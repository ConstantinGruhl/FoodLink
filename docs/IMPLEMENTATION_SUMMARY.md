# FoodLink implementation and verification

Completed on **9 September 2026** against the original assessment of commit `f0951eef`. The agreed delivery target is a working application packaged as Docker containers. No public deployment was requested or performed.

## Result

FoodLink now runs locally with five healthy services: the web interface, API, PostgreSQL, private image storage and captured email. The original database was backed up, upgraded through six numbered migrations and preserved. The application supports the complete offer → receiving → reservation → pickup journey, plus volunteer delivery, administration and optional payment integration.

Open [FoodLink](http://localhost:5173) and [captured email](http://localhost:8025). To start from a fresh checkout:

```sh
docker compose up --build -d --wait
docker compose --profile tools run --rm seed
```

The demo accounts are `donor@email.com`, `recipient@email.com`, `buyer@email.com`, `volunteer@email.com` and `admin@email.com`. Their default local password is `FoodLink-demo-2026!`. Seeding is explicit, preserves existing passwords and is prohibited in production mode.

## Milestones delivered within the Docker scope

| Original milestone | Implementation |
|---|---|
| 0. Reproducible baseline | Removed generated dependencies and real environment files from Git tracking; added build exclusions, environment examples, lockfiles, supported Node 24 images, fixed line endings, CI and formatting checks. Migrations and demo seeding are separate. |
| 1. Application foundation | Modular API, validated request/response contracts, consistent errors, one database connection per transaction, ordered stock locking, idempotency and bounded deadlock retries. Frontend uses strict types, awaited writes, error boundaries and explicit loading/empty/failure states. |
| 2. Identity and permissions | Salted password hashes, opaque server sessions, HTTP-only cookies, CSRF/origin checks, registration, email verification, recovery, logout, expiry and account-scoped data. Staff creation and recipient approval require an administrator. Role/ownership changes are audited. |
| 3. Food distribution | Private donation offers, editing/cancellation, staff receipt, validated photos, availability controls, stock ledger, basket reservation, event capacity/cutoffs, protected tickets, one-time pickup, cancellations, no-shows, expiry, disposal and historical records. |
| 4. Pilot preparation | Responsive navigation and forms, profile/privacy workflows, accurate impact/reporting, confirmations/reminders, durable mail outbox, healthchecks, database/object recovery tools and isolated acceptance tests. A real operator pilot is outside this local task. |
| 5. Release preparation | Portable production configuration that rejects missing settings, private networks, separate migration/runtime database roles, non-root/read-only application containers, explicit administrator bootstrap, monitoring and rollback runbook. No hosted release, DNS, certificate issuance or external infrastructure was attempted. |
| Commerce and delivery | Buyer baskets with optional Stripe Checkout; signed webhook verification, payment state transitions, late-payment refunds, durable refund reconciliation and controlled retries. Delivery assignment and required completion proof are implemented and tested. Payments remain disabled by default. |

## Functional behavior

Donors provide quantities, units, weights, storage conditions, expiry, allergens and handling notes. Offered stock stays unavailable until staff check and receive it. Receipt quantities and order line descriptions/prices are preserved separately from remaining inventory. Uploads are decoded, resized and re-encoded to WebP; offered photos remain private and malformed, oversized or cross-owner uploads are rejected.

An approved, email-verified recipient submits one basket as one transaction. The API rechecks the entire basket, event capacity, cutoff, food expiry and allowance before reserving stock. Repeated submissions with the same key return the same order; changed payloads cannot reuse that key. Food must remain available through the event's end. The default allowance is 50 quantity units per account/event.

Pickup opens 30 minutes before the event and closes at its end. The owner can recover the ticket from order history after a refresh; staff receive the ticket presented by the recipient, without retrieving it from staff order listings. Redemption is accepted once. Delivery requires an enabled event, an address, an assigned volunteer and completion proof. Completed orders cannot be cancelled or silently restocked.

Administrators manage users, eligibility, operator contact information, privacy requests, audit history, outbox failures and refunds. Staff have receiving, inventory, events, tasks, pickup, delivery and reporting screens. Reports aggregate the entire requested period; their downloadable detail list is capped at 2,000 records and clearly marked if truncated. Personal identity and delivery addresses are omitted from report details.

Accounts support profile updates, password changes, personal data export and deactivation. Deactivation revokes access and opens a review request. Administrators can anonymize resolved accounts while retaining operational history. In-flight donation/reservation/profile writes are serialized against deactivation so they cannot recreate personal records after anonymization. Sent mail bodies are purged after 30 days; notifications follow the configured retention period. Business record retention remains an operator decision.

Payment amounts come from stored order snapshots. Browser redirects never confirm payment. Webhooks validate signatures, age, provider mode, order identity, currency and amount. Duplicate and out-of-order events cannot distribute or restore stock twice. Refunds remain pending until provider success; ambiguous network retries retain the same idempotency key, while confirmed failed attempts can be retried explicitly. All payment verification here used synthetic signatures and offline provider fixtures.

## Verification results

**72 automated tests passed**, with no skipped tests in the recorded final runs:

| Check | Result |
|---|---|
| Backend unit tests | 18 passed, including password hashing, CSRF/origin rules, request validation, safe image decoding and payment helpers |
| Frontend component/contract tests | 19 passed across seven files, including basket failures, response validation, event edits, staff pagination and role-aware sign-in |
| SQL-backed API acceptance | 23 passed against isolated temporary Docker services |
| Signed payment webhook acceptance | 12 passed; no real provider requests or charges |
| Strict builds and container builds | Passed for backend and frontend using clean Linux dependency installations |
| Dependency audits | Zero reported vulnerabilities for both complete dependency trees, including development dependencies, at verification time |
| Fresh/legacy migrations | Six migrations applied and reapplied; existing identifiers and stock preserved |
| Runtime database privileges | Normal data access works; superuser/schema/migration changes and changes to append-only history are rejected |
| Database restore | Snapshot counts, migration records, foreign keys, nonnegative stock and inventory ledger verified in separate restore databases |
| Object restore | One actual uploaded/re-encoded image restored into a separate bucket and downloaded checksum verified |
| Container/configuration checks | Localhost-only development ports, no published test ports, missing production settings rejected, ingress syntax checked without network access |
| Formatting and repository hygiene | Passed; host dependencies, environment files, backups and generated output excluded from version control |

The independent review produced regression fixes for a login/password-reset race, profile/deactivation races, truncated report totals, booked-event location edits and staff selection after pagination. Acceptance tests cover concurrent last-unit reservations, concurrent duplicate submissions, full basket rollback, cross-user permissions, verification/recovery through captured SMTP, upload privacy, delivery permissions and final stock reconciliation.

Browser verification used separate sessions for all five roles. A synthetic donor offer was created and edited from three to four units, staff received it, and a recipient reserved one unit alongside one bag of rice. The confirmed ticket survived a full reload. A volunteer redeemed it once and the repeated ticket was rejected. Reports and public impact then showed one completed order, 1.5 kg and three 500 g meal equivalents. Phone-width checks at 390 px covered navigation, sign-in, profile, marketplace and basket pricing. The buyer payment action remained disabled as configured. Browser recovery after replacing the frontend container was also checked.

Evidence is recorded in [API acceptance results](evidence/implementation-api-tests.json), [operations and recovery results](evidence/implementation-operations.json), [build/browser results](evidence/implementation-validation.json), [backend audit](evidence/implementation-backend-audit.json) and [frontend audit](evidence/implementation-frontend-audit.json). The raw local execution logs are ignored by Git.

## Scope and remaining external configuration

The Docker acceptance target is complete. The local dataset contains explicit demo food and one labelled browser-test collection, so its displayed impact is demonstration activity. Historical weights and quantities that the original schema never stored cannot be reconstructed; unknown weights are labelled and excluded from weight totals.

A future public service still needs an operating organization, reviewed contact/privacy/retention and food-handling procedures, real SMTP/S3/payment settings where used, protected secrets, external monitoring and an operator acceptance/release process. The prepared containers and runbook support that work; local tests do not establish legal compliance, food-safety certification, external provider delivery or production load capacity. Camera QR scanning also depends on browser support and permission; its manual ticket fallback was exercised here.

See [README](../README.md), [API contract](API_CONTRACT.md) and [operations runbook](OPERATIONS.md) for configuration, testing, backup, administrator bootstrap and update/rollback instructions. Refresh an existing browser tab after replacing the frontend image if it needs a newly built page asset.
