import Stripe from 'stripe'
import { config } from './config.js'
import { ApiError } from './http.js'

export class PaymentError extends ApiError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message)
    this.name = 'PaymentError'
  }
}

export interface PaymentSettings {
  paymentsEnabled: boolean
  stripeKey?: string
  stripeWebhookSecret?: string
  currency: string
  publicAppUrl: string
}

export interface CheckoutOrder {
  id: string
  totalCents: number
  supportContributionCents: number
  items: { name: string; qty: number; priceCents: number }[]
  /** Persist this deadline before the provider call so idempotent retries have identical parameters. */
  expiresAt?: string
}

type CheckoutResult = Pick<Stripe.Checkout.Session, 'id' | 'url' | 'payment_intent' | 'expires_at'>
type RefundResult = Pick<Stripe.Refund, 'id' | 'status'>

/** Narrow adapter keeps tests offline while using the official SDK for all provider operations. */
export interface PaymentClient {
  createSession(
    params: Stripe.Checkout.SessionCreateParams,
    options: Stripe.RequestOptions,
  ): Promise<CheckoutResult>
  expireSession(id: string, options: Stripe.RequestOptions): Promise<unknown>
  retrieveSession(id: string): Promise<Pick<Stripe.Checkout.Session, 'status'>>
  createRefund(params: Stripe.RefundCreateParams, options: Stripe.RequestOptions): Promise<RefundResult>
  retrieveRefund(id: string): Promise<RefundResult>
  constructEvent(raw: Buffer, signature: string, secret: string, tolerance: number): Stripe.Event
}

function sdkClient(key: string): PaymentClient {
  const stripe = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 2, telemetry: false })
  return {
    createSession: (params, options) => stripe.checkout.sessions.create(params, options),
    expireSession: (id, options) => stripe.checkout.sessions.expire(id, {}, options),
    retrieveSession: (id) => stripe.checkout.sessions.retrieve(id),
    createRefund: (params, options) => stripe.refunds.create(params, options),
    retrieveRefund: (id) => stripe.refunds.retrieve(id),
    constructEvent: (raw, signature, secret, tolerance) =>
      stripe.webhooks.constructEvent(raw, signature, secret, tolerance),
  }
}

function amount(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 99_999_999) {
    throw new PaymentError(
      400,
      'INVALID_PAYMENT_AMOUNT',
      `${label} must be an integer amount within the supported range.`,
    )
  }
}

