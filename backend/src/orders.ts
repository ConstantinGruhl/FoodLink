import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { pool, transaction } from './db.js'
import { config } from './config.js'
import { ApiError, route, id, uuid, quantity, textField, dateTime, page } from './http.js'
import { requireAuth, token, hash } from './security.js'
import { assertLocation, assertRecordAccess, canAt, requireCharityManager, loadMemberships, membershipAllows } from './tenancy.js'
import { getOrder, eventDto, type Row } from './models.js'
import { movement } from './inventory.js'
import { audit, notify } from './communications.js'
import { createCheckout, expireCheckout, refundPayment, retrieveRefund, verifyWebhook } from './payments.js'
import { createBookingLocked, assertBookingCapacity } from './distribution.js'
import { lockHousehold, householdAccess, releaseBooking, consumeBooking } from './entitlements.js'
export const orders = Router()
export const basketSchema = z
  .object({
    eventId: uuid,
    householdId: uuid.optional(),
    slotId: uuid.optional(),
    collectorId: uuid.optional(),
    items: z
      .array(z.object({ itemId: uuid, qty: quantity }).strict())
      .min(1)
      .max(50),
    fulfillment: z.enum(['pickup', 'delivery']).default('pickup'),
    deliveryAddress: z.string().trim().min(10).max(500).optional(),
    supportContributionCents: z.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (new Set(d.items.map((i) => i.itemId)).size !== d.items.length)
      ctx.addIssue({ code: 'custom', message: 'An item may only occur once', path: ['items'] })
    if (d.fulfillment === 'delivery' && !d.deliveryAddress)
      ctx.addIssue({ code: 'custom', message: 'Delivery address is required', path: ['deliveryAddress'] })
  })
export const eventSchema = z
  .object({
    startsAt: dateTime,
    endsAt: dateTime,
    cutoffAt: dateTime,
    location: textField(300),
    capacity: z.number().int().min(1).max(10000),
    allowDelivery: z.boolean().default(false),
    timezone: textField(60).default(config.timezone),
    mode: z.enum(['items','visit','packages']).default('items'),
    recordingMode: z.enum(['opening','leftovers-only']).default('opening'),
    walkInCapacity: z.number().int().min(0).max(10000).default(0),
    waitlistEnabled: z.boolean().default(false),
    packageLabel: z.string().trim().max(200).default(''),
    slots: z.array(z.object({startsAt:dateTime,endsAt:dateTime,capacity:z.number().int().min(1).max(10000)}).strict()).max(100).default([]),
    recurrence: z.object({weeks:z.number().int().min(1).max(12)}).strict().optional(),
  })
  .strict()
export function validateEvent(d: Pick<z.infer<typeof eventSchema>,'startsAt'|'endsAt'|'cutoffAt'|'timezone'> & Partial<z.infer<typeof eventSchema>>) {
  if (new Date(d.startsAt) >= new Date(d.endsAt) || new Date(d.cutoffAt) > new Date(d.startsAt))
    throw new ApiError(
      400,
      'INVALID_EVENT_TIME',
      'Cutoff must precede the start, and the end must follow the start',
    )
  if (new Date(d.endsAt) <= new Date())
    throw new ApiError(400, 'PAST_EVENT', 'The event must end in the future')
  try {
    new Intl.DateTimeFormat('en', { timeZone: d.timezone })
  } catch {
    throw new ApiError(400, 'INVALID_TIMEZONE', 'Unknown event timezone')
  }
  if((d.walkInCapacity||0)>(d.capacity||0))throw new ApiError(400,'INVALID_CAPACITY','Walk-in places must fit inside total household capacity')
  const slots=[...(d.slots||[])].sort((a,b)=>a.startsAt.localeCompare(b.startsAt))
  for(let n=0;n<slots.length;n++){
    const s=slots[n]
    if(new Date(s.startsAt)>=new Date(s.endsAt)||new Date(s.startsAt)<new Date(d.startsAt)||new Date(s.endsAt)>new Date(d.endsAt))throw new ApiError(400,'INVALID_SLOT','Time slots must fit inside the event')
    if(n&&new Date(slots[n-1].endsAt)>new Date(s.startsAt))throw new ApiError(400,'OVERLAPPING_SLOTS','Time slots must not overlap')
  }
  if(slots.reduce((sum,s)=>sum+s.capacity,0)>(d.capacity||0)-(d.walkInCapacity||0))throw new ApiError(400,'INVALID_SLOT_CAPACITY','Slot places exceed advance booking capacity')
}
export async function lockEvent(db: PoolClient, eventId: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('event:'||$1))", [eventId])
  return (await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [eventId])).rows[0]
}
async function lockOrder(db: PoolClient, orderId: string) {
  const found = (await db.query('SELECT event_id FROM orders WHERE id=$1', [orderId])).rows[0]
  if (!found) throw new ApiError(404, 'NOT_FOUND', 'Order not found')
  if (found.event_id) await lockEvent(db, found.event_id)
  return (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0]
}
export async function cancelLocked(
  db: PoolClient,
  order: Row,
  actorId: string | null,
  status = 'cancelled',
  reason = 'Order cancelled',
) {
  if (['cancelled', 'expired'].includes(order.status)) return
  if (!['pending', 'confirmed'].includes(order.status))
    throw new ApiError(409, 'INVALID_TRANSITION', 'A completed order cannot be cancelled')
  if (order.payment_mode!=='local-fixture' && order.stripe_session_id && order.payment_status === 'pending')
    await expireCheckout(order.stripe_session_id)
  let payment = order.payment_status
  if (payment === 'paid') {
    payment = order.payment_mode==='local-fixture'?'refunded':'refund-pending'
  } else if (payment === 'pending') payment = 'failed'
  const lines = (
    await db.query(
      'SELECT i.*,oi.qty reserved_qty FROM order_items oi JOIN items i ON i.id=oi.item_id WHERE oi.order_id=$1 ORDER BY i.id FOR UPDATE OF i',
      [order.id],
    )
  ).rows
  for (const line of lines) {
    const deadline=line.distribution_deadline||line.expires_on
    const expired = deadline && new Date(deadline) <= new Date()
    await db.query("UPDATE items SET qty=qty+$2,status=CASE WHEN status='disposed' THEN status ELSE 'available' END WHERE id=$1", [line.id, line.reserved_qty])
    await movement(db, line.id, line.reserved_qty, 'restock', actorId, order.id, reason)
    if (expired) {
      await db.query(
        "UPDATE items SET qty=qty-$2,status=CASE WHEN qty=$2 THEN 'disposed' ELSE status END WHERE id=$1",
        [line.id, line.reserved_qty],
      )
      await movement(db, line.id, -line.reserved_qty, 'expire', actorId, order.id, 'Expired reserved stock')
    }
  }
  await db.query('UPDATE orders SET status=$2,payment_status=$3,pickup_token=null WHERE id=$1', [
    order.id,
    status,
    payment,
  ])
  if(order.booking_id)await releaseBooking(db,order.booking_id)
  await audit(db, actorId, `order.${status}`, 'order', order.id, { reason })
  await notify(
    db,
    order.user_id,
    `Order ${status}`,
    `Your FoodLink order ${order.id} was ${status}. ${reason}`,
  )
}
const eventQuery =
  "SELECT e.*,(SELECT count(*) FROM orders o WHERE o.event_id=e.id AND o.status NOT IN ('cancelled','expired')) reserved_count FROM events e"
