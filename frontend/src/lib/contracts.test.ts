import { describe, expect, it } from 'vitest'
import { basketTotal, setBasketQuantity, validateBasket } from './format'
import { eventSchema, itemSchema, reportSchema } from './schemas'
export const exampleItem = {
  id: 'item-a',
  name: 'Apples',
  qty: 2,
  unit: 'bag',
  storage: 'ambient' as const,
  expiresOn: '2099-12-30T23:59:59Z',
  donorId: 'donor-a',
  isSurplus: false,
  priceCents: 250,
  weightGrams: 1000,
  category: 'Produce',
  allergens: [],
  handlingNotes: 'Wash before eating',
  status: 'available',
  imageUrl: null,
  images: [],
}
export const exampleEvent = {
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
  status: 'scheduled' as const,
}
describe('basket and response contracts', () => {
  it('bounds stock controls, removes zero quantities, and never mutates previous basket', () => {
    const previous = [{ itemId: 'item-b', qty: 1 }]
    const next = setBasketQuantity(previous, 'item-a', 99, 2)
    expect(next).toEqual([
      { itemId: 'item-b', qty: 1 },
      { itemId: 'item-a', qty: 2 },
    ])
    expect(previous).toEqual([{ itemId: 'item-b', qty: 1 }])
    expect(setBasketQuantity(next, 'item-a', 0, 2)).toEqual(previous)
    expect(setBasketQuantity([], 'item-a', NaN, 2)).toEqual([])
  })
  it('rejects stale stock, duplicate lines and negative quantities before submitting', () => {
    expect(validateBasket([{ itemId: 'item-a', qty: 3 }], [exampleItem])).toMatch(/no longer available/)
    expect(
      validateBasket(
        [
          { itemId: 'item-a', qty: 1 },
          { itemId: 'item-a', qty: 1 },
        ],
        [exampleItem],
      ),
    ).toMatch(/once/)
    expect(validateBasket([{ itemId: 'item-a', qty: -1 }], [exampleItem])).toMatch(/no longer available/)
    expect(validateBasket([{ itemId: 'item-a', qty: 2 }], [exampleItem])).toBeNull()
    expect(basketTotal([{ itemId: 'item-a', qty: 2 }], [exampleItem])).toBe(500)
  })
  it('rejects legacy snake_case catalog and malformed event data', () => {
    expect(itemSchema.safeParse({ ...exampleItem, isSurplus: undefined, is_surplus: true }).success).toBe(
      false,
    )
    expect(eventSchema.safeParse({ ...exampleEvent, capacity: '50' }).success).toBe(false)
  })
  it('accepts intentionally redacted reporting rows without requiring personal fields', () => {
    expect(
      reportSchema.parse({
        from: '2026-09-01',
        to: '2026-09-30',
        receivedDonations: 1,
        completedOrders: 1,
        kgDistributed: 1,
        mealsDistributed: 2,
        disposedKg: 0,
        orders: [
          {
            id: 'order-a',
            type: 'recipient-reservation',
            status: 'picked-up',
            eventId: 'event-a',
            event: exampleEvent,
            createdAt: '2026-09-01T12:00:00Z',
            items: [
              { itemId: 'item-a', name: 'Apples', qty: 1, unit: 'bag', priceCents: 0, weightGrams: 1000 },
            ],
            totalCents: 0,
            supportContributionCents: 0,
            paymentStatus: 'not-required',
            pickupToken: null,
            fulfillment: 'pickup',
            assignedVolunteerId: null,
            completedAt: '2026-09-01T13:00:00Z',
          },
        ],
      }).orders[0].status,
    ).toBe('picked-up')
  })
})
