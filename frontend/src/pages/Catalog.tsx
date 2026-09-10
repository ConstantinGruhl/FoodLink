import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Leaf, ShoppingBasket, Snowflake, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, useQuery } from '../lib/hooks'
import { eventSchema, itemSchema, okSchema, orderSchema, type BasketLine, type Item } from '../lib/schemas'
import {
  basketTotal,
  formatDate,
  money,
  setBasketQuantity,
  storageLabel,
  validateBasket,
} from '../lib/format'
import {
  ActionMessages,
  Alert,
  Empty,
  ErrorPanel,
  Field,
  Loading,
  PageHead,
  Pagination,
} from '../components/ui'
import OrderCard from '../components/OrderCard'
function FoodCard({
  item,
  quantity,
  onQuantity,
  currency,
  timezone,
}: {
  item: Item
  quantity: number
  onQuantity: (quantity: number) => void
  currency: string
  timezone: string
}) {
  return (
    <article className="card food-card">
      {item.imageUrl ? (
        <img
          className="food-image"
          src={item.imageUrl}
          alt={item.images.find((x) => x.isPrimary)?.alt || item.name}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <div className="food-placeholder" aria-hidden="true">
          <Leaf size={50} strokeWidth={1.3} />
        </div>
      )}
      <div className="food-content">
        <div className="between">
          <span className="badge">{item.category}</span>
          {item.isSurplus && <strong>{money(item.priceCents, currency)}</strong>}
        </div>
        <h3>{item.name}</h3>
        <p className="small muted">
          {item.qty} {item.unit}
          {item.qty === 1 ? '' : 's'} available ·{' '}
          {item.weightGrams > 0 ? `${item.weightGrams}g each` : 'Weight not recorded'}
        </p>
        <div className="food-meta">
          <span>
            <Snowflake size={15} />
            {storageLabel(item.storage)}
          </span>
          <span>
            <CalendarDays size={15} />
            Until {formatDate(item.expiresOn, timezone)}
          </span>
          <p>
            <strong>Allergens:</strong>{' '}
            {item.allergens.length ? item.allergens.join(', ') : 'None declared; check the label'}
          </p>
          {item.handlingNotes && <p>{item.handlingNotes}</p>}
        </div>
        <div style={{ marginTop: 'auto', paddingTop: '.5rem' }}>
          <label className="field">
            <span>Quantity in basket</span>
            <div className="quantity">
              <button
                className="icon-button"
                type="button"
                disabled={quantity === 0}
                onClick={() => onQuantity(quantity - 1)}
                aria-label={`Remove one ${item.name}`}
              >
                −
              </button>
              <input
                aria-label={`Quantity of ${item.name}`}
                type="number"
                min={0}
                max={item.qty}
                step={1}
                value={quantity}
                onChange={(e) => onQuantity(Number(e.target.value))}
              />
              <button
                className="icon-button"
                type="button"
                disabled={quantity >= item.qty}
                onClick={() => onQuantity(quantity + 1)}
                aria-label={`Add one ${item.name}`}
              >
                +
              </button>
            </div>
          </label>
        </div>
      </div>
    </article>
  )
}
export default function Catalog({ mode }: { mode: 'recipient' | 'buyer' }) {
  const buyer = mode === 'buyer',
    { user, config, refresh } = useAuth(),
    action = useAction(),
    [offset, setOffset] = useState(0)
  const catalog = useQuery(`/items?surplus=${buyer}&limit=50&offset=${offset}`, z.array(itemSchema)),
    events = useQuery('/events?limit=100', z.array(eventSchema))
  const [basket, setBasket] = useState<BasketLine[]>([]),
    [remembered, setRemembered] = useState<Item[]>([]),
    [search, setSearch] = useState(''),
    [storage, setStorage] = useState(''),
    [eventId, setEventId] = useState(''),
    [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup'),
    [address, setAddress] = useState(user?.address || ''),
    [contribution, setContribution] = useState(0),
    [confirmed, setConfirmed] = useState<z.infer<typeof orderSchema> | null>(null)
  const key = useRef(crypto.randomUUID())
  const available = (catalog.data || []).filter((x) => x.isSurplus === buyer),
    allItems = [...available, ...remembered.filter((x) => !available.some((y) => x.id === y.id))],
    activeEvents = (events.data || []).filter(
      (e) =>
        e.status === 'scheduled' &&
        new Date(e.cutoffAt).getTime() > Date.now() &&
        e.reservedCount < e.capacity,
    )
  const selectedEvent = activeEvents.find((e) => e.id === eventId)
  const blocked = !user?.emailVerified || (!buyer && !user.verified) || (buyer && !config.paymentsEnabled)
  function touch() {
    key.current = crypto.randomUUID()
    setConfirmed(null)
  }
  function changeQuantity(item: Item, qty: number) {
    touch()
    setRemembered((prev) => [...prev.filter((x) => x.id !== item.id), item])
    setBasket((prev) => setBasketQuantity(prev, item.id, qty, item.qty))
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      const invalid = validateBasket(basket, allItems)
      if (invalid) throw new Error(invalid)
      if (!selectedEvent) throw new Error('Choose an available collection event.')
      if (fulfillment === 'delivery' && !address.trim()) throw new Error('Add a delivery address.')
      const body = {
        eventId: selectedEvent.id,
        items: basket,
        fulfillment,
        ...(fulfillment === 'delivery' ? { deliveryAddress: address.trim() } : {}),
        ...(buyer ? { supportContributionCents: Math.round(contribution * 100) } : {}),
      }
      if (buyer) {
        const result = await mutation(
          '/orders/checkout',
          z.object({ order: orderSchema, checkoutUrl: z.string().url() }),
          body,
          'POST',
          { 'Idempotency-Key': key.current },
        )
        const checkout = new URL(result.checkoutUrl)
        if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.stripe.com')
          throw new Error(
            'The payment provider returned an unsupported checkout address. Contact the operator.',
          )
        window.location.assign(checkout.href)
      } else {
        const order = await mutation('/orders/reserve', orderSchema, body, 'POST', {
          'Idempotency-Key': key.current,
        })
        setConfirmed(order)
        setBasket([])
        setRemembered([])
        key.current = crypto.randomUUID()
        catalog.reload()
        events.reload()
        action.setSuccess('Your basket is reserved. Your confirmed order and collection details are below.')
      }
    })
  }
  return (
    <>
      <PageHead
        eyebrow={buyer ? 'Released surplus' : 'Recipient workspace'}
        title={buyer ? 'Good food, still to enjoy.' : 'Choose food for your household.'}
        description={
          buyer
            ? 'Browse food released for sale by the operator. Stock is checked again when checkout starts.'
            : 'Build one basket and choose a distribution event. Your reservation is confirmed only after the whole basket is available.'
        }
        action={
          <Link className="btn secondary" to="/orders">
            Order history
          </Link>
        }
      />
      <div className="stack-lg">
        {!user?.emailVerified && (
          <Alert kind="warning">
            Verify your email address before reserving or buying food.{' '}
            <Link to="/profile">Open account settings</Link> to request a new verification email.
          </Alert>
        )}
        {!buyer && !user?.verified && (
          <Alert kind="info">
            <p>
              Your recipient account is awaiting eligibility approval. You can browse food while the team
              reviews it.
            </p>
            <button
              className="btn secondary small"
              style={{ marginTop: '.65rem' }}
              onClick={() => void refresh()}
            >
              Refresh approval status
            </button>
          </Alert>
        )}
        {buyer && !config.paymentsEnabled && (
          <Alert kind="info">
            Surplus purchasing is currently unavailable. The operator has not enabled payment processing. You
            can explore the available food.
          </Alert>
        )}
        <ActionMessages error={action.error} success={action.success} />
        {confirmed && <OrderCard order={confirmed} onChange={() => setConfirmed(null)} />}
        <div className="split">
          <section>
            <div className="filters">
              <input
                className="input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search food on this page"
                placeholder="Search food on this page…"
              />
              <select
                className="input"
                value={storage}
                onChange={(e) => setStorage(e.target.value)}
                aria-label="Filter storage"
              >
                <option value="">All storage types</option>
                <option value="ambient">Room temperature</option>
                <option value="chilled">Chilled</option>
                <option value="frozen">Frozen</option>
              </select>
            </div>
            {catalog.loading ? (
              <Loading label="Finding available food…" />
            ) : catalog.error ? (
              <ErrorPanel error={catalog.error} retry={catalog.reload} />
            ) : available.filter(
                (i) =>
                  i.name.toLowerCase().includes(search.toLowerCase()) && (!storage || i.storage === storage),
              ).length ? (
              <div className="grid two">
                {available
                  .filter(
                    (i) =>
                      i.name.toLowerCase().includes(search.toLowerCase()) &&
                      (!storage || i.storage === storage),
                  )
                  .map((item) => (
                    <FoodCard
                      key={item.id}
                      item={item}
                      quantity={basket.find((x) => x.itemId === item.id)?.qty || 0}
                      onQuantity={(qty) => changeQuantity(item, qty)}
                      currency={config.currency}
                      timezone={config.timezone}
                    />
                  ))}
              </div>
            ) : (
              <div className="card">
                <Empty title="No food available here yet">
                  Try a different filter or check again after the next receiving session.
                </Empty>
              </div>
            )}
            <Pagination offset={offset} count={catalog.data?.length || 0} setOffset={setOffset} />
          </section>
          <aside className="card basket stack">
            <h2 className="row">
              <ShoppingBasket size={24} />
              Your basket
            </h2>
            {!basket.length ? (
              <p className="muted small">Add food using the quantity controls.</p>
            ) : (
              basket.map((line) => {
                const item = allItems.find((x) => x.id === line.itemId)
                return (
                  <div className="basket-line" key={line.itemId}>
                    <div>
                      <strong className="small">{item?.name || 'Unavailable item'}</strong>
                      <div className="quantity" style={{ marginTop: '.4rem' }}>
                        <input
                          type="number"
                          aria-label={`Basket quantity for ${item?.name}`}
                          min={1}
                          max={item?.qty || line.qty}
                          value={line.qty}
                          onChange={(e) => item && changeQuantity(item, Number(e.target.value))}
                        />
                        <span className="small muted">{item?.unit}</span>
                      </div>
                      {buyer && (
                        <span className="small">
                          {money((item?.priceCents || 0) * line.qty, config.currency)}
                        </span>
                      )}
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${item?.name} from basket`}
                      onClick={() => {
                        touch()
                        setBasket(basket.filter((x) => x.itemId !== line.itemId))
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )
              })
            )}
            <form className="stack" onSubmit={submit}>
              {events.loading ? (
                <Loading label="Loading events…" />
              ) : events.error ? (
                <ErrorPanel error={events.error} retry={events.reload} />
              ) : !activeEvents.length ? (
                <Alert kind="info">
                  No distribution events are open for reservations. The team will publish the next collection
                  here.
                </Alert>
              ) : (
                <Field label="Collection event" required>
                  <select
                    required
                    value={eventId}
                    onChange={(e) => {
                      touch()
                      setEventId(e.target.value)
                      setFulfillment('pickup')
                    }}
                  >
                    <option value="">Choose a collection…</option>
                    {activeEvents.map((event) => (
                      <option value={event.id} key={event.id}>
                        {formatDate(event.startsAt, event.timezone, true)} · {event.location}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {selectedEvent && (
                <div className="panel small stack" style={{ gap: '.3rem' }}>
                  <strong>{selectedEvent.location}</strong>
                  <p>
                    {formatDate(selectedEvent.startsAt, selectedEvent.timezone, true)} –{' '}
                    {formatDate(selectedEvent.endsAt, selectedEvent.timezone, true)}
                  </p>
                  <p>Reserve by {formatDate(selectedEvent.cutoffAt, selectedEvent.timezone, true)}.</p>
                  <p>{selectedEvent.capacity - selectedEvent.reservedCount} collection slots left.</p>
                </div>
              )}
              {selectedEvent?.allowDelivery && (
                <Field label="How to receive your food">
                  <select
                    value={fulfillment}
                    onChange={(e) => {
                      touch()
                      setFulfillment(e.target.value as 'pickup' | 'delivery')
                    }}
                  >
                    <option value="pickup">Collect at the event</option>
                    <option value="delivery">Request delivery</option>
                  </select>
                </Field>
              )}
              {fulfillment === 'delivery' && (
                <Field
                  label="Delivery address"
                  hint="Shared with the staff and assigned volunteer handling your delivery."
                  required
                >
                  <textarea
                    value={address}
                    onChange={(e) => {
                      touch()
                      setAddress(e.target.value)
                    }}
                    maxLength={500}
                    required
                  />
                </Field>
              )}
              {buyer && (
                <>
                  <Field label={`Optional support contribution (${config.currency})`}>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step="0.01"
                      value={contribution}
                      onChange={(e) => {
                        touch()
                        setContribution(Number(e.target.value))
                      }}
                    />
                  </Field>
                  <div className="between">
                    <strong>Total</strong>
                    <strong>
                      {money(basketTotal(basket, allItems) + Math.round(contribution * 100), config.currency)}
                    </strong>
                  </div>
                </>
              )}
              <button
                className="btn block"
                disabled={action.pending || blocked || !basket.length || !selectedEvent}
              >
                {action.pending
                  ? 'Confirming availability…'
                  : buyer
                    ? 'Continue to secure payment'
                    : 'Reserve basket'}
              </button>
              <p className="small muted">
                {buyer
                  ? 'Payment is completed with the configured provider. Your order status changes only after the provider confirms it.'
                  : 'Please collect within your event window. Cancel from your order history if your plans change.'}
              </p>
            </form>
          </aside>
        </div>
      </div>
    </>
  )
}
