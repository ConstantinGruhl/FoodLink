import 'dotenv/config'
const env = process.env
const production = env.NODE_ENV === 'production'
const origins = (env.APP_ORIGIN || env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim())
export const config = {
  production,
  demoLoginEnabled: !production && env.DEMO_LOGIN_ENABLED === 'true',
  port: Number(env.PORT || 8080),
  databaseUrl: env.DATABASE_URL,
  origins,
  publicAppUrl: env.PUBLIC_APP_URL || origins[0],
  secureCookie: env.COOKIE_SECURE === 'true' || production,
  currency: (env.CURRENCY || 'EUR').toUpperCase(),
  timezone: env.TIMEZONE || 'Europe/Berlin',
  organizationName: env.ORGANIZATION_NAME || 'FoodLink',
  mailMode: env.MAIL_MODE || 'outbox',
  smtpHost: env.SMTP_HOST,
  smtpPort: Number(env.SMTP_PORT || 587),
  smtpSecure: env.SMTP_SECURE === 'true',
  smtpUser: env.SMTP_USER,
  smtpPassword: env.SMTP_PASSWORD,
  mailFrom: env.MAIL_FROM || 'FoodLink <noreply@foodlink.local>',
  paymentsEnabled: env.PAYMENTS_ENABLED === 'true',
  stripeKey: env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  s3Endpoint: env.S3_ENDPOINT,
  s3Region: env.S3_REGION || 'us-east-1',
  s3AccessKey: env.S3_ACCESS_KEY,
  s3SecretKey: env.S3_SECRET_KEY,
  s3Bucket: env.S3_BUCKET || 'foodlink',
  s3ForcePath: env.S3_FORCE_PATH !== 'false',
  autoCreateBucket: !production && env.AUTO_CREATE_BUCKET !== 'false',
  sessionHours: Number(env.SESSION_HOURS || 12),
  maxBasketUnits: Number(env.MAX_BASKET_UNITS || 50),
}
export function validateConfig() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required')
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error('Invalid PORT')
  if (!['outbox', 'smtp'].includes(config.mailMode)) throw new Error('MAIL_MODE must be outbox or smtp')
  if (config.mailMode === 'smtp' && !config.smtpHost) throw new Error('SMTP_HOST is required')
  for (const origin of origins) {
    const url = new URL(origin)
    if (url.origin !== origin) throw new Error('APP_ORIGIN must contain exact origins')
  }
  const publicUrl = new URL(config.publicAppUrl)
  if (
    !origins.includes(publicUrl.origin) ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.pathname !== '/' ||
    publicUrl.search ||
    publicUrl.hash
  )
    throw new Error('PUBLIC_APP_URL must be one configured origin without a path or credentials')
  if (!Number.isFinite(config.sessionHours) || config.sessionHours < 1 || config.sessionHours > 168)
    throw new Error('SESSION_HOURS must be between 1 and 168')
  if (!Number.isInteger(config.maxBasketUnits) || config.maxBasketUnits < 1 || config.maxBasketUnits > 1000)
    throw new Error('MAX_BASKET_UNITS must be between 1 and 1000')
  new Intl.DateTimeFormat('en', { timeZone: config.timezone })
  if (!/^[A-Z]{3}$/.test(config.currency)) throw new Error('Invalid CURRENCY')
  if (
    !Intl.supportedValuesOf('currency').includes(config.currency) ||
    new Intl.NumberFormat('en', { style: 'currency', currency: config.currency }).resolvedOptions()
      .maximumFractionDigits !== 2
  )
    throw new Error('CURRENCY must be a supported currency with two decimal places')
  const retentionDays = Number(env.RETENTION_DAYS || 365)
  if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650)
    throw new Error('RETENTION_DAYS must be between 30 and 3650')
  if (config.paymentsEnabled && (!config.stripeKey || !config.stripeWebhookSecret))
    throw new Error('Stripe key and webhook secret are required')
  if (production) {
    if (env.SEED_DEMO === 'true') throw new Error('Demo seeding is prohibited in production')
    if (env.COOKIE_SECURE === 'false') throw new Error('Production requires secure cookies')
    if (origins.some((o) => !o.startsWith('https://')) || !config.publicAppUrl.startsWith('https://'))
      throw new Error('Production requires HTTPS origins')
    if (config.mailMode !== 'smtp') throw new Error('Production requires SMTP')
    if (!config.s3Endpoint || !config.s3AccessKey || !config.s3SecretKey || config.s3SecretKey.length < 16)
      throw new Error('Production object storage credentials are required')
    const storageUrl = new URL(config.s3Endpoint)
    if (
      storageUrl.protocol !== 'https:' &&
      !['minio', 'localhost', '127.0.0.1'].includes(storageUrl.hostname)
    )
      throw new Error('External production object storage requires HTTPS')
    if (
      !config.smtpSecure &&
      !['mailpit', 'localhost', '127.0.0.1'].includes(config.smtpHost || '') &&
      env.SMTP_REQUIRE_TLS !== 'true'
    )
      throw new Error('External production SMTP requires TLS')
    if (new URL(config.databaseUrl!).password.length < 16)
      throw new Error('Production database requires a strong password')
  }
}
