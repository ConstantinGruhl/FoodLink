import type { Request } from 'express'
import type { PoolClient } from 'pg'
import { Router } from 'express'
import { z } from 'zod'
import { pool, transaction, type Db } from './db.js'
import { ApiError, route, uuid, dateTime } from './http.js'
import { requireAuth } from './security.js'
import { canAt, requireCharityManager } from './tenancy.js'
import { audit } from './communications.js'
import type { Row } from './models.js'

export const entitlements = Router()
export const policySchema = z.object({
  periodDays: z.number().int().min(1).max(366).default(7),
  visits: z.number().int().min(0).max(100).default(1),
  perMemberVisits: z.number().int().min(0).max(100).default(0),
  categoryLimits: z.record(z.string().trim().min(1).max(80), z.number().int().min(0).max(10000)).default({}),
  noShowConsumes: z.boolean().default(false),
  allowOverrides: z.boolean().default(true),
}).strict()
export type AllowancePolicy = z.infer<typeof policySchema>
export async function policyFor(db: Db, organizationId: string): Promise<AllowancePolicy> {
  const p = (await db.query('SELECT * FROM allowance_policies WHERE org_id=$1', [organizationId])).rows[0]
  return p ? { periodDays:p.period_days, visits:p.visits, perMemberVisits:p.per_member_visits,
    categoryLimits:p.category_limits, noShowConsumes:p.no_show_consumes, allowOverrides:p.allow_overrides } : policySchema.parse({})
}
export async function lockHousehold(db: PoolClient, organizationId: string, householdId: string) {
  const h = (await db.query('SELECT * FROM households WHERE id=$1 AND org_id=$2 FOR UPDATE', [householdId, organizationId])).rows[0]
  if (!h) throw new ApiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found in this charity')
  return h
}
export async function householdAccess(db: Db, req: Request, household: Row, locationId: string) {
  if (household.org_id !== req.scope.organizationId) throw new ApiError(403,'CROSS_CHARITY','Choose a household in this charity')
  const member = (await db.query('SELECT 1 FROM household_members WHERE household_id=$1 AND org_id=$2 AND user_id=$3', [household.id, household.org_id,req.user!.id])).rowCount
  const staff = await canAt(req,locationId,'checkin') || await canAt(req,locationId,'people')
  if (!member && !staff) throw new ApiError(403,'HOUSEHOLD_ACCESS','You are not an authorized collector for this household')
  return { member:!!member,staff }
}
export async function assertCollector(db: Db, householdId: string, collectorId?: string | null) {
  if (!collectorId) return
  if (!(await db.query('SELECT 1 FROM household_members hm JOIN users u ON u.id=hm.user_id WHERE hm.household_id=$1 AND hm.user_id=$2 AND NOT u.disabled', [householdId,collectorId])).rowCount)
    throw new ApiError(403,'COLLECTOR_NOT_AUTHORIZED','The collector must be an authorized household member')
}
export async function allowanceSummary(db: Db, household: Row, at: string | Date, excludeBookingId?: string) {
  const policy = await policyFor(db,household.org_id)
  // Period boundaries are local calendar dates, not fixed 24-hour durations; DST does not shift a visit into another week.
  const bounds = (await db.query(`WITH d AS (SELECT ($1::timestamptz AT TIME ZONE timezone)::date day FROM organizations WHERE id=$2), p AS (SELECT date '1970-01-05'+(floor((day-date '1970-01-05')::numeric/$3)::int*$3) start FROM d) SELECT start::text period_start,(start+$3)::text period_end FROM p`, [at,household.org_id,policy.periodDays])).rows[0]
  const holds = (await db.query(`SELECT h.visits,h.categories FROM allowance_holds h JOIN event_bookings b ON b.id=h.booking_id JOIN events e ON e.id=b.event_id JOIN organizations org ON org.id=h.org_id WHERE h.household_id=$1 AND h.org_id=$2 AND h.state IN ('held','consumed') AND (e.starts_at AT TIME ZONE org.timezone)::date >= $3::date AND (e.starts_at AT TIME ZONE org.timezone)::date < $4::date AND ($5::uuid IS NULL OR h.booking_id<>$5)`,[household.id,household.org_id,bounds.period_start,bounds.period_end,excludeBookingId||null])).rows
  const usedCategories: Record<string,number> = {}
  let usedVisits=0
  for(const hold of holds) { usedVisits+=hold.visits; for(const [category,qty] of Object.entries(hold.categories as Record<string,number>)) usedCategories[category]=(usedCategories[category]||0)+qty }
  const visitLimit=policy.visits+policy.perMemberVisits*household.approved_size
  return {householdId:household.id,periodStart:bounds.period_start,periodEnd:bounds.period_end,visitLimit,usedVisits,remainingVisits:Math.max(0,visitLimit-usedVisits),categoryLimits:policy.categoryLimits,usedCategories,noShowConsumes:policy.noShowConsumes,allowOverrides:policy.allowOverrides}
}
export function exceededAllowance(summary: Awaited<ReturnType<typeof allowanceSummary>>, categories: Record<string,number>, visits=1) {
  const reasons:string[]=[]
  if(summary.usedVisits+visits>summary.visitLimit) reasons.push(`The household has ${summary.remainingVisits} visits remaining in this period`)
  for(const [category,qty] of Object.entries(categories)) {
    const limit=summary.categoryLimits[category]
    if(limit!==undefined && (summary.usedCategories[category]||0)+qty>limit) reasons.push(`${category} exceeds the household allowance of ${limit} units`)
  }
  return reasons
}
export async function holdAllowance(db:PoolClient,req:Request,household:Row,event:Row,bookingId:string,categories:Record<string,number>,overrideReason?:string) {
  if(household.status!=='approved') throw new ApiError(403,'HOUSEHOLD_NOT_APPROVED','Charity staff must approve this household before food collection')
  const summary=await allowanceSummary(db,household,event.starts_at,bookingId)
  const reasons=exceededAllowance(summary,categories)
  let overridden=false
  if(reasons.length) {
    if(!overrideReason || !summary.allowOverrides || !(await canAt(req,event.location_id,'manage')))
      throw new ApiError(409,'ALLOWANCE_EXCEEDED',reasons.join('. '),summary)
    overridden=true
    await audit(db,req.user!.id,'allowance.overridden','booking',bookingId,{reason:overrideReason,reasons,householdId:household.id,organizationId:household.org_id})
  }
  await db.query(`INSERT INTO allowance_holds(booking_id,org_id,household_id,period_start,period_end,categories,overridden) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(booking_id) DO UPDATE SET categories=excluded.categories,overridden=allowance_holds.overridden OR excluded.overridden`,[bookingId,household.org_id,household.id,summary.periodStart,summary.periodEnd,JSON.stringify(categories),overridden])
  return summary
}
export async function releaseBooking(db:PoolClient,bookingId:string,status='cancelled') {
  await db.query("UPDATE event_bookings SET status=$2 WHERE id=$1 AND status IN ('confirmed','waitlisted')",[bookingId,status])
  await db.query("UPDATE allowance_holds SET state='released' WHERE booking_id=$1 AND state='held'",[bookingId])
}
export async function consumeBooking(db:PoolClient,bookingId:string) {
  await db.query("UPDATE event_bookings SET status='completed',checked_in_at=coalesce(checked_in_at,now()),completed_at=now() WHERE id=$1 AND status='confirmed'",[bookingId])
  await db.query("UPDATE allowance_holds SET state='consumed' WHERE booking_id=$1 AND state='held'",[bookingId])
}
entitlements.get('/allowance-policy',requireAuth(),route(async(req,res)=>res.json(await policyFor(pool,req.scope.organizationId))))
entitlements.patch('/allowance-policy',requireAuth(),route(async(req,res)=>{
  await requireCharityManager(req,req.scope.organizationId)
  const p=policySchema.parse({...await policyFor(pool,req.scope.organizationId),...req.body})
  await transaction(async db=>{
    await db.query(`INSERT INTO allowance_policies(org_id,period_days,visits,per_member_visits,category_limits,no_show_consumes,allow_overrides) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id) DO UPDATE SET period_days=excluded.period_days,visits=excluded.visits,per_member_visits=excluded.per_member_visits,category_limits=excluded.category_limits,no_show_consumes=excluded.no_show_consumes,allow_overrides=excluded.allow_overrides`,[req.scope.organizationId,p.periodDays,p.visits,p.perMemberVisits,JSON.stringify(p.categoryLimits),p.noShowConsumes,p.allowOverrides])
    await audit(db,req.user!.id,'allowance.policy-updated','organization',req.scope.organizationId,p)
  })
  res.json(p)
}))
entitlements.get('/allowances',requireAuth(),route(async(req,res)=>{
  const householdId=uuid.parse(req.query.householdId)
  const at=req.query.at===undefined?new Date():dateTime.parse(req.query.at)
  const h=(await pool.query('SELECT * FROM households WHERE id=$1 AND org_id=$2',[householdId,req.scope.organizationId])).rows[0]
  if(!h)throw new ApiError(404,'HOUSEHOLD_NOT_FOUND','Household not found')
  await householdAccess(pool,req,h,req.scope.locationId)
  res.json(await allowanceSummary(pool,h,at))
}))
