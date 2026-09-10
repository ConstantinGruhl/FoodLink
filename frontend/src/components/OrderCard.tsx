import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Printer } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { mutation } from '../lib/api'
import { useAction } from '../lib/hooks'
import { orderSchema, type Order } from '../lib/schemas'
import { formatDate, printRecord, money, shortId } from '../lib/format'
import { ActionMessages, Badge } from './ui'
function Ticket({ token }: { token: string }) {
  const [url, setUrl] = useState(''),
    action = useAction()
  useEffect(() => {
    let active = true
    QRCode.toDataURL(token, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
      .then((image) => {
        if (active) setUrl(image)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [token])
  return (
    <div className="ticket">
      {url && <img src={url} alt="Collection QR code for staff verification" />}
      <div className="stack" style={{ gap: '.5rem' }}>
        <h3>Your collection ticket</h3>
        <p className="small muted">
          Show this code to staff at collection. Keep it private; it authorizes one pickup.
        </p>
        <details>
          <summary>Show text ticket</summary>
          <code className="mono">{token}</code>
        </details>
        <button
          className="btn secondary small no-print"
          onClick={() => void action.run(() => navigator.clipboard.writeText(token), 'Ticket copied.')}
        >
          <Copy size={14} />
          Copy ticket
        </button>
        <ActionMessages error={action.error} success={action.success} />
      </div>
    </div>
  )
}
export default function OrderCard({
  order,
  onChange,
  staff = false,
}: {
  order: Order
  onChange: () => void
  staff?: boolean
}) {
  const { config } = useAuth(),
    action = useAction(),
    [confirmCancel, setConfirmCancel] = useState(false)
  const cancellable = ['pending', 'confirmed'].includes(order.status)
  return (
    <article className="card stack">
      <div className="between">
        <div>
          <h3>
            {order.type === 'buyer-order' ? 'Purchase' : 'Reservation'} {shortId(order.id)}
          </h3>
          <p className="small muted">
            {formatDate(order.createdAt, config.timezone, true)}
            {staff ? ` · ${order.userName}` : ''}
          </p>
        </div>
        <div className="row">
          <Badge status={order.status} />
          {order.type === 'buyer-order' && (
            <Badge status={order.paymentStatus}>Payment: {order.paymentStatus}</Badge>
          )}
        </div>
      </div>
      <ActionMessages error={action.error} success={action.success} />
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Reserved food</caption>
          <thead>
            <tr>
              <th>Food</th>
              <th>Quantity</th>
              {order.type === 'buyer-order' && <th>Line total</th>}
            </tr>
          </thead>
          <tbody>
            {order.items.map((line) => (
              <tr key={line.itemId}>
                <td>{line.name}</td>
                <td>
                  {line.qty} {line.unit}
                </td>
                {order.type === 'buyer-order' && (
                  <td>{money(line.priceCents * line.qty, config.currency)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="detail-list">
        {order.event && (
          <div>
            <dt>Collection event</dt>
            <dd>
              {order.event.location}
              <br />
              {formatDate(order.event.startsAt, order.event.timezone, true)} –{' '}
              {formatDate(order.event.endsAt, order.event.timezone, true)}
            </dd>
          </div>
        )}
        <div>
          <dt>Fulfillment</dt>
          <dd>
            {order.fulfillment === 'delivery' ? 'Volunteer delivery' : 'Collection at your chosen event'}
          </dd>
        </div>
        {order.type === 'buyer-order' && (
          <div>
            <dt>Total, including support</dt>
            <dd>
              {money(order.totalCents, config.currency)}
              {order.supportContributionCents > 0 &&
                ` (${money(order.supportContributionCents, config.currency)} support)`}
            </dd>
          </div>
        )}
        {order.deliveryAddress && (
          <div>
            <dt>Delivery address</dt>
            <dd>{order.deliveryAddress}</dd>
          </div>
        )}
        {order.completedAt && (
          <div>
            <dt>Completed</dt>
            <dd>{formatDate(order.completedAt, config.timezone, true)}</dd>
          </div>
        )}
      </dl>
      {order.fulfillment === 'pickup' && order.status === 'confirmed' && order.pickupToken && (
        <Ticket token={order.pickupToken} />
      )}
      <div className="row no-print">
        {order.status === 'confirmed' && (
          <button
            className="btn secondary small"
            onClick={(e) => printRecord(e.currentTarget.closest('article'))}
          >
            <Printer size={15} />
            Print order
          </button>
        )}
        {cancellable && (
          <button className="btn danger small" onClick={() => setConfirmCancel(!confirmCancel)}>
            Cancel {order.type === 'buyer-order' ? 'order' : 'reservation'}
          </button>
        )}
      </div>
      {confirmCancel && (
        <div className="panel warning stack no-print">
          <p>
            Cancel this order and release its reserved food?{' '}
            {order.paymentStatus === 'paid'
              ? 'A refund will be requested; its result appears in payment status.'
              : ''}
          </p>
          <div className="row">
            <button
              className="btn danger small"
              disabled={action.pending}
              onClick={() =>
                void action.run(async () => {
                  await mutation(`/orders/${order.id}/cancel`, orderSchema)
                  setConfirmCancel(false)
                  onChange()
                }, 'Order cancelled.')
              }
            >
              Confirm cancellation
            </button>
            <button className="btn secondary small" onClick={() => setConfirmCancel(false)}>
              Keep order
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