orders.get(
  '/events',
  route(async (req, res) => {
    const all = req.query.all === 'true'
    if (all && !isStaff(req)) throw new ApiError(403, 'FORBIDDEN', 'Only staff can view event history')
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      `${eventQuery} WHERE ($1::boolean OR (e.ends_at>now() AND e.status='scheduled')) ORDER BY e.starts_at,e.id LIMIT $2 OFFSET $3`,
      [all, limit, offset],
    )
    res.json(rows.map(eventDto))
  }),
)
orders.get(
  '/events/next',
  route(async (_req, res) => {
    const { rows } = await pool.query(
      `${eventQuery} WHERE e.starts_at>now() AND e.cutoff_at>now() AND e.status='scheduled' ORDER BY e.starts_at,e.id LIMIT 1`,
    )
    res.json(rows[0] ? eventDto(rows[0]) : null)
  }),
)
orders.post(
  '/events',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const d = eventSchema.parse(req.body)
    validateEvent(d)
    const result = await transaction(async (db) => {
      const { rows } = await db.query(
        'INSERT INTO events(date,starts_at,ends_at,cutoff_at,location,pickup_window,capacity,allow_delivery,timezone) VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [
          d.startsAt,
          d.endsAt,
          d.cutoffAt,
          d.location,
          windowLabel(d),
          d.capacity,
          d.allowDelivery,
          d.timezone,
        ],
      )
      await audit(db, req.user!.id, 'event.created', 'event', rows[0].id, d)
      return eventDto(rows[0])
    })
    res.status(201).json(result)
  }),
)
function windowLabel(d: { startsAt: string; endsAt: string; timezone: string }) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: d.timezone, hour: '2-digit', minute: '2-digit' })
  return `${f.format(new Date(d.startsAt))}–${f.format(new Date(d.endsAt))}`
}
orders.patch(
  '/events/:id',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const changes = eventSchema
      .partial()
      .extend({ status: z.enum(['cancelled', 'completed']).optional() })
      .strict()
      .parse(req.body)
    const eventId = id(req)
    const result = await transaction(async (db) => {
      const e = await lockEvent(db, eventId)
      if (!e) throw new ApiError(404, 'NOT_FOUND', 'Event not found')
      if (e.status !== 'scheduled')
        throw new ApiError(409, 'INVALID_TRANSITION', 'Only scheduled events can be changed')
      const d = {
        startsAt: e.starts_at.toISOString(),
        endsAt: e.ends_at.toISOString(),
        cutoffAt: e.cutoff_at.toISOString(),
        location: e.location,
        capacity: e.capacity,
        allowDelivery: e.allow_delivery,
        timezone: e.timezone,
        ...changes,
      }
      const active = (
        await db.query(
          "SELECT * FROM orders WHERE event_id=$1 AND status IN ('pending','confirmed') ORDER BY id FOR UPDATE",
          [eventId],
        )
      ).rows
      if (changes.status === 'cancelled') {
        for (const o of active)
          await cancelLocked(db, o, req.user!.id, 'cancelled', 'Distribution event cancelled')
      } else if (changes.status === 'completed') {
        if (active.length)
          throw new ApiError(
            409,
            'OPEN_ORDERS',
            'Collect, deliver, or cancel remaining orders before completing the event',
          )
        if (new Date(e.starts_at) > new Date())
          throw new ApiError(409, 'EVENT_NOT_STARTED', 'The event has not started')
      } else {
        validateEvent(d)
        const used = Number(
          (
            await db.query(
              "SELECT count(*) n FROM orders WHERE event_id=$1 AND status NOT IN ('cancelled','expired')",
              [eventId],
            )
          ).rows[0].n,
        )
        if (d.capacity < used)
          throw new ApiError(409, 'CAPACITY_IN_USE', 'Capacity cannot be reduced below existing orders')
        if (
          active.length &&
          (changes.startsAt || changes.endsAt || changes.cutoffAt || changes.allowDelivery !== undefined)
        )
          throw new ApiError(
            409,
            'EVENT_HAS_ORDERS',
            'Time and fulfillment changes require cancelling existing orders first',
          )
      }
      await db.query(
        'UPDATE events SET date=$2,starts_at=$2,ends_at=$3,cutoff_at=$4,location=$5,pickup_window=$6,capacity=$7,allow_delivery=$8,timezone=$9,status=coalesce($10,status) WHERE id=$1',
        [
          eventId,
          d.startsAt,
          d.endsAt,
          d.cutoffAt,
          d.location,
          windowLabel(d),
          d.capacity,
          d.allowDelivery,
          d.timezone,
          d.status,
        ],
      )
      await audit(db, req.user!.id, 'event.updated', 'event', eventId, changes)
      if (changes.location)
        for (const o of active) {
          await db.query('UPDATE orders SET event_snapshot=event_snapshot||$2::jsonb WHERE id=$1', [
            o.id,
            JSON.stringify({ location: d.location }),
          ])
          await notify(
            db,
            o.user_id,
            'Pickup location updated',
            `The distribution location is now ${d.location}.`,
          )
        }
      return eventDto((await db.query(`${eventQuery} WHERE e.id=$1`, [eventId])).rows[0])
    })
    res.json(result)
  }),
)
async function reserve(req: import('express').Request, buyer: boolean) {
  if (buyer && !config.paymentsEnabled)
    throw new ApiError(503, 'PAYMENTS_DISABLED', 'Purchases are not available. No payment has been taken')
  const data = basketSchema.parse(req.body)
  if (!buyer && data.supportContributionCents)
    throw new ApiError(400, 'INVALID_CONTRIBUTION', 'Contributions are only accepted through buyer checkout')
  const key = uuid.parse(req.get('Idempotency-Key'))
  const requestHash = hash(
    JSON.stringify({
      ...data,
      items: [...data.items].sort((a, b) => a.itemId.localeCompare(b.itemId)),
      buyer,
    }),
  )
  return transaction(async (db) => {
    // Keep account changes and privacy completion behind this reservation until it commits.
    // The account lock always precedes idempotency, event and inventory locks.
    const currentUser = (
      await db.query('SELECT id,role,disabled,email_verified,verified FROM users WHERE id=$1 FOR SHARE', [
        req.user!.id,
      ])
    ).rows[0]
    if (!currentUser || currentUser.disabled) throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in')
    if (currentUser.role !== (buyer ? 'buyer' : 'recipient'))
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action')
    if (!currentUser.email_verified)
      throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before using this feature')
    if (!buyer && !currentUser.verified)
      throw new ApiError(403, 'RECIPIENT_NOT_APPROVED', 'Staff must approve your recipient eligibility')
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${req.user!.id}:${key}`])
    const previous = (
      await db.query('SELECT * FROM idempotency_keys WHERE user_id=$1 AND key=$2', [req.user!.id, key])
    ).rows[0]
    if (previous) {
      if (previous.request_hash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This submission key was already used for another basket',
        )
      return { order: (await getOrder(db, previous.order_id))!, replayed: true }
    }
    const event = await lockEvent(db, data.eventId)
    if (!event || event.status !== 'scheduled' || new Date(event.cutoff_at) <= new Date())
      throw new ApiError(409, 'EVENT_CLOSED', 'Choose an upcoming event with an open booking window')
    if (buyer && new Date(event.cutoff_at).getTime() < Date.now() + 36 * 60000)
      throw new ApiError(
        409,
        'CHECKOUT_WINDOW_CLOSED',
        'Checkout closes 36 minutes before the booking cutoff',
      )
    if (data.fulfillment === 'delivery' && !event.allow_delivery)
      throw new ApiError(409, 'DELIVERY_UNAVAILABLE', 'This event does not offer delivery')
    const count = Number(
      (
        await db.query(
          "SELECT count(*) n FROM orders WHERE event_id=$1 AND status NOT IN ('cancelled','expired')",
          [event.id],
        )
      ).rows[0].n,
    )
    if (count >= event.capacity) throw new ApiError(409, 'EVENT_FULL', 'This event is full')
    const current = Number(
      (
        await db.query(
          "SELECT coalesce(sum(oi.qty),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.user_id=$1 AND o.event_id=$2 AND o.status NOT IN ('cancelled','expired')",
          [req.user!.id, event.id],
        )
      ).rows[0].n,
    )
    if (current + data.items.reduce((s, i) => s + i.qty, 0) > config.maxBasketUnits)
      throw new ApiError(400, 'BASKET_LIMIT', `Limit ${config.maxBasketUnits} units per person per event`)
    const lines = (
      await db.query('SELECT * FROM items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
        data.items.map((i) => i.itemId),
      ])
    ).rows
    if (lines.length !== data.items.length) throw new ApiError(404, 'NOT_FOUND', 'An item no longer exists')
    let total = data.supportContributionCents
    for (const item of lines) {
      const qty = data.items.find((l) => l.itemId === item.id)!.qty
      if (item.status !== 'available' || item.qty < qty)
        throw new ApiError(409, 'INSUFFICIENT_STOCK', `${item.name} has insufficient available stock`)
      if (item.expires_on && new Date(item.expires_on) <= new Date(event.ends_at))
        throw new ApiError(409, 'EXPIRED_FOOD', `${item.name} expires before this event ends`)
      if (item.is_surplus !== buyer)
        throw new ApiError(403, 'ALLOCATION_MISMATCH', 'This food is allocated to a different program')
      if (buyer && item.price_cents <= 0)
        throw new ApiError(409, 'INVALID_PRICE', 'This item is not available for purchase')
      total += buyer ? (item.price_cents || 0) * qty : 0
    }
    if (total > 1000000) throw new ApiError(400, 'TOTAL_LIMIT', 'Order total exceeds the supported limit')
    const order = (
      await db.query(
        "INSERT INTO orders(user_id,type,status,event_id,total_cents,support_contribution_cents,payment_status,pickup_token,fulfillment,delivery_address,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $11 THEN now()+interval '35 minutes' ELSE $12 END) RETURNING id",
        [
          req.user!.id,
          buyer ? 'buyer-order' : 'recipient-reservation',
          buyer ? 'pending' : 'confirmed',
          event.id,
          total,
          data.supportContributionCents,
          buyer ? 'pending' : 'not-required',
          token(),
          data.fulfillment,
          data.fulfillment === 'delivery' ? data.deliveryAddress : null,
          buyer,
          event.ends_at,
        ],
      )
    ).rows[0]
    for (const item of lines) {
      const qty = data.items.find((l) => l.itemId === item.id)!.qty
      await db.query(
        "UPDATE items SET qty=qty-$2,status=CASE WHEN qty=$2 THEN 'exhausted' ELSE status END WHERE id=$1",
        [item.id, qty],
      )
      await db.query(
        'INSERT INTO order_items(order_id,item_id,qty,name_snapshot,unit_snapshot,price_cents,weight_grams) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [order.id, item.id, qty, item.name, item.unit, buyer ? item.price_cents : 0, item.weight_grams],
      )
      await movement(db, item.id, -qty, 'reserve', req.user!.id, order.id)
    }
    await db.query('UPDATE orders SET event_snapshot=$2 WHERE id=$1', [
      order.id,
      JSON.stringify(eventDto(event)),
    ])
    await db.query('INSERT INTO idempotency_keys(user_id,key,request_hash,order_id) VALUES($1,$2,$3,$4)', [
      req.user!.id,
      key,
      requestHash,
      order.id,
    ])
    await audit(db, req.user!.id, buyer ? 'order.checkout-started' : 'order.reserved', 'order', order.id)
    if (!buyer)
      await notify(
        db,
        req.user!.id,
        'Reservation confirmed',
        `Your reservation ${order.id} is confirmed. View your pickup ticket in FoodLink. Event: ${event.starts_at.toISOString()}, ${event.location}.`,
      )
    return { order: (await getOrder(db, order.id))!, replayed: false }
  })
}
orders.post(
  '/orders/reserve',
  requireAuth('recipient'),
  route(async (req, res) => {
    const result = await reserve(req, false)
    res.status(result.replayed ? 200 : 201).json(result.order)
  }),
)
orders.post(
  '/orders/checkout',
  requireAuth('buyer'),
  route(async (req, res) => {
    const result = await reserve(req, true)
    const stored = (await pool.query('SELECT * FROM orders WHERE id=$1', [result.order.id])).rows[0]
    if (stored.status !== 'pending')
      throw new ApiError(409, 'CHECKOUT_CLOSED', 'This checkout is no longer pending')
    let checkoutUrl = stored.checkout_url
    if (!checkoutUrl) {
      const session = await createCheckout(
        { ...result.order, expiresAt: stored.expires_at.toISOString() },
        req.user!.email,
      )
      await transaction(async (db) => {
        const order = await lockOrder(db, stored.id)
        if (order.status !== 'pending') {
          await expireCheckout(session.id)
          throw new ApiError(409, 'CHECKOUT_CLOSED', 'This checkout was cancelled')
        }
        await db.query('UPDATE orders SET stripe_session_id=$2,checkout_url=$3 WHERE id=$1', [
          stored.id,
          session.id,
          session.url,
        ])
      })
      checkoutUrl = session.url
    }
    res.status(result.replayed ? 200 : 201).json({ order: result.order, checkoutUrl })
  }),
)
async function orderList(
  req: import('express').Request,
  where: string,
  params: unknown[],
  includeToken = false,
) {
  const [limit, offset] = page(req)
  const { rows } = await pool.query(
    `SELECT id FROM orders WHERE ${where} ORDER BY created_at DESC,id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  return Promise.all(rows.map((r) => getOrder(pool, r.id, includeToken)))
}
orders.get(
  '/orders/mine',
  requireAuth(),
  route(async (req, res) => res.json(await orderList(req, 'user_id=$1', [req.user!.id], true))),
)
orders.get(
  '/orders',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => res.json(await orderList(req, 'true', []))),
)
orders.get(
  '/deliveries',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) =>
    res.json(
      await orderList(
        req,
        "fulfillment='delivery' AND ($1::boolean OR assigned_volunteer_id=$2 OR assigned_volunteer_id IS NULL)",
        [req.user!.role === 'admin', req.user!.id],
      ),
    ),
  ),
)
orders.get(
  '/orders/:id',
  requireAuth(),
  route(async (req, res) => {
    const order = await getOrder(pool, id(req))
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found')
    assertOwner(req, order.userId)
    if (order.userId !== req.user!.id) order.pickupToken = null
    res.json(order)
  }),
)
orders.post(
  '/orders/:id/cancel',
  requireAuth(),
  route(async (req, res) => {
    const orderId = id(req)
    const result = await transaction(async (db) => {
      const order = await lockOrder(db, orderId)
      assertOwner(req, order.user_id)
      if (!isStaff(req) && !['cancelled', 'expired'].includes(order.status)) {
        const event = (await db.query('SELECT cutoff_at FROM events WHERE id=$1', [order.event_id])).rows[0]
        if (event && new Date(event.cutoff_at) <= new Date())
          throw new ApiError(409, 'CANCELLATION_CLOSED', 'Contact staff to cancel after the booking cutoff')
      }
      await cancelLocked(db, order, req.user!.id)
      return getOrder(db, orderId)
    })
    res.json(result)
  }),
)
async function complete(
  db: PoolClient,
  order: Row,
  actorId: string,
  status: 'picked-up' | 'delivered',
  proof?: string,
) {
  if (order.status !== 'confirmed')
    throw new ApiError(409, 'ALREADY_REDEEMED', 'This order is no longer awaiting fulfillment')
  const event = (await db.query('SELECT * FROM events WHERE id=$1', [order.event_id])).rows[0]
  if (!event || event.status !== 'scheduled' || new Date(event.ends_at) <= new Date())
    throw new ApiError(409, 'EVENT_CLOSED', 'This event is no longer open')
  if (new Date(event.starts_at).getTime() > Date.now() + 30 * 60000)
    throw new ApiError(409, 'PICKUP_NOT_OPEN', 'Collection opens 30 minutes before the event')
  const expired = await db.query(
    'SELECT 1 FROM order_items oi JOIN items i ON i.id=oi.item_id WHERE oi.order_id=$1 AND i.expires_on<=now() LIMIT 1',
    [order.id],
  )
  if (expired.rowCount)
    throw new ApiError(409, 'EXPIRED_FOOD', 'This order contains expired food; cancel it for disposal')
  if (order.type === 'buyer-order' && order.payment_status !== 'paid')
    throw new ApiError(409, 'PAYMENT_REQUIRED', 'Payment must be confirmed before fulfillment')
  await db.query(
    'UPDATE orders SET status=$2,completed_at=now(),pickup_token=null,delivery_proof=$3 WHERE id=$1',
    [order.id, status, proof || null],
  )
  await audit(db, actorId, `order.${status}`, 'order', order.id, { hasProof: !!proof })
  await notify(
    db,
    order.user_id,
    status === 'delivered' ? 'Delivery completed' : 'Pickup completed',
    `Your FoodLink order ${order.id} has been ${status}.`,
  )
}
orders.post(
  '/orders/redeem',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const data = z
      .object({ token: textField(100) })
      .strict()
      .parse(req.body)
    const result = await transaction(async (db) => {
      const found = (await db.query('SELECT id FROM orders WHERE pickup_token=$1', [data.token])).rows[0]
      if (!found)
        throw new ApiError(409, 'INVALID_PICKUP_TOKEN', 'This pickup ticket is invalid or was already used')
      const order = await lockOrder(db, found.id)
      if (order.pickup_token !== data.token || order.fulfillment !== 'pickup')
        throw new ApiError(409, 'INVALID_PICKUP_TOKEN', 'This pickup ticket is invalid or was already used')
      await complete(db, order, req.user!.id, 'picked-up')
      return getOrder(db, order.id)
    })
    res.json(result)
  }),
)
orders.post(
  '/orders/:id/assign',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const data = z.object({ volunteerId: uuid }).strict().parse(req.body)
    if (req.user!.role === 'volunteer' && data.volunteerId !== req.user!.id)
      throw new ApiError(403, 'FORBIDDEN', 'Volunteers can claim deliveries for themselves')
    const result = await transaction(async (db) => {
      const order = await lockOrder(db, id(req))
      if (order.fulfillment !== 'delivery' || order.status !== 'confirmed')
        throw new ApiError(409, 'INVALID_TRANSITION', 'Only confirmed deliveries can be assigned')
      if (
        req.user!.role === 'volunteer' &&
        order.assigned_volunteer_id &&
        order.assigned_volunteer_id !== req.user!.id
      )
        throw new ApiError(409, 'ALREADY_ASSIGNED', 'This delivery is assigned to another volunteer')
      const user = (
        await db.query(
          "SELECT id FROM users WHERE id=$1 AND role IN ('volunteer','admin') AND NOT disabled AND email_verified",
          [data.volunteerId],
        )
      ).rows[0]
      if (!user) throw new ApiError(400, 'INVALID_VOLUNTEER', 'Choose an active verified volunteer')
      await db.query('UPDATE orders SET assigned_volunteer_id=$2 WHERE id=$1', [order.id, data.volunteerId])
      await audit(db, req.user!.id, 'delivery.assigned', 'order', order.id, data)
      await notify(
        db,
        data.volunteerId,
        'Delivery assigned',
        `Delivery ${order.id} has been assigned to you. View address details securely in FoodLink.`,
      )
      return getOrder(db, order.id)
    })
    res.json(result)
  }),
)
orders.post(
  '/orders/:id/deliver',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const data = z
      .object({ proof: textField(1000) })
      .strict()
      .parse(req.body)
    const result = await transaction(async (db) => {
      const order = await lockOrder(db, id(req))
      if (
        order.fulfillment !== 'delivery' ||
        (req.user!.role !== 'admin' && order.assigned_volunteer_id !== req.user!.id)
      )
        throw new ApiError(403, 'FORBIDDEN', 'Only the assigned volunteer can complete this delivery')
      await complete(db, order, req.user!.id, 'delivered', data.proof)
      return getOrder(db, order.id)
    })
    res.json(result)
  }),
)
export async function paymentWebhook(raw: Buffer, signature: string) {
  const event = verifyWebhook(raw, signature)
  const checkoutTypes = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.expired',
    'checkout.session.async_payment_failed',
  ])
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [event.id])
    if ((await db.query('SELECT 1 FROM stripe_events WHERE id=$1', [event.id])).rowCount) return
    const object = event.data.object as unknown as Row
    const intentId =
      typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id

    // Provider-confirmed failures/refunds need no additional external call before releasing stock.
    const closeUnfulfilled = async (order: Row, paymentStatus: string, status: string, reason: string) => {
      if (['pending', 'confirmed'].includes(order.status)) {
        await cancelLocked(
          db,
          { ...order, stripe_session_id: null, payment_status: paymentStatus },
          null,
          status,
          reason,
        )
      }
      await db.query('UPDATE orders SET payment_status=$2 WHERE id=$1', [order.id, paymentStatus])
    }

    if (checkoutTypes.has(event.type)) {
      const orderId = object.metadata?.orderId
      if (!z.string().uuid().safeParse(orderId).success) {
        throw new ApiError(400, 'INVALID_PAYMENT_ORDER', 'Payment order reference is invalid')
      }
      const order = await lockOrder(db, orderId)
      const paidEvent =
        ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) &&
        object.payment_status === 'paid'
      if (
        order.type !== 'buyer-order' ||
        object.object !== 'checkout.session' ||
        object.mode !== 'payment' ||
        !Number.isSafeInteger(object.amount_total) ||
        object.amount_total !== order.total_cents ||
        object.currency?.toUpperCase() !== config.currency ||
        object.client_reference_id !== order.id ||
        typeof object.id !== 'string' ||
        !object.id.startsWith('cs_') ||
        (order.stripe_session_id && order.stripe_session_id !== object.id) ||
        !['paid', 'unpaid', 'no_payment_required'].includes(object.payment_status) ||
        (paidEvent && (typeof intentId !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(intentId))) ||
        (order.stripe_payment_intent && intentId && order.stripe_payment_intent !== intentId)
      ) {
        throw new ApiError(400, 'PAYMENT_MISMATCH', 'Payment does not match the stored order')
      }
      await db.query(
        'UPDATE orders SET stripe_session_id=coalesce(stripe_session_id,$2),stripe_payment_intent=coalesce(stripe_payment_intent,$3) WHERE id=$1',
        [order.id, object.id, intentId || null],
      )

      if (paidEvent && !['paid', 'refunded', 'refund-pending'].includes(order.payment_status)) {
        const distribution = (await db.query('SELECT * FROM events WHERE id=$1', [order.event_id])).rows[0]
        const windowClosed =
          !distribution ||
          distribution.status !== 'scheduled' ||
          new Date(distribution.ends_at) <= new Date() ||
          (order.expires_at && new Date(order.expires_at) <= new Date())
        if (['cancelled', 'expired'].includes(order.status) || windowClosed) {
          // A delayed payment must not resurrect released inventory. The refund worker reconciles it.
          await closeUnfulfilled(
            order,
            'refund-pending',
            'expired',
            'Payment arrived after the reservation window closed',
          )
          await notify(
            db,
            order.user_id,
            'Refund pending',
            'Payment arrived after this reservation closed. A full refund has been queued; this order cannot be collected.',
          )
        } else if (order.status === 'pending') {
          await db.query(
            "UPDATE orders SET status='confirmed',payment_status='paid',expires_at=$2 WHERE id=$1",
            [order.id, distribution.ends_at],
          )
          await notify(
            db,
            order.user_id,
            'Payment confirmed',
            `Payment for order ${order.id} is confirmed. Your pickup or delivery is now booked.`,
          )
        }
      } else if (
        ['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type) &&
        order.status === 'pending' &&
        order.payment_status === 'pending'
      ) {
        await closeUnfulfilled(order, 'failed', 'expired', 'Payment was not completed')
      }
    } else if (
      ['charge.refunded', 'refund.updated', 'refund.created', 'refund.failed'].includes(event.type)
    ) {
      if (typeof intentId !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(intentId)) {
        throw new ApiError(400, 'INVALID_REFUND', 'Refund payment reference is invalid')
      }
      const metadataOrderId = z.string().uuid().safeParse(object.metadata?.orderId)
      const found = (
        await db.query(
          "SELECT id FROM orders WHERE type='buyer-order' AND (stripe_payment_intent=$1 OR id=$2::uuid) ORDER BY stripe_payment_intent NULLS LAST LIMIT 1",
          [intentId, metadataOrderId.success ? metadataOrderId.data : null],
        )
      ).rows[0]
      // This Stripe account may contain payments that do not belong to FoodLink.
      if (found) {
        const order = await lockOrder(db, found.id)
        if (event.type !== 'charge.refunded' && (order.superseded_refund_ids || []).includes(object.id)) {
          await db.query('INSERT INTO stripe_events(id,type) VALUES($1,$2)', [event.id, event.type])
          await audit(db, null, 'payment.superseded-refund-event', 'order', order.id, {
            eventId: event.id,
            refundId: object.id,
          })
          return
        }
        const refundedAmount = event.type === 'charge.refunded' ? object.amount_refunded : object.amount
        if (
          object.currency?.toUpperCase() !== config.currency ||
          !Number.isSafeInteger(refundedAmount) ||
          refundedAmount <= 0 ||
          refundedAmount > order.total_cents ||
          (order.stripe_payment_intent && order.stripe_payment_intent !== intentId) ||
          object.object !== (event.type === 'charge.refunded' ? 'charge' : 'refund') ||
          (event.type !== 'charge.refunded' &&
            !['pending', 'succeeded', 'failed', 'canceled', 'requires_action'].includes(object.status)) ||
          (object.metadata?.orderId && object.metadata.orderId !== order.id)
        ) {
          throw new ApiError(400, 'REFUND_MISMATCH', 'Refund does not match the stored payment')
        }
        await db.query(
          'UPDATE orders SET stripe_payment_intent=coalesce(stripe_payment_intent,$2) WHERE id=$1',
          [order.id, intentId],
        )
        const succeeded = event.type === 'charge.refunded' || object.status === 'succeeded'
        const trackedRefund = object.id === order.refund_id
        const fullyRefunded = succeeded && (refundedAmount === order.total_cents || trackedRefund)
        const terminal = ['failed', 'canceled', 'requires_action'].includes(object.status)
        // Only the current full-balance attempt can change reconciliation state. An old
        // failed-attempt notification must not overwrite a newly retried refund.
        if (
          event.type !== 'charge.refunded' &&
          (trackedRefund || (!order.refund_id && refundedAmount === order.total_cents))
        ) {
          await db.query(
            "UPDATE orders SET refund_id=$2,refund_status=$3,refund_error=$4,refund_next_at=CASE WHEN $5 THEN NULL ELSE now()+interval '15 minutes' END WHERE id=$1",
            [
              order.id,
              object.id,
              object.status,
              terminal ? 'The provider requires review of this refund in administration.' : null,
              terminal || fullyRefunded,
            ],
          )
        }
        if (order.payment_status !== 'refunded') {
          await closeUnfulfilled(
            order,
            fullyRefunded ? 'refunded' : 'refund-pending',
            'cancelled',
            fullyRefunded ? 'Payment refunded' : 'Payment refund is being reconciled',
          )
          if (fullyRefunded) {
            await notify(
              db,
              order.user_id,
              'Refund completed',
              `The payment for order ${order.id} has been refunded.`,
            )
          } else if (order.payment_status !== 'refund-pending') {
            await notify(
              db,
              order.user_id,
              'Refund pending',
              `A refund for order ${order.id} is being reconciled. This order cannot be collected.`,
            )
          }
          if (terminal) {
            await audit(db, null, 'payment.refund-needs-review', 'order', order.id, {
              refundId: object.id,
              status: object.status,
            })
          }
        }
      }
    }
    await db.query('INSERT INTO stripe_events(id,type) VALUES($1,$2)', [event.id, event.type])
    await audit(db, null, 'payment.webhook', 'payment', event.id, { type: event.type })
  })
}
export async function maintenance() {
  const coordinator = await pool.connect()
  let acquired = false
  let expiredOrders = 0,
    expiredItems = 0,
    remindersQueued = 0,
    failedOrders = 0
  try {
    acquired = (await coordinator.query('SELECT pg_try_advisory_lock(742193003) acquired')).rows[0].acquired
    if (!acquired) return { expiredOrders, expiredItems, remindersQueued, failedOrders }
    const candidates = (
      await pool.query(
        "SELECT id FROM orders WHERE status IN ('pending','confirmed') AND expires_at<=now() ORDER BY event_id,id LIMIT 100",
      )
    ).rows
    for (const candidate of candidates) {
      try {
        const changed = await transaction(async (db) => {
          const order = await lockOrder(db, candidate.id)
          if (!['pending', 'confirmed'].includes(order.status) || new Date(order.expires_at) > new Date())
            return false
          await cancelLocked(db, order, null, 'expired', 'Collection or payment deadline passed')
          return true
        })
        if (changed) expiredOrders++
      } catch (error) {
        failedOrders++
        console.error(
          JSON.stringify({
            event: 'order_expiry_failed',
            orderId: candidate.id,
            code: (error as { code?: string }).code || 'DEPENDENCY_ERROR',
          }),
        )
      }
    }
    expiredItems = await transaction(async (db) => {
      const expired = (
        await db.query(
          "SELECT * FROM items WHERE status='available' AND qty>0 AND expires_on<=now() ORDER BY id FOR UPDATE SKIP LOCKED",
        )
      ).rows
      for (const item of expired) {
        await movement(db, item.id, -item.qty, 'expire', null, null, 'Food expiry reached')
        await db.query("UPDATE items SET qty=0,status='disposed' WHERE id=$1", [item.id])
      }
      return expired.length
    })
    const reminders = (
      await pool.query(
        "SELECT o.id FROM orders o JOIN events e ON e.id=o.event_id WHERE o.status='confirmed' AND NOT o.reminder_sent AND e.starts_at>now() AND e.starts_at<now()+interval '24 hours' ORDER BY o.event_id,o.id LIMIT 100",
      )
    ).rows
    for (const reminder of reminders) {
      const changed = await transaction(async (db) => {
        const order = await lockOrder(db, reminder.id)
        if (order.status !== 'confirmed' || order.reminder_sent) return false
        await notify(
          db,
          order.user_id,
          'Your FoodLink event is coming up',
          `Your reserved food is scheduled within the next 24 hours. Check your order ${order.id} for collection or delivery details.`,
        )
        await db.query('UPDATE orders SET reminder_sent=true WHERE id=$1', [order.id])
        return true
      })
      if (changed) remindersQueued++
    }
    await pool.query('DELETE FROM sessions WHERE expires_at<now()')
    await pool.query('DELETE FROM account_tokens WHERE expires_at<now()')
    await pool.query('DELETE FROM auth_attempts WHERE resets_at<now()')
    await pool.query("DELETE FROM mail_outbox WHERE status='sent' AND sent_at<now()-interval '30 days'")
    const retention = Number(
      (await pool.query('SELECT data FROM organization_config WHERE id=1')).rows[0]?.data?.retentionDays ||
        process.env.RETENTION_DAYS ||
        365,
    )
    await pool.query("DELETE FROM notifications WHERE created_at<now()-$1*interval '1 day'", [retention])
    return { expiredOrders, expiredItems, remindersQueued, failedOrders }
  } finally {
    if (acquired) await coordinator.query('SELECT pg_advisory_unlock(742193003)')
    coordinator.release()
  }
}
export async function processRefunds() {
  if (!config.paymentsEnabled) return
  const candidates = (
    await pool.query(
      "SELECT id FROM orders WHERE payment_status='refund-pending' AND stripe_payment_intent IS NOT NULL AND refund_next_at<=now() AND (refund_status IS NULL OR refund_status='pending') ORDER BY refund_next_at,id LIMIT 20",
    )
  ).rows
  for (const candidate of candidates)
    await transaction(async (db) => {
      const order = await lockOrder(db, candidate.id)
      if (
        order.payment_status !== 'refund-pending' ||
        (order.refund_status && !['pending'].includes(order.refund_status))
      )
        return
      try {
        const refund = order.refund_id
          ? await retrieveRefund(order.refund_id)
          : await refundPayment(order.stripe_payment_intent, order.id, order.refund_attempt)
        const succeeded = refund.status === 'succeeded'
        const terminal = ['failed', 'canceled', 'requires_action'].includes(refund.status)
        await db.query(
          "UPDATE orders SET payment_status=CASE WHEN $2 THEN 'refunded' ELSE payment_status END,refund_id=$3,refund_status=$4,refund_failures=0,refund_error=$5,refund_next_at=CASE WHEN $6 THEN NULL ELSE now()+interval '15 minutes' END WHERE id=$1",
          [
            order.id,
            succeeded,
            refund.id,
            refund.status,
            terminal
              ? refund.status === 'requires_action'
                ? 'This refund requires action in the payment provider dashboard. Resolve it there, then retry reconciliation.'
                : 'The provider rejected this refund. Review it and retry from administration.'
              : null,
            terminal || succeeded,
          ],
        )
        await audit(db, null, 'payment.refund-reconciled', 'order', order.id, {
          refundId: refund.id,
          status: refund.status,
          attempt: order.refund_attempt,
        })
        if (succeeded)
          await notify(
            db,
            order.user_id,
            'Refund completed',
            `The payment for order ${order.id} has been refunded.`,
          )
      } catch (error) {
        await db.query(
          "UPDATE orders SET refund_failures=refund_failures+1,refund_error='Payment provider is temporarily unavailable; retry is scheduled',refund_next_at=now()+least(3600,power(2,least(refund_failures,7))*30)*interval '1 second' WHERE id=$1",
          [order.id],
        )
        await audit(db, null, 'payment.refund-retry-scheduled', 'order', order.id, {
          code: (error as { code?: string }).code || 'PROVIDER_UNAVAILABLE',
        })
      }
    })
}
