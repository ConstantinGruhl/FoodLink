# FoodLink Docker operation and recovery

This repository prepares and verifies portable containers. No hosting account, public deployment, DNS change, external email or payment is required to use the local prototype. The production Compose file is a configuration template for a future operator, not a claim that a live production release has taken place.

## Local startup

Requires Docker Desktop with Linux containers and Docker Compose. Run from the repository directory:

```sh
docker compose up --build -d --wait
docker compose --profile tools run --rm seed
```

Open FoodLink at <http://localhost:5173>, captured email at <http://localhost:8025>, and local storage administration at <http://localhost:9001>. Development connections bind to `127.0.0.1`. The API is additionally available at <http://localhost:8080/api/ready>; PostgreSQL at localhost:5432. SMTP is private to Docker and Mailpit never forwards messages externally. Images live in a private bucket and are served through the API after ownership/availability checks.

The explicit development seed creates the five roles with emails `admin@email.com`, `donor@email.com`, `recipient@email.com`, `buyer@email.com`, and `volunteer@email.com`. The default local-only password is `FoodLink-demo-2026!`. Override `DEMO_PASSWORD` in an ignored root `.env` before seeding. Real registration creates an unverified account: open its captured verification email in Mailpit, then use the administrator to approve recipient eligibility. Password recovery uses the same captured-mail workflow. Payments remain disabled by default.

The `foodlink_dbdata` and `foodlink_miniodata` volumes preserve existing data. Startup applies numbered migrations. The old schema initialization file is not re-run over existing volumes. Demo seeding is explicit and prohibited in production. To stop while retaining data, run `docker compose down`. Do not add `--volumes` to routine stop/update commands.

The frontend uses the relative `/api` path compiled at build time. Changing a runtime `VITE_*` variable does not reconfigure static assets. The API and frontend run without root privileges, with a read-only root filesystem and temporary writable storage only. Container healthchecks verify readiness, and restart policies recover stopped processes.

## Tests and maintenance

With Node 24 available on the host:

```sh
node scripts/test.mjs
node scripts/check-health.mjs
node scripts/check-repository.mjs
```

The acceptance harness starts the independent `foodlink-tests` Compose project. PostgreSQL uses the `foodlink_test` database on an ephemeral filesystem, storage uses an ephemeral filesystem and there are no published test ports. The suite refuses another database name, checks readiness and migration reapplication, and exercises separate authenticated sessions. It covers email verification/recovery through local Mailpit, recipient approval, donation receipt, atomic reservation, idempotency/races, cancellation/expiry, verified pickup, uploads, delivery, reporting, audits and stock reconciliation. A second isolated API process verifies signed payment webhook state transitions using synthetic test secrets; it never initiates provider requests. The harness removes test containers on completion and does not touch development data.

CI performs fresh lockfile installs, TypeScript/production builds, backend unit tests, high/critical production-dependency audit gates and container-backed acceptance tests. Action and base-image versions are pinned. Dependabot proposes weekly updates; each update must pass the same checks. Review build-tool advisories as well as runtime advisories before release.

Useful local commands:

```sh
docker compose ps
docker compose logs --tail 100 backend
docker compose exec backend node dist/migrate.js
```

Application logs are structured and carry request IDs. Avoid publishing database dumps, authentication cookies, email bodies, addresses or raw logs containing private data in issue trackers. Notification delivery status and administrative actions are visible in the admin screens.

## Back up and verify a database restore

Run the backup before upgrades and regularly while operating:

```sh
node scripts/backup.mjs
node scripts/restore-drill.mjs backups/<timestamped-archive>.dump
```

The backup uses an exported PostgreSQL transaction snapshot, so its archive and seven-table count manifest describe the same committed point in time. Binary archives are copied byte-for-byte with Docker, avoiding shell encoding corruption. Each backup includes a SHA-256 checksum. The restore drill validates that checksum, creates a new `foodlink_restore_<random>` database and verifies row counts, foreign-key relationships, nonnegative stock, migration records and the inventory movement ledger. It retains the restored database for inspection and never drops or overwrites an existing database. A legacy archive without a manifest is explicitly reported as such.

The database archive contains personal data and account/session records. Store backups encrypted outside the machine; the ignored local `backups/` folder alone cannot recover a lost host. Set `COMPOSE_FILE=docker-compose.production.yml` and supply the protected production environment when operating that stack. `BACKUP_DATABASE` defaults to `foodlink`. Plan retention and deletion in the operator's backup system; no automated deletion is enabled here.

## Local object-storage backup and restore drill

```sh
node scripts/object-backup.mjs
node scripts/object-restore-drill.mjs backups/<object-archive>.ndjson
```

