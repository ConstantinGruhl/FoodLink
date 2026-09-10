import type { Db } from './db.js'
import { membershipDto } from './tenancy.js'
export type Row = Record<string, any>
export function userDto(r: Row) {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    platformAdmin: r.platform_admin || false,
    memberships: (r.memberships || []).map(membershipDto),
    verified: r.verified,
    emailVerified: r.email_verified,
    disabled: r.disabled,
    householdSize: r.household_size,
    dietaryNeeds: r.dietary_needs || [],
    specialRequirements: r.special_requirements || '',
    address: r.address || '',
    createdAt: r.created_at,
  }
}
export function imageDto(r: Row) {
  return { id: r.id, url: `/api/images/${r.id}/content`, alt: r.alt || '', isPrimary: r.is_primary }
}
export function itemDto(r: Row) {
  return {
    id: r.id,
    name: r.name,
    organizationId: r.org_id,
    locationId: r.location_id,
    foodTypeId: r.food_type_id,
    packSize: r.pack_size || '',
    dateLabelType: r.date_label_type || 'none',
    dateLabelOn: r.date_label_on,
    distributionDeadline: r.distribution_deadline,
    allergenStatus: r.allergen_status || 'unknown',
    sourceReference: r.source_reference || '',
    salePermission: r.sale_permission || 'unknown',
    transferPermission: r.transfer_permission || 'unknown',
    inspectionStatus: r.inspection_status || 'clear',
    inspectionReason: r.inspection_reason || '',
    protectedQty: r.protected_qty || 0,
    saleQty: r.sale_qty || 0,
    saleMode: r.sale_mode || 'manual',
    saleReason: r.sale_reason || '',
    qty: r.qty,
    unit: r.unit || 'unit',
    storage: r.storage,
    expiresOn: r.expires_on,
    donorId: r.donor_id,
    isSurplus: r.is_surplus,
    priceCents: r.price_cents || 0,
    weightGrams: r.weight_grams,
    category: r.category,
    allergens: r.allergens,
    handlingNotes: r.handling_notes,
    status: r.status,
    imageUrl: r.images?.[0]?.url || null,
    images: r.images || [],
  }
}
export function eventDto(r: Row) {
  return {
    id: r.id,
    organizationId: r.org_id,
    locationId: r.location_id,
    mode: r.mode || 'items',
    recordingMode: r.recording_mode || 'opening',
    walkInCapacity: r.walk_in_capacity || 0,
    waitlistEnabled: r.waitlist_enabled || false,
    admissionsClosed: r.admissions_closed || false,
    packageLabel: r.package_label || '',
    recurrenceGroupId: r.recurrence_group_id,
    date: r.starts_at,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    cutoffAt: r.cutoff_at,
    timezone: r.timezone,
    location: r.location,
    pickupWindow: r.pickup_window,
    allowDelivery: r.allow_delivery,
    capacity: r.capacity,
    reservedCount: Number(r.reserved_count || 0),
    status: r.status,
  }
}
export async function getItems(db: Db, where = 'true', params: unknown[] = []) {
  const result = await db.query(
    `SELECT i.*,coalesce((SELECT json_agg(json_build_object('id',im.id,'url','/api/images/'||im.id||'/content','alt',coalesce(im.alt,''),'isPrimary',im.is_primary) ORDER BY im.is_primary DESC,im.created_at) FROM item_images im WHERE im.item_id=i.id),'[]') AS images FROM items i WHERE ${where}`,
    params,
  )
  return result.rows.map(itemDto)
}
export async function getDonation(db: Db, donationId: string) {
  const { rows } = await db.query(
    'SELECT d.*,u.name donor_name FROM donations d JOIN users u ON u.id=d.donor_id WHERE d.id=$1',
    [donationId],
  )
  if (!rows.length) return null
  const d = rows[0]
  const items = await getItems(db, 'i.id IN (SELECT item_id FROM donation_items WHERE donation_id=$1)', [
    donationId,
  ])
  const lines = (await db.query('SELECT * FROM donation_items WHERE donation_id=$1', [donationId])).rows
  return {
    id: d.id,
    organizationId: d.org_id,
    locationId: d.location_id,
    submissionId: d.submission_id,
    donorReference: d.donor_reference || '',
    donorType: d.donor_type || 'private',
    fulfillment: d.fulfillment || 'dropoff',
    collectionAddress: d.collection_address || '',
    acceptanceStatus: d.acceptance_status || 'pending',
    acceptanceReason: d.acceptance_reason || '',
    donorId: d.donor_id,
    donorName: d.donor_name,
    date: d.date,
    status: d.status,
    receivedAt: d.received_at,
    notes: d.notes,
    items: items.map((item) => {
      const line = lines.find((l) => l.item_id === item.id)
      return {
        ...item,
        name: line.name_snapshot,
        unit: line.unit_snapshot,
        offeredQty: line.offered_qty,
        receivedQty: line.received_qty,
        rejectedQty: line.rejected_qty || 0,
        rejectionReason: line.rejection_reason || '',
        condition: line.condition || 'unchecked',
      }
    }),
  }
}
export async function getOrder(db: Db, orderId: string, includeToken = true) {
  const { rows } = await db.query(
    'SELECT o.*,u.name user_name FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1',
    [orderId],
  )
  if (!rows.length) return null
  const o = rows[0]
  const lines = (await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY item_id', [orderId]))
    .rows
  return {
    id: o.id,
    organizationId: o.org_id,
    locationId: o.location_id,
    householdId: o.household_id,
    bookingId: o.booking_id,
    currency: o.currency || 'EUR',
    sellerSnapshot: o.seller_snapshot || {},
    userId: o.user_id,
    userName: o.user_name,
    type: o.type,
    status: o.status,
    eventId: o.event_id,
    event: o.event_snapshot,
    createdAt: o.created_at,
    items: lines.map((l) => ({
      itemId: l.item_id,
      name: l.name_snapshot,
      qty: l.qty,
      unit: l.unit_snapshot,
      priceCents: l.price_cents,
      weightGrams: l.weight_grams,
    })),
    totalCents: o.total_cents || 0,
    supportContributionCents: o.support_contribution_cents || 0,
    paymentStatus: o.payment_status,
    pickupToken:
      includeToken && o.status === 'confirmed' && o.fulfillment === 'pickup' ? o.pickup_token : null,
    fulfillment: o.fulfillment,
    deliveryAddress: o.delivery_address,
    assignedVolunteerId: o.assigned_volunteer_id,
    completedAt: o.completed_at,
  }
}
