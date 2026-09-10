import { test } from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { createPaymentService, PaymentError } from '../dist/payments.js'

const settings = {
  paymentsEnabled: true,
  stripeKey: 'sk_test_offline_fixture',
  stripeWebhookSecret: 'whsec_offline_fixture',
  currency: 'EUR',
  publicAppUrl: 'http://localhost:5173',
}
const order = {
  id: 'e2dd721d-e710-4dc6-8dc1-bc4e8d984e99',
  totalCents: 250,
  supportContributionCents: 50,
  items: [{ name: 'Apples', qty: 2, priceCents: 100 }],
  expiresAt: '2030-01-01T12:00:00Z',
}
const session = {
  id: 'cs_test_fixture',
  url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
  payment_intent: null,
  expires_at: 1893499200,
}
function provider(overrides = {}) {
  return {
    createSession: async () => session,
    expireSession: async () => ({}),
    retrieveSession: async () => ({ status: 'expired' }),
    createRefund: async () => ({ id: 're_fixture', status: 'pending' }),
    retrieveRefund: async () => ({ id: 're_fixture', status: 'succeeded' }),
    constructEvent: (raw, signature, secret, tolerance) =>
      new Stripe('sk_test_offline').webhooks.constructEvent(raw, signature, secret, tolerance),
    ...overrides,
  }
}

test('disabled payments refuse checkout/refund/webhooks without contacting a provider', async () => {
  let calls = 0
  const service = createPaymentService(
    { ...settings, paymentsEnabled: false },
    provider({
      createSession: async () => {
        calls++
        return session
      },
    }),
  )
  await assert.rejects(
    service.createCheckout(order, 'buyer@example.invalid'),
    (e) => e instanceof PaymentError && e.status === 503,
  )
  await assert.rejects(service.refundPayment('pi_fixture', order.id), { code: 'PAYMENTS_DISABLED' })
  assert.throws(() => service.verifyWebhook(Buffer.from('{}'), 'invalid'), { code: 'PAYMENTS_DISABLED' })
  assert.equal(calls, 0)
})

test('checkout uses snapshot amounts and stable provider idempotency for retries', async () => {
  const calls = []
  const service = createPaymentService(
    settings,
    provider({
      createSession: async (params, options) => {
        calls.push({ params, options })
        return session
      },
    }),
  )
  const result = await service.createCheckout(order, 'buyer@example.invalid')
  await service.createCheckout(order, 'buyer@example.invalid')
  assert.deepEqual(calls[0], calls[1])
  assert.equal(calls[0].params.line_items[0].price_data.currency, 'eur')
  assert.equal(calls[0].params.line_items[0].quantity, 2)
  assert.equal(calls[0].params.line_items[1].price_data.unit_amount, 50)
  assert.equal(calls[0].params.client_reference_id, order.id)
  assert.equal(calls[0].options.idempotencyKey, `foodlink:checkout:${order.id}`)
  assert.equal(new URL(calls[0].params.success_url).searchParams.get('checkout'), 'returned')
  assert.equal(result.url, session.url)
  assert.equal(result.paymentIntent, undefined)
})

test('checkout rejects tampered totals, fractional quantities and negative support before provider call', async () => {
  let calls = 0
  const service = createPaymentService(
    settings,
    provider({
      createSession: async () => {
        calls++
        return session
      },
    }),
  )
  await assert.rejects(service.createCheckout({ ...order, totalCents: 1 }, 'buyer@example.invalid'), {
    code: 'PAYMENT_TOTAL_MISMATCH',
  })
  await assert.rejects(
    service.createCheckout({ ...order, supportContributionCents: -1 }, 'buyer@example.invalid'),
    { code: 'INVALID_PAYMENT_AMOUNT' },
  )
  await assert.rejects(
    service.createCheckout(
      { ...order, items: [{ name: 'Apples', qty: 1.5, priceCents: 100 }] },
      'buyer@example.invalid',
    ),
    { code: 'INVALID_PAYMENT_AMOUNT' },
  )
  assert.equal(calls, 0)
})

test('provider redirect must be HTTPS on the configured Stripe hosted checkout domain', async () => {
  for (const url of [
    'invalid-url',
    'javascript:alert(1)',
    'http://checkout.stripe.com/x',
    'https://checkout.stripe.com.evil.invalid/x',
    'https://user:password@checkout.stripe.com/x',
    null,
  ]) {
    const service = createPaymentService(
      settings,
      provider({ createSession: async () => ({ ...session, url }) }),
    )
    await assert.rejects(service.createCheckout(order, 'buyer@example.invalid'), (e) => e.status === 502)
  }
})