The local object exporter streams a record for each S3 object with its key, content type, bytes and checksum. The restore drill creates a separate `foodlink-restore-<random>` bucket, restores objects and downloads each again to verify checksums. It never overwrites the active bucket and retains the test bucket for inspection. Freeze uploads and image deletion during a combined database/object snapshot, or use provider versioning and a consistent recovery point. The database and object exports are not a cross-system atomic snapshot.

These object scripts deliberately reject `NODE_ENV=production`. A future production S3 service should provide supported versioning, lifecycle policy, encrypted backup/replication and independently tested restore procedures. The pinned MinIO image is a local compatibility fixture: [its upstream repository was archived](https://github.com/minio/minio/releases), so the production template requires a maintained S3 service instead of shipping it as production storage. The local fixture stays on the previously used storage version to preserve the existing volume format.

## Portable production configuration

`docker-compose.production.yml` is independent from development and exposes only HTTPS ingress ports 80/443. The database and application networks are private, storage is external/private, the mail sink and demo seed are absent, and all required configuration blanks reject startup. API and frontend images must be tested immutable release references. Copy `.env.production.example` into an ignored, access-restricted file or inject values from a container secret manager. Never commit real values or reuse local credentials.

The template requires a configured application origin, organization name, sender identity, certificate contact, private S3 bucket and SMTP transport. Cookies are secure, SMTP/storage settings must pass production validation, and payment credentials are required only if that feature is explicitly enabled. Provision the private bucket and scoped permissions before starting the API. Browser-to-storage CORS and public-read policy are unnecessary because image upload/download goes through the API. SMTP supports implicit TLS or authenticated STARTTLS as documented by the chosen mail provider.

Use a dedicated least-privilege runtime database role, distinct from the schema migration owner. `ops/database-role.sql` provisions `foodlink_app` after migrations; supply `app_password` through a protected psql variable and `database_name=foodlink`. The role cannot change schema/migration records or update/delete append-only stock, audit and payment-event history. Runtime `DATABASE_URL` must use that account. `MIGRATION_DATABASE_URL` belongs to the schema owner and is used only by the explicit migration container. Do not give the web API PostgreSQL superuser credentials. For an external managed database, configure its CA/TLS and network access according to the provider; the bundled database stays on the internal Docker network.

Before any future release, validate configuration without starting services:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
```

This command intentionally fails with the unfilled example. It does not allocate infrastructure or contact a certificate authority.

For a future non-demo installation, create the first administrator through the one-time bootstrap command below. Inject `ADMIN_EMAIL`, `ADMIN_NAME` and a unique `ADMIN_PASSWORD` (at least 12 characters) into the invoking environment through the operator's secret manager; the command forwards their values without placing the password in shell history. This uses the migration owner because bootstrap applies migrations. It refuses to replace an existing active administrator. Subsequent accounts and role changes belong in the administrator interface.

```sh
docker compose --env-file .env.production -f docker-compose.production.yml run --rm -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD migrate node dist/bootstrap-admin.js
```

This is a documented future operator action and was not executed against any production environment.

## Release and rollback procedure

1. Run CI and the acceptance suite, then build/version both application images from the same reviewed revision. Record image digests and migration version. Review dependency/image advisories.
2. Make a database backup and object recovery point; run the restore drills in isolation. Record measured restore duration and agree acceptable data loss with the operator.
3. In a future staged environment, inject secrets and start dependencies. Run the migration container explicitly before promoting API/frontend images. Never seed production. Use additive/backward-compatible schema changes so the previous application revision remains usable during rollback.
4. Verify readiness, fresh registration/login, staff receipt, reservation, pickup, mail delivery status and a sample image. Check logs and inventory reconciliation before opening access.
5. If application behavior regresses, restore the previous tested API/frontend image digests and restart those services. A schema rollback is not automatic; if the previous app is incompatible, stop writes and restore the verified database/object recovery point into new storage, then switch configuration. Preserve the failed state for investigation.

These are operator procedures, not automatic deployment actions. No release/rollback command contacts hosting or promotes code from this repository by itself.

## Monitoring and operational ownership

Poll `/api/ready` through the frontend with `scripts/check-health.mjs`; it exits nonzero on timeout or dependency failure. Monitor container restart/health state, request error rates/latency, database connection saturation, available disk, backup age, recovery-check results, failed mail/outbox age and pending payment/refund age if commerce is enabled. Route meaningful failures to the operator's existing monitoring service. The local checker does not claim to deliver alerts externally.

The API schedules cleanup/expiry/reminder processing and also exposes authenticated administrative maintenance. Investigate failed durable-outbox rows and retry only after fixing transport configuration. Reconcile completed orders and stock movements after an outage; do not edit stock directly in SQL during normal operation.

Docker readiness is established by local test evidence. Public operation additionally needs a named support owner, a privacy/retention policy and food receiving/distribution procedures appropriate to the operator; container configuration alone cannot supply those organizational decisions.
