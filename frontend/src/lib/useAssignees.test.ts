import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAssignees } from './useAssignees'
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())
describe('eligible staff directory', () => {
  it('loads every filtered directory page so staff beyond the first page remain selectable', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: `staff-${i}`, name: `Team member ${i}` }))
    const last = { id: 'old-volunteer', name: 'Longstanding volunteer' }
    const fetchMock = vi.fn(async (path: string) => (path.endsWith('offset=0') ? json(first) : json([last])))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAssignees(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(101)
    expect(result.current.data).toContainEqual(last)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/admin/assignees?limit=100&offset=0',
      '/api/admin/assignees?limit=100&offset=100',
    ])
  })
  it('reports a failed later page instead of silently presenting an incomplete directory', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: `staff-${i}`, name: `Team member ${i}` }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.endsWith('offset=0')
          ? json(first)
          : json({ error: { code: 'UNAVAILABLE', message: 'Staff directory unavailable' } }, 503),
      ),
    )
    const { result } = renderHook(() => useAssignees(true))
    await waitFor(() => expect(result.current.error).toBe('Staff directory unavailable'))
    expect(result.current.data).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})