export function createPaymentService(settings: PaymentSettings, injected?: PaymentClient) {
  let client = injected
  const enabled = (): PaymentClient => {
    if (!settings.paymentsEnabled || !settings.stripeKey || !settings.stripeWebhookSecret) {
      throw new PaymentError(
        503,
        'PAYMENTS_DISABLED',
        'Online payments are not enabled for this FoodLink installation.',
      )
    }
    client ??= sdkClient(settings.stripeKey)
    return client
  }

  return {
    async createCheckout(order: CheckoutOrder, email: string) {
      const provider = enabled()
      amount(order.totalCents, 'Order total', 1)
      amount(order.supportContributionCents, 'Support contribution')
      if (!order.id || order.items.length < 1 || order.items.length > 99) {
        throw new PaymentError(
          400,
          'INVALID_PAYMENT_ORDER',
          'A checkout requires an order and between 1 and 99 item lines.',
        )
      }
      let computedTotal = order.supportContributionCents
      for (const item of order.items) {
        amount(item.qty, 'Quantity', 1)
        amount(item.priceCents, 'Unit price')
        if (!item.name.trim())
          throw new PaymentError(400, 'INVALID_PAYMENT_ORDER', 'Every checkout line requires a product name.')
        computedTotal += item.qty * item.priceCents
      }
      amount(computedTotal, 'Computed order total', 1)
      if (computedTotal !== order.totalCents) {
        throw new PaymentError(
          409,
          'PAYMENT_TOTAL_MISMATCH',
          'The stored order total does not match its item lines.',
        )
      }

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map((item) => ({
        price_data: {
          currency: settings.currency.toLowerCase(),
          product_data: { name: item.name },
          unit_amount: item.priceCents,
        },
        quantity: item.qty,
      }))
      if (order.supportContributionCents > 0) {
        lineItems.push({
          price_data: {
            currency: settings.currency.toLowerCase(),
            product_data: { name: 'Support contribution' },
            unit_amount: order.supportContributionCents,
          },
          quantity: 1,
        })
      }

      const success = new URL('/orders', settings.publicAppUrl)
      success.searchParams.set('checkout', 'returned')
      success.searchParams.set('order', order.id)
      const cancel = new URL(success)
      cancel.searchParams.set('checkout', 'cancelled')
      let expiresAt: number | undefined
      if (order.expiresAt) {
        expiresAt = Math.floor(new Date(order.expiresAt).getTime() / 1000)
        if (!Number.isSafeInteger(expiresAt)) {
          throw new PaymentError(400, 'INVALID_CHECKOUT_DEADLINE', 'The checkout deadline is invalid.')
        }
      }
      // No client-provided amounts, redirects or metadata reach Stripe. A return URL never confirms payment.
      const session = await provider.createSession(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          client_reference_id: order.id,
          customer_email: email,
          line_items: lineItems,
          metadata: { orderId: order.id },
          payment_intent_data: { metadata: { orderId: order.id } },
          success_url: success.href,
          cancel_url: cancel.href,
          ...(expiresAt ? { expires_at: expiresAt } : {}),
        },
        { idempotencyKey: `foodlink:checkout:${order.id}` },
      )

      if (!session.url)
        throw new PaymentError(
          502,
          'CHECKOUT_UNAVAILABLE',
          'The payment provider did not return a checkout URL.',
        )
      let checkoutUrl: URL
      try {
        checkoutUrl = new URL(session.url)
      } catch {
        throw new PaymentError(
          502,
          'INVALID_CHECKOUT_URL',
          'The payment provider returned an invalid checkout address.',
        )
      }
      if (
        checkoutUrl.protocol !== 'https:' ||
        checkoutUrl.hostname !== 'checkout.stripe.com' ||
        checkoutUrl.username ||
        checkoutUrl.password
      ) {
        throw new PaymentError(
          502,
          'INVALID_CHECKOUT_URL',
          'The payment provider returned an unexpected checkout address.',
        )
      }
      return {
        id: session.id,
        url: session.url,
        paymentIntent:
          typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
        expiresAt: new Date(session.expires_at * 1000).toISOString(),
      }
    },

    verifyWebhook(raw: Buffer, signature: string): Stripe.Event {
      const provider = enabled()
      if (!Buffer.isBuffer(raw) || raw.length > 1_048_576 || !signature) {
        throw new PaymentError(400, 'INVALID_PAYMENT_SIGNATURE', 'Payment signature verification failed.')
      }
      try {
        const timestamps = signature.split(',').filter((part) => part.startsWith('t='))
        const timestamp = Number(timestamps[0]?.slice(2))
        if (
          timestamps.length !== 1 ||
          !Number.isSafeInteger(timestamp) ||
          Math.abs(Date.now() / 1000 - timestamp) > 300
        )
          throw new Error('Timestamp outside tolerance')
        const event = provider.constructEvent(raw, signature, settings.stripeWebhookSecret!, 300)
        if (
          !event.id ||
          !event.type ||
          !event.data?.object ||
          event.livemode !== settings.stripeKey!.includes('_live_')
        )
          throw new Error('Invalid event envelope')
        return event
      } catch {
        throw new PaymentError(400, 'INVALID_PAYMENT_SIGNATURE', 'Payment signature verification failed.')
      }
    },

    async refundPayment(paymentIntent: string, orderId: string, attempt = 0) {
      const provider = enabled()
      if (
        !/^pi_[a-zA-Z0-9_]+$/.test(paymentIntent) ||
        !orderId ||
        !Number.isSafeInteger(attempt) ||
        attempt < 0 ||
        attempt > 1000
      )
        throw new PaymentError(
          400,
          'INVALID_REFUND',
          'A refund requires the original payment, order and valid attempt.',
        )
      const refund = await provider.createRefund(
        {
          payment_intent: paymentIntent,
          reason: 'requested_by_customer',
          metadata: { orderId },
        },
        { idempotencyKey: `foodlink:refund:${orderId}${attempt ? `:${attempt}` : ''}` },
      )
      // A pending refund must remain pending until a later provider event/reconciliation succeeds.
      return { id: refund.id, status: refund.status ?? 'pending' }
    },

    async retrieveRefund(refundId: string) {
      const provider = enabled()
      if (!/^re_[A-Za-z0-9_]+$/.test(refundId))
        throw new PaymentError(400, 'INVALID_REFUND', 'A valid refund reference is required.')
      const refund = await provider.retrieveRefund(refundId)
      return { id: refund.id, status: refund.status ?? 'pending' }
    },

    async expireCheckout(sessionId: string): Promise<void> {
      const provider = enabled()
      try {
        await provider.expireSession(sessionId, { idempotencyKey: `foodlink:expire:${sessionId}` })
      } catch (error) {
        // Retries after a successful expiration are safe; a completed payment must be reconciled/refunded.
        const session = await provider.retrieveSession(sessionId)
        if (session.status === 'expired') return
        if (session.status === 'complete')
          throw new PaymentError(
            409,
            'PAYMENT_ALREADY_COMPLETED',
            'Payment completed before cancellation; wait for confirmation and request a refund.',
          )
        throw error
      }
    },
  }
}

const service = createPaymentService(config)
export const createCheckout = service.createCheckout
export const verifyWebhook = service.verifyWebhook
export const refundPayment = service.refundPayment
export const retrieveRefund = service.retrieveRefund
export const expireCheckout = service.expireCheckout
