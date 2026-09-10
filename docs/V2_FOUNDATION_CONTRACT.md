# Implementation contract: organization foundation

API uses `X-Location-Id` for the current location. Missing header selects the user's first active staff location, then the migrated default location. Public endpoints may use `?locationId=`; explicit body destinations are validated by their owning routes. `req.scope` always has `{locationId, organizationId, location}`. Scope is context, never permission.

Default organization and location IDs are both `00000000-0000-4000-8000-000000000001` (different tables).

Tables in migration 007:

- organizations: id, slug, name, currency, timezone, support_email, address, privacy_contact, active, policies jsonb, created_at.
- locations: id, org_id, name, code, address, city, postal_code, latitude/longitude nullable, opening_hours, receiving_instructions, collection_available, storage_types text[], active, settings jsonb, created_at.
- staff_memberships: id, user_id, org_id, location_id nullable (only charity_manager), role charity_manager/location_manager/volunteer, duties text[], active, created_at.
- households: id, org_id, label, approved_size int, status pending/approved/paused, notes, created_at.
- household_members: household_id, org_id, user_id. Unique(org_id,user_id).
- staff_invitations: id, org_id, location_id, email, role, duties, token_hash, expires_at, accepted_at, invited_by.
- items/donations/events/orders/tasks gain org_id and location_id NOT NULL, default migrated location. audit_log gains nullable org_id/location_id. users gains platform_admin boolean; global role enum adds charity_manager/location_manager. Existing admin gets default charity_manager membership, existing volunteers operational default location membership.

Helpers in backend/src/tenancy.ts:

- `canAt(req, locationId, capability='read'): Promise<boolean>`
- `assertLocation(req, locationId, capability='read'): Promise<void>`
- `assertRecordAccess(req, row, ownerField='user_id', capability='read'): Promise<void>` owner or scoped staff, never global admin bypass.
- `requireCapability(capability)` middleware for req.scope.locationId.
- `requireCharityManager(req, orgId?)` async assertion.
- `locationById(locationId)` async DB row lookup.

Capabilities: read, receive, inventory, events, checkin, delivery, manage, people, policy, pricing. Managers all except policy requires charity_manager. Volunteers read plus explicitly assigned duty capabilities. Location manager may invite/revoke volunteers only. Global admin is platform access, not implicit charity data access. Legacy requireAuth('admin','volunteer') recognizes scoped membership managers and volunteers; routes must still assert their action capability and record location.

User DTO gains `platformAdmin` and `memberships:[{id,organizationId,locationId,role,duties,organizationName,locationName}]`; permissions depend on memberships, not primary role. Login/session should populate memberships (login may require GET /workspace refresh).

Foundation endpoints (JSON camelCase):

- GET /organizations -> [{id,name,slug,currency,timezone,active}]; public active directory.
- GET /locations -> [{id,organizationId,organizationName,name,code,address,city,postalCode,latitude,longitude,openingHours,receivingInstructions,collectionAvailable,storageTypes,active,settings}]; public active directory. Optional organizationId/search. Manager can query ?all=true within organization.
- GET /workspace (authenticated) -> {location:Location,organization:Organization,memberships:Membership[],capabilities:string[],households:Household[]}; selected context; organization includes policies only for charity manager, safe public fields otherwise.
- GET /platform/organizations, POST /platform/organizations {name,slug,currency?,timezone?,managerEmail?,managerName?}; platformAdmin only. POST creates organization/default location and sends manager invitation if email supplied; no default password.
- POST /locations {name,code,address,city?,postalCode?,openingHours?,receivingInstructions?,collectionAvailable?,storageTypes?,latitude?,longitude?}; charity manager selected org.
- PATCH /locations/:id same optional fields plus active, settings; manager assigned location. Currency/org cannot change through this route.
- PATCH /organizations/:id {name?,supportEmail?,address?,privacyContact?,policies?}; charity manager.
- GET /staff -> {memberships:Membership[],invitations:Invitation[]}; selected location managers, charity manager all org.
- POST /staff/invitations {email,role:'volunteer'|'location_manager'|'charity_manager',locationId?,duties?}; scope checked. Returns {id,email,role,expiresAt}; mail captured locally.
- DELETE /staff/memberships/:id; revoke membership only; protect last charity manager.
- GET /staff/invitations/:token public -> {email,role,organizationName,locationName,existingAccount}; secret token required.
- POST /staff/invitations/:token/accept {name?,password?}; new account requires password; existing account requires matching signed-in identity; creates membership and consumes invitation. Returns {ok:true}; refresh session after accepting.
- GET /households -> Household[] selected org manager. Household {id,organizationId,label,approvedSize,status,notes,members:[{id,name,email}]}.
- POST /households {label,approvedSize,status?,notes?,userIds?:[]}; manager, permits household without online account for assisted collection.
- PATCH /households/:id {label?,approvedSize?,status?,notes?,userIds?}; manager selectedorg.
- GET /households/mine -> Household[] current org (self membership; redact staff notes).
- POST /households/apply {label,size}; current org, pending staff approval. Existing applicant updates request, never auto-increases approved size.
- GET /dashboard -> {location,organization,inventory:{availableUnits,expiringBatches,quarantinedBatches},donations:{pending,needsReview},events:{upcoming},households:{pending},locations:[{id,name,availableUnits,pendingDonations,upcomingEvents}],recentActivity:[]}; read capability, organization-wide locations only charity manager.

Other agents publish additional endpoint contracts in separate files and notify root/frontend. Inventory owns 009 and backend package dependencies; distribution owns 008/orders.ts/payments.ts. Root owns models.ts/security.ts/auth.ts/app.ts/operations.ts/storage.ts/seed.ts plus foundation module/migration. Frontend agent owns all frontend/src and frontend package dependencies.
