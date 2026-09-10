import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './config.js'
import { pool } from './db.js'
import { route, requestContext, errorHandler, ApiError } from './http.js'
import { sessionMiddleware, guardOrigin, rateLimit } from './security.js'
import { auth } from './auth.js'
import { inventory } from './inventory.js'
import { orders, paymentWebhook } from './orders.js'
import { operations } from './operations.js'
import { storage, storageReady } from './storage.js'
import { locationContext } from './tenancy.js'
import { organizations } from './organizations.js'
export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
app.use(requestContext)
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || config.origins.includes(origin)),
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Image-Alt', 'X-Location-Id'],
  }),
)
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
app.get(
  '/api/ready',
  route(async (_req, res) => {
    const result = await Promise.allSettled([pool.query('SELECT 1'), storageReady()])
    const ready = result.every((r) => r.status === 'fulfilled')
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'unavailable',
      database: result[0].status === 'fulfilled',
      storage: result[1].status === 'fulfilled',
    })
  }),
)
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  route(async (req, res) => {
    await paymentWebhook(req.body, req.get('Stripe-Signature') || '')
    res.json({ received: true })
  }),
)
app.use('/api', guardOrigin, express.json({ limit: '8mb' }), sessionMiddleware, locationContext)
app.use('/api', (req, res, next) => {
  if (req.user) res.set('Cache-Control', 'no-store')
  next()
})
app.use('/api', rateLimit('api', 600, 60))
app.use(
  '/api/auth',
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  },
  auth,
)
app.use('/api', organizations, storage, inventory, orders, operations)
app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found')))
app.use(errorHandler)
