import { Router } from 'express'
import { z } from 'zod'
import { pool, transaction, type Db } from './db.js'
import { ApiError, route, id, uuid, page, textField, quantity, dateTime } from './http.js'
import { requireAuth, isStaff, assertOwner } from './security.js'
import { getItems, getDonation } from './models.js'
import { audit, notify } from './communications.js'
export const inventory = Router()
export const donationLine = z
  .object({
    name: textField(160),
    qty: quantity,
    unit: textField(30),
    storage: z.enum(['ambient', 'chilled', 'frozen']),
    expiresOn: dateTime.nullable().optional(),
    weightGrams: z.number().int().min(1).max(100000),
    category: textField(60).default('other'),
    allergens: z.array(textField(60)).max(30).default([]),
    handlingNotes: z.string().trim().max(1000).default(''),
  })
  .strict()
export async function movement(
  db: Db,
  itemId: string,
  delta: number,
  kind: string,
  actorId: string | null,
  orderId: string | null = null,
  reason = '',
) {
  await db.query(
    'INSERT INTO inventory_movements(item_id,delta,kind,actor_id,order_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [itemId, delta, kind, actorId, orderId, reason],
  )
}
inventory.get(
  '/items',
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const surplus = z.enum(['true', 'false']).optional().parse(req.query.surplus)
    res.json(
      await getItems(
        pool,
        "i.status='available' AND i.qty>0 AND (i.expires_on IS NULL OR i.expires_on>now()) AND ($1::boolean IS NULL OR i.is_surplus=$1) ORDER BY i.expires_on NULLS LAST,i.id LIMIT $2 OFFSET $3",
        [surplus === undefined ? null : surplus === 'true', limit, offset],
      ),
    )
  }),
)
inventory.get(
  '/inventory',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    res.json(await getItems(pool, 'true ORDER BY i.created_at DESC,i.id LIMIT $1 OFFSET $2', [limit, offset]))
  }),
)
inventory.get(
  '/donations',
  requireAuth('donor', 'admin', 'volunteer'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      'SELECT id FROM donations WHERE ($1::boolean OR donor_id=$2) ORDER BY date DESC,id LIMIT $3 OFFSET $4',
      [isStaff(req), req.user!.id, limit, offset],
    )
    res.json(await Promise.all(rows.map((r) => getDonation(pool, r.id))))
  }),
)
inventory.get(
  '/donations/:id',
  requireAuth('donor', 'admin', 'volunteer'),
  route(async (req, res) => {
    const donation = await getDonation(pool, id(req))
    if (!donation) throw new ApiError(404, 'NOT_FOUND', 'Donation not found')
    assertOwner(req, donation.donorId)
    res.json(donation)
  }),
)
inventory.post(
  '/donations',
  requireAuth('donor', 'admin'),
  route(async (req, res) => {
    const data = z
      .object({ date: dateTime.optional(), items: z.array(donationLine).min(1).max(50) })
      .strict()
      .parse(req.body)
    const result = await transaction(async (db) => {
      // Serialize new offers with deactivation and anonymization of the donor account.
      const currentUser = (
        await db.query('SELECT id,role,disabled,email_verified FROM users WHERE id=$1 FOR SHARE', [
          req.user!.id,
        ])
      ).rows[0]
      if (!currentUser || currentUser.disabled) throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in')
      if (!['donor', 'admin'].includes(currentUser.role))
        throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action')
      if (!currentUser.email_verified)
        throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before using this feature')
      const donation = (
        await db.query('INSERT INTO donations(donor_id,date) VALUES($1,$2) RETURNING id', [
          req.user!.id,
          data.date || new Date().toISOString(),
        ])
      ).rows[0]
      for (const line of data.items) {
        if (line.expiresOn && new Date(line.expiresOn) <= new Date())
          throw new ApiError(400, 'EXPIRED_FOOD', 'Offered food must not be expired')
        const item = (
          await db.query(
            "INSERT INTO items(name,qty,unit,storage,expires_on,donor_id,status,weight_grams,category,allergens,handling_notes) VALUES($1,0,$2,$3,$4,$5,'offered',$6,$7,$8,$9) RETURNING id",
            [
              line.name,
              line.unit,
              line.storage,
              line.expiresOn,
              req.user!.id,
              line.weightGrams,
              line.category,
              line.allergens,
              line.handlingNotes,
            ],
          )
        ).rows[0]
        await db.query(
          'INSERT INTO donation_items(donation_id,item_id,offered_qty,name_snapshot,unit_snapshot) VALUES($1,$2,$3,$4,$5)',
          [donation.id, item.id, line.qty, line.name, line.unit],
        )
      }
      await audit(db, req.user!.id, 'donation.offered', 'donation', donation.id)
      await notify(
        db,
        req.user!.id,
        'Donation offered',
        'Your donation has been submitted. Food becomes available after staff receipt and safety checks.',
      )
      return getDonation(db, donation.id)
    })
    res.status(201).json(result)
  }),
)
inventory.put(
  '/donations/:id',
  requireAuth('donor', 'admin', 'volunteer'),
  route(async (req, res) => {
    const data = z
      .object({
        date: dateTime.optional(),
        items: z
          .array(donationLine.extend({ id: uuid }))
          .min(1)
          .max(50),
      })
      .strict()
      .parse(req.body)
    const donationId = id(req)
    const result = await transaction(async (db) => {
      const d = (await db.query('SELECT * FROM donations WHERE id=$1 FOR UPDATE', [donationId])).rows[0]
      if (!d) throw new ApiError(404, 'NOT_FOUND', 'Donation not found')
      assertOwner(req, d.donor_id)
      if (d.status !== 'scheduled')
        throw new ApiError(409, 'INVALID_TRANSITION', 'Only scheduled offers can be edited')
      const before = await getDonation(db, donationId)
      const ids = (
        await db.query('SELECT item_id FROM donation_items WHERE donation_id=$1', [donationId])
      ).rows.map((r) => r.item_id)
      if (
        data.items.length !== ids.length ||
        new Set(data.items.map((i) => i.id)).size !== ids.length ||
        data.items.some((i) => !ids.includes(i.id))
      )
        throw new ApiError(400, 'INVALID_ITEMS', 'Update the existing offer lines using their IDs')
      for (const line of data.items) {
        if (line.expiresOn && new Date(line.expiresOn) <= new Date())
          throw new ApiError(400, 'EXPIRED_FOOD', 'Offered food must not be expired')
        await db.query(
          'UPDATE items SET name=$2,unit=$3,storage=$4,expires_on=$5,weight_grams=$6,category=$7,allergens=$8,handling_notes=$9 WHERE id=$1',
          [
            line.id,
            line.name,
            line.unit,
            line.storage,
            line.expiresOn,
            line.weightGrams,
            line.category,
            line.allergens,
            line.handlingNotes,
          ],
        )
        await db.query(
          'UPDATE donation_items SET offered_qty=$3,name_snapshot=$4,unit_snapshot=$5 WHERE donation_id=$1 AND item_id=$2',
          [donationId, line.id, line.qty, line.name, line.unit],
        )
      }
      if (data.date) await db.query('UPDATE donations SET date=$2 WHERE id=$1', [donationId, data.date])
      await audit(db, req.user!.id, 'donation.offer-edited', 'donation', donationId, {
        previousItems: before?.items.map((i) => ({ id: i.id, qty: i.offeredQty, name: i.name })),
      })
      return getDonation(db, donationId)
    })
    res.json(result)
  }),
)
inventory.patch(
  '/donations/:id',
  requireAuth('donor', 'admin', 'volunteer'),
  route(async (req, res) => {
    const d = z
      .object({ status: z.enum(['received', 'cancelled']), notes: z.string().trim().max(2000).optional() })
      .strict()
      .parse(req.body)
    if (d.status === 'received' && !isStaff(req))
      throw new ApiError(403, 'FORBIDDEN', 'Staff must receive food')
    const donationId = id(req)
    const result = await transaction(async (db) => {
      const donation = (await db.query('SELECT * FROM donations WHERE id=$1 FOR UPDATE', [donationId]))
        .rows[0]
      if (!donation) throw new ApiError(404, 'NOT_FOUND', 'Donation not found')
      assertOwner(req, donation.donor_id)
      if (donation.status === d.status) return getDonation(db, donationId)
      if (donation.status !== 'scheduled')
        throw new ApiError(409, 'INVALID_TRANSITION', 'This donation is no longer a scheduled offer')
      const lines = (
        await db.query(
          'SELECT i.*,di.offered_qty FROM donation_items di JOIN items i ON i.id=di.item_id WHERE di.donation_id=$1 ORDER BY i.id FOR UPDATE OF i',
          [donationId],
        )
      ).rows
      for (const line of lines) {
        if (d.status === 'received') {
          if (line.expires_on && new Date(line.expires_on) <= new Date())
            throw new ApiError(409, 'EXPIRED_FOOD', 'Expired food cannot be received')
          if (line.weight_grams <= 0)
            throw new ApiError(409, 'WEIGHT_REQUIRED', 'Set the weight for all offered items before receipt')
          await db.query("UPDATE items SET qty=$2,status='available' WHERE id=$1", [
            line.id,
            line.offered_qty,
          ])
          await db.query(
            'UPDATE donation_items SET received_qty=offered_qty WHERE donation_id=$1 AND item_id=$2',
            [donationId, line.id],
          )
          await movement(db, line.id, line.offered_qty, 'receipt', req.user!.id)
        } else await db.query("UPDATE items SET status='disposed' WHERE id=$1", [line.id])
      }
      await db.query(
        "UPDATE donations SET status=$2,received_at=CASE WHEN $2='received' THEN now() ELSE received_at END,notes=coalesce($3,notes) WHERE id=$1",
        [donationId, d.status, d.notes],
      )
      await audit(db, req.user!.id, `donation.${d.status}`, 'donation', donationId, { notes: d.notes || '' })
      await notify(
        db,
        donation.donor_id,
        `Donation ${d.status}`,
        `Your donation ${donationId} has been ${d.status}.`,
      )
      return getDonation(db, donationId)
    })
    res.json(result)
  }),
)
inventory.patch(
  '/items/:id',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const data = z
      .object({
        isSurplus: z.boolean().optional(),
        priceCents: z.number().int().min(0).max(100000).optional(),
        handlingNotes: z.string().max(1000).optional(),
      })
      .strict()
      .parse(req.body)
    const itemId = id(req)
    await transaction(async (db) => {
      const item = (await db.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [itemId])).rows[0]
      if (!item) throw new ApiError(404, 'NOT_FOUND', 'Item not found')
      if (data.isSurplus !== undefined || data.priceCents !== undefined) {
        if (item.status !== 'available')
          throw new ApiError(
            409,
            'INVALID_TRANSITION',
            'Only available stock can be released to the marketplace',
          )
        if ((data.isSurplus ?? item.is_surplus) && (data.priceCents ?? item.price_cents ?? 0) <= 0)
          throw new ApiError(400, 'PRICE_REQUIRED', 'Surplus needs a positive price')
        const allocated = await db.query(
          "SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.item_id=$1 AND o.status IN ('pending','confirmed') LIMIT 1",
          [itemId],
        )
        if (allocated.rowCount)
          throw new ApiError(
            409,
            'ALLOCATED_STOCK',
            'Wait until existing reservations complete before changing allocation or price',
          )
      }
      await db.query(
        'UPDATE items SET is_surplus=coalesce($2,is_surplus),price_cents=coalesce($3,price_cents),handling_notes=coalesce($4,handling_notes) WHERE id=$1',
        [itemId, data.isSurplus, data.priceCents, data.handlingNotes],
      )
      await audit(db, req.user!.id, 'inventory.updated', 'item', itemId, data)
    })
    res.json((await getItems(pool, 'i.id=$1', [itemId]))[0])
  }),
)
inventory.post(
  '/items/:id/dispose',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const data = z
      .object({ qty: quantity, reason: textField(1000) })
      .strict()
      .parse(req.body)
    const itemId = id(req)
    await transaction(async (db) => {
      const item = (await db.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [itemId])).rows[0]
      if (!item) throw new ApiError(404, 'NOT_FOUND', 'Item not found')
      if (item.qty < data.qty || !['available', 'exhausted'].includes(item.status))
        throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Only unallocated received stock can be disposed')
      await db.query(
        "UPDATE items SET qty=qty-$2,status=CASE WHEN qty=$2 THEN 'disposed' ELSE status END WHERE id=$1",
        [itemId, data.qty],
      )
      await movement(db, itemId, -data.qty, 'dispose', req.user!.id, null, data.reason)
      await audit(db, req.user!.id, 'inventory.disposed', 'item', itemId, data)
    })
    res.json((await getItems(pool, 'i.id=$1', [itemId]))[0])
  }),
)
inventory.get(
  '/items/:id/ledger',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      'SELECT * FROM inventory_movements WHERE item_id=$1 ORDER BY created_at,id LIMIT $2 OFFSET $3',
      [id(req), limit, offset],
    )
    res.json(
      rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        delta: r.delta,
        kind: r.kind,
        reason: r.reason,
        createdAt: r.created_at,
        actorId: r.actor_id,
        orderId: r.order_id,
      })),
    )
  }),
)
