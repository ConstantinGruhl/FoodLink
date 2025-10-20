// src/store/useData.ts
import { create } from 'zustand'
import { DistributionEvent, FoodItem, ImpactStats, Order } from '@/types'
import { api } from '@/lib/api'

type DonationItem = {
    id: string
    name: string
    qty: number
    unit?: string | null
    storage: 'ambient' | 'chilled' | 'frozen'
    expiresOn?: string | null
}

type Donation = {
    id: string
    donorId: string
    date: string
    status: 'scheduled' | 'received' | 'distributed' | 'cancelled'
    items: DonationItem[]
}

type ItemImage = {
    id: string
    object_key: string
    url?: string | null
    alt?: string | null
    is_primary?: boolean
}

type DataState = {
    // state mirrors what your components expect
    items: any[]
    events: DistributionEvent[]
    orders: Order[]           // we only store “mine” when fetched
    donations: Donation[]     // requires donations endpoints
    impact: ImpactStats

    imagesByItem: Record<string, ItemImage[]>
    loadItemImages: (itemId: string) => Promise<void>

    // loaders
    loadPublicImpact: () => Promise<void>
    loadRecipientCatalog: () => Promise<void>
    loadSurplusCatalog: () => Promise<void>
    loadNextEvent: () => Promise<void>
    loadMyOrders: (userId: string) => Promise<void>
    loadMyDonations: (donorId: string) => Promise<void> // requires backend

    // actions
    reserveItem: (userId: string, itemId: string, qty: number) => Promise<Order>
    buyerPurchase: (userId: string, cart: { itemId: string; qty: number }[], supportCents: number) => Promise<Order>
    createDonation: (payload: { donorId: string; items: { name: string; qty: number; storage: FoodItem['storage']; expiresOn?: string }[] }) => Promise<void> // requires backend
    updateDonationStatus: (id: string, status: 'scheduled' | 'received' | 'distributed' | 'cancelled') => Promise<void> // requires backend
    createEvent: (evt: Omit<DistributionEvent, 'id'>) => Promise<void> // requires backend
}

const emptyImpact: ImpactStats = { totalMealsDistributed: 0, totalKgSaved: 0, totalDonors: 0, totalBuyers: 0 }

export const useData = create<DataState>((set, get) => ({
    items: [],
    events: [],
    orders: [],
    donations: [],
    imagesByItem: {},
    impact: emptyImpact,

    createDonation: async (payload) => {
        await api.post('/donations', payload)        // returns { donationId, items:[{id,...}] } (backend below)
    },

    loadMyDonations: async (userId) => {
        const { data } = await api.get(`/users/${userId}/donations`)
        set({ donations: data })
        // optional: prefetch images for convenience
        const allItemIds = data.flatMap((d: Donation) => d.items.map(i => i.id)).filter(Boolean)
        await Promise.all(allItemIds.map((id: string) => get().loadItemImages(id)))
    },

    loadPublicImpact: async () => {
        const { data } = await api.get<ImpactStats>('/impact')
        set({ impact: data })
    },

    loadRecipientCatalog: async () => {
        const { data } = await api.get("/items?surplus=false")
        set({ items: data })
        await Promise.all(data.map((it: any) => get().loadItemImages(it.id)))
    },
    loadItemImages: async (itemId: string) => {
        if (!itemId) return
        // optional small cache guard
        if (get().imagesByItem[itemId]) return
        const { data } = await api.get(`/items/${itemId}/images`)
        set(s => ({ imagesByItem: { ...s.imagesByItem, [itemId]: data } }))
    },

    loadSurplusCatalog: async () => {
        const { data } = await api.get("/items?surplus=true")
        set({ items: data })
        // optionally prefetch images for each item
        await Promise.all(data.map((it: any) => get().loadItemImages(it.id)))
    },

    loadNextEvent: async () => {
        const { data } = await api.get<DistributionEvent | null>('/events/next')
        set({ events: data ? [data] : [] })
    },

    loadMyOrders: async (userId: string) => {
        // implement this endpoint in backend, else skip and rely on client-side confirmation
        const { data } = await api.get<Order[]>('/orders/mine', { params: { userId } })
        set({ orders: data })
    },

    reserveItem: async (userId, itemId, qty) => {
        const { data } = await api.post<{ orderId: string }>('/orders/reserve', { userId, itemId, qty })
        // refresh lists
        await Promise.allSettled([get().loadRecipientCatalog(), get().loadNextEvent(), get().loadMyOrders(userId)])
        return { id: data.orderId, userId, items: [{ itemId, qty }], type: 'recipient-reservation', status: 'confirmed', createdAt: new Date().toISOString() } as Order
    },

    buyerPurchase: async (userId, cart, supportCents) => {
        const { data } = await api.post<{ orderId: string; totalCents: number }>('/orders/buy', {
            userId,
            cart,
            supportContributionCents: supportCents,
        })
        await get().loadSurplusCatalog()
        return {
            id: data.orderId,
            userId,
            items: cart,
            type: 'buyer-order',
            status: 'confirmed',
            createdAt: new Date().toISOString(),
            totalCents: data.totalCents,
            supportContributionCents: supportCents,
        } as Order
    },

    updateDonationStatus: async (id, status) => {
        await api.patch(`/donations/${id}`, { status })
        const donations = [...get().donations]
        const d = donations.find(x => x.id === id)
        if (d) d.status = status
        set({ donations })
    },

    createEvent: async (evt) => {
        await api.post('/events', evt)
        await get().loadNextEvent()
    },

}))
