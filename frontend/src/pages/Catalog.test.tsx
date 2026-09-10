import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Catalog from './Catalog'
const mocks = vi.hoisted(() => ({
  user: {
    id: 'recipient-a',
    name: 'Test Recipient',
    email: 'recipient@example.test',
    role: 'recipient',
    emailVerified: true,
    verified: true,
    address: '',
  },
}))
vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: mocks.user,
    config: { currency: 'EUR', timezone: 'Europe/Berlin', paymentsEnabled: false },
    refresh: vi.fn(),
  }),
}))
const item = {
  id: 'item-a',
  name: 'Apples',
  qty: 2,
  unit: 'bag',
  storage: 'ambient',
  expiresOn: '2099-12-30T23:59:59Z',
  donorId: 'donor-a',
  isSurplus: false,
  priceCents: 250,
  weightGrams: 1000,
  category: 'Produce',
  allergens: ['apple'],
  handlingNotes: 'Wash before eating',
  status: 'available',
  imageUrl: null,
  images: [],
}
const event = {
  id: 'event-a',
  date: '2099-09-15T12:00:00Z',
  startsAt: '2099-09-15T12:00:00Z',
  endsAt: '2099-09-15T14:00:00Z',
  cutoffAt: '2099-09-15T11:00:00Z',
  timezone: 'Europe/Berlin',
  location: 'Community hall',
  pickupWindow: '14:00–16:00',
  allowDelivery: true,
  capacity: 50,
  reservedCount: 0,
  status: 'scheduled',
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function page(mode: 'recipient' | 'buyer' = 'recipient') {
  return render(
    <MemoryRouter>
      <Catalog mode={mode} />
    </MemoryRouter>,
  )
}
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  mocks.user.verified = true
  mocks.user.emailVerified = true
})
describe('catalog workflow', () => {
  it('handles no upcoming event without a crash and displays food safety details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => (path.includes('/items') ? json([item]) : json([]))),
    )
    page()
    expect(await screen.findByText('Apples')).toBeInTheDocument()
    expect(await screen.findByText(/No distribution events are open/)).toBeInTheDocument()
    expect(screen.getByText('Wash before eating')).toBeInTheDocument()
    expect(screen.getByText('Allergens:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reserve basket' })).toBeDisabled()
  })
  it('preserves the basket on reservation failure and sends one atomic request with an idempotency key', async () => {
    const requests: { path: string; options: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options: RequestInit) => {
        requests.push({ path, options })
        if (path.includes('/items')) return json([item])
        if (path.includes('/events')) return json([event])
        return json(
          { error: { code: 'INSUFFICIENT_STOCK', message: 'Apples has insufficient available stock' } },
          409,
        )
      }),
    )
    const user = userEvent.setup()
    page()
    await user.click(await screen.findByRole('button', { name: 'Add one Apples' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Collection event' }), 'event-a')
    await user.click(screen.getByRole('button', { name: 'Reserve basket' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('insufficient available stock')
    expect(screen.getByRole('spinbutton', { name: 'Basket quantity for Apples' })).toHaveValue(1)
    const writes = requests.filter((r) => r.path === '/api/orders/reserve')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].options.body as string)).toEqual({
      eventId: 'event-a',
      items: [{ itemId: 'item-a', qty: 1 }],
      fulfillment: 'pickup',
    })
    expect(new Headers(writes[0].options.headers).get('Idempotency-Key')).toMatch(/^[a-f\d-]{36}$/)
  })
  it('keeps recipient approval and commerce availability explicit', async () => {
    mocks.user.verified = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => (path.includes('/items') ? json([item]) : json([event]))),
    )
    const { unmount } = page()
    expect(screen.getByText(/awaiting eligibility approval/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reserve basket' })).toBeDisabled()
    unmount()
    page('buyer')
    expect(screen.getByText(/operator has not enabled payment processing/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeDisabled()
  })
  it('shows a retry action when catalog loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.includes('/items')
          ? json({ error: { code: 'OUTAGE', message: 'Temporarily unavailable' } }, 503)
          : json([]),
      ),
    )
    page()
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporarily unavailable')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
