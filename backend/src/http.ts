import { randomUUID } from 'node:crypto'
import type { ErrorRequestHandler, Request, RequestHandler } from 'express'
import { z } from 'zod'
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}
export const route =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next)
export const uuid = z.string().uuid()
export const quantity = z.number().int().min(1).max(10000)
export const dateTime = z.string().datetime({ offset: true })
export const textField = (max = 200) => z.string().trim().min(1).max(max)
export const roles = z.enum(['recipient', 'buyer', 'donor', 'volunteer', 'admin', 'charity_manager', 'location_manager'])
export function id(req: Request, key = 'id') {
  return uuid.parse(req.params[key])
}
export function page(req: Request): [number, number] {
  return [
    z.coerce.number().int().min(1).max(200).default(100).parse(req.query.limit),
    z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset),
  ]
}
export const requestContext: RequestHandler = (req, res, next) => {
  res.locals.requestId = randomUUID()
  res.setHeader('X-Request-ID', res.locals.requestId)
  const start = Date.now()
  res.on('finish', () =>
    console.log(
      JSON.stringify({
        event: 'request',
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    ),
  )
  next()
}
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  let status = 500,
    code = 'INTERNAL_ERROR',
    message = 'The request could not be completed',
    details: unknown
  if (error instanceof ApiError) {
    ;({ status, code, message, details } = error)
  } else if (error instanceof z.ZodError) {
    status = 400
    code = 'VALIDATION_ERROR'
    message = 'Check the submitted fields'
    details = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  } else if (error.type === 'entity.too.large') {
    status = 413
    code = 'PAYLOAD_TOO_LARGE'
    message = 'Maximum upload size is 5 MB'
  } else if (error.type === 'entity.parse.failed') {
    status = 400
    code = 'INVALID_JSON'
    message = 'The request body is invalid JSON'
  } else if (error.code === '23505') {
    status = 409
    code = 'CONFLICT'
    message = 'This record already exists'
  } else if (['23503', '23514', '22P02'].includes(error.code)) {
    status = 400
    code = 'INVALID_DATA'
    message = 'The supplied data violates a record constraint'
  }
  if (status >= 500)
    console.error(
      JSON.stringify({
        event: 'request_error',
        requestId: res.locals.requestId,
        code: error.code || error.name,
        message: error.message,
      }),
    )
  res
    .status(status)
    .json({ error: { code, message, ...(details ? { details } : {}) }, requestId: res.locals.requestId })
}
