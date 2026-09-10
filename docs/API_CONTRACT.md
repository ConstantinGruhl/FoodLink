# FoodLink API contract

Base `/api`, JSON camelCase. Errors: `{error:{code,message,details?},requestId}`. Lists return arrays (bounded by `?limit=100&offset=0`; maximum 200), unless noted. Dates ISO-8601; EUR cents integer. Authentication cookie `foodlink_session` is HttpOnly/SameSite=Lax, secure in production. `GET /auth/session` returns `{user:User|null,csrfToken:string|null}`. Login/register return same object. Send `credentials:include` and `X-CSRF-Token` on all authenticated mutations. All browser mutations must have allowed Origin. Login/register/recovery/verification/reset require Origin but no CSRF. `User`: `{id,email,name,role,verified,emailVerified,disabled,householdSize,dietaryNeeds,specialRequirements,address,createdAt}`; `verified` is recipient eligibility. Only donor/buyer/recipient self-registration. Staff accounts admin-managed.

## Identity
- POST `/auth/register` `{email,password,name,role,householdSize?,dietaryNeeds?,specialRequirements?,address?}` -> session 201 (pending email verification and recipient approval).
- POST `/auth/login` `{email,password}` -> session. POST `/auth/logout` -> `{ok:true}`.
- GET `/auth/session` -> session, including null user when anonymous.
- PATCH `/auth/profile` `{name?,householdSize?,dietaryNeeds?,specialRequirements?,address?}` -> User.
- POST `/auth/forgot-password` `{email}` -> generic `{ok:true}`. POST `/auth/reset-password` `{token,password}` -> `{ok:true}`.
- POST `/auth/verify-email` `{token}` -> `{ok:true}`. POST `/auth/resend-verification` `{}` (session+CSRF) -> `{ok:true}`. Email links use frontend `/verify-email?token=...` and `/reset-password?token=...`.

## Catalog and donations
`Item`: `{id,name,qty,unit,storage,expiresOn,donorId,isSurplus,priceCents,weightGrams,category,allergens,handlingNotes,status,imageUrl,images:Image[]}`; qty available, status offered/available/exhausted/disposed. `Image`: `{id,url,alt,isPrimary}`.
- GET `/items` -> available unexpired Item[]; GET `/inventory` -> staff all Item[].
- GET `/donations` -> own donations (all for staff). GET `/donations/:id` -> owned/staff Donation.
- POST `/donations` `{date?,items:[{name,qty,unit,storage,expiresOn?,weightGrams,category?,allergens?:string[],handlingNotes?}]}` -> Donation 201.
- PATCH `/donations/:id` `{status:'received'|'cancelled',notes?}` -> Donation. Receipt staff only. Cancellation owner/staff before receipt.
`Donation`: `{id,donorId,donorName,date,status,receivedAt,notes,items:[Item & {offeredQty,receivedQty}]}`. Offered quantities immutable; receipt currently accepts full offered quantity after visual/safety confirmation.
- PATCH `/items/:id` staff `{isSurplus?,priceCents?,handlingNotes?}` -> Item; only unallocated available stock. POST `/items/:id/dispose` staff `{qty,reason}` -> Item.
- GET `/items/:id/ledger` staff -> movement records `{id,itemId,delta,kind,reason,createdAt,actorId,orderId}`.
- POST `/items/:id/images` owner/staff: binary image body, Content-Type image/jpeg,image/png,image/webp; optional `X-Image-Alt`; max 5MB; magic validated -> Image 201. GET `/items/:id/images` -> Image[]. DELETE `/items/:itemId/images/:id` owner/staff -> `{ok:true}`. Images proxied by GET `/images/:id/content`.

