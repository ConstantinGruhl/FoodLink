import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EventManagement from './EventManagement'
vi.mock('../lib/auth', () => ({ useAuth: () => ({ config: { timezone: 'Europe/Berlin' } }) }))
const fixture = {
  id: 'event-a',
  date: '2099-09-15T12:00:37Z',
  startsAt: '2099-09-15T12:00:37Z',
  endsAt: '2099-09-15T14:00:37Z',
  cutoffAt: '2099-09-15T11:00:37Z',
  timezone: 'Europe/Berlin',
  location: 'Original hall',
  pickupWindow: '14:00–16:00',
  allowDelivery: true,
  capacity: 50,
  reservedCount: 3,
  status: 'scheduled',
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())
describe('editing an event with reservations', () => {
  it('changes the location without resubmitting protected schedule fields or changing existing reservations', async () => {
    let current = { ...fixture }
    const patches: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, options: RequestInit) => {
        if (options.method === 'PATCH') {
          const payload = JSON.parse(options.body as string)
          patches.push(payload)
          if (['startsAt', 'endsAt', 'cutoffAt', 'allowDelivery'].some((field) => field in payload))
            return json(
              { error: { code: 'ACTIVE_ORDERS', message: 'Reserved events cannot be rescheduled' } },
              409,
            )
          current = { ...current, ...payload }
          return json(current)
        }
        return json([current])
      }),
    )
    const user = userEvent.setup()
    render(<EventManagement />)
    await user.click(await screen.findByRole('button', { name: 'Edit event' }))
    await user.clear(screen.getByRole('textbox', { name: 'Collection location' }))
    await user.type(screen.getByRole('textbox', { name: 'Collection location' }), 'Accessible community hall')
    await user.click(screen.getByRole('button', { name: 'Save event' }))
    expect(await screen.findByRole('heading', { name: 'Accessible community hall' })).toBeInTheDocument()
    expect(screen.getByText('3 / 50 slots')).toBeInTheDocument()
    expect(patches).toEqual([{ location: 'Accessible community hall' }])
    expect(current.startsAt).toBe(fixture.startsAt)
    expect(current.allowDelivery).toBe(true)
  })
  it('does not write when an edit is saved without changes, including second-precision schedule timestamps', async () => {
    const fetchMock = vi.fn(async () => json([fixture]))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<EventManagement />)
    await user.click(await screen.findByRole('button', { name: 'Edit event' }))
    await user.click(screen.getByRole('button', { name: 'Save event' }))
    expect(await screen.findByRole('heading', { name: 'Original hall' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.every((call) => !(call[1] as RequestInit | undefined)?.method)).toBe(true)
  })
})
