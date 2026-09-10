import { Router } from 'express'
import { z } from 'zod'
import { pool, transaction } from './db.js'
import { config } from './config.js'
import { route, ApiError, page, id, uuid, textField, dateTime, roles } from './http.js'
import { requireAuth, hashPassword } from './security.js'
import { userDto, getOrder } from './models.js'
import { passwordSchema, sendAccountToken } from './auth.js'
import { audit, notify } from './communications.js'
import { maintenance } from './orders.js'
export const operations = Router()
const operatorSchema = z
  .object({
    organizationName: textField(160).optional(),
    supportEmail: z.string().email().max(254).optional(),
    organizationAddress: textField(500).optional(),
    privacyContact: z.string().email().max(254).optional(),
    retentionDays: z.number().int().min(30).max(3650).optional(),
  })
  .strict()
async function publicConfig() {
  const data = (await pool.query('SELECT data FROM organization_config WHERE id=1')).rows[0]?.data || {}
  return {
    currency: config.currency,
    timezone: config.timezone,
    paymentsEnabled: config.paymentsEnabled,
    mailMode: config.production ? 'configured' : config.mailMode,
    organizationName: config.organizationName,
    supportEmail: process.env.SUPPORT_EMAIL || '',
    organizationAddress: process.env.ORGANIZATION_ADDRESS || '',
    privacyContact: process.env.PRIVACY_CONTACT || '',
    retentionDays: Number(process.env.RETENTION_DAYS || 365),
    ...data,
    demoLoginEnabled: config.demoLoginEnabled,
    legalReady: !!(
      (data.supportEmail || process.env.SUPPORT_EMAIL) &&
      (data.organizationAddress || process.env.ORGANIZATION_ADDRESS) &&
      (data.privacyContact || process.env.PRIVACY_CONTACT)
    ),
  }
}
operations.get(
  '/config',
  route(async (_req, res) => res.json(await publicConfig())),
)
operations.get(
  '/impact',
  route(async (_req, res) => {
    const [totals, people, monthly] = await Promise.all([
      pool.query(
        "SELECT count(DISTINCT o.id) orders,coalesce(sum(oi.qty::bigint*oi.weight_grams),0) grams FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.status IN ('picked-up','delivered')",
      ),
      pool.query(
        "SELECT (SELECT count(DISTINCT donor_id) FROM donations WHERE status IN ('received','distributed')) donors,(SELECT count(DISTINCT user_id) FROM orders WHERE type='buyer-order' AND status IN ('picked-up','delivered')) buyers",
      ),
      pool.query(
        "SELECT to_char(date_trunc('month',o.completed_at AT TIME ZONE $1),'YYYY-MM') AS month_label,coalesce(sum(oi.qty::bigint*oi.weight_grams),0) grams FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.status IN ('picked-up','delivered') AND o.completed_at>=now()-interval '12 months' GROUP BY 1 ORDER BY 1",
        [config.timezone],
      ),
    ])
    const grams = Number(totals.rows[0].grams)
    res.json({
      totalMealsDistributed: Math.floor(grams / 500),
      totalKgSaved: grams / 1000,
      totalDonors: Number(people.rows[0].donors),
      totalBuyers: Number(people.rows[0].buyers),
      totalOrdersCompleted: Number(totals.rows[0].orders),
      monthly: monthly.rows.map((r) => ({
        month: r.month_label,
        meals: Math.floor(Number(r.grams) / 500),
        kg: Number(r.grams) / 1000,
      })),
      methodology:
        'Distributed weight uses completed pickup/delivery line snapshots. Meal equivalents use 500 g per meal; these are estimates, not counted meals. Legacy items without measured weight contribute zero weight. Donors count confirmed receipts; buyers count completed purchases.',
    })
  }),
)
operations.get(
  '/reports',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const day = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
    const today = new Date().toISOString().slice(0, 10)
    const from = day.default(today.slice(0, 7) + '-01').parse(req.query.from),
      to = day.default(today).parse(req.query.to)
    if (from > to || new Date(to).getTime() - new Date(from).getTime() > 366 * 86400000)
      throw new ApiError(400, 'INVALID_PERIOD', 'Choose a reporting period of at most one year')
    const params = [from, to, config.timezone]
    const period =
      ' >= ($1::date::timestamp AT TIME ZONE $3) AND completed_at < (($2::date+1)::timestamp AT TIME ZONE $3)'
    const [orderRows, totals, received, disposed] = await Promise.all([
      pool.query(
        `SELECT id FROM orders WHERE status IN ('picked-up','delivered') AND completed_at ${period} ORDER BY completed_at,id LIMIT 2000`,
        params,
      ),
      pool.query(
        `SELECT count(DISTINCT o.id) orders,coalesce(sum(oi.qty::bigint*oi.weight_grams),0) grams FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.status IN ('picked-up','delivered') AND o.completed_at ${period}`,
        params,
      ),
      pool.query(
        'SELECT count(*) n FROM donations WHERE received_at >= ($1::date::timestamp AT TIME ZONE $3) AND received_at < (($2::date+1)::timestamp AT TIME ZONE $3)',
        params,
      ),
      pool.query(
        "SELECT coalesce(sum(-m.delta::bigint*i.weight_grams),0) grams FROM inventory_movements m JOIN items i ON i.id=m.item_id WHERE m.kind IN ('dispose','expire') AND m.created_at >= ($1::date::timestamp AT TIME ZONE $3) AND m.created_at < (($2::date+1)::timestamp AT TIME ZONE $3)",
        params,
      ),
    ])
    const orderData = await Promise.all(orderRows.rows.map((r) => getOrder(pool, r.id, false)))
    const grams = Number(totals.rows[0].grams)
    const completedOrders = Number(totals.rows[0].orders)
    res.json({
      from,
      to,
      timezone: config.timezone,
      receivedDonations: Number(received.rows[0].n),
      completedOrders,
      kgDistributed: grams / 1000,
      mealsDistributed: Math.floor(grams / 500),
      disposedKg: Number(disposed.rows[0].grams) / 1000,
      orders: orderData.map((o) => ({
        ...o,
        deliveryAddress: undefined,
        userName: undefined,
        userId: undefined,
      })),
      truncated: completedOrders > orderData.length,
    })
  }),
)
operations.get(
  '/notifications',
  requireAuth(),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',
      [req.user!.id, limit, offset],
    )
    res.json(
      rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        body: r.body,
        createdAt: r.created_at,
        readAt: r.read_at,
      })),
    )
  }),
)
operations.patch(
  '/notifications/:id',
  requireAuth(),
  route(async (req, res) => {
    z.object({ read: z.literal(true) })
      .strict()
      .parse(req.body)
    const r = await pool.query(
      'UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2',
      [id(req), req.user!.id],
    )
    if (!r.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Notification not found')
    res.json({ ok: true })
  }),
)
operations.get(
  '/admin/assignees',
  requireAuth('admin'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      "SELECT id,name FROM users WHERE role IN ('admin','volunteer') AND NOT disabled AND email_verified ORDER BY name,id LIMIT $1 OFFSET $2",
      [limit, offset],
    )
    res.json(rows)
  }),
)
operations.get(
  '/admin/users',
  requireAuth('admin'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    res.json(
      (
        await pool.query('SELECT * FROM users ORDER BY created_at DESC,id LIMIT $1 OFFSET $2', [
          limit,
          offset,
        ])
      ).rows.map(userDto),
    )
  }),
)
operations.post(
  '/admin/users',
  requireAuth('admin'),
  route(async (req, res) => {
    const d = z
      .object({
        email: z.string().trim().toLowerCase().email().max(254),
        name: textField(120),
        password: passwordSchema,
        role: roles,
        verified: z.boolean().default(false),
      })
      .strict()
      .parse(req.body)
    const encoded = await hashPassword(d.password)
    const user = await transaction(async (db) => {
      const r = (
        await db.query(
          'INSERT INTO users(email,name,role,password_hash,verified) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [d.email, d.name, d.role, encoded, d.verified],
        )
      ).rows[0]
      await sendAccountToken(db, r.id, 'verify')
      await audit(db, req.user!.id, 'admin.user-created', 'user', r.id, { role: d.role })
      return userDto(r)
    })
    res.status(201).json(user)
  }),
)
operations.patch(
  '/admin/users/:id',
  requireAuth('admin'),
  route(async (req, res) => {
    const d = z
      .object({ verified: z.boolean().optional(), disabled: z.boolean().optional(), role: roles.optional() })
      .strict()
      .parse(req.body)
    const userId = id(req)
    const user = await transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(742193002)')
      const u = (await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0]
      if (!u) throw new ApiError(404, 'NOT_FOUND', 'User not found')
      if (u.role === 'admin' && !u.disabled && (d.disabled === true || (d.role && d.role !== 'admin'))) {
        const count = await db.query("SELECT id FROM users WHERE role='admin' AND NOT disabled")
        if (count.rowCount === 1)
          throw new ApiError(409, 'LAST_ADMIN', 'Keep at least one active administrator')
      }
      const r = (
        await db.query(
          'UPDATE users SET verified=coalesce($2,verified),disabled=coalesce($3,disabled),role=coalesce($4,role) WHERE id=$1 RETURNING *',
          [userId, d.verified, d.disabled, d.role],
        )
      ).rows[0]
      if (d.disabled || d.role) await db.query('DELETE FROM sessions WHERE user_id=$1', [userId])
      if (d.verified === true && !u.verified)
        await notify(
          db,
          userId,
          'Recipient eligibility approved',
          'Your recipient eligibility has been approved. Verify your email and sign in to reserve available food.',
        )
      await audit(db, req.user!.id, 'admin.user-updated', 'user', userId, d)
      return userDto(r)
    })
    res.json(user)
  }),
)
operations.get(
  '/admin/audit',
  requireAuth('admin'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      'SELECT * FROM audit_log ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',
      [limit, offset],
    )
    res.json(
      rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details: r.details,
        createdAt: r.created_at,
      })),
    )
  }),
)
operations.get(
  '/admin/config',
  requireAuth('admin'),
  route(async (_req, res) => res.json(await publicConfig())),
)
operations.patch(
  '/admin/config',
  requireAuth('admin'),
  route(async (req, res) => {
    const d = operatorSchema.parse(req.body)
    await transaction(async (db) => {
      await db.query('UPDATE organization_config SET data=data||$1::jsonb WHERE id=1', [JSON.stringify(d)])
      await audit(db, req.user!.id, 'admin.config-updated', 'organization', '1', d)
    })
    res.json(await publicConfig())
  }),
)
operations.get(
  '/admin/outbox',
  requireAuth('admin'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      'SELECT * FROM mail_outbox ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',
      [limit, offset],
    )
    res.json(
      rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        status: r.status,
        attempts: r.attempts,
        lastError: r.last_error,
        createdAt: r.created_at,
        sentAt: r.sent_at,
        ...(!config.production && config.mailMode === 'outbox'
          ? { recipient: r.recipient, body: r.body }
          : {}),
      })),
    )
  }),
)
operations.post(
  '/admin/outbox/:id/retry',
  requireAuth('admin'),
  route(async (req, res) => {
    await transaction(async (db) => {
      const r = await db.query(
        "UPDATE mail_outbox SET status='pending',attempts=0,available_at=now(),last_error=null WHERE id=$1 AND status='failed'",
        [id(req)],
      )
      if (!r.rowCount) throw new ApiError(409, 'NOT_RETRYABLE', 'Only failed messages can be retried')
      await audit(db, req.user!.id, 'mail.retry', 'outbox', id(req))
    })
    res.json({ ok: true })
  }),
)
operations.post(
  '/admin/maintenance',
  requireAuth('admin'),
  route(async (_req, res) => res.json(await maintenance())),
)
operations.get(
  '/admin/health',
  requireAuth('admin'),
  route(async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT (SELECT count(*) FROM mail_outbox WHERE status='failed') failedMail,(SELECT count(*) FROM mail_outbox WHERE status='pending') pendingMail,(SELECT count(*) FROM orders WHERE payment_status='refund-pending') pendingRefunds,(SELECT count(*) FROM privacy_requests WHERE status='pending') privacyRequests",
    )
    res.json(rows[0])
  }),
)
operations.get(
  '/admin/refunds',
  requireAuth('admin'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      "SELECT o.*,u.name FROM orders o JOIN users u ON u.id=o.user_id WHERE o.payment_status IN ('refund-pending','refunded') ORDER BY o.created_at DESC,o.id LIMIT $1 OFFSET $2",
      [limit, offset],
    )
    res.json(
      rows.map((r) => ({
        id: r.id,
        userName: r.name,
        totalCents: r.total_cents,
        paymentStatus: r.payment_status,
        refundStatus: r.payment_status === 'refunded' ? 'succeeded' : r.refund_status,
        refundAttempt: r.refund_attempt,
        refundError: r.refund_error,
        refundNextAt: r.refund_next_at,
      })),
    )
  }),
)
operations.post(
  '/admin/refunds/:id/retry',
  requireAuth('admin'),
  route(async (req, res) => {
    await transaction(async (db) => {
      const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id(req)])).rows[0]
      if (!order || order.payment_status !== 'refund-pending')
        throw new ApiError(409, 'NOT_RETRYABLE', 'Only pending refunds can be retried')
      const terminal = ['failed', 'canceled'].includes(order.refund_status)
      await db.query(
        "UPDATE orders SET refund_attempt=refund_attempt+$2,superseded_refund_ids=CASE WHEN $3 AND refund_id IS NOT NULL THEN array_append(superseded_refund_ids,refund_id) ELSE superseded_refund_ids END,refund_id=CASE WHEN $3 THEN NULL ELSE refund_id END,refund_status=CASE WHEN $3 THEN NULL WHEN refund_status='requires_action' THEN 'pending' ELSE refund_status END,refund_failures=0,refund_error=null,refund_next_at=now() WHERE id=$1",
        [order.id, terminal ? 1 : 0, terminal],
      )
      await audit(db, req.user!.id, 'payment.refund-retry-requested', 'order', order.id, {
        newProviderAttempt: terminal,
      })
    })
    res.json({ ok: true })
  }),
)
operations.get(
  '/admin/privacy',
  requireAuth('admin'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      'SELECT p.*,u.name FROM privacy_requests p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC,p.id LIMIT $1 OFFSET $2',
      [limit, offset],
    )
    res.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.name,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
        completedAt: r.completed_at,
      })),
    )
  }),
)
operations.patch(
  '/admin/privacy/:id',
  requireAuth('admin'),
  route(async (req, res) => {
    z.object({ status: z.literal('completed') })
      .strict()
      .parse(req.body)
    await transaction(async (db) => {
      const requestId = id(req)
      const found = (await db.query('SELECT user_id FROM privacy_requests WHERE id=$1', [requestId])).rows[0]
      if (!found) throw new ApiError(404, 'NOT_FOUND', 'Privacy request not found')
      // New reservations and offers take this account lock first, so the active-record
      // check sees their committed result before any personal data is removed.
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [found.user_id])
      const p = (await db.query('SELECT * FROM privacy_requests WHERE id=$1 FOR UPDATE', [requestId])).rows[0]
      if (p.status === 'completed') return
      const active = await db.query(
        "SELECT id FROM orders WHERE user_id=$1 AND status IN ('pending','confirmed') UNION SELECT id FROM donations WHERE donor_id=$1 AND status='scheduled'",
        [p.user_id],
      )
      if (active.rowCount)
        throw new ApiError(
          409,
          'ACTIVE_RECORDS',
          'Resolve active orders and donation offers before anonymizing',
        )
      await db.query(
        "UPDATE users SET email=id::text||'@anonymized.invalid',name='Former member',password_hash=null,address=null,ngo_code=null,household_size=null,dietary_needs=null,special_requirements=null,disabled=true WHERE id=$1",
        [p.user_id],
      )
      await db.query('DELETE FROM sessions WHERE user_id=$1', [p.user_id])
      await db.query('DELETE FROM account_tokens WHERE user_id=$1', [p.user_id])
      await db.query('DELETE FROM notifications WHERE user_id=$1', [p.user_id])
      await db.query('DELETE FROM mail_outbox WHERE user_id=$1', [p.user_id])
      await db.query('UPDATE orders SET delivery_address=null,delivery_proof=null WHERE user_id=$1', [
        p.user_id,
      ])
      await db.query(
        "UPDATE privacy_requests SET status='completed',reason='',completed_at=now() WHERE id=$1",
        [p.id],
      )
      await audit(db, req.user!.id, 'privacy.anonymized', 'user', p.user_id)
    })
    res.json({ ok: true })
  }),
)
const taskSchema = z
  .object({
    title: textField(160),
    description: z.string().max(2000).default(''),
    eventId: uuid.nullable().optional(),
    assignedVolunteerId: uuid.nullable().optional(),
    dueAt: dateTime.nullable().optional(),
  })
  .strict()
