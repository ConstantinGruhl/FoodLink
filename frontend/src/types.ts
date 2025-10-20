// src/types.ts

export type Role = 'recipient' | 'buyer' | 'donor' | 'volunteer' | 'admin'

export interface User {
    id: string
    email: string
    name: string
    role: Role
    verified?: boolean
    ngoCode?: string
    householdSize?: number
    dietaryNeeds?: string[]
    specialRequirements?: string
    address?: string
    createdAt?: string
}

export type StorageType = 'ambient' | 'chilled' | 'frozen'

export interface FoodItem {
    id: string
    name: string
    qty: number
    unit?: string
    storage: StorageType
    expiresOn?: string
    donorId?: string
    imageUrl?: string
    priceCents?: number
    isSurplus?: boolean
    reservedBy?: string[]        // optional: recipient ids who reserved
}

export type DonationStatus = 'scheduled' | 'received' | 'distributed' | 'cancelled'

export interface DonationLine {
    id?: string                   // optional client id
    name: string
    qty: number
    storage: StorageType
    expiresOn?: string
}

export interface Donation {
    id: string
    donorId: string
    date: string                  // ISO
    status: DonationStatus
    items: DonationLine[]
}

export interface DistributionEvent {
    id: string
    date: string                  // ISO
    location: string
    pickupWindow: string
    allowDelivery: boolean
}

export type OrderType = 'recipient-reservation' | 'buyer-order'
export type OrderStatus = 'pending' | 'confirmed' | 'picked-up' | 'delivered' | 'cancelled'

export interface OrderLine {
    itemId: string
    qty: number
}

export interface Order {
    id: string
    userId: string
    items: OrderLine[]
    type: OrderType
    status: OrderStatus
    eventId?: string
    createdAt: string             // ISO
    totalCents?: number
    supportContributionCents?: number
}

export interface ImpactStats {
    totalMealsDistributed: number
    totalKgSaved: number
    totalDonors: number
    totalBuyers: number
}