## Events and orders
`Event`: `{id,date,startsAt,endsAt,cutoffAt,timezone,location,pickupWindow,allowDelivery,capacity,reservedCount,status}` (`scheduled|cancelled|completed`).
- GET `/events` future active events; GET `/events?all=true` staff history; GET `/events/next` -> Event|null.
- POST `/events` staff `{startsAt,endsAt,cutoffAt,location,capacity,allowDelivery?,timezone?}` -> Event 201.
- PATCH `/events/:id` staff same optional fields plus `status:'cancelled'|'completed'`; cancellation cancels/restocks unpaid reservations atomically.
- POST `/orders/reserve` eligible verified-email recipients: `{eventId,items:[{itemId,qty}],fulfillment:'pickup'|'delivery',deliveryAddress?}` plus `Idempotency-Key` unique UUID -> Order 201 (same key/body replays 200). One basket atomic.
- POST `/orders/checkout` verified-email buyers: same plus `supportContributionCents?`; feature-gated 503 if payments disabled. When enabled -> `{order,checkoutUrl}`.
- GET `/orders/mine` -> Order[]; GET `/orders` staff -> Order[]. GET `/orders/:id` owner/staff -> Order.
- POST `/orders/:id/cancel` owner/staff -> Order; exactly-once restock, paid buyer orders initiate refund if configured.
- POST `/orders/redeem` staff `{token}` -> Order (pickup token from authenticated order only; repeated redemption 409).
`Order`: `{id,userId,userName,type,status,eventId,createdAt,items:[{itemId,name,qty,unit,priceCents,weightGrams}],totalCents,supportContributionCents,paymentStatus,pickupToken,fulfillment,deliveryAddress,assignedVolunteerId,completedAt}`. status `pending|confirmed|picked-up|delivered|cancelled|expired`. paymentStatus `not-required|pending|paid|failed|refunded|refund-pending`.
- POST `/orders/:id/assign` staff `{volunteerId}` -> Order (only volunteers/admin accounts assignable). POST `/orders/:id/deliver` assigned volunteer/admin `{proof}` -> Order, proof required free text confirmation, never public.
- GET `/deliveries` staff -> delivery Order[] (volunteer sees assignments plus unassigned; admin all).

## Impact, communications and administration
- GET `/impact` -> `{totalMealsDistributed,totalKgSaved,totalDonors,totalBuyers,totalOrdersCompleted,monthly:[{month,meals,kg}],methodology}` derived from completed orders, weight/500g meal-equivalent.
- GET `/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` staff -> `{from,to,receivedDonations,completedOrders,kgDistributed,mealsDistributed,disposedKg,orders:Order[]}`.
- GET `/notifications` authenticated -> `[{id,subject,body,createdAt,readAt}]`; PATCH `/notifications/:id` `{read:true}` -> `{ok:true}`.
- GET `/admin/users` -> User[]. PATCH `/admin/users/:id` `{verified?,disabled?,role?}` -> User (cannot disable/demote last admin).
- POST `/admin/users` `{email,name,password,role,verified?}` -> User; admin-managed onboarding sends verification email.
- GET `/admin/audit` -> `[{id,actorId,action,entityType,entityId,details,createdAt}]`.
- GET `/admin/outbox` -> redacted delivery status entries; local development with `MAIL_MODE=outbox` includes body to review verification/recovery links.
- POST `/admin/maintenance` -> `{expiredOrders,expiredItems,remindersQueued}`; also periodically scheduled in server.
- GET `/config` public -> `{currency,timezone,paymentsEnabled,mailMode,organizationName}`.
- GET `/health` liveness; GET `/ready` DB/storage readiness 200/503.
- POST `/payments/webhook` raw Stripe signed payload (no browser CSRF, signature required).

No arbitrary donorId/userId accepted as acting identity. Request schemas reject unknown properties. Pagination is stable by creation/id. Production startup rejects demo seed, insecure origin/storage/mail/payment configuration. Emails use durable database outbox; worker retries configured SMTP, local mode records only. No external operations are performed by implementation/testing.

## Additional implemented operations

