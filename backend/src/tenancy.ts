import type { Request } from 'express'
import { pool, type Db } from './db.js'
import { ApiError, route, uuid } from './http.js'
import type { Row } from './models.js'

export const DEFAULT_LOCATION = '00000000-0000-4000-8000-000000000001'
export const capabilities = ['read', 'receive', 'inventory', 'events', 'checkin', 'delivery', 'manage', 'people', 'policy', 'pricing'] as const
export type Capability = (typeof capabilities)[number]
declare global {
  namespace Express {
    interface Request { scope: { locationId: string; organizationId: string; location: Row } }
  }
}
export async function loadMemberships(userId: string, db: Db = pool) {
  return (await db.query(`SELECT m.*,o.name organization_name,l.name location_name FROM staff_memberships m JOIN organizations o ON o.id=m.org_id LEFT JOIN locations l ON l.id=m.location_id WHERE m.user_id=$1 AND m.active AND o.active AND (l.id IS NULL OR l.active) ORDER BY m.created_at,m.id`, [userId])).rows
}
export function membershipDto(m: Row) {
  return {id:m.id,userId:m.user_id,name:m.name,email:m.email,organizationId:m.org_id,locationId:m.location_id,role:m.role,duties:m.duties || [],organizationName:m.organization_name,locationName:m.location_name,active:m.active}
}
export async function locationById(locationId: string) {
  const r=(await pool.query('SELECT l.*,o.name organization_name,o.active organization_active,o.currency,o.timezone FROM locations l JOIN organizations o ON o.id=l.org_id WHERE l.id=$1',[uuid.parse(locationId)])).rows[0]
  if(!r) throw new ApiError(404,'LOCATION_NOT_FOUND','Choose an available location')
  return r
}
export const locationContext=route(async(req,_res,next)=>{
  if(req.user && !req.user.memberships) req.user.memberships=await loadMemberships(req.user.id)
  const explicit=req.get('X-Location-Id') || (typeof req.query.locationId==='string'?req.query.locationId:undefined)
  let selected=explicit
  if(!selected && req.user?.memberships?.length){
    const first=req.user.memberships[0]
    selected=first.location_id || (await pool.query('SELECT id FROM locations WHERE org_id=$1 AND active ORDER BY created_at,id LIMIT 1',[first.org_id])).rows[0]?.id
  }
  const location=await locationById(selected || DEFAULT_LOCATION)
  req.scope={locationId:location.id,organizationId:location.org_id,location}
  next()
})
export function membershipAllows(m: Row, location: Row, capability: string) {
  if(!m.active || m.org_id!==location.org_id || (m.location_id && m.location_id!==location.id)) return false
  if(m.role==='charity_manager') return true
  if(m.role==='location_manager') return capability!=='policy'
  return capability==='read' || (['receive','inventory','events','checkin','delivery'].includes(capability) && (m.duties || []).includes(capability))
}
export async function canAt(req:Request, locationId:string, capability='read') {
  if(!req.user) return false
  const location=req.scope?.locationId===locationId?req.scope.location:await locationById(locationId)
  if(!location.active || !location.organization_active) return false
  // Read memberships freshly at the authority boundary: revocations apply to existing sessions.
  const memberships=await loadMemberships(req.user.id)
  return memberships.some(m=>membershipAllows(m,location,capability))
}
export async function assertLocation(req:Request,locationId:string,capability='read') {
  if(!await canAt(req,locationId,capability)) throw new ApiError(403,'LOCATION_FORBIDDEN','You do not have permission for this action at this location')
}
export async function assertRecordAccess(req:Request,row:Row|undefined,ownerField='user_id',capability='read') {
  if(!row) throw new ApiError(404,'NOT_FOUND','Record not found')
  if(req.user && row[ownerField]===req.user.id) return
  await assertLocation(req,row.location_id,capability)
}
export const requireCapability=(capability:string)=>route(async(req,_res,next)=>{
  await assertLocation(req,req.scope.locationId,capability);next()
})
export async function requireCharityManager(req:Request,orgId=req.scope.organizationId){
  if(!req.user || !(await loadMemberships(req.user.id)).some(m=>m.org_id===orgId && m.role==='charity_manager')) throw new ApiError(403,'CHARITY_MANAGER_REQUIRED','A manager of this charity must perform this action')
}
export const requirePlatformAdmin=route(async(req,_res,next)=>{
  if(!req.user?.platform_admin) throw new ApiError(403,'PLATFORM_ADMIN_REQUIRED','Platform administration permission is required')
  next()
})
export async function scopedAudit(db:Db,req:Request,action:string,entityType:string,entityId:string|null,details:unknown={}){
  await db.query('INSERT INTO audit_log(actor_id,action,entity_type,entity_id,details,org_id,location_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[req.user?.id||null,action,entityType,entityId,JSON.stringify(details),req.scope.organizationId,req.scope.locationId])
}