function signedEvent(timestamp = Math.floor(Date.now() / 1000), changes = {}) {
  const raw = Buffer.from(
    JSON.stringify({
      id: 'evt_fixture',
      object: 'event',
      type: 'checkout.session.completed',
      livemode: false,
      data: { object: { id: session.id } },
      ...changes,
    }),
  )
  const signature = new Stripe(settings.stripeKey).webhooks.generateTestHeaderString({
    payload: raw.toString(),
    secret: settings.stripeWebhookSecret,
    timestamp,
  })
  return { raw, signature }
}

test('official SDK verifies raw signed events, accepts rotated signatures and rejects changed payload', () => {
  const service = createPaymentService(settings, provider())
  const { raw, signature } = signedEvent()
  assert.equal(service.verifyWebhook(raw, signature).id, 'evt_fixture')
  assert.equal(service.verifyWebhook(raw, `${signature},v1=${'0'.repeat(64)}`).id, 'evt_fixture')
  assert.throws(() => service.verifyWebhook(Buffer.concat([raw, Buffer.from(' ')]), signature), {
    code: 'INVALID_PAYMENT_SIGNATURE',
  })
  assert.throws(() => service.verifyWebhook(raw, signature.replace('v1=', 'v0=')), {
    code: 'INVALID_PAYMENT_SIGNATURE',
  })
})

test('stale/future signatures and live-mode mismatches are rejected', () => {
  const service = createPaymentService(settings, provider())
  for (const timestamp of [Math.floor(Date.now() / 1000) - 301, Math.floor(Date.now() / 1000) + 600]) {
    const { raw, signature } = signedEvent(timestamp)
    assert.throws(() => service.verifyWebhook(raw, signature), { code: 'INVALID_PAYMENT_SIGNATURE' })
  }
  const { raw, signature } = signedEvent(undefined, { livemode: true })
  assert.throws(() => service.verifyWebhook(raw, signature), { code: 'INVALID_PAYMENT_SIGNATURE' })
})

test('refund requests reuse one idempotency key and preserve pending outcome', async () => {
  const calls = []
  const service = createPaymentService(
    settings,
    provider({
      createRefund: async (params, options) => {
        calls.push({ params, options })
        return { id: 're_fixture', status: 'pending' }
      },
    }),
  )
  assert.deepEqual(await service.refundPayment('pi_fixture', order.id), {
    id: 're_fixture',
    status: 'pending',
  })
  await service.refundPayment('pi_fixture', order.id)
  assert.deepEqual(calls[0], calls[1])
  assert.equal(calls[0].params.payment_intent, 'pi_fixture')
})

test('checkout expiration retries tolerate expired sessions but reject completed payments', async () => {
  const failure = new Error('session no longer open')
  const expired = createPaymentService(
    settings,
    provider({
      expireSession: async () => {
        throw failure
      },
    }),
  )
  await expired.expireCheckout(session.id)
  const completed = createPaymentService(
    settings,
    provider({
      expireSession: async () => {
        throw failure
      },
      retrieveSession: async () => ({ status: 'complete' }),
    }),
  )
  await assert.rejects(completed.expireCheckout(session.id), { code: 'PAYMENT_ALREADY_COMPLETED' })
  const offline = createPaymentService(
    settings,
    provider({
      expireSession: async () => {
        throw failure
      },
      retrieveSession: async () => ({ status: 'open' }),
    }),
  )
  await assert.rejects(offline.expireCheckout(session.id), failure)
})

test('refund reconciliation retrieves current state and uses a new key only for an explicit retry attempt', async () => {
  const keys = []
  const service = createPaymentService(
    settings,
    provider({
      createRefund: async (_params, options) => {
        keys.push(options.idempotencyKey)
        return { id: 're_retry_fixture', status: 'pending' }
      },
      retrieveRefund: async (id) => ({ id, status: 'succeeded' }),
    }),
  )
  await service.refundPayment('pi_fixture', order.id, 0)
  await service.refundPayment('pi_fixture', order.id, 1)
  await service.refundPayment('pi_fixture', order.id, 1)
  assert.deepEqual(keys, [
    `foodlink:refund:${order.id}`,
    `foodlink:refund:${order.id}:1`,
    `foodlink:refund:${order.id}:1`,
  ])
  assert.deepEqual(await service.retrieveRefund('re_retry_fixture'), {
    id: 're_retry_fixture',
    status: 'succeeded',
  })
  await assert.rejects(service.retrieveRefund('../invalid'), { code: 'INVALID_REFUND' })
  await assert.rejects(service.refundPayment('pi_fixture', order.id, -1), { code: 'INVALID_REFUND' })
})
