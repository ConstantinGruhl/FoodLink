# FoodLink

Food rescue application with a React interface, Express API, PostgreSQL, private S3-compatible image storage, and captured development email. The project is prepared as Docker containers; no hosting account or deployment is required.

## Start locally

Install/start Docker Desktop with Linux containers. From this repository directory:

```sh
docker compose up --build -d --wait
docker compose --profile tools run --rm seed
```

Open [FoodLink](http://localhost:5173). Open [captured email](http://localhost:8025) for verification and password recovery links. [API readiness](http://localhost:5173/api/ready) checks the database and image bucket.

The explicit seed creates local demo users and sample inventory. It does not run automatically and is forbidden in production mode. All five demo accounts use **`FoodLink-demo-2026!`**, configurable with `DEMO_PASSWORD` in an ignored root `.env` before seeding.

The local sign-in page includes Donor, Recipient, Buyer, Volunteer and Admin buttons that fill the default demo email and password. Select **Sign in** to authenticate. If you seeded with a custom `DEMO_PASSWORD`, replace the filled password before signing in. Set `DEMO_LOGIN_ENABLED=false` in the root `.env` to hide the buttons; they are always hidden in production mode.

| Role          | Email               | Main workflow                                                                     |
| ------------- | ------------------- | --------------------------------------------------------------------------------- |
| Donor         | donor@email.com     | Offer food, edit or cancel offers, upload photos, download receipt                |
| Recipient     | recipient@email.com | Reserve a basket, view a pickup ticket and order history                          |
| Buyer         | buyer@email.com     | Browse received surplus and prepare a basket                                      |
| Volunteer     | volunteer@email.com | Receive donations, manage events, redeem tickets and complete assigned deliveries |
| Administrator | admin@email.com     | Manage users, eligibility, inventory, reports, notifications and privacy requests |

New accounts use real password sign-in and email verification. Recipient reservations also require administrator approval. Staff roles can only be created by an administrator. Development email stays inside Mailpit; it is not delivered to external mailboxes.

## What is implemented

- Cookie sessions, CSRF and origin controls, password recovery, profile editing, personal data export and account deactivation.
- Donation offer and receipt stages, immutable quantity/price snapshots, image validation and private storage, stock movement history, expiry and disposal.
- Atomic multi-item reservations, repeat-submission protection, concurrent-stock locking, event capacity/cutoffs, cancellation and restocking.
- Protected pickup tickets with single redemption, delivery assignment and completion proof, order history, confirmations and reminders.
- Staff operations, recipient approval, user management, audit history, operational reports and impact calculated from completed distribution.
- Mobile navigation, labelled forms, recoverable errors, loading/empty states, typed response validation and strict frontend builds.
- Numbered database migrations, explicit demo seed, isolated acceptance tests, CI, healthchecks, database/object backup and restore tools.

Payments are **disabled by default**. Optional Stripe Checkout, signed webhooks and refund reconciliation are implemented with offline test fixtures. A browser redirect never marks an order paid. Real provider credentials and provider-side webhook configuration are needed to exercise actual payments; local tests do not make charges.

Defaults are one operating organization, EUR and Europe/Berlin. Organization contact information is configurable in administration. Privacy and terms pages explain the prototype's data handling and identify missing operator details.

## Test and operate

With Node 24 on the host:

```sh
node scripts/test.mjs
node scripts/check-health.mjs
node scripts/check-repository.mjs
node scripts/backup.mjs
```

The acceptance harness uses a separate Docker project and temporary database/storage, without published ports. It does not reset development data. Unit and frontend tests also run in CI. See [verification scope](docs/VERIFICATION.md) and [operation and recovery instructions](docs/OPERATIONS.md) for detailed checks and restore commands.

```sh
docker compose ps
docker compose logs --tail 100 backend
docker compose down
```

Routine shutdown preserves database and image volumes. Run `docker compose up -d --wait` to restart. Do not add `--volumes` unless you deliberately intend to erase local data.

The default development ports bind to localhost: application 5173, API 8080, database 5432, storage 9000/9001 and captured mail 8025. The frontend always calls the API through `/api`; host dependencies and environment files are excluded from container build contexts.

## Configuration and development record

- [Implementation and verification report](docs/IMPLEMENTATION_SUMMARY.md): completed milestones, 72 automated tests, browser checks and the remaining external configuration for any future public service.

- [Environment template](.env.example): local defaults and optional integrations.
- [Container operations](docs/OPERATIONS.md): startup, backup/restore, update/rollback and monitoring procedures.
- [Production configuration template](.env.production.example): required settings for a future operator; unfilled values deliberately reject startup. This is not deployed.
- [API contract](docs/API_CONTRACT.md): payloads and workflow rules used by both application layers.
- [Original analysis and milestone plan](docs/CURRENT_STATE_ANALYSIS.md): historical assessment of baseline `f0951eef`, before this implementation. Its original defects and audit results describe that baseline.

The original development database is upgraded through migrations. Where the earlier schema did not record historical weights or receipt quantities, migration labels the limitation instead of inventing missing history.
