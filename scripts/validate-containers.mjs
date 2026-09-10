import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { root } from './docker.mjs'

function configuration(file, environment = {}) {
  return spawnSync('docker', ['compose', '-f', file, 'config', '--format', 'json'], {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  })
}
const development = configuration('docker-compose.yml')
assert.equal(development.status, 0, development.stderr)
for (const service of Object.values(JSON.parse(development.stdout).services)) {
  for (const port of service.ports || [])
    assert.equal(port.host_ip, '127.0.0.1', 'Development ports must bind to loopback')
}
const isolated = configuration('docker-compose.test.yml')
assert.equal(isolated.status, 0, isolated.stderr)
for (const service of Object.values(JSON.parse(isolated.stdout).services))
  assert.equal((service.ports || []).length, 0, 'Tests must not publish host ports')

const missing = configuration('docker-compose.production.yml', { POSTGRES_PASSWORD: '' })
assert.notEqual(missing.status, 0, 'Missing production configuration must reject startup')
// Synthetic values only; config validates without creating services or contacting providers.
const placeholder = 'configuration-check-only-2026'
const production = configuration('docker-compose.production.yml', {
  POSTGRES_PASSWORD: placeholder,
  DATABASE_URL: `postgres://foodlink_app:${placeholder}@db:5432/foodlink`,
  MIGRATION_DATABASE_URL: `postgres://foodlink:${placeholder}@db:5432/foodlink`,
  APP_DOMAIN: 'foodlink.example.invalid',
  ACME_EMAIL: 'operator@example.invalid',
  BACKEND_IMAGE: `foodlink-backend@sha256:${'0'.repeat(64)}`,
  FRONTEND_IMAGE: `foodlink-frontend@sha256:${'0'.repeat(64)}`,
  S3_ENDPOINT: 'https://storage.example.invalid',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: placeholder,
  S3_SECRET_KEY: placeholder,
  S3_BUCKET: 'foodlink-private',
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_USER: placeholder,
  SMTP_PASSWORD: placeholder,
  MAIL_FROM: 'FoodLink <mail@example.invalid>',
  ORGANIZATION_NAME: 'Configuration fixture',
  SUPPORT_EMAIL: 'support@example.invalid',
  ORGANIZATION_ADDRESS: 'Configuration fixture address',
  PRIVACY_CONTACT: 'privacy@example.invalid',
})
assert.equal(production.status, 0, production.stderr)
const config = JSON.parse(production.stdout)
for (const [name, service] of Object.entries(config.services)) {
  if (name !== 'ingress') assert.equal((service.ports || []).length, 0, `${name} must stay private`)
}
assert.equal(config.networks.data.internal, true)
assert.equal(config.networks.app.internal, true)
assert.equal(config.services.backend.environment.COOKIE_SECURE, 'true')
assert.equal(config.services.backend.environment.MIGRATE_ON_START, 'false')
assert.equal(config.services.backend.read_only, true)
assert.equal(config.services.frontend.read_only, true)
assert.ok(!config.services.seed && !config.services.mailpit && !config.services.minio)
console.log(
  'Container configuration verified: loopback development, isolated tests, private production services and fail-closed required settings. No deployment performed.',
)
