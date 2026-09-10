import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire('/app/package.json')
const { Pool } = require('pg')
const sharp = require('sharp')
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl || new URL(databaseUrl).pathname !== '/foodlink_test') {
  throw new Error('Tests require the dedicated foodlink_test database. Refusing to use any other database.')
}
const api = process.env.TEST_API_URL || 'http://backend:8080/api'
const mail = process.env.TEST_MAIL_URL || 'http://mailpit:8025'
const origin = 'http://localhost:5173'
const password = process.env.TEST_PASSWORD || 'FoodLink-test-pass-2026!'
const db = new Pool({ connectionString: databaseUrl })
const unique = randomUUID().slice(0, 8)
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString()
const futureDay = () => future(240)

class Client {
  cookie = ''
  csrf = ''
  user = null
  async request(
    path,
    { method = 'GET', body, status = 200, headers = {}, raw = false, noCsrf = false, noOrigin = false } = {},
  ) {
    const requestHeaders = {
      ...(noOrigin ? {} : { Origin: origin }),
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...(!noCsrf && this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
      ...headers,
    }
    if (body !== undefined && !raw && !requestHeaders['Content-Type'])
      requestHeaders['Content-Type'] = 'application/json'
    const response = await fetch(`${api}${path}`, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    })
    const cookies = response.headers.getSetCookie()
    if (cookies.length) this.cookie = cookies.map((c) => c.split(';')[0]).join('; ')
    const text = await response.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    if (status !== null) assert.equal(response.status, status, `${method} ${path}: ${text}`)
    if (response.status >= 400) {
      assert.equal(typeof data.error?.code, 'string', `Structured error expected for ${path}`)
      assert.equal(typeof data.requestId, 'string', 'Error needs request ID')
      assert.ok(!text.includes('password_hash'), 'Internal fields must not leak')
    }
    return { data, status: response.status, headers: response.headers }
  }
  async login(email, pass = password) {
    const response = await this.request('/auth/login', { method: 'POST', body: { email, password: pass } })
    this.user = response.data.user
    this.csrf = response.data.csrfToken
    assert.ok(this.csrf)
    return response
  }
}

const anonymous = new Client()
const admin = new Client()
const donor = new Client()
const recipient = new Client()
const buyer = new Client()
const volunteer = new Client()
let secondDonor
let secondRecipient
let event
let mainDonation
let mainOrder
let baselineImpact

