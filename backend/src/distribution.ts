import { Router, type Request } from 'express'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, transaction, type Db } from './db.js'
import { ApiError, route, uuid, id, quantity, textField } from './http.js'
import { requireAuth, token, hash } from './security.js'
import { assertLocation, canAt } from './tenancy.js'
import { eventDto, type Row } from './models.js'
import { audit } from './communications.js'
import { movement } from './inventory.js'
import { lockEvent, cancelLocked } from './orders.js'
import { lockHousehold,householdAccess,assertCollector,holdAllowance,releaseBooking,consumeBooking,policyFor } from './entitlements.js'

export const distribution = Router()
export const bookingSchema=z.object({householdId:uuid,slotId:uuid.optional(),collectorId:uuid.optional(),walkIn:z.boolean().default(false),overrideReason:textField(500).optional(),packageCount:z.number().int().min(1).max(20).default(1),notes:z.string().trim().max(1000).default('')}).strict()
type BookingInput=z.infer<typeof bookingSchema>
export function bookingDto(b:Row){return {id:b.id,eventId:b.event_id,organizationId:b.org_id,locationId:b.location_id,householdId:b.household_id,householdLabel:b.household_label,slotId:b.slot_id,collectorId:b.collector_id,bookedBy:b.booked_by,status:b.status,walkIn:b.walk_in,packageCount:b.package_count,reference:b.reference,notes:b.notes,createdAt:b.created_at,checkedInAt:b.checked_in_at,event:b.event_snapshot}}
async function getBooking(db:Db,bookingId:string){return (await db.query('SELECT b.*,h.label household_label FROM event_bookings b JOIN households h ON h.id=b.household_id WHERE b.id=$1',[bookingId])).rows[0]}
export async function assertBookingCapacity(db:Db,event:Row,slotId?:string|null,walkIn=false,excludeId?:string){
  const counts=(await db.query(`SELECT count(*)::int total,count(*) FILTER(WHERE walk_in)::int walkins FROM event_bookings WHERE event_id=$1 AND status IN ('confirmed','checked-in','completed') AND ($2::uuid IS NULL OR id<>$2)`,[event.id,excludeId||null])).rows[0]
  const standalone=Number((await db.query("SELECT count(*) n FROM orders WHERE event_id=$1 AND booking_id IS NULL AND status NOT IN ('cancelled','expired')",[event.id])).rows[0].n)
  if(counts.total+standalone>=event.capacity)return false
  if(walkIn){if(counts.walkins>=event.walk_in_capacity)return false}
  else if(counts.total-counts.walkins+standalone>=event.capacity-event.walk_in_capacity)return false
  const slots=(await db.query('SELECT * FROM event_slots WHERE event_id=$1 ORDER BY starts_at',[event.id])).rows
  if(!walkIn && slots.length && !slotId)throw new ApiError(400,'SLOT_REQUIRED','Choose a collection time')
  if(slotId){
    const slot=slots.find(s=>s.id===slotId)
    if(!slot)throw new ApiError(400,'SLOT_MISMATCH','This time slot belongs to another event')
    const n=Number((await db.query("SELECT count(*) n FROM event_bookings WHERE slot_id=$1 AND status IN ('confirmed','checked-in','completed') AND ($2::uuid IS NULL OR id<>$2)",[slotId,excludeId||null])).rows[0].n)
    if(n>=slot.capacity)return false
  }
  return true
}
export async function createBookingLocked(db:PoolClient,req:Request,event:Row,household:Row,data:BookingInput,key:string,requestHash:string,categories:Record<string,number>={},allowWaitlist=true){
  const access=await householdAccess(db,req,household,event.location_id)
  if(household.status!=='approved')throw new ApiError(403,'HOUSEHOLD_NOT_APPROVED','Staff must approve this household before booking')
  if(event.org_id!==req.scope.organizationId || event.location_id!==req.scope.locationId)throw new ApiError(403,'LOCATION_MISMATCH','Choose an event at the selected location')
  if(event.status!=='scheduled'||event.admissions_closed||new Date(event.ends_at)<=new Date())throw new ApiError(409,'EVENT_CLOSED','This event is closed for admissions')
  if(data.walkIn && !access.staff)throw new ApiError(403,'WALKIN_STAFF_ONLY','Ask staff to register a walk-in')
  if(!data.walkIn && new Date(event.cutoff_at)<=new Date())throw new ApiError(409,'BOOKING_CLOSED','The advance booking cutoff has passed')
  const collector=data.collectorId||(access.member?req.user!.id:null)
  await assertCollector(db,household.id,collector)
  const previous=(await db.query('SELECT * FROM event_bookings WHERE booked_by=$1 AND request_key=$2',[req.user!.id,key])).rows[0]
  if(previous){if(previous.request_hash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','This submission key belongs to another booking');return {booking:previous,replayed:true}}
  if((await db.query("SELECT 1 FROM event_bookings WHERE event_id=$1 AND household_id=$2 AND status NOT IN ('cancelled','no-show')",[event.id,household.id])).rowCount)throw new ApiError(409,'HOUSEHOLD_ALREADY_BOOKED','This household already has a booking for this event')
  const space=await assertBookingCapacity(db,event,data.slotId,data.walkIn)
  if(!space && (!allowWaitlist||!event.waitlist_enabled||data.walkIn))throw new ApiError(409,'EVENT_FULL','This event or time slot is full')
  const booking=(await db.query(`INSERT INTO event_bookings(org_id,location_id,event_id,household_id,slot_id,collector_id,booked_by,status,walk_in,package_count,reference,notes,override_reason,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[event.org_id,event.location_id,event.id,household.id,data.slotId||null,collector,req.user!.id,space?'confirmed':'waitlisted',data.walkIn,data.packageCount,token().slice(0,10).toUpperCase(),data.notes,data.overrideReason||null,key,requestHash])).rows[0]
  if(space)await holdAllowance(db,req,household,event,booking.id,categories,data.overrideReason)
  await audit(db,req.user!.id,space?'booking.confirmed':'booking.waitlisted','booking',booking.id,{householdId:household.id,locationId:event.location_id,assisted:!access.member})
  return {booking,replayed:false}
}
distribution.post('/events/:id/book',requireAuth(),route(async(req,res)=>{
  const data=bookingSchema.parse(req.body),key=uuid.parse(req.get('Idempotency-Key')),eventId=id(req)
  const result=await transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`booking-key:${req.user!.id}:${key}`])
    const household=await lockHousehold(db,req.scope.organizationId,data.householdId)
    const event=await lockEvent(db,eventId)
    if(!event)throw new ApiError(404,'NOT_FOUND','Event not found')
    if(event.mode==='items')throw new ApiError(400,'ITEM_SELECTION_REQUIRED','Choose items for this event instead of booking an unrecorded visit')
    return createBookingLocked(db,req,event,household,data,key,hash(JSON.stringify({eventId,...data})),event.mode==='packages'?{packages:data.packageCount}:{})
  })
  res.status(result.replayed?200:201).json(bookingDto(result.booking))
}))
distribution.get('/bookings/mine',requireAuth(),route(async(req,res)=>{
  const rows=(await pool.query(`SELECT b.*,h.label household_label,json_build_object('id',e.id,'startsAt',e.starts_at,'endsAt',e.ends_at,'location',e.location,'mode',e.mode) event_snapshot FROM event_bookings b JOIN households h ON h.id=b.household_id JOIN household_members hm ON hm.household_id=h.id JOIN events e ON e.id=b.event_id WHERE hm.user_id=$1 AND b.org_id=$2 ORDER BY e.starts_at DESC,b.created_at DESC LIMIT 200`,[req.user!.id,req.scope.organizationId])).rows
  res.json(rows.map(bookingDto))
}))
async function bookingContext(db:PoolClient,req:Request,bookingId:string){
  const found=await getBooking(db,bookingId)
  if(!found||found.org_id!==req.scope.organizationId)throw new ApiError(404,'NOT_FOUND','Booking not found')
  const household=await lockHousehold(db,found.org_id,found.household_id)
  const event=await lockEvent(db,found.event_id)
  const booking=(await db.query('SELECT * FROM event_bookings WHERE id=$1 FOR UPDATE',[bookingId])).rows[0]
  return {booking,event,household}
}
distribution.post('/bookings/:id/cancel',requireAuth(),route(async(req,res)=>{
  const result=await transaction(async db=>{
    const {booking,event,household}=await bookingContext(db,req,id(req))
    const access=await householdAccess(db,req,household,event.location_id)
    if(booking.status==='cancelled')return booking
    if(!['confirmed','waitlisted'].includes(booking.status))throw new ApiError(409,'INVALID_TRANSITION','An attended booking cannot be cancelled')
    if(!access.staff&&new Date(event.cutoff_at)<=new Date())throw new ApiError(409,'CANCELLATION_CLOSED','Contact staff to cancel after the booking cutoff')
    const linked=(await db.query("SELECT * FROM orders WHERE booking_id=$1 AND status IN ('pending','confirmed') FOR UPDATE",[booking.id])).rows
    for(const order of linked)await cancelLocked(db,order,req.user!.id)
    await releaseBooking(db,booking.id)
    await audit(db,req.user!.id,'booking.cancelled','booking',booking.id)
    return getBooking(db,booking.id)
  });res.json(bookingDto(result))
}))
distribution.post('/bookings/:id/promote',requireAuth(),route(async(req,res)=>{
  const result=await transaction(async db=>{
    const {booking,event,household}=await bookingContext(db,req,id(req));await assertLocation(req,event.location_id,'checkin')
    if(booking.status==='confirmed')return booking
    if(booking.status!=='waitlisted')throw new ApiError(409,'INVALID_TRANSITION','Only waiting households can be promoted')
    if(event.admissions_closed||event.status!=='scheduled'||new Date(event.cutoff_at)<=new Date())throw new ApiError(409,'BOOKING_CLOSED','The booking window is closed')
    if(!await assertBookingCapacity(db,event,booking.slot_id,false,booking.id))throw new ApiError(409,'EVENT_FULL','This event or time slot is still full')
    await holdAllowance(db,req,household,event,booking.id,event.mode==='packages'?{packages:booking.package_count}:{})
    await assertCollector(db,household.id,booking.collector_id)
    await db.query("UPDATE event_bookings SET status='confirmed' WHERE id=$1",[booking.id])
    await audit(db,req.user!.id,'booking.promoted','booking',booking.id)
    return getBooking(db,booking.id)
  });res.json(bookingDto(result))
}))
distribution.post('/bookings/:id/checkin',requireAuth(),route(async(req,res)=>{
  const data=z.object({collectorId:uuid.optional(),categoryTallies:z.array(z.object({category:textField(80),qty:z.number().int().min(0).max(10000)}).strict()).max(100).optional(),overrideReason:textField(500).optional()}).strict().parse(req.body)
  const result=await transaction(async db=>{
    const {booking,event,household}=await bookingContext(db,req,id(req));await assertLocation(req,event.location_id,'checkin')
    if(['checked-in','completed'].includes(booking.status))return booking
    if(booking.status!=='confirmed')throw new ApiError(409,'BOOKING_NOT_CONFIRMED','Confirm this household booking before check-in')
    if(event.status!=='scheduled'||event.admissions_closed||new Date(event.ends_at)<=new Date()||new Date(event.starts_at).getTime()>Date.now()+30*60000)throw new ApiError(409,'CHECKIN_CLOSED','Check-in is not open for this event')
    await assertCollector(db,household.id,data.collectorId||booking.collector_id)
    if((await db.query("SELECT 1 FROM orders WHERE booking_id=$1 AND status IN ('pending','confirmed')",[booking.id])).rowCount)throw new ApiError(409,'REDEEM_ORDER','Use the recorded order pickup flow for this household')
    const policy=await policyFor(db,event.org_id)
    if(Object.keys(policy.categoryLimits).some(k=>k!=='packages')&&!data.categoryTallies)throw new ApiError(400,'CATEGORY_TALLY_REQUIRED','Record category quantities to apply this charity’s category allowance')
    const categories:Record<string,number>=event.mode==='packages'?{packages:booking.package_count}:{}
    for(const line of data.categoryTallies||[]){if(line.category in categories)throw new ApiError(400,'DUPLICATE_CATEGORY','Record each category once');categories[line.category]=line.qty}
    await holdAllowance(db,req,household,event,booking.id,categories,data.overrideReason)
    await consumeBooking(db,booking.id)
    if(data.collectorId)await db.query('UPDATE event_bookings SET collector_id=$2 WHERE id=$1',[booking.id,data.collectorId])
    await audit(db,req.user!.id,'booking.checked-in','booking',booking.id,{collectorId:data.collectorId||booking.collector_id,categories,assisted:!booking.collector_id})
    return getBooking(db,booking.id)
  });res.json(bookingDto(result))
}))
distribution.post('/bookings/:id/no-show',requireAuth(),route(async(req,res)=>{
  const result=await transaction(async db=>{
    const {booking,event}=await bookingContext(db,req,id(req));await assertLocation(req,event.location_id,'checkin')
    if(booking.status==='no-show')return booking
    if(booking.status!=='confirmed')throw new ApiError(409,'INVALID_TRANSITION','Only confirmed bookings can be marked absent')
    if(new Date(event.ends_at)>new Date())throw new ApiError(409,'EVENT_NOT_ENDED','Record no-shows after the event ends')
    const linked=(await db.query("SELECT * FROM orders WHERE booking_id=$1 AND status IN ('pending','confirmed') FOR UPDATE",[booking.id])).rows
    for(const order of linked)await cancelLocked(db,order,req.user!.id,'expired','Household did not attend')
    const policy=await policyFor(db,event.org_id)
    await db.query("UPDATE event_bookings SET status='no-show' WHERE id=$1",[booking.id])
    await db.query('UPDATE allowance_holds SET state=$2 WHERE booking_id=$1',[booking.id,policy.noShowConsumes?'consumed':'released'])
    await audit(db,req.user!.id,'booking.no-show','booking',booking.id,{consumed:policy.noShowConsumes})
    return getBooking(db,booking.id)
  });res.json(bookingDto(result))
}))
distribution.get('/events/:id/details',route(async(req,res)=>{
  const e=(await pool.query('SELECT * FROM events WHERE id=$1 AND location_id=$2',[id(req),req.scope.locationId])).rows[0]
  if(!e)throw new ApiError(404,'NOT_FOUND','Event not found at this location')
  const slots=(await pool.query("SELECT s.*,(SELECT count(*) FROM event_bookings b WHERE b.slot_id=s.id AND b.status IN ('confirmed','completed','checked-in')) reserved_count FROM event_slots s WHERE event_id=$1 ORDER BY starts_at",[e.id])).rows.map(s=>({id:s.id,startsAt:s.starts_at,endsAt:s.ends_at,capacity:s.capacity,reservedCount:Number(s.reserved_count)}))
  const read=await canAt(req,e.location_id,'read'),checkin=await canAt(req,e.location_id,'checkin')
  const allocations=read?(await pool.query('SELECT a.*,i.name,i.unit FROM event_allocations a JOIN items i ON i.id=a.item_id WHERE event_id=$1 ORDER BY i.name',[e.id])).rows.map(a=>({itemId:a.item_id,name:a.name,unit:a.unit,openingQty:a.opening_qty,addedQty:a.added_qty})):[]
  const bookings=checkin?(await pool.query('SELECT b.*,h.label household_label FROM event_bookings b JOIN households h ON h.id=b.household_id WHERE b.event_id=$1 ORDER BY b.created_at',[e.id])).rows.map(bookingDto):[]
  const closeout=read?(await pool.query('SELECT report FROM event_closeouts WHERE event_id=$1',[e.id])).rows[0]?.report||null:null
  res.json({event:eventDto(e),slots,allocations,bookings,closeout})
}))
distribution.post('/events/:id/allocations',requireAuth(),route(async(req,res)=>{
  const data=z.object({items:z.array(z.object({itemId:uuid,qty:quantity}).strict()).min(1).max(200),notes:z.string().trim().max(1000).default('')}).strict().parse(req.body)
  if(new Set(data.items.map(i=>i.itemId)).size!==data.items.length)throw new ApiError(400,'DUPLICATE_ITEM','Allocate each batch once per request')
  const result=await transaction(async db=>{
    const event=await lockEvent(db,id(req));if(!event)throw new ApiError(404,'NOT_FOUND','Event not found');await assertLocation(req,event.location_id,'inventory')
    if(event.status!=='scheduled'||event.admissions_closed)throw new ApiError(409,'EVENT_CLOSED','Stock cannot be allocated to a closed event')
    const items=(await db.query('SELECT * FROM items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[data.items.map(i=>i.itemId)])).rows
    if(items.length!==data.items.length)throw new ApiError(404,'NOT_FOUND','A batch was not found')
    for(const item of items){
      const qty=data.items.find(i=>i.itemId===item.id)!.qty
      if(item.location_id!==event.location_id||item.org_id!==event.org_id)throw new ApiError(403,'LOCATION_MISMATCH','Allocate batches at this event’s location')
      if(item.status!=='available'||item.inspection_status!=='clear'||item.qty-(item.sale_qty||0)<qty)throw new ApiError(409,'INSUFFICIENT_STOCK','This batch does not have sufficient clear aid stock')
      const deadline=item.distribution_deadline||item.expires_on
      if(deadline&&new Date(deadline)<=new Date(event.ends_at))throw new ApiError(409,'HANDLING_DEADLINE','A batch cannot remain in distribution beyond its handling deadline')
      await db.query("UPDATE items SET qty=qty-$2,protected_qty=greatest(0,protected_qty-$2),status=CASE WHEN qty=$2 THEN 'exhausted' ELSE status END WHERE id=$1",[item.id,qty])
      await db.query(`INSERT INTO event_allocations(event_id,item_id,opening_qty,notes) VALUES($1,$2,$3,$4) ON CONFLICT(event_id,item_id) DO UPDATE SET added_qty=event_allocations.added_qty+excluded.opening_qty,notes=excluded.notes`,[event.id,item.id,qty,data.notes])
      await movement(db,item.id,-qty,'event-allocate',req.user!.id,null,`Event ${event.id}. ${data.notes}`)
    }
    await audit(db,req.user!.id,'event.stock-allocated','event',event.id,data)
    return {allocated:true}
  });res.status(201).json(result)
}))
distribution.post('/events/:id/stop-admissions',requireAuth(),route(async(req,res)=>{
  const result=await transaction(async db=>{
    const event=await lockEvent(db,id(req));if(!event)throw new ApiError(404,'NOT_FOUND','Event not found');await assertLocation(req,event.location_id,'events')
    if(event.status!=='scheduled')throw new ApiError(409,'EVENT_CLOSED','The event is already closed')
    await db.query('UPDATE events SET admissions_closed=true WHERE id=$1',[event.id]);await audit(db,req.user!.id,'event.admissions-stopped','event',event.id)
    return {admissionsClosed:true}
  });res.json(result)
}))
export const closeoutSchema=z.object({lines:z.array(z.object({itemId:uuid,leftoverQty:z.number().int().min(0).max(1000000),lossQty:z.number().int().min(0).max(1000000).default(0),distributedQty:z.number().int().min(0).max(1000000).optional(),discrepancyQty:z.number().int().min(0).max(1000000).default(0),notes:z.string().trim().max(1000).default('')}).strict()).max(500),newLeftovers:z.array(z.record(z.string(),z.unknown())).max(100).default([]),notes:textField(2000),estimatedDistributedQty:z.number().int().min(0).max(1000000).optional()}).strict()
export function reconcileLine(recordingMode:string,allocation:Row,line:z.infer<typeof closeoutSchema>['lines'][number]){
  const opening=allocation.opening_qty+allocation.added_qty
  if(line.leftoverQty+line.lossQty+line.discrepancyQty>opening)throw new ApiError(409,'COUNT_EXCEEDS_ALLOCATION','Leftovers, losses and discrepancies exceed the allocated stock')
  if(recordingMode==='opening'&&(line.distributedQty===undefined||line.leftoverQty+line.lossQty+line.discrepancyQty+line.distributedQty!==opening))throw new ApiError(409,'UNRECONCILED_STOCK','Explicitly account for allocated stock as leftovers, distribution, loss or discrepancy')
  if(recordingMode==='leftovers-only'&&line.distributedQty!==undefined)throw new ApiError(400,'DISTRIBUTION_UNKNOWN','Use the separately labeled estimate field when opening distribution quantities are unknown')
  if(line.discrepancyQty>0&&!line.notes)throw new ApiError(400,'DISCREPANCY_REASON','Explain stock discrepancies before confirming closeout')
  return {itemId:line.itemId,name:allocation.name,unit:allocation.unit,openingQty:opening,leftoverQty:line.leftoverQty,lossQty:line.lossQty,distributedQty:recordingMode==='opening'?line.distributedQty:null,discrepancyQty:line.discrepancyQty,unmeasuredQty:recordingMode==='leftovers-only'?opening-line.leftoverQty-line.lossQty-line.discrepancyQty:0,notes:line.notes}
}
async function closeout(req:Request,preview:boolean){
  const data=closeoutSchema.parse(req.body),requestHash=hash(JSON.stringify(data));if(!preview)uuid.parse(req.get('Idempotency-Key'))
  return transaction(async db=>{
    const event=await lockEvent(db,id(req));if(!event)throw new ApiError(404,'NOT_FOUND','Event not found');await assertLocation(req,event.location_id,'events')
    const previous=(await db.query('SELECT * FROM event_closeouts WHERE event_id=$1',[event.id])).rows[0]
    if(previous){if(previous.request_hash!==requestHash)throw new ApiError(409,'CLOSEOUT_ALREADY_CONFIRMED','This event already has a different confirmed count');return previous.report}
    if(event.status!=='scheduled'||!event.admissions_closed)throw new ApiError(409,'STOP_ADMISSIONS_FIRST','Stop admissions before counting and confirming leftovers')
    if(new Date(event.starts_at)>new Date())throw new ApiError(409,'EVENT_NOT_STARTED','The event has not started')
    if((await db.query("SELECT 1 FROM orders WHERE event_id=$1 AND status IN ('pending','confirmed') UNION ALL SELECT 1 FROM event_bookings WHERE event_id=$1 AND status IN ('confirmed','waitlisted') LIMIT 1",[event.id])).rowCount)throw new ApiError(409,'UNRESOLVED_ATTENDANCE','Collect, cancel or resolve all bookings/orders before closeout')
    const allocations=(await db.query('SELECT a.*,i.name,i.unit,i.inspection_status,i.distribution_deadline,i.expires_on FROM event_allocations a JOIN items i ON i.id=a.item_id WHERE a.event_id=$1 ORDER BY a.item_id FOR UPDATE OF a,i',[event.id])).rows
    if(new Set(data.lines.map(l=>l.itemId)).size!==data.lines.length||data.lines.length!==allocations.length)throw new ApiError(400,'INCOMPLETE_COUNT','Count every allocated batch exactly once')
    const lines=data.lines.map(line=>{const a=allocations.find(a=>a.item_id===line.itemId);if(!a)throw new ApiError(400,'UNALLOCATED_BATCH','This batch was not allocated to the event');return reconcileLine(event.recording_mode,a,line)})
    if(data.newLeftovers.length && event.recording_mode!=='leftovers-only')throw new ApiError(400,'UNALLOCATED_STOCK','Record additional opening stock before confirming this event')
    // New physical leftovers are created through the inventory intake validator, never by cloning an existing batch.
    const inventory=await import('./inventory.js')
    const creator=(inventory as unknown as {createLeftoverBatch?: (db:PoolClient,input:unknown,scope:Row)=>Promise<Row>}).createLeftoverBatch
    if(data.newLeftovers.length&&!creator)throw new ApiError(409,'LEFTOVER_INTAKE_REQUIRED','Record new leftover batches through receiving before closeout')
    if(preview&&data.newLeftovers.length){
      // Use a savepoint so the same intake validation runs without persisting preview batches or movements.
      await db.query('SAVEPOINT preview_leftovers')
      for(const input of data.newLeftovers)await creator!(db,input,{organizationId:event.org_id,locationId:event.location_id,actorId:req.user!.id,eventId:event.id})
      await db.query('ROLLBACK TO SAVEPOINT preview_leftovers')
    }
    const attendance=(await db.query("SELECT count(*) FILTER(WHERE status IN ('checked-in','completed'))::int attended,count(*) FILTER(WHERE status='no-show')::int no_shows FROM event_bookings WHERE event_id=$1",[event.id])).rows[0]
    const report={eventId:event.id,organizationId:event.org_id,locationId:event.location_id,recordingMode:event.recording_mode,attendance:{households:attendance.attended,noShows:attendance.no_shows},distributedQty:event.recording_mode==='opening'?lines.reduce((s,l)=>s+(l.distributedQty||0),0):null,distributionMeasurement:event.recording_mode==='opening'?'reconciled-count':'unknown',estimatedDistributedQty:data.estimatedDistributedQty??null,lines,newLeftovers:data.newLeftovers,notes:data.notes,confirmedAt:preview?null:new Date().toISOString(),confirmedBy:preview?null:req.user!.id}
    if(preview)return {...report,preview:true}
    for(const line of lines){
      const a=allocations.find(a=>a.item_id===line.itemId)!
      const deadline=a.distribution_deadline||a.expires_on
      if(line.leftoverQty>0&&(a.inspection_status!=='clear'||(deadline&&new Date(deadline)<=new Date())))throw new ApiError(409,'UNSAFE_LEFTOVERS','Resolve quarantined/recalled/expired leftovers through loss/inspection before making them available')
      if(line.leftoverQty){await db.query("UPDATE items SET qty=qty+$2,status='available' WHERE id=$1",[line.itemId,line.leftoverQty]);await movement(db,line.itemId,line.leftoverQty,'event-return',req.user!.id,null,`Confirmed leftovers from event ${event.id}`)}
      await db.query('UPDATE event_allocations SET returned_qty=$3,distributed_qty=$4,loss_qty=$5,discrepancy_qty=$6,notes=$7 WHERE event_id=$1 AND item_id=$2',[event.id,line.itemId,line.leftoverQty,line.distributedQty,line.lossQty,line.discrepancyQty,line.notes])
    }
    const newBatches:Row[]=[]
    for(const input of data.newLeftovers)newBatches.push(await creator!(db,input,{organizationId:event.org_id,locationId:event.location_id,actorId:req.user!.id,eventId:event.id}))
    await db.query('INSERT INTO event_closeouts(event_id,request_hash,recording_mode,report,actor_id) VALUES($1,$2,$3,$4,$5)',[event.id,requestHash,event.recording_mode,JSON.stringify({...report,newBatchIds:newBatches.map(b=>b.id)}),req.user!.id])
    await db.query("UPDATE events SET status='completed' WHERE id=$1",[event.id])
    const org=(await db.query('SELECT policies FROM organizations WHERE id=$1',[event.org_id])).rows[0]
    const publisher=(inventory as unknown as {publishSurplus?: (db:PoolClient,itemId:string,actorId:string,automatic?:boolean)=>Promise<unknown>}).publishSurplus
    if(org?.policies?.allowAutomaticSales && publisher){
      for(const itemId of [...lines.filter(l=>l.leftoverQty>0).map(l=>l.itemId),...newBatches.map(b=>b.id)]){
        await db.query('SAVEPOINT publish_leftover')
        try{await publisher(db,itemId,req.user!.id,true)}catch(error){await db.query('ROLLBACK TO SAVEPOINT publish_leftover');if(!(error instanceof ApiError))throw error;await audit(db,req.user!.id,'surplus.automatic-skipped','item',itemId,{code:error.code,eventId:event.id})}
      }
    }
    await audit(db,req.user!.id,'event.closeout-confirmed','event',event.id,{recordingMode:event.recording_mode,households:attendance.attended})
    return {...report,newBatchIds:newBatches.map(b=>b.id)}
  })
}
distribution.post('/events/:id/closeout/preview',requireAuth(),route(async(req,res)=>res.json(await closeout(req,true))))
distribution.post('/events/:id/closeout',requireAuth(),route(async(req,res)=>res.json(await closeout(req,false))))
distribution.get('/events/:id/report',requireAuth(),route(async(req,res)=>{
  const event=(await pool.query('SELECT * FROM events WHERE id=$1',[id(req)])).rows[0];if(!event)throw new ApiError(404,'NOT_FOUND','Event not found');await assertLocation(req,event.location_id,'read')
  const row=(await pool.query('SELECT report FROM event_closeouts WHERE event_id=$1',[event.id])).rows[0]
  if(!row)throw new ApiError(404,'NO_CLOSEOUT','This event has no confirmed closeout');res.json(row.report)
}))
