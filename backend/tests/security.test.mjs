import test from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword, hash, token, guardOrigin, requireAuth } from '../dist/security.js'
import { registrationSchema } from '../dist/auth.js'
import { basketSchema, validateEvent } from '../dist/orders.js'
import { config } from '../dist/config.js'

test('passwords use independent salted scrypt hashes and reject incorrect credentials', async () => {
  const password = 'A sufficiently long passphrase!'
  const a = await hashPassword(password),
    b = await hashPassword(password)
  assert.notEqual(a, b)
  assert.match(a, /^scrypt\$32768\$/)
  assert.equal(a.includes(password), false)
  assert.equal(await verifyPassword(password, a), true)
  assert.equal(await verifyPassword('wrong', a), false)
  assert.equal(await verifyPassword(password, null), false)
})
test('session and recovery tokens carry independent entropy and are hashed for storage', () => {
  const a = token(),
    b = token()
  assert.match(a, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a, b)
  assert.match(hash(a), /^[a-f0-9]{64}$/)
  assert.notEqual(hash(a), hash(b))
})
test('registration refuses privilege escalation, unknown identity fields and weak passwords', () => {
  const base = {
    email: 'new@example.test',
    name: 'New person',
    password: 'strong-passphrase-2026',
    role: 'recipient',
  }
  assert.equal(registrationSchema.safeParse(base).success, true)
  for (const data of [
    { ...base, role: 'admin' },
    { ...base, verified: true },
    { ...base, userId: 'another' },
    { ...base, password: 'short' },
  ])
    assert.equal(registrationSchema.safeParse(data).success, false)
})
test('CSRF is required for writes even with a valid session and role', () => {
  const middleware = requireAuth('donor')
  const req = {
    user: { id: 'x', role: 'donor' },
    method: 'POST',
    csrfToken: 'expected',
    get: () => undefined,
  }
  middleware(req, {}, (error) => assert.equal(error.code, 'CSRF_REQUIRED'))
  middleware({ ...req, get: () => 'expected' }, {}, (error) => assert.equal(error, undefined))
  middleware({ ...req, user: { role: 'buyer' }, get: () => 'expected' }, {}, (error) =>
    assert.equal(error.code, 'FORBIDDEN'),
  )
  middleware({ ...req, user: undefined }, {}, (error) => assert.equal(error.code, 'AUTH_REQUIRED'))
})
test('unsafe requests need an exact allowed Origin; safe reads remain accessible', () => {
  for (const origin of [undefined, 'https://evil.example', `${config.origins[0]}.evil.example`])
    guardOrigin({ method: 'POST', headers: { origin } }, {}, (error) =>
      assert.equal(error.code, 'ORIGIN_REJECTED'),
    )
  guardOrigin({ method: 'POST', headers: { origin: config.origins[0] } }, {}, (error) =>
    assert.equal(error, undefined),
  )
  guardOrigin({ method: 'GET', headers: {} }, {}, (error) => assert.equal(error, undefined))
})
test('basket validation prevents duplicate lines, negative money and fractional quantities', () => {
  const itemId = '11111111-1111-4111-8111-111111111111',
    eventId = '22222222-2222-4222-8222-222222222222'
  const base = { eventId, items: [{ itemId, qty: 1 }], fulfillment: 'pickup' }
  assert.equal(basketSchema.safeParse(base).success, true)
  for (const data of [
    {
      ...base,
      items: [
        { itemId, qty: 1 },
        { itemId, qty: 2 },
      ],
    },
    { ...base, supportContributionCents: -1 },
    { ...base, items: [{ itemId, qty: 0.5 }] },
    { ...base, userId: 'fake' },
    { ...base, fulfillment: 'delivery' },
  ])
    assert.equal(basketSchema.safeParse(data).success, false)
})
test('event chronology and timezone validation reject ambiguous scheduling', () => {
  const base = {
    startsAt: new Date(Date.now() + 7200000).toISOString(),
    endsAt: new Date(Date.now() + 10800000).toISOString(),
    cutoffAt: new Date(Date.now() + 3600000).toISOString(),
    timezone: 'Europe/Berlin',
    location: 'Hall',
    capacity: 10,
    allowDelivery: false,
  }
  assert.doesNotThrow(() => validateEvent(base))
  assert.throws(() => validateEvent({ ...base, endsAt: base.cutoffAt }), /end must follow/)
  assert.throws(() => validateEvent({ ...base, timezone: 'unknown/timezone' }), /timezone/)
})
