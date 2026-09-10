import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { createHmac, randomUUID, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire('/app/package.json')
const { Pool } = require('pg')
const databaseUrl = process.env.TEST_DATABASE_URL
const base = process.env.TEST_API_URL || 'http://payments-backend:8080/api'
if (
  !databaseUrl ||
  new URL(databaseUrl).pathname !== '/foodlink_test' ||
  new URL(base).hostname !== 'payments-backend'
) {
  throw new Error(
    'Payment webhook tests require the isolated foodlink_test database and payments-backend container.',
  )
}
const db = new Pool({ connectionString: databaseUrl })
const secret = 'whsec_offline_fixture'
let buyerId, donorId, eventId

before(async () => {
  const key = randomUUID()
  buyerId = (
    await db.query(
      "INSERT INTO users(email,name,role,verified,email_verified) VALUES($1,'Payment test buyer','buyer',true,true) RETURNING id",
      [`payment-buyer-${key}@example.invalid`],
    )
  ).rows[0].id
  donorId = (
    await db.query(
      "INSERT INTO users(email,name,role,verified,email_verified) VALUES($1,'Payment test donor','donor',true,true) RETURNING id",
      [`payment-donor-${key}@example.invalid`],
    )
  ).rows[0].id
  eventId = (
    await db.query(
      "INSERT INTO events(date,location,pickup_window,starts_at,ends_at,cutoff_at,capacity) VALUES(now()+interval '2 days','Payment test event','10:00-12:00',now()+interval '2 days',now()+interval '2 days 2 hours',now()+interval '1 day',100) RETURNING id",
    )
  ).rows[0].id
})
after(async () => {
  await db.end()
})

async function pendingOrder() {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const itemId = (
      await client.query(
        "INSERT INTO items(name,qty,unit,storage,donor_id,status,is_surplus,price_cents,weight_grams) VALUES('Payment fixture',3,'pack','ambient',$1,'available',true,200,500) RETURNING id",
        [donorId],
      )
    ).rows[0].id
    const sessionId = `cs_test_${randomUUID().replaceAll('-', '')}`
    const orderId = (
      await client.query(
        "INSERT INTO orders(user_id,type,status,event_id,total_cents,support_contribution_cents,payment_status,pickup_token,expires_at,stripe_session_id) VALUES($1,'buyer-order','pending',$2,400,0,'pending',$3,now()+interval '35 minutes',$4) RETURNING id",
        [buyerId, eventId, randomBytes(32).toString('base64url'), sessionId],
      )
    ).rows[0].id
    await client.query(
      "INSERT INTO order_items(order_id,item_id,qty,name_snapshot,unit_snapshot,price_cents,weight_grams) VALUES($1,$2,2,'Payment fixture','pack',200,500)",
      [orderId, itemId],
    )
    await client.query("INSERT INTO inventory_movements(item_id,delta,kind) VALUES($1,5,'opening')", [itemId])
    await client.query(
      "INSERT INTO inventory_movements(item_id,delta,kind,order_id) VALUES($1,-2,'reserve',$2)",
      [itemId, orderId],
    )
    await client.query('COMMIT')
    return { orderId, itemId, sessionId, intentId: `pi_${randomUUID().replaceAll('-', '')}` }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function eventFor(fixture, type = 'checkout.session.completed', changes = {}, eventIdOverride) {
  return {
    id: eventIdOverride || `evt_${randomUUID().replaceAll('-', '')}`,
    object: 'event',
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: fixture.sessionId,
        object: 'checkout.session',
        client_reference_id: fixture.orderId,
        metadata: { orderId: fixture.orderId },
        mode: 'payment',
        amount_total: 400,
        currency: 'eur',
        payment_status: 'paid',
        payment_intent: fixture.intentId,
        ...changes,
      },
    },
  }
}

