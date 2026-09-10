import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto'

import type { Request, Response, RequestHandler } from 'express'
import { pool, type Db } from './db.js'
import { config } from './config.js'
import { ApiError, route } from './http.js'
import type { Row } from './models.js'
import { loadMemberships, membershipAllows } from './tenancy.js'
const derive = (
  password: string,
  salt: string,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, length, options, (error, result) => (error ? reject(error) : resolve(result))),
  )
export const token = () => randomBytes(32).toString('base64url')
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const result = (await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 67108864 })) as Buffer
  return `scrypt$32768$${salt}$${result.toString('hex')}`
}
export async function verifyPassword(password: string, encoded: string | null) {
  const parts = encoded?.split('$')
  const salt = parts?.[2] || '00000000000000000000000000000000'
  const expected = parts?.[3] ? Buffer.from(parts[3], 'hex') : Buffer.alloc(64)
  const actual = (await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 67108864 })) as Buffer
  return expected.length === actual.length && timingSafeEqual(actual, expected) && !!encoded
}
declare global {
  namespace Express {
    interface Request {
      user?: Row
      sessionHash?: string
      csrfToken?: string
    }
  }
}
function sessionCookie(req: Request) {
  return req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('foodlink_session='))
    ?.slice(17)
}
export const sessionMiddleware = route(async (req, res, next) => {
  const raw = sessionCookie(req)
  if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw)) {
    const result = await pool.query(
      'SELECT u.*,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=$1 AND s.expires_at>now() AND NOT u.disabled',
      [hash(raw)],
    )
    if (result.rows[0]) {
      req.user = result.rows[0]
      req.user!.memberships = await loadMemberships(req.user!.id)
      req.sessionHash = hash(raw)
      req.csrfToken = result.rows[0].csrf_token
    }
  }
  next()
})
export const guardOrigin: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  if (!req.headers.origin || !config.origins.includes(req.headers.origin))
    return next(new ApiError(403, 'ORIGIN_REJECTED', 'The request origin is not allowed'))
  next()
}
export function requireAuth(...allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'AUTH_REQUIRED', 'Please sign in'))
    const memberships = (req.user.memberships || []) as Row[]
    const scopeMembers = memberships.filter((m) => req.scope && membershipAllows(m, req.scope.location, 'read'))
    const staffAllowed = scopeMembers.some((m) => allowed.includes('volunteer') || (m.role !== 'volunteer' && allowed.includes('admin')) || allowed.includes(m.role))
    const publicRoleAllowed = !['admin', 'volunteer', 'charity_manager', 'location_manager'].includes(req.user.role) && allowed.includes(req.user.role)
    if (allowed.length && !staffAllowed && !publicRoleAllowed)
      return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action'))
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-CSRF-Token') !== req.csrfToken)
      return next(new ApiError(403, 'CSRF_REQUIRED', 'Your session token is missing or expired'))
    next()
  }
}
export function requireVerified(req: Request) {
  if (!req.user?.email_verified)
    throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before using this feature')
}
export function isStaff(req: Request) {
  return !!req.scope && (req.user?.memberships || []).some((m: Row) => membershipAllows(m, req.scope.location, 'read'))
}
export function assertOwner(req: Request, userId: string) {
  if (req.user?.id !== userId)
    throw new ApiError(403, 'FORBIDDEN', 'This record belongs to another account')
}
export async function createSession(db: Db, req: Request, res: Response, userId: string) {
  if (req.sessionHash) await db.query('DELETE FROM sessions WHERE id_hash=$1', [req.sessionHash])
  const raw = token(),
    csrfToken = token()
  await db.query(
    "INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 hour')",
    [hash(raw), userId, csrfToken, config.sessionHours],
  )
  res.cookie('foodlink_session', raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookie,
    path: '/',
    maxAge: config.sessionHours * 3600000,
  })
  return csrfToken
}
export function clearSession(res: Response) {
  res.clearCookie('foodlink_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookie,
    path: '/',
  })
}
export function rateLimit(scope: string, limit: number, seconds: number): RequestHandler {
  return route(async (req, _res, next) => {
    const key = hash(`${scope}:${req.ip}`)
    const { rows } = await pool.query(
      `INSERT INTO auth_attempts(key,count,resets_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.resets_at<now() THEN 1 ELSE auth_attempts.count+1 END,resets_at=CASE WHEN auth_attempts.resets_at<now() THEN excluded.resets_at ELSE auth_attempts.resets_at END RETURNING count`,
      [key, seconds],
    )
    if (rows[0].count > limit) throw new ApiError(429, 'RATE_LIMIT', 'Too many attempts. Try again later')
    next()
  })
}
