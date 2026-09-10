import { z } from 'zod'

export const roleSchema = z.enum(['recipient', 'buyer', 'donor', 'volunteer', 'admin', 'charity_manager', 'location_manager'])
export const membershipSchema = z.object({
  id: z.string(), organizationId: z.string(), locationId: z.string().nullable(),
  role: z.enum(['charity_manager', 'location_manager', 'volunteer']),
  status: z.string().optional(), duties: z.array(z.string()).default([]),
  organizationName: z.string().optional(), locationName: z.string().nullable().optional(),
  userId: z.string().optional(), userName: z.string().optional(), email: z.string().optional(),
})
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  memberships: z.array(membershipSchema).optional(),
  platformAdmin: z.boolean().optional(),
  verified: z.boolean(),
  emailVerified: z.boolean(),
  disabled: z.boolean(),
  householdSize: z.number().nullable().optional(),
  dietaryNeeds: z.array(z.string()).default([]),
  specialRequirements: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  createdAt: z.string(),
})
export const sessionSchema = z.object({ user: userSchema.nullable(), csrfToken: z.string().nullable() })
export const imageSchema = z.object({
  id: z.string(),
  url: z.string(),
  alt: z.string().nullable().optional(),
  isPrimary: z.boolean(),
})
export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  qty: z.number(),
  unit: z.string(),
  storage: z.enum(['ambient', 'chilled', 'frozen']),
  expiresOn: z.string().nullable(),
  donorId: z.string().nullable(),
  isSurplus: z.boolean(),
  priceCents: z.number(),
  weightGrams: z.number(),
  category: z.string(),
  allergens: z.array(z.string()),
  handlingNotes: z.string().nullable(),
  status: z.string(),
  imageUrl: z.string().nullable(),
  images: z.array(imageSchema),
  organizationId: z.string().optional(), locationId: z.string().optional(),
  organizationName: z.string().optional(), locationName: z.string().optional(),
  foodTypeId: z.string().nullable().optional(), packSize: z.string().nullable().optional(),
  dateLabelType: z.enum(['use_by', 'best_before', 'none']).optional(), dateLabelOn: z.string().nullable().optional(),
  distributionDeadline: z.string().nullable().optional(), allergenStatus: z.enum(['unknown', 'declared']).optional(),
  sourceReference: z.string().nullable().optional(), salePermission: z.enum(['unknown','allowed','prohibited']).optional(),
  transferPermission: z.enum(['unknown','allowed','prohibited']).optional(), inspectionStatus: z.string().optional(),
  protectedQty: z.number().optional(), saleQty: z.number().optional(),
})
export const donationSchema = z.object({
  id: z.string(),
  donorId: z.string(),
  donorName: z.string(),
  date: z.string(),
  status: z.string(),
  receivedAt: z.string().nullable(),
  notes: z.string().nullable(),
  organizationId: z.string().optional(), locationId: z.string().optional(), locationName: z.string().optional(),
  organizationName: z.string().optional(), donorReference: z.string().nullable().optional(),
  fulfillment: z.enum(['dropoff','collection']).optional(), collectionAddress: z.string().nullable().optional(),
  reviewRequired: z.boolean().optional(),
  items: z.array(itemSchema.extend({ offeredQty: z.number(), receivedQty: z.number(), rejectedQty: z.number().optional(), rejectionReason: z.string().nullable().optional(), condition: z.string().nullable().optional() })),
})
export const eventSchema = z.object({
  id: z.string(),
  date: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  cutoffAt: z.string(),
  timezone: z.string(),
  location: z.string(),
  pickupWindow: z.string(),
  allowDelivery: z.boolean(),
  capacity: z.number(),
  reservedCount: z.number(),
  status: z.enum(['scheduled', 'cancelled', 'completed']),
  organizationId: z.string().optional(), locationId: z.string().optional(),
  mode: z.enum(['items','visit','packages']).optional(), recordingMode: z.enum(['opening','leftovers-only']).optional(),
  walkInCapacity: z.number().optional(), waitlistEnabled: z.boolean().optional(), admissionsClosed: z.boolean().optional(),
  packageLabel: z.string().nullable().optional(), recurrenceGroupId: z.string().nullable().optional(),
})
export const orderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  type: z.string(),
  status: z.string(),
  eventId: z.string().nullable(),
  event: eventSchema.nullable().optional(),
  createdAt: z.string(),
  items: z.array(
    z.object({
      itemId: z.string(),
      name: z.string(),
      qty: z.number(),
      unit: z.string(),
      priceCents: z.number(),
      weightGrams: z.number(),
    }),
  ),
  totalCents: z.number(),
  supportContributionCents: z.number(),
  paymentStatus: z.string(),
  pickupToken: z.string().nullable(),
  fulfillment: z.enum(['pickup', 'delivery']),
  deliveryAddress: z.string().nullable(),
  assignedVolunteerId: z.string().nullable(),
  completedAt: z.string().nullable(),
  organizationId: z.string().optional(), locationId: z.string().optional(), organizationName: z.string().optional(), locationName: z.string().optional(),
})
export const impactSchema = z.object({
  totalMealsDistributed: z.number(),
  totalKgSaved: z.number(),
  totalDonors: z.number(),
  totalBuyers: z.number(),
  totalOrdersCompleted: z.number(),
  monthly: z.array(z.object({ month: z.string(), meals: z.number(), kg: z.number() })),
  methodology: z.string(),
})
export const configSchema = z.object({
  currency: z.string(),
  timezone: z.string(),
  paymentsEnabled: z.boolean(),
  mailMode: z.string(),
  organizationName: z.string(),
  supportEmail: z.string().default(''),
  organizationAddress: z.string().default(''),
  privacyContact: z.string().default(''),
  retentionDays: z.number().default(365),
  legalReady: z.boolean().default(false),
  demoLoginEnabled: z.boolean().default(false),
})
export const notificationSchema = z.object({
  id: z.string(),
  subject: z.string(),
  body: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
})
export const reportSchema = z.object({
  from: z.string(),
  to: z.string(),
  receivedDonations: z.number(),
  completedOrders: z.number(),
  kgDistributed: z.number(),
  mealsDistributed: z.number(),
  disposedKg: z.number(),
  orders: z.array(orderSchema.omit({ userId: true, userName: true, deliveryAddress: true })),
  timezone: z.string().optional(),
  truncated: z.boolean().default(false),
})
export const ledgerSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  delta: z.number(),
  kind: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  actorId: z.string().nullable(),
  orderId: z.string().nullable(),
})
export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  eventId: z.string().nullable(),
  assignedVolunteerId: z.string().nullable(),
  dueAt: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
})
export const auditSchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  details: z.unknown(),
  createdAt: z.string(),
})
export const outboxSchema = z
  .object({
    id: z.string(),
    recipient: z.string().optional(),
    subject: z.string().optional(),
    status: z.string(),
    attempts: z.number().optional(),
    createdAt: z.string(),
    body: z.string().optional(),
    lastError: z.string().nullable().optional(),
  })
  .passthrough()
export type Role = z.infer<typeof roleSchema>
export type User = z.infer<typeof userSchema>
export type Item = z.infer<typeof itemSchema>
export type Donation = z.infer<typeof donationSchema>
export type DistributionEvent = z.infer<typeof eventSchema>
export type Order = z.infer<typeof orderSchema>
export type Config = z.infer<typeof configSchema>
export type Task = z.infer<typeof taskSchema>
export type BasketLine = { itemId: string; qty: number }
export type DonationInput = {
  name: string
  qty: number
  unit: string
  storage: Item['storage']
  expiresOn?: string
  weightGrams: number
  category: string
  allergens: string[]
  handlingNotes: string
  locationId?: string
  foodTypeId?: string
  packSize?: string
  dateLabelType?: 'use_by' | 'best_before' | 'none'
  dateLabelOn?: string
  distributionDeadline?: string
  allergenStatus?: 'unknown' | 'declared'
  sourceReference?: string
  salePermission?: 'unknown' | 'allowed' | 'prohibited'
  transferPermission?: 'unknown' | 'allowed' | 'prohibited'
  needId?: string
}
export const okSchema = z.object({ ok: z.boolean() })