async function mailToken(address, type) {
  const until = Date.now() + 45000
  while (Date.now() < until) {
    const response = await fetch(`${mail}/api/v1/messages`)
    assert.equal(response.status, 200, 'Mailpit API available')
    const messages = (await response.json()).messages || []
    for (const message of messages) {
      if (!(message.To || []).some((to) => to.Address.toLowerCase() === address.toLowerCase())) continue
      const detail = await (await fetch(`${mail}/api/v1/message/${message.ID}`)).json()
      const link = String(detail.Text || detail.HTML).match(new RegExp(`/${type}\\?token=([^\\s"<>]+)`))
      if (link) return decodeURIComponent(link[1].replaceAll('&amp;', '&').split('&')[0])
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Mailpit did not receive ${type} email for test user`)
}

async function register(role, label = role, verify = true) {
  const client = new Client()
  const email = `${label}-${unique}-${randomUUID().slice(0, 6)}@example.test`
  const { data } = await client.request('/auth/register', {
    method: 'POST',
    status: 201,
    body: { email, password, name: `Test ${label}`, role },
  })
  client.user = data.user
  client.csrf = data.csrfToken
  assert.equal(data.user.emailVerified, false)
  assert.ok(!('passwordHash' in data.user))
  if (verify) {
    const token = await mailToken(email, 'verify-email')
    await client.request('/auth/verify-email', { method: 'POST', body: { token } })
    await client.request('/auth/verify-email', { method: 'POST', body: { token }, status: 400 })
    await client.login(email)
    assert.equal(client.user.emailVerified, true)
  }
  return client
}

async function offer(qty = 5, name = 'Test apples', itemOverrides = {}) {
  const { data } = await donor.request('/donations', {
    method: 'POST',
    status: 201,
    body: {
      items: [
        {
          name: `${name} ${unique}`,
          qty,
          unit: 'pack',
          storage: 'ambient',
          expiresOn: futureDay(),
          weightGrams: 500,
          category: 'produce',
          allergens: [],
          handlingNotes: 'Keep clean and dry',
          ...itemOverrides,
        },
      ],
    },
  })
  return data
}
async function received(qty = 5, name = 'Test stock', overrides = {}) {
  const donation = await offer(qty, name, overrides)
  const { data } = await admin.request(`/donations/${donation.id}`, {
    method: 'PATCH',
    body: { status: 'received', notes: 'Quality, labeling and temperature checked' },
  })
  return data
}
function basket(itemId, qty = 1, overrides = {}) {
  return { eventId: event.id, items: [{ itemId, qty }], fulfillment: 'pickup', ...overrides }
}
async function reserve(client, body, key = randomUUID(), status = 201) {
  return client.request('/orders/reserve', {
    method: 'POST',
    body,
    status,
    headers: { 'Idempotency-Key': key },
  })
}
async function quantity(itemId) {
  return (await db.query('SELECT qty FROM items WHERE id=$1', [itemId])).rows[0].qty
}

before(async () => {
  assert.equal((await db.query('SELECT current_database() name')).rows[0].name, 'foodlink_test')
  await Promise.all([
    admin.login('admin@email.com'),
    donor.login('donor@email.com'),
    recipient.login('recipient@email.com'),
    buyer.login('buyer@email.com'),
    volunteer.login('volunteer@email.com'),
  ])
  const { data } = await admin.request('/events', {
    method: 'POST',
    status: 201,
    body: {
      startsAt: future(24),
      endsAt: future(27),
      cutoffAt: future(23),
      location: `Integration hub ${unique}`,
      capacity: 100,
      allowDelivery: true,
      timezone: 'Europe/Berlin',
    },
  })
  event = data
  baselineImpact = (await anonymous.request('/impact')).data
})
after(async () => {
  await db.end()
})

test('readiness, response contracts and anonymous access boundaries', async () => {
  for (const path of ['/health', '/ready', '/config', '/items', '/events', '/impact'])
    await anonymous.request(path)
  const session = await anonymous.request('/auth/session')
  assert.equal(session.data.user, null)
  for (const path of [
    '/orders/mine',
    '/orders',
    '/donations',
    '/inventory',
    '/notifications',
    '/admin/users',
    '/admin/audit',
    '/deliveries',
  ]) {
    await anonymous.request(path, { status: 401 })
  }
  const config = (await anonymous.request('/config')).data
  assert.equal(config.paymentsEnabled, false)
  assert.equal(config.currency, 'EUR')
  assert.ok(Array.isArray((await anonymous.request('/items')).data))
  assert.ok(Array.isArray((await anonymous.request('/impact')).data.monthly))
  await anonymous.request('/items?limit=201', { status: 400 })
  await donor.request('/admin/users', { status: 403 })
  await recipient.request('/inventory', { status: 403 })
})

test('real password login, session protection and malformed inputs', async () => {
  await anonymous.request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@email.com', password: 'wrong-password' },
    status: 401,
  })
  await anonymous.request('/auth/login', { method: 'POST', body: { email: 'admin@email.com' }, status: 400 })
  await anonymous.request('/auth/register', {
    method: 'POST',
    body: { email: `admin-${unique}@example.test`, password, name: 'Escalation attempt', role: 'admin' },
    status: 400,
  })
  await anonymous.request('/auth/register', {
    method: 'POST',
    body: { email: `weak-${unique}@example.test`, password: 'weak', name: 'Weak', role: 'donor' },
    status: 400,
  })
  await donor.request('/auth/profile', {
    method: 'PATCH',
    body: { name: 'Changed' },
    noCsrf: true,
    status: 403,
  })
  await donor.request('/auth/profile', {
    method: 'PATCH',
    body: { name: 'Changed' },
    headers: { Origin: 'https://untrusted.example' },
    status: 403,
  })
  await donor.request('/auth/profile', {
    method: 'PATCH',
    body: '{',
    raw: true,
    headers: { 'Content-Type': 'application/json' },
    status: 400,
  })
  assert.match(donor.cookie, /foodlink_session=/)
  const fresh = new Client()
  const login = await fresh.login('donor@email.com')
  assert.ok(login.headers.getSetCookie().some((c) => /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)))
  await fresh.request('/auth/logout', { method: 'POST', body: {} })
  await fresh.request('/donations', { status: 401 })
  await anonymous.request('/ready')
})

test('registration, captured email verification and administrator eligibility', async () => {
  secondDonor = await register('donor')
  secondRecipient = await register('recipient')
  await secondRecipient.request('/orders/reserve', {
    method: 'POST',
    status: 403,
    body: basket(randomUUID()),
    headers: { 'Idempotency-Key': randomUUID() },
  })
  const approved = await admin.request(`/admin/users/${secondRecipient.user.id}`, {
    method: 'PATCH',
    body: { verified: true },
  })
  assert.equal(approved.data.verified, true)
  await anonymous.request('/auth/register', {
    method: 'POST',
    status: 409,
    body: { email: secondDonor.user.email, password, name: 'Duplicate', role: 'donor' },
  })
  const pending = await register('recipient', 'unverified', false)
  await admin.request(`/admin/users/${pending.user.id}`, { method: 'PATCH', body: { verified: true } })
  await reserve(pending, basket(randomUUID()), randomUUID(), 403)
})

test('donor offer is private, unavailable until staff receipt, with immutable original quantity', async () => {
  mainDonation = await offer(8)
  const item = mainDonation.items[0]
  assert.equal(item.offeredQty, 8)
  assert.equal(item.qty, 0)
  assert.ok(!(await anonymous.request('/items')).data.some((i) => i.id === item.id))
  await secondDonor.request(`/donations/${mainDonation.id}`, { status: 403 })
  await secondDonor.request(`/donations/${mainDonation.id}`, {
    method: 'PATCH',
    body: { status: 'cancelled' },
    status: 403,
  })
  await donor.request(`/donations/${mainDonation.id}`, {
    method: 'PATCH',
    body: { status: 'received' },
    status: 403,
  })
  await reserve(recipient, basket(item.id), randomUUID(), 409)
  await admin.request(`/donations/${mainDonation.id}`, {
    method: 'PATCH',
    body: { status: 'received', notes: 'Received in good condition' },
  })
  assert.equal(await quantity(item.id), 8)
  const history = (await donor.request(`/donations/${mainDonation.id}`)).data
  assert.equal(history.items[0].offeredQty, 8)
  assert.equal(history.items[0].receivedQty, 8)
  await admin.request(`/donations/${mainDonation.id}`, { method: 'PATCH', body: { status: 'received' } })
  assert.equal(await quantity(item.id), 8)
})

test('invalid quantities, spoofed identity and atomic basket rollback', async () => {
  const itemId = mainDonation.items[0].id
  for (const qty of [-1, 0, 1.5, 10000000]) await reserve(recipient, basket(itemId, qty), randomUUID(), 400)
  await reserve(recipient, basket(itemId, 1, { userId: admin.user.id }), randomUUID(), 400)
  await donor.request('/donations', {
    method: 'POST',
    body: { donorId: secondDonor.user.id, items: [] },
    status: 400,
  })
  await reserve(
    recipient,
    basket(itemId, 1, {
      items: [
        { itemId, qty: 1 },
        { itemId: randomUUID(), qty: 1 },
      ],
    }),
    randomUUID(),
    404,
  )
  assert.equal(await quantity(itemId), 8, 'A failed basket must not reserve an earlier valid line')
  await reserve(
    recipient,
    basket(itemId, 1, {
      items: [
        { itemId, qty: 1 },
        { itemId, qty: 1 },
      ],
    }),
    randomUUID(),
    400,
  )
  await reserve(recipient, basket(itemId, 1, { supportContributionCents: -100 }), randomUUID(), 400)
  await recipient.request('/orders/reserve', { method: 'POST', body: basket(itemId), status: 400 })
})

test('reservation replay is idempotent and a changed body cannot reuse a key', async () => {
  const itemId = mainDonation.items[0].id
  const key = randomUUID()
  const body = basket(itemId, 2)
  mainOrder = (await reserve(recipient, body, key)).data
  assert.equal(mainOrder.status, 'confirmed')
  assert.ok(mainOrder.pickupToken)
  const replay = (await reserve(recipient, body, key, 200)).data
  assert.equal(replay.id, mainOrder.id)
  await reserve(recipient, basket(itemId, 3), key, 409)
  assert.equal(await quantity(itemId), 6)
  const history = (await donor.request(`/donations/${mainDonation.id}`)).data
  assert.equal(history.items[0].offeredQty, 8)
  assert.equal(history.items[0].receivedQty, 8)
  await secondRecipient.request(`/orders/${mainOrder.id}`, { status: 403 })
  await secondRecipient.request(`/orders/${mainOrder.id}/cancel`, { method: 'POST', body: {}, status: 403 })
  assert.ok(!(await secondRecipient.request('/orders/mine')).data.some((o) => o.id === mainOrder.id))
  assert.equal(
    (await anonymous.request('/impact')).data.totalOrdersCompleted,
    baselineImpact.totalOrdersCompleted,
  )
})

test('last-unit concurrency permits one winner and never negative stock', async () => {
  const donation = await received(1, 'Last unit')
  const itemId = donation.items[0].id
  const results = await Promise.all([
    reserve(recipient, basket(itemId), randomUUID(), null),
    reserve(secondRecipient, basket(itemId), randomUUID(), null),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
  assert.equal(await quantity(itemId), 0)
  const rows = await db.query('SELECT count(*)::int n FROM order_items WHERE item_id=$1', [itemId])
  assert.equal(rows.rows[0].n, 1)
})

test('simultaneous duplicate submission produces one order and one reservation', async () => {
  const donation = await received(4, 'Double submission')
  const itemId = donation.items[0].id
  const key = randomUUID()
  const results = await Promise.all([
    reserve(recipient, basket(itemId, 2), key, null),
    reserve(recipient, basket(itemId, 2), key, null),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201])
  assert.equal(results[0].data.id, results[1].data.id)
  assert.equal(await quantity(itemId), 2)
})

test('cancellation restores once, keeps business history and refuses collection', async () => {
  const donation = await received(3, 'Cancellation')
  const itemId = donation.items[0].id
  const order = (await reserve(recipient, basket(itemId, 2))).data
  await recipient.request(`/orders/${order.id}/cancel`, { method: 'POST', body: {} })
  assert.equal(await quantity(itemId), 3)
  const repeated = await recipient.request(`/orders/${order.id}/cancel`, {
    method: 'POST',
    body: {},
    status: null,
  })
  assert.ok([200, 409].includes(repeated.status))
  assert.equal(await quantity(itemId), 3)
  await volunteer.request('/orders/redeem', {
    method: 'POST',
    body: { token: order.pickupToken },
    status: 409,
  })
  assert.equal((await recipient.request(`/orders/${order.id}`)).data.items[0].qty, 2)
})

test('verified pickup is redeemed exactly once and impact uses completed weight', async () => {
  assert.equal((await recipient.request(`/orders/${mainOrder.id}`)).data.pickupToken, mainOrder.pickupToken)
  assert.equal(
    (await recipient.request('/orders/mine')).data.find((order) => order.id === mainOrder.id).pickupToken,
    mainOrder.pickupToken,
  )
  assert.equal((await volunteer.request(`/orders/${mainOrder.id}`)).data.pickupToken, null)
  assert.equal((await admin.request(`/orders/${mainOrder.id}`)).data.pickupToken, null)
  assert.equal(
    (await volunteer.request('/orders')).data.find((order) => order.id === mainOrder.id).pickupToken,
    null,
  )
  assert.equal(
    (await admin.request('/orders')).data.find((order) => order.id === mainOrder.id).pickupToken,
    null,
  )
  await recipient.request('/orders/redeem', {
    method: 'POST',
    body: { token: mainOrder.pickupToken },
    status: 403,
  })
  await volunteer.request('/orders/redeem', {
    method: 'POST',
    body: { token: mainOrder.pickupToken },
    status: 409,
  })
  await db.query(
    "UPDATE events SET starts_at=now()+interval '10 minutes',cutoff_at=now()+interval '5 minutes',ends_at=now()+interval '2 hours' WHERE id=$1",
    [event.id],
  )
  const complete = await volunteer.request('/orders/redeem', {
    method: 'POST',
    body: { token: mainOrder.pickupToken },
  })
  assert.equal(complete.data.status, 'picked-up')
  assert.equal(complete.data.pickupToken, null)
  await volunteer.request('/orders/redeem', {
    method: 'POST',
    body: { token: mainOrder.pickupToken },
    status: 409,
  })
  await recipient.request(`/orders/${mainOrder.id}/cancel`, { method: 'POST', body: {}, status: 409 })
  const impact = (await anonymous.request('/impact')).data
  assert.equal(impact.totalOrdersCompleted, baselineImpact.totalOrdersCompleted + 1)
  assert.equal(impact.totalKgSaved, baselineImpact.totalKgSaved + 1)
  assert.equal(impact.totalMealsDistributed, baselineImpact.totalMealsDistributed + 2)
  assert.equal(await quantity(mainDonation.items[0].id), 6)
})

test('expired stock, no-shows and event cancellation reconcile inventory', async () => {
  const donation = await received(4, 'Expiry')
  const itemId = donation.items[0].id
  const order = (await reserve(recipient, basket(itemId))).data
  await db.query("UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1", [order.id])
  await admin.request('/admin/maintenance', { method: 'POST', body: {} })
  assert.equal((await recipient.request(`/orders/${order.id}`)).data.status, 'expired')
  assert.equal(await quantity(itemId), 4)
  await db.query('UPDATE items SET expires_on=current_date-1 WHERE id=$1', [itemId])
  assert.ok(!(await anonymous.request('/items')).data.some((i) => i.id === itemId))
  await reserve(recipient, basket(itemId), randomUUID(), 409)
  await admin.request('/admin/maintenance', { method: 'POST', body: {} })
  assert.equal(await quantity(itemId), 0)
  const otherEvent = (
    await admin.request('/events', {
      method: 'POST',
      status: 201,
      body: {
        startsAt: future(48),
        endsAt: future(51),
        cutoffAt: future(47),
        location: 'Cancellation hub',
        capacity: 2,
      },
    })
  ).data
  const otherDonation = await received(3, 'Event cancellation')
  const otherItemId = otherDonation.items[0].id
  const affected = (await reserve(recipient, basket(otherItemId, 2, { eventId: otherEvent.id }))).data
  await admin.request(`/events/${otherEvent.id}`, { method: 'PATCH', body: { status: 'cancelled' } })
  assert.equal(await quantity(otherItemId), 3)
  assert.equal((await recipient.request(`/orders/${affected.id}`)).data.status, 'cancelled')
})

test('binary image upload, retrieval, ownership, invalid magic and deletion', async () => {
  const donation = await offer(1, 'Photo')
  const itemId = donation.items[0].id
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00aa00' } })
    .png()
    .toBuffer()
  await secondDonor.request(`/items/${itemId}/images`, {
    method: 'POST',
    body: png,
    raw: true,
    headers: { 'Content-Type': 'image/png' },
    status: 403,
  })
  await donor.request(`/items/${itemId}/images`, {
    method: 'POST',
    body: Buffer.from('<script>bad</script>'),
    raw: true,
    headers: { 'Content-Type': 'image/png' },
    status: 415,
  })
  await donor.request(`/items/${itemId}/images`, {
    method: 'POST',
    body: png.subarray(0, 16),
    raw: true,
    headers: { 'Content-Type': 'image/png' },
    status: 400,
  })
  await donor.request(`/items/${itemId}/images`, {
    method: 'POST',
    body: Buffer.alloc(5 * 1024 * 1024 + 1),
    raw: true,
    headers: { 'Content-Type': 'image/png' },
    status: 413,
  })
  const image = (
    await donor.request(`/items/${itemId}/images`, {
      method: 'POST',
      body: png,
      raw: true,
      headers: { 'Content-Type': 'image/png', 'X-Image-Alt': 'Food photo' },
      status: 201,
    })
  ).data
  assert.equal(image.alt, 'Food photo')
  const imageUrl = new URL(image.url, api.replace('/api', '')).href
  const privateResponse = await fetch(imageUrl)
  assert.ok([403, 404].includes(privateResponse.status), 'Offered food images remain private')
  const response = await fetch(imageUrl, { headers: { Cookie: donor.cookie } })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /image\/webp/)
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
  assert.equal(metadata.width, 2)
  assert.equal(metadata.height, 2)
  await admin.request(`/donations/${donation.id}`, { method: 'PATCH', body: { status: 'received' } })
  assert.equal((await fetch(imageUrl)).status, 200, 'Received food images are visible in the public catalog')
  assert.ok((await donor.request(`/items/${itemId}/images`)).data.some((i) => i.id === image.id))
  await secondDonor.request(`/items/${itemId}/images/${image.id}`, { method: 'DELETE', status: 403 })
  await donor.request(`/items/${itemId}/images/${image.id}`, { method: 'DELETE' })
  assert.equal((await donor.request(`/items/${itemId}/images`)).data.length, 0)
})

test('delivery requires assignment and proof, completes once without exposing address publicly', async () => {
  const donation = await received(2, 'Delivery')
  const order = (
    await reserve(
      recipient,
      basket(donation.items[0].id, 1, {
        fulfillment: 'delivery',
        deliveryAddress: 'Test recipient, 1 Example Street, Berlin',
      }),
    )
  ).data
  assert.equal(order.pickupToken, null)
  await volunteer.request(`/orders/${order.id}/deliver`, {
    method: 'POST',
    body: { proof: 'Handed to recipient' },
    status: 403,
  })
  await admin.request(`/orders/${order.id}/assign`, {
    method: 'POST',
    body: { volunteerId: donor.user.id },
    status: 400,
  })
  await admin.request(`/orders/${order.id}/assign`, {
    method: 'POST',
    body: { volunteerId: volunteer.user.id },
  })
  await volunteer.request(`/orders/${order.id}/deliver`, { method: 'POST', body: { proof: '' }, status: 400 })
  const delivered = (
    await volunteer.request(`/orders/${order.id}/deliver`, {
      method: 'POST',
      body: { proof: 'Handed directly to verified recipient at requested address' },
    })
  ).data
  assert.equal(delivered.status, 'delivered')
  await volunteer.request(`/orders/${order.id}/deliver`, {
    method: 'POST',
    body: { proof: 'Repeated' },
    status: 409,
  })
  const publicImpact = (await anonymous.request('/impact')).data
  assert.ok(!JSON.stringify(publicImpact).includes('Example Street'))
})

test('surplus restricted to buyer workflow, payments disabled safely and webhook signatures required', async () => {
  const donation = await received(2, 'Surplus')
  const itemId = donation.items[0].id
  await admin.request(`/items/${itemId}`, { method: 'PATCH', body: { isSurplus: true, priceCents: 150 } })
  await reserve(recipient, basket(itemId), randomUUID(), 403)
  await buyer.request('/orders/checkout', {
    method: 'POST',
    body: basket(itemId),
    headers: { 'Idempotency-Key': randomUUID() },
    status: 503,
  })
  assert.equal(await quantity(itemId), 2)
  const webhook = await anonymous.request('/payments/webhook', {
    method: 'POST',
    body: { type: 'checkout.session.completed' },
    status: null,
  })
  assert.ok([400, 503].includes(webhook.status))
})

test('reports, notifications, disposal ledger and staff audit derive from real operations', async () => {
  const donation = await received(2, 'Disposal')
  const itemId = donation.items[0].id
  await donor.request(`/items/${itemId}/dispose`, {
    method: 'POST',
    body: { qty: 1, reason: 'Damaged' },
    status: 403,
  })
  await admin.request(`/items/${itemId}/dispose`, {
    method: 'POST',
    body: { qty: 1, reason: 'Packaging damaged at inspection' },
  })
  assert.equal(await quantity(itemId), 1)
  const ledger = (await admin.request(`/items/${itemId}/ledger`)).data
  assert.equal(
    ledger.reduce((total, row) => total + row.delta, 0),
    1,
  )
  assert.ok(ledger.some((row) => row.kind === 'dispose' && row.actorId === admin.user.id))
  const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const to = future(24).slice(0, 10)
  const report = (await admin.request(`/reports?from=${from}&to=${to}`)).data
  assert.ok(report.completedOrders >= 2)
  assert.ok(report.kgDistributed >= 1.5)
  const notifications = (await recipient.request('/notifications')).data
  assert.ok(notifications.length > 0)
  await recipient.request(`/notifications/${notifications[0].id}`, { method: 'PATCH', body: { read: true } })
  await secondRecipient.request(`/notifications/${notifications[0].id}`, {
    method: 'PATCH',
    body: { read: true },
    status: 404,
  })
  assert.ok((await admin.request('/admin/audit')).data.length > 0)
})

test('password recovery uses captured mail and revokes old sessions', async () => {
  const recovery = await register('buyer', 'recovery')
  const existingSessionCookie = recovery.cookie
  await anonymous.request('/auth/forgot-password', { method: 'POST', body: { email: recovery.user.email } })
  const token = await mailToken(recovery.user.email, 'reset-password')
  const newPassword = 'FoodLink-reset-pass-2026!'
  await anonymous.request('/auth/reset-password', { method: 'POST', body: { token, password: newPassword } })
  await anonymous.request('/auth/reset-password', {
    method: 'POST',
    body: { token, password: newPassword },
    status: 400,
  })
  recovery.cookie = existingSessionCookie
  await recovery.request('/orders/mine', { status: 401 })
  await recovery.request('/auth/login', {
    method: 'POST',
    body: { email: recovery.user.email, password },
    status: 401,
  })
  await recovery.login(recovery.user.email, newPassword)
  await anonymous.request('/auth/forgot-password', {
    method: 'POST',
    body: { email: `missing-${unique}@example.test` },
  })
})

test('account disabling revokes sessions and final ledger reconciles', async () => {
  await admin.request(`/admin/users/${secondDonor.user.id}`, { method: 'PATCH', body: { disabled: true } })
  await secondDonor.request('/donations', { status: 401 })
  await admin.request(`/admin/users/${admin.user.id}`, {
    method: 'PATCH',
    body: { disabled: true },
    status: 409,
  })
  const negative = await db.query('SELECT count(*)::int n FROM items WHERE qty<0')
  assert.equal(negative.rows[0].n, 0)
  const mismatch = await db.query(
    'SELECT i.id FROM items i JOIN inventory_movements m ON m.item_id=i.id GROUP BY i.id HAVING i.qty <> sum(m.delta)',
  )
  assert.deepEqual(mismatch.rows, [], 'Inventory must reconcile with its ledger')
  const leaks = await db.query(
    "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'",
  )
  assert.equal(leaks.rows[0].n, 0, 'Requests must release their transaction connections')
})

test('session expiry, scoped profile export and volunteer task assignment', async () => {
  const temporary = new Client()
  await temporary.login('buyer@email.com')
  const raw = temporary.cookie.split('foodlink_session=')[1].split(';')[0]
  await db.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE id_hash=$1", [
    createHash('sha256').update(raw).digest('hex'),
  ])
  await temporary.request('/orders/mine', { status: 401 })
  const exportData = (await recipient.request('/auth/export')).data
  assert.equal(exportData.profile.id, recipient.user.id)
  assert.ok(!JSON.stringify(exportData).includes(secondRecipient.user.email))
  await recipient.request('/tasks', { status: 403 })
  const task = (
    await admin.request('/tasks', {
      method: 'POST',
      status: 201,
      body: {
        title: 'Prepare integration distribution',
        description: 'Check cold storage and collection signs',
        eventId: event.id,
        assignedVolunteerId: volunteer.user.id,
        dueAt: future(1),
      },
    })
  ).data
  const working = (
    await volunteer.request(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'in-progress' } })
  ).data
  assert.equal(working.status, 'in-progress')
  const completed = (
    await volunteer.request(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'completed' } })
  ).data
  assert.equal(completed.status, 'completed')
  assert.ok((await volunteer.request('/tasks')).data.some((t) => t.id === task.id))
})

test('password reset rejects a login whose password check finished before the reset', async () => {
  const email = `login-race-${randomUUID()}@example.test`
  const userId = randomUUID()
  const resetToken = randomUUID()
  await db.query(
    "INSERT INTO users(id,email,name,role,password_hash,email_verified) SELECT $1,$2,'Login race fixture','buyer',password_hash,true FROM users WHERE id=$3",
    [userId, email, donor.user.id],
  )
  await db.query(
    "INSERT INTO account_tokens(token_hash,user_id,kind,expires_at) VALUES($1,$2,'reset',now()+interval '1 hour')",
    [createHash('sha256').update(resetToken).digest('hex'), userId],
  )
  const attemptKey = createHash('sha256').update(`account:${email}`).digest('hex')
  await db.query("INSERT INTO auth_attempts(key,count,resets_at) VALUES($1,1,now()+interval '15 minutes')", [
    attemptKey,
  ])
  const lock = await db.connect()
  const staleLogin = new Client()
  let pendingLogin
  try {
    await lock.query('BEGIN')
    const lockerPid = (await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid
    await lock.query('SELECT key FROM auth_attempts WHERE key=$1 FOR UPDATE', [attemptKey])
    pendingLogin = staleLogin.request('/auth/login', {
      method: 'POST',
      body: { email, password },
      status: null,
      headers: { 'X-Forwarded-For': '198.51.100.41' },
    })
    const deadline = Date.now() + 5000
    let blocked = false
    while (Date.now() < deadline) {
      blocked = (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'DELETE FROM auth_attempts%') blocked",
          [lockerPid],
        )
      ).rows[0].blocked
      if (blocked) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.ok(blocked, 'Login reached session issuance after checking its old password')
    await anonymous.request('/auth/reset-password', {
      method: 'POST',
      body: { token: resetToken, password: 'FoodLink-new-race-password-2026!' },
      headers: { 'X-Forwarded-For': '198.51.100.42' },
    })
    await lock.query('COMMIT')
    const response = await pendingLogin
    assert.equal(response.status, 401, 'A verified but stale password cannot create a session')
    assert.equal(staleLogin.cookie, '')
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1', [userId])).rows[0].n,
      0,
    )
    const current = new Client()
    await current.request('/auth/login', {
      method: 'POST',
      body: { email, password: 'FoodLink-new-race-password-2026!' },
      headers: { 'X-Forwarded-For': '198.51.100.43' },
    })
  } finally {
    await lock.query('ROLLBACK')
    lock.release()
    await pendingLogin
  }
})

test('report totals include the entire period when detail rows are capped', async () => {
  const itemId = randomUUID()
  let orderIds = []
  try {
    await db.query(
      "INSERT INTO items(id,name,qty,unit,storage,donor_id,status,weight_grams) VALUES($1,'Report fixture',0,'pack','ambient',$2,'exhausted',500)",
      [itemId, donor.user.id],
    )
    orderIds = (
      await db.query(
        "INSERT INTO orders(user_id,type,status,payment_status,completed_at,total_cents) SELECT $1,'recipient-reservation','picked-up','not-required','2001-01-03T12:00:00Z',0 FROM generate_series(1,2001) RETURNING id",
        [recipient.user.id],
      )
    ).rows.map((row) => row.id)
    await db.query(
      "INSERT INTO order_items(order_id,item_id,qty,name_snapshot,unit_snapshot,price_cents,weight_grams) SELECT unnest($1::uuid[]),$2,1,'Report fixture','pack',0,500",
      [orderIds, itemId],
    )
    const report = (await admin.request('/reports?from=2001-01-03&to=2001-01-03')).data
    assert.equal(report.completedOrders, 2001)
    assert.equal(report.kgDistributed, 1000.5)
    assert.equal(report.mealsDistributed, 2001)
    assert.equal(report.orders.length, 2000)
    assert.equal(report.truncated, true)
    assert.ok(report.orders.every((order) => !('userName' in order) && !('deliveryAddress' in order)))
  } finally {
    await db.query('DELETE FROM order_items WHERE order_id=ANY($1::uuid[])', [orderIds])
    await db.query('DELETE FROM orders WHERE id=ANY($1::uuid[])', [orderIds])
    await db.query('DELETE FROM items WHERE id=$1', [itemId])
  }
})

test('staff assignment options filter before pagination and expose only active verified staff', async () => {
  const prefix = `assignee-${randomUUID()}`
  const staffId = randomUUID()
  const fixtureIds = [staffId]
  try {
    await db.query(
      "INSERT INTO users(id,email,name,role,email_verified,created_at) VALUES($1,$2,'ZZZ regression volunteer','volunteer',true,'2001-01-01T00:00:00Z')",
      [staffId, `${prefix}@example.test`],
    )
    fixtureIds.push(
      ...(
        await db.query(
          "INSERT INTO users(email,name,role,email_verified) SELECT $1||n||'@example.test','Recent recipient '||n,'recipient',true FROM generate_series(1,201) n RETURNING id",
          [prefix],
        )
      ).rows.map((row) => row.id),
    )
    const inactive = (
      await db.query(
        "INSERT INTO users(email,name,role,email_verified,disabled) VALUES($1,'Unverified volunteer','volunteer',false,false),($2,'Disabled volunteer','volunteer',true,true) RETURNING id",
        [`${prefix}-unverified@example.test`, `${prefix}-disabled@example.test`],
      )
    ).rows.map((row) => row.id)
    fixtureIds.push(...inactive)
    const assignees = []
    for (let offset = 0; ; offset += 2) {
      const options = (await admin.request(`/admin/assignees?limit=2&offset=${offset}`)).data
      assignees.push(...options)
      if (options.length < 2) break
    }
    assert.ok(
      assignees.some((person) => person.id === staffId),
      'Older volunteers remain selectable after 200 newer recipients',
    )
    assert.ok(assignees.every((person) => !inactive.includes(person.id)))
    assert.ok(assignees.every((person) => Object.keys(person).sort().join(',') === 'id,name'))
    await volunteer.request('/admin/assignees', { status: 403 })
    await anonymous.request('/admin/assignees', { status: 401 })
  } finally {
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [fixtureIds])
  }
})

async function concurrentAccount(role) {
  const client = new Client()
  const userId = randomUUID()
  const email = `concurrency-${userId}@example.test`
  const raw = Buffer.from(randomUUID() + randomUUID())
    .toString('base64url')
    .slice(0, 43)
  client.csrf = randomUUID()
  client.cookie = `foodlink_session=${raw}`
  client.user = { id: userId, email, role }
  await db.query(
    "INSERT INTO users(id,email,name,role,password_hash,email_verified,verified,address) SELECT $1,$2,'Concurrency fixture',$3,password_hash,true,true,'Private fixture address' FROM users WHERE id=$4",
    [userId, email, role, donor.user.id],
  )
  await db.query(
    "INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [createHash('sha256').update(raw).digest('hex'), userId, client.csrf],
  )
  return client
}

async function blockedRequestPid(blockerPid, queryPattern) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await db.query(
      'SELECT pid,pg_blocking_pids(pid) blockers,query LIKE $1 matches FROM pg_stat_activity WHERE datname=current_database()',
      [queryPattern],
    )
    const blockers = new Map(result.rows.map((row) => [row.pid, row.blockers]))
    const reachesBlocker = (pid, seen = new Set()) => {
      if (pid === blockerPid) return true
      if (seen.has(pid)) return false
      seen.add(pid)
      return (blockers.get(pid) || []).some((parent) => reachesBlocker(parent, seen))
    }
    // PostgreSQL can queue a second tuple-lock waiter behind the first waiter,
    // even though both ultimately wait for this test's held account lock.
    const blocked = result.rows.find(
      (row) => row.pid !== blockerPid && row.matches && reachesBlocker(row.pid),
    )
    if (blocked) return blocked.pid
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`Expected a blocked request matching ${queryPattern}`)
}

test('deactivation waits for an in-flight reservation and privacy completion preserves active records', async () => {
  const account = await concurrentAccount('recipient')
  const stock = await received(1, 'Privacy serialization')
  const distribution = (
    await admin.request('/events', {
      method: 'POST',
      status: 201,
      body: {
        startsAt: future(48),
        endsAt: future(50),
        cutoffAt: future(47),
        location: 'Privacy regression hub',
        capacity: 5,
        allowDelivery: true,
      },
    })
  ).data
  const lock = await db.connect()
  let reservation, deactivation
  try {
    await lock.query('BEGIN')
    const blockerPid = (await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid
    await lock.query("SELECT pg_advisory_xact_lock(hashtext('event:'||$1))", [distribution.id])
    reservation = reserve(
      account,
      {
        eventId: distribution.id,
        items: [{ itemId: stock.items[0].id, qty: 1 }],
        fulfillment: 'delivery',
        deliveryAddress: 'Private concurrent delivery address',
      },
      randomUUID(),
      null,
    )
    const reservationPid = await blockedRequestPid(blockerPid, 'SELECT pg_advisory_xact_lock%')
    deactivation = account.request('/auth/deactivate', {
      method: 'POST',
      body: { password, reason: 'Privacy serialization regression' },
      status: null,
    })
    await blockedRequestPid(reservationPid, 'UPDATE users SET disabled=true%')
    assert.equal(
      (await db.query('SELECT disabled FROM users WHERE id=$1', [account.user.id])).rows[0].disabled,
      false,
    )
    await lock.query('COMMIT')
    const reserved = await reservation
    assert.equal(reserved.status, 201)
    assert.equal((await deactivation).status, 200)
    const privacy = (
      await db.query("SELECT id FROM privacy_requests WHERE user_id=$1 AND status='pending'", [
        account.user.id,
      ])
    ).rows[0]
    assert.ok(privacy)
    const refused = await admin.request(`/admin/privacy/${privacy.id}`, {
      method: 'PATCH',
      body: { status: 'completed' },
      status: 409,
    })
    assert.equal(refused.data.error.code, 'ACTIVE_RECORDS')
    await admin.request(`/orders/${reserved.data.id}/cancel`, { method: 'POST', body: {} })
    await admin.request(`/admin/privacy/${privacy.id}`, { method: 'PATCH', body: { status: 'completed' } })
    const stored = (await db.query('SELECT name,address,disabled FROM users WHERE id=$1', [account.user.id]))
      .rows[0]
    assert.deepEqual(stored, { name: 'Former member', address: null, disabled: true })
    assert.equal(
      (await db.query('SELECT delivery_address FROM orders WHERE id=$1', [reserved.data.id])).rows[0]
        .delivery_address,
      null,
    )
  } finally {
    await lock.query('ROLLBACK')
    lock.release()
    await Promise.allSettled([reservation, deactivation].filter(Boolean))
  }
})

test('donation and profile requests authenticated before disable cannot recreate personal records afterward', async () => {
  const account = await concurrentAccount('donor')
  const lock = await db.connect()
  let donation, profile
  try {
    await lock.query('BEGIN')
    const blockerPid = (await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid
    await lock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [account.user.id])
    donation = account.request('/donations', {
      method: 'POST',
      status: null,
      body: {
        items: [
          {
            name: 'Late donation',
            qty: 1,
            unit: 'pack',
            storage: 'ambient',
            weightGrams: 500,
            expiresOn: futureDay(),
          },
        ],
      },
    })
    await blockedRequestPid(blockerPid, 'SELECT id,role,disabled,email_verified FROM users%')
    profile = account.request('/auth/profile', {
      method: 'PATCH',
      status: null,
      body: { name: 'Stale profile name', address: 'Stale private address' },
    })
    await blockedRequestPid(blockerPid, 'UPDATE users SET name=%')
    // Complete the account-state change while both requests hold a stale authenticated snapshot.
    await lock.query("UPDATE users SET disabled=true,name='Former member',address=null WHERE id=$1", [
      account.user.id,
    ])
    await lock.query('DELETE FROM sessions WHERE user_id=$1', [account.user.id])
    await lock.query('COMMIT')
    assert.equal((await donation).status, 401)
    assert.equal((await profile).status, 401)
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM donations WHERE donor_id=$1', [account.user.id])).rows[0]
        .n,
      0,
    )
    assert.deepEqual(
      (await db.query('SELECT name,address FROM users WHERE id=$1', [account.user.id])).rows[0],
      { name: 'Former member', address: null },
    )
  } finally {
    await lock.query('ROLLBACK')
    lock.release()
    await Promise.allSettled([donation, profile].filter(Boolean))
  }
})