function taskDto(r: Record<string, any>) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    eventId: r.event_id,
    assignedVolunteerId: r.assigned_volunteer_id,
    dueAt: r.due_at,
    status: r.status,
    createdAt: r.created_at,
  }
}
operations.get(
  '/tasks',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const [limit, offset] = page(req)
    const { rows } = await pool.query(
      'SELECT * FROM tasks WHERE ($1::boolean OR assigned_volunteer_id=$2 OR assigned_volunteer_id IS NULL) ORDER BY due_at NULLS LAST,created_at,id LIMIT $3 OFFSET $4',
      [req.user!.role === 'admin', req.user!.id, limit, offset],
    )
    res.json(rows.map(taskDto))
  }),
)
operations.post(
  '/tasks',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const d = taskSchema.parse(req.body)
    if (req.user!.role === 'volunteer' && d.assignedVolunteerId && d.assignedVolunteerId !== req.user!.id)
      throw new ApiError(403, 'FORBIDDEN', 'Volunteers can assign tasks to themselves')
    const task = await transaction(async (db) => {
      if (
        d.assignedVolunteerId &&
        !(
          await db.query(
            "SELECT 1 FROM users WHERE id=$1 AND role IN ('admin','volunteer') AND NOT disabled",
            [d.assignedVolunteerId],
          )
        ).rowCount
      )
        throw new ApiError(400, 'INVALID_VOLUNTEER', 'Choose an active volunteer')
      const { rows } = await db.query(
        'INSERT INTO tasks(title,description,event_id,assigned_volunteer_id,due_at) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [d.title, d.description, d.eventId, d.assignedVolunteerId, d.dueAt],
      )
      await audit(db, req.user!.id, 'task.created', 'task', rows[0].id)
      return taskDto(rows[0])
    })
    res.status(201).json(task)
  }),
)
operations.patch(
  '/tasks/:id',
  requireAuth('admin', 'volunteer'),
  route(async (req, res) => {
    const d = z
      .object({
        status: z.enum(['open', 'in-progress', 'completed', 'cancelled']).optional(),
        assignedVolunteerId: uuid.nullable().optional(),
      })
      .strict()
      .parse(req.body)
    const task = await transaction(async (db) => {
      const t = (await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [id(req)])).rows[0]
      if (!t) throw new ApiError(404, 'NOT_FOUND', 'Task not found')
      if (
        req.user!.role === 'volunteer' &&
        ((t.assigned_volunteer_id && t.assigned_volunteer_id !== req.user!.id) ||
          (d.assignedVolunteerId && d.assignedVolunteerId !== req.user!.id))
      )
        throw new ApiError(403, 'FORBIDDEN', 'Only your own or unassigned tasks can be changed')
      if (
        d.assignedVolunteerId &&
        !(
          await db.query(
            "SELECT 1 FROM users WHERE id=$1 AND role IN ('admin','volunteer') AND NOT disabled",
            [d.assignedVolunteerId],
          )
        ).rowCount
      )
        throw new ApiError(400, 'INVALID_VOLUNTEER', 'Choose an active volunteer')
      const { rows } = await db.query(
        'UPDATE tasks SET status=coalesce($2,status),assigned_volunteer_id=CASE WHEN $3 THEN $4 ELSE assigned_volunteer_id END WHERE id=$1 RETURNING *',
        [t.id, d.status, Object.hasOwn(d, 'assignedVolunteerId'), d.assignedVolunteerId],
      )
      await audit(db, req.user!.id, 'task.updated', 'task', t.id, d)
      return taskDto(rows[0])
    })
    res.json(task)
  }),
)
