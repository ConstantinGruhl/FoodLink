import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiError, mutation, request, setCsrfToken } from './api'
afterEach(() => {
  setCsrfToken(null)
  vi.unstubAllGlobals()
})
describe('API transport', () => {
  it('uses cookie credentials and the server CSRF token with mutation requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    setCsrfToken('server-token')
    await mutation('/test', z.object({ ok: z.boolean() }), { qty: 2 })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/test')
    expect(options.credentials).toBe('include')
    expect(options.headers.get('X-CSRF-Token')).toBe('server-token')
    expect(JSON.parse(options.body)).toEqual({ qty: 2 })
  })
  it('rejects incompatible server data instead of inventing a successful order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ order_id: 'x' }), { status: 200 })),
    )
    await expect(request('/orders/test', z.object({ id: z.string() }))).rejects.toMatchObject({
      code: 'CONTRACT_ERROR',
    })
  })
  it('surfaces validation details and preserves request IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Check the submitted fields',
              details: [{ path: 'items.0.qty', message: 'Must be positive' }],
            },
            requestId: 'request-1',
          }),
          { status: 400 },
        ),
      ),
    )
    await expect(mutation('/test', z.object({ ok: z.boolean() }))).rejects.toMatchObject({
      status: 400,
      requestId: 'request-1',
      message: expect.stringContaining('items.0.qty: Must be positive'),
    })
  })
  it('clears authenticated state on session expiry', async () => {
    const event = vi.fn()
    window.addEventListener('foodlink:session-expired', event)
    setCsrfToken('expired')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again' } }), {
          status: 401,
        }),
      ),
    )
    await expect(request('/orders/mine', z.array(z.unknown()))).rejects.toBeInstanceOf(ApiError)
    expect(event).toHaveBeenCalledOnce()
    window.removeEventListener('foodlink:session-expired', event)
  })
})