async function webhook(event, { signatureOverride, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(event)
  const signature =
    signatureOverride ??
    `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`
  const response = await fetch(`${base}/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
    body: raw,
    signal: AbortSignal.timeout(15000),
  })
  return { status: response.status, data: await response.json() }
}
async function state(fixture) {
  return (
    await db.query(
      'SELECT status,payment_status,stripe_payment_intent,(SELECT qty FROM items WHERE id=$2) AS qty FROM orders WHERE id=$1',
      [fixture.orderId, fixture.itemId],
    )
  ).rows[0]
}

test('forged or stale webhooks cannot change order or inventory', async () => {
  const fixture = await pendingOrder()
  assert.equal((await webhook(eventFor(fixture), { signatureOverride: 't=1,v1=bad' })).status, 400)
  assert.equal(
    (await webhook(eventFor(fixture), { timestamp: Math.floor(Date.now() / 1000) - 600 })).status,
    400,
  )
  assert.deepEqual(await state(fixture), {
    status: 'pending',
    payment_status: 'pending',
    stripe_payment_intent: null,
    qty: 3,
  })
})

test('signed payment must match stored amount, currency, session and order identity', async () => {
  for (const changes of [
    { amount_total: 1 },
    { currency: 'usd' },
    { id: 'cs_test_unrelated' },
    { client_reference_id: randomUUID() },
    { mode: 'subscription' },
  ]) {
    const fixture = await pendingOrder()
    const result = await webhook(eventFor(fixture, 'checkout.session.completed', changes))
    assert.ok(
      [400, 409].includes(result.status),
      `Mismatch should be rejected: ${JSON.stringify(changes)} => ${JSON.stringify(result)}`,
    )
    assert.equal((await state(fixture)).payment_status, 'pending')
    assert.equal((await state(fixture)).qty, 3)
  }
})

test('paid webhook confirms once; replay or later expiry cannot cancel paid stock', async () => {
  const fixture = await pendingOrder()
  const event = eventFor(fixture)
  assert.equal((await webhook(event)).status, 200)
  assert.deepEqual(await state(fixture), {
    status: 'confirmed',
    payment_status: 'paid',
    stripe_payment_intent: fixture.intentId,
    qty: 3,
  })
  const notificationsBefore = Number(
    (await db.query('SELECT count(*) FROM notifications WHERE user_id=$1', [buyerId])).rows[0].count,
  )
  assert.equal((await webhook(event)).status, 200)
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  assert.equal(
    (await webhook(eventFor(fixture, 'checkout.session.expired', { payment_status: 'unpaid' }))).status,
    200,
  )
  assert.equal((await state(fixture)).status, 'confirmed')
  assert.equal((await state(fixture)).qty, 3)
  assert.equal(
    Number((await db.query('SELECT count(*) FROM notifications WHERE user_id=$1', [buyerId])).rows[0].count),
    notificationsBefore,
  )
})

test('unpaid checkout completion does not confirm until asynchronous success', async () => {
  const fixture = await pendingOrder()
  assert.equal(
    (await webhook(eventFor(fixture, 'checkout.session.completed', { payment_status: 'unpaid' }))).status,
    200,
  )
  assert.equal((await state(fixture)).status, 'pending')
  assert.equal((await webhook(eventFor(fixture, 'checkout.session.async_payment_succeeded'))).status, 200)
  assert.equal((await state(fixture)).payment_status, 'paid')
})

test('failed or expired pending checkout restores stock exactly once', async () => {
  for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed']) {
    const fixture = await pendingOrder()
    const event = eventFor(fixture, type, { payment_status: 'unpaid' })
    assert.equal((await webhook(event)).status, 200)
    assert.equal((await state(fixture)).qty, 5)
    assert.ok(['expired', 'cancelled'].includes((await state(fixture)).status))
    assert.equal((await webhook(event)).status, 200)
    assert.equal((await webhook(eventFor(fixture, type, { payment_status: 'unpaid' }))).status, 200)
    assert.equal((await state(fixture)).qty, 5)
  }
})

test('payment after the hold expires queues a refund without resurrecting inventory', async () => {
  const fixture = await pendingOrder()
  await db.query("UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1", [fixture.orderId])
  const event = eventFor(fixture)
  assert.equal((await webhook(event)).status, 200)
  assert.deepEqual(await state(fixture), {
    status: 'expired',
    payment_status: 'refund-pending',
    stripe_payment_intent: fixture.intentId,
    qty: 5,
  })
  const notificationsBefore = Number(
    (await db.query('SELECT count(*) FROM notifications WHERE user_id=$1', [buyerId])).rows[0].count,
  )
  assert.equal((await webhook(event)).status, 200)
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  assert.equal((await state(fixture)).qty, 5)
  assert.equal(
    Number((await db.query('SELECT count(*) FROM notifications WHERE user_id=$1', [buyerId])).rows[0].count),
    notificationsBefore,
  )
})

function refundEvent(fixture, amount = 400, status = 'succeeded') {
  return {
    id: `evt_${randomUUID().replaceAll('-', '')}`,
    object: 'event',
    type: 'refund.updated',
    livemode: false,
    data: {
      object: {
        id: `re_${randomUUID().replaceAll('-', '')}`,
        object: 'refund',
        payment_intent: fixture.intentId,
        amount,
        currency: 'eur',
        status,
        metadata: { orderId: fixture.orderId },
      },
    },
  }
}

test('refund updates release uncollected inventory exactly once and cannot be reversed by payment replay', async () => {
  const fixture = await pendingOrder()
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  const event = refundEvent(fixture)
  assert.equal((await webhook(event)).status, 200)
  assert.deepEqual(await state(fixture), {
    status: 'cancelled',
    payment_status: 'refunded',
    stripe_payment_intent: fixture.intentId,
    qty: 5,
  })
  assert.equal((await webhook(event)).status, 200)
  assert.equal((await webhook(refundEvent(fixture))).status, 200)
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  assert.equal((await state(fixture)).qty, 5)
  assert.equal((await state(fixture)).payment_status, 'refunded')
})

test('refund of a collected order preserves its completed fulfillment and distributed stock', async () => {
  const fixture = await pendingOrder()
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  await db.query("UPDATE orders SET status='picked-up',completed_at=now(),pickup_token=NULL WHERE id=$1", [
    fixture.orderId,
  ])
  assert.equal((await webhook(refundEvent(fixture))).status, 200)
  assert.equal((await state(fixture)).status, 'picked-up')
  assert.equal((await state(fixture)).payment_status, 'refunded')
  assert.equal((await state(fixture)).qty, 3)
})

test('pending or failed refund blocks collection until reconciliation and validates the amount', async () => {
  const fixture = await pendingOrder()
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  assert.equal((await webhook(refundEvent(fixture, 401))).status, 400)
  assert.equal((await state(fixture)).payment_status, 'paid')
  assert.equal((await webhook(refundEvent(fixture, 400, 'pending'))).status, 200)
  assert.equal((await state(fixture)).payment_status, 'refund-pending')
  assert.equal((await state(fixture)).qty, 5)
  assert.equal((await webhook(refundEvent(fixture, 400, 'failed'))).status, 200)
  assert.equal((await state(fixture)).payment_status, 'refund-pending')
  assert.equal((await state(fixture)).qty, 5)
  assert.equal((await webhook(refundEvent(fixture))).status, 200)
  assert.equal((await state(fixture)).payment_status, 'refunded')
})

test('refund received before payment confirmation remains refunded after delayed confirmation', async () => {
  const fixture = await pendingOrder()
  assert.equal((await webhook(refundEvent(fixture))).status, 200)
  assert.deepEqual(await state(fixture), {
    status: 'cancelled',
    payment_status: 'refunded',
    stripe_payment_intent: fixture.intentId,
    qty: 5,
  })
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  assert.equal((await state(fixture)).payment_status, 'refunded')
  assert.equal((await state(fixture)).qty, 5)
})

test('partial refund queues the remaining balance without misreporting a full refund', async () => {
  const fixture = await pendingOrder()
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  assert.equal((await webhook(refundEvent(fixture, 100))).status, 200)
  const record = (
    await db.query('SELECT payment_status,refund_id FROM orders WHERE id=$1', [fixture.orderId])
  ).rows[0]
  assert.deepEqual(record, { payment_status: 'refund-pending', refund_id: null })
  assert.equal((await state(fixture)).qty, 5)
  const remaining = refundEvent(fixture, 300)
  await db.query("UPDATE orders SET refund_id=$2,refund_status='pending' WHERE id=$1", [
    fixture.orderId,
    remaining.data.object.id,
  ])
  assert.equal((await webhook(remaining)).status, 200)
  assert.equal((await state(fixture)).payment_status, 'refunded')
})

test('administrator retry preserves attempt identity and ignores superseded failed-refund events', async () => {
  const fixture = await pendingOrder()
  assert.equal((await webhook(eventFor(fixture))).status, 200)
  const failed = refundEvent(fixture, 400, 'failed')
  assert.equal((await webhook(failed)).status, 200)
  let record = (
    await db.query('SELECT refund_id,refund_status,refund_attempt,refund_next_at FROM orders WHERE id=$1', [
      fixture.orderId,
    ])
  ).rows[0]
  assert.equal(record.refund_id, failed.data.object.id)
  assert.equal(record.refund_status, 'failed')
  assert.equal(record.refund_next_at, null)

  const origin = 'http://localhost:5173'
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: 'admin@email.com', password: process.env.TEST_PASSWORD }),
  })
  assert.equal(login.status, 200)
  const session = await login.json()
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const retry = () =>
    fetch(`${base}/admin/refunds/${fixture.orderId}/retry`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookie,
        'X-CSRF-Token': session.csrfToken,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  assert.equal((await retry()).status, 200)
  assert.equal((await retry()).status, 200)
  record = (
    await db.query(
      'SELECT refund_id,refund_status,refund_attempt,superseded_refund_ids FROM orders WHERE id=$1',
      [fixture.orderId],
    )
  ).rows[0]
  assert.equal(record.refund_attempt, 1)
  assert.equal(record.refund_id, null)
  assert.equal(record.refund_status, null)
  assert.deepEqual(record.superseded_refund_ids, [failed.data.object.id])
  failed.id = `evt_${randomUUID().replaceAll('-', '')}`
  assert.equal((await webhook(failed)).status, 200)
  assert.equal(
    (await db.query('SELECT refund_status FROM orders WHERE id=$1', [fixture.orderId])).rows[0].refund_status,
    null,
  )
  assert.equal((await state(fixture)).qty, 5)
})
