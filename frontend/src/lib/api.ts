import { z } from 'zod'

let csrfToken: string | null = null
let selectedLocationId: string | null = null
export function setLocationId(value: string | null) {
  selectedLocationId = value
}
export function getLocationId() { return selectedLocationId }
export function setCsrfToken(value: string | null) {
  csrfToken = value
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (selectedLocationId && !headers.has('X-Location-Id')) headers.set('X-Location-Id', selectedLocationId)
  if (options.body && typeof options.body === 'string') headers.set('Content-Type', 'application/json')
  if (csrfToken && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken)
  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Unable to connect. Check your connection and try again.', 0, 'NETWORK_ERROR')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ApiError(
      'The server returned an unreadable response. Please try again.',
      response.status,
      'INVALID_RESPONSE',
    )
  }
  if (!response.ok) {
    const parsed = z
      .object({
        error: z.object({
          message: z.string(),
          code: z.string(),
          details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
        }),
        requestId: z.string().optional(),
      })
      .safeParse(data)
    if (response.status === 401 && csrfToken) {
      setCsrfToken(null)
      window.dispatchEvent(new Event('foodlink:session-expired'))
    }
    throw new ApiError(
      parsed.success
        ? `${parsed.data.error.message}${
            parsed.data.error.details?.length
              ? ': ' +
                parsed.data.error.details
                  .slice(0, 4)
                  .map((d) => `${d.path}: ${d.message}`)
                  .join('; ')
              : ''
          }`
        : 'The request could not be completed.',
      response.status,
      parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
      parsed.success ? parsed.data.requestId : undefined,
    )
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    if (import.meta.env.DEV) console.error('Response contract mismatch', path, parsed.error.issues)
    throw new ApiError(
      'This page received unexpected data. Please reload or contact support.',
      response.status,
      'CONTRACT_ERROR',
    )
  }
  return parsed.data
}
export function mutation<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  body: unknown = {},
  method = 'POST',
  headers?: HeadersInit,
) {
  return request(path, schema, { method, body: JSON.stringify(body), headers })
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