- GET `/admin/assignees?limit=&offset=` returns `[{id,name}]` for active, email-verified administrators and volunteers. Filtering happens before pagination; only administrators can read this assignment directory.
- Pickup tokens are returned only to the order owner. Staff order lists and cross-user detail reads redact them; staff redeem the ticket presented by the recipient.
- Report `completedOrders`, `kgDistributed` and `mealsDistributed` cover the entire requested period. The `orders` detail array is capped at 2,000, with `truncated:true` when additional detail records exist; details omit user identity and delivery address.

- PUT `/donations/:id` owner/staff, scheduled-only, `{date?,items:[{id,...donationLine}]}`. The exact existing line IDs are required. Offered quantity/name snapshots may change before receipt, with prior values audited; received and order snapshots remain immutable.
- Orders include `event:{id,startsAt,endsAt,cutoffAt,location,pickupWindow,timezone}`. Active reservations receive location corrections; completed orders keep historical snapshots.
- POST `/auth/change-password` `{currentPassword,newPassword}` revokes sessions and outstanding recovery tokens. GET `/auth/export` downloads profile, donation lines, order lines, notifications and privacy requests. POST `/auth/deactivate` `{password,reason?}` immediately disables the account and submits a review request.
- GET `/admin/privacy` -> `[{id,userId,userName,reason,status,createdAt,completedAt}]`; PATCH `/admin/privacy/:id` `{status:'completed'}` anonymizes resolved accounts, clears contact data/secrets/communications, and retains business line/audit history. Active orders or scheduled offers must first be resolved.
- GET `/tasks` staff -> `[{id,title,description,eventId,assignedVolunteerId,dueAt,status,createdAt}]`. POST `/tasks` staff `{title,description?,eventId?,assignedVolunteerId?,dueAt?}`. PATCH `/tasks/:id` `{status?,assignedVolunteerId?}` with status `open|in-progress|completed|cancelled`. Volunteers can claim unassigned work or change their own tasks; admin can assign other volunteers.
- GET `/admin/config` -> public config; PATCH `/admin/config` `{organizationName?,supportEmail?,organizationAddress?,privacyContact?,retentionDays?}`. Public `/config` includes those fields and `legalReady`, which only means operator contact fields are configured, not legal approval.
- POST `/admin/outbox/:id/retry` requeues a failed email. GET `/admin/health` reports failed/pending mail, pending refunds and privacy requests. Local SMTP is tested through Mailpit; SMTP delivery is at least once with a stable Message-ID and retry backoff.
- GET `/admin/refunds` -> `[{id,userName,totalCents,paymentStatus,refundStatus,refundAttempt,refundError,refundNextAt}]`. POST `/admin/refunds/:id/retry` requeues reconciliation. Failed/canceled provider refunds receive a new durable attempt key; ambiguous network outcomes reuse the existing key. A refund stays pending until Stripe confirms success.
- Maintenance returns an additional `failedOrders` count; individual provider failures do not block other expiry/reminder jobs. Expired sessions/tokens and rate counters are cleaned. Sent email bodies are purged after 30 days; in-app notifications follow configured retention days. Durable transaction/audit records remain until operator retention review.
- POST `/orders/redeem` and delivery completion open 30 minutes before event start and close at event end. Basket food must remain unexpired until event end. Recipient allowance defaults to 50 units per account/event (`MAX_BASKET_UNITS`). Buyer checkout requires 36 minutes before cutoff and holds stock for 35 minutes. Payment is never confirmed by a browser redirect.
- Runtime defaults `RUN_BACKGROUND_JOBS=true`; setting false disables maintenance/mail/refund/orphan workers for isolated tests or a separately managed worker role. `TRUST_PROXY=1` is suitable only behind one controlled ingress that replaces forwarding headers.

Bootstrap: run `node dist/bootstrap-admin.js` with `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` to create the first administrator. It refuses to replace an active configured administrator. Legacy accounts with no password must recover access using their email or explicit local demo bootstrap. All migrations are checksum-verified and preserve existing records; unrecorded historical quantities/weights cannot be reconstructed and are disclosed in the migration audit.
