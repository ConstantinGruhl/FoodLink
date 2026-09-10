import { Router } from 'express'
import { z } from 'zod'
import { pool, transaction } from './db.js'
import { ApiError, route, textField, roles } from './http.js'
import {
  createSession,
  clearSession,
  hashPassword,
  verifyPassword,
  token,
  hash,
  rateLimit,
  requireAuth,
} from './security.js'
import { userDto, getDonation, getOrder } from './models.js'
import { audit, mail, notify } from './communications.js'
import { config } from './config.js'
import { loadMemberships } from './tenancy.js'
export const auth = Router()
export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(128)
export const profileSchema = z
  .object({
    name: textField(120).optional(),
    householdSize: z.number().int().min(1).max(30).nullable().optional(),
    dietaryNeeds: z.array(textField(60)).max(20).optional(),
    specialRequirements: z.string().trim().max(1000).optional(),
    address: z.string().trim().max(500).optional(),
  })
  .strict()
export const registrationSchema = profileSchema
  .extend({
    name: textField(120),
    email: z.string().trim().toLowerCase().email().max(254),
    password: passwordSchema,
    role: z.enum(['recipient', 'buyer', 'donor']),
  })
  .strict()
export async function sendAccountToken(
  db: Parameters<typeof mail>[0],
  userId: string,
  kind: 'verify' | 'reset',
) {
  const value = token()
  await db.query('DELETE FROM account_tokens WHERE user_id=$1 AND kind=$2', [userId, kind])
  await db.query(
    "INSERT INTO account_tokens(token_hash,user_id,kind,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 hour')",
    [hash(value), userId, kind, kind === 'verify' ? 24 : 1],
  )
  const path = kind === 'verify' ? 'verify-email' : 'reset-password'
  await mail(
    db,
    userId,
    kind === 'verify' ? 'Verify your FoodLink email' : 'Reset your FoodLink password',
    `${config.publicAppUrl}/${path}?token=${value}\n\nThis link expires in ${kind === 'verify' ? '24 hours' : '1 hour'}. If you did not request it, ignore this email.`,
  )
}
auth.get(
  '/session',
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json({ user: req.user ? userDto(req.user) : null, csrfToken: req.csrfToken || null })
  }),
)
auth.post(
  '/register',
  rateLimit('register', 15, 3600),
  route(async (req, res) => {
    const data = registrationSchema.parse(req.body)
    const encoded = await hashPassword(data.password)
    const result = await transaction(async (db) => {
      const { rows } = await db.query(
        'INSERT INTO users(email,name,role,password_hash,household_size,dietary_needs,special_requirements,address) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [
          data.email,
          data.name,
          data.role,
          encoded,
          data.householdSize || null,
          data.dietaryNeeds || [],
          data.specialRequirements || '',
          data.address || '',
        ],
      )
      const user = rows[0]
      await sendAccountToken(db, user.id, 'verify')
      await audit(db, user.id, 'account.register', 'user', user.id)
      const csrfToken = await createSession(db, req, res, user.id)
      return { user: userDto(user), csrfToken }
    })
    res.status(201).json(result)
  }),
)
auth.post(
  '/login',
  rateLimit('login', 30, 900),
  route(async (req, res) => {
    const data = z
      .object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().max(128) })
      .strict()
      .parse(req.body)
    const lockKey = hash(`account:${data.email}`)
    const lock = await pool.query('SELECT count FROM auth_attempts WHERE key=$1 AND resets_at>now()', [
      lockKey,
    ])
    if (lock.rows[0]?.count >= 10) throw new ApiError(429, 'RATE_LIMIT', 'Too many attempts. Try again later')
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email)=$1', [data.email])
    const user = rows[0]
    if (!(await verifyPassword(data.password, user?.password_hash)) || user?.disabled) {
      await pool.query(
        "INSERT INTO auth_attempts(key,count,resets_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.resets_at<now() THEN 1 ELSE auth_attempts.count+1 END,resets_at=CASE WHEN auth_attempts.resets_at<now() THEN excluded.resets_at ELSE auth_attempts.resets_at END",
        [lockKey],
      )
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
    }
    const session = await transaction(async (db) => {
      await db.query('DELETE FROM auth_attempts WHERE key=$1', [lockKey])
      // Password recovery and account changes may commit while scrypt is running.
      // Serialize session issuance with those changes and reject a stale credential check.
      const current = (await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [user.id])).rows[0]
      if (!current || current.disabled || current.password_hash !== user.password_hash)
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
      current.memberships = await loadMemberships(current.id, db)
      return { user: userDto(current), csrfToken: await createSession(db, req, res, current.id) }
    })
    res.json(session)
  }),
)
auth.post(
  '/logout',
  requireAuth(),
  route(async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE id_hash=$1', [req.sessionHash])
    clearSession(res)
    res.json({ ok: true })
  }),
)
auth.patch(
  '/profile',
  requireAuth(),
  route(async (req, res) => {
    const d = profileSchema.parse(req.body)
    const { rows } = await pool.query(
      'UPDATE users SET name=coalesce($2,name),household_size=CASE WHEN $3 THEN $4 ELSE household_size END,dietary_needs=coalesce($5,dietary_needs),special_requirements=coalesce($6,special_requirements),address=coalesce($7,address) WHERE id=$1 AND NOT disabled RETURNING *',
      [
        req.user!.id,
        d.name,
        Object.hasOwn(d, 'householdSize'),
        d.householdSize,
        d.dietaryNeeds,
        d.specialRequirements,
        d.address,
      ],
    )
    if (!rows[0]) throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in')
    rows[0].memberships = req.user!.memberships
    res.json(userDto(rows[0]))
  }),
)
auth.post(
  '/forgot-password',
  rateLimit('recovery', 10, 3600),
  route(async (req, res) => {
    const { email } = z
      .object({ email: z.string().trim().toLowerCase().email().max(254) })
      .strict()
      .parse(req.body)
    await transaction(async (db) => {
      const { rows } = await db.query('SELECT id FROM users WHERE lower(email)=$1 AND NOT disabled', [email])
      if (rows[0]) await sendAccountToken(db, rows[0].id, 'reset')
    })
    res.json({ ok: true })
  }),
)
auth.post(
  '/reset-password',
  rateLimit('reset', 20, 3600),
  route(async (req, res) => {
    const data = z
      .object({ token: textField(100), password: passwordSchema })
      .strict()
      .parse(req.body)
    const encoded = await hashPassword(data.password)
    await transaction(async (db) => {
      const { rows } = await db.query(
        "DELETE FROM account_tokens WHERE token_hash=$1 AND kind='reset' AND expires_at>now() RETURNING user_id",
        [hash(data.token)],
      )
      if (!rows[0])
        throw new ApiError(400, 'INVALID_TOKEN', 'This reset link has expired or was already used')
      await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [rows[0].user_id, encoded])
      await db.query('DELETE FROM sessions WHERE user_id=$1', [rows[0].user_id])
      await notify(
        db,
        rows[0].user_id,
        'Password changed',
        'Your password was changed. All existing sessions have been signed out.',
      )
      await audit(db, rows[0].user_id, 'account.password-reset', 'user', rows[0].user_id)
    })
    clearSession(res)
    res.json({ ok: true })
  }),
)
auth.post(
  '/verify-email',
  rateLimit('verify', 30, 3600),
  route(async (req, res) => {
    const data = z
      .object({ token: textField(100) })
      .strict()
      .parse(req.body)
    await transaction(async (db) => {
      const { rows } = await db.query(
        "DELETE FROM account_tokens WHERE token_hash=$1 AND kind='verify' AND expires_at>now() RETURNING user_id",
        [hash(data.token)],
      )
      if (!rows[0])
        throw new ApiError(400, 'INVALID_TOKEN', 'This verification link has expired or was already used')
      await db.query('UPDATE users SET email_verified=true WHERE id=$1', [rows[0].user_id])
      await audit(db, rows[0].user_id, 'account.email-verified', 'user', rows[0].user_id)
    })
    res.json({ ok: true })
  }),
)
auth.post(
  '/resend-verification',
  requireAuth(),
  rateLimit('resend', 5, 3600),
  route(async (req, res) => {
    if (!req.user!.email_verified) await transaction((db) => sendAccountToken(db, req.user!.id, 'verify'))
    res.json({ ok: true })
  }),
)
auth.post(
  '/change-password',
  requireAuth(),
  rateLimit('change-password', 10, 3600),
  route(async (req, res) => {
    const d = z
      .object({ currentPassword: z.string().max(128), newPassword: passwordSchema })
      .strict()
      .parse(req.body)
    if (!(await verifyPassword(d.currentPassword, req.user!.password_hash)))
      throw new ApiError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect')
    const encoded = await hashPassword(d.newPassword)
    await transaction(async (db) => {
      await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user!.id, encoded])
      await db.query('DELETE FROM sessions WHERE user_id=$1', [req.user!.id])
      await db.query('DELETE FROM account_tokens WHERE user_id=$1', [req.user!.id])
      await audit(db, req.user!.id, 'account.password-changed', 'user', req.user!.id)
    })
    clearSession(res)
    res.json({ ok: true })
  }),
)
auth.get(
  '/export',
  requireAuth(),
  route(async (req, res) => {
    const userId = req.user!.id
    const [donations, orders, notifications, requests] = await Promise.all([
      pool.query('SELECT id FROM donations WHERE donor_id=$1 ORDER BY date,id', [userId]),
      pool.query('SELECT id FROM orders WHERE user_id=$1 ORDER BY created_at,id', [userId]),
      pool.query(
        'SELECT subject,body,created_at,read_at FROM notifications WHERE user_id=$1 ORDER BY created_at,id',
        [userId],
      ),
      pool.query('SELECT reason,status,created_at,completed_at FROM privacy_requests WHERE user_id=$1', [
        userId,
      ]),
    ])
    const donationData = []
    for (const row of donations.rows) donationData.push(await getDonation(pool, row.id))
    const orderData = []
    for (const row of orders.rows) orderData.push(await getOrder(pool, row.id, false))
    res.set('Content-Disposition', 'attachment; filename="foodlink-personal-data.json"')
    res.json({
      exportedAt: new Date(),
      profile: userDto(req.user!),
      donations: donationData,
      orders: orderData,
      notifications: notifications.rows.map((r) => ({
        subject: r.subject,
        body: r.body,
        createdAt: r.created_at,
        readAt: r.read_at,
      })),
      privacyRequests: requests.rows.map((r) => ({
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
        completedAt: r.completed_at,
      })),
    })
  }),
)
auth.post(
  '/deactivate',
  requireAuth(),
  route(async (req, res) => {
    const d = z
      .object({ password: z.string().max(128), reason: z.string().max(1000).optional() })
      .strict()
      .parse(req.body)
    if (!(await verifyPassword(d.password, req.user!.password_hash)))
      throw new ApiError(400, 'INVALID_CREDENTIALS', 'Password is incorrect')
    await transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(742193002)')
      if (req.user!.role === 'admin') {
        const admins = await db.query("SELECT id FROM users WHERE role='admin' AND NOT disabled")
        if (admins.rowCount === 1)
          throw new ApiError(
            409,
            'LAST_ADMIN',
            'Assign another administrator before deactivating your account',
          )
      }
      await db.query('UPDATE users SET disabled=true WHERE id=$1', [req.user!.id])
      await db.query('DELETE FROM sessions WHERE user_id=$1', [req.user!.id])
      await db.query('DELETE FROM account_tokens WHERE user_id=$1', [req.user!.id])
      await db.query('INSERT INTO privacy_requests(user_id,reason) VALUES($1,$2)', [
        req.user!.id,
        d.reason || '',
      ])
      await audit(db, req.user!.id, 'account.deactivation-requested', 'user', req.user!.id)
    })
    clearSession(res)
    res.json({ ok: true })
  }),
)
