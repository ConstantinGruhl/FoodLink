import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { z } from 'zod'
import { useQuery } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { eventSchema, orderSchema } from '../lib/schemas'
import { formatDate } from '../lib/format'
import { Alert, Empty, ErrorPanel, Loading, PageHead, Pagination } from '../components/ui'
import OrderCard from '../components/OrderCard'
export default function Orders() {
  const { user } = useAuth(),
    [params] = useSearchParams(),
    [offset, setOffset] = useState(0),
    query = useQuery(`/orders/mine?limit=50&offset=${offset}`, z.array(orderSchema)),
    events = useQuery('/events?limit=200', z.array(eventSchema))
  const [polls, setPolls] = useState(0)
  useEffect(() => {
    if (params.has('checkout') && query.data?.some((o) => o.paymentStatus === 'pending') && polls < 5) {
      const timer = setTimeout(() => {
        setPolls((x) => x + 1)
        query.reload()
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [query.data, params, polls, query.reload])
  return (
    <>
      <PageHead
        eyebrow="Your activity"
        title="Orders & collection tickets"
        description="View confirmed reservations, payment status and completed collections. History preserves the quantities and prices recorded when you ordered."
        action={
          <button className="btn secondary" onClick={query.reload}>
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />
      <div className="stack-lg">
        {params.has('checkout') && (
          <Alert kind="info">
            You have returned from checkout. The payment status below comes from the server; confirmation may
            take a moment. If you left checkout early, the pending order can be cancelled.
          </Alert>
        )}
        {query.loading ? (
          <Loading />
        ) : query.error ? (
          <ErrorPanel error={query.error} retry={query.reload} />
        ) : query.data?.length ? (
          query.data.map((order) => {
            const event = events.data?.find((e) => e.id === order.eventId)
            return (
              <div className="stack" key={order.id} style={{ gap: '.6rem' }}>
                {event && (
                  <p className="small muted">
                    {event.location} · {formatDate(event.startsAt, event.timezone, true)} to{' '}
                    {formatDate(event.endsAt, event.timezone, true)}
                  </p>
                )}
                <OrderCard order={order} onChange={query.reload} />
              </div>
            )
          })
        ) : (
          <div className="card">
            <Empty title="No orders yet">Your first reservation or purchase will appear here.</Empty>
            {['recipient', 'buyer'].includes(user?.role || '') && (
              <Link className="btn block" to={user?.role === 'buyer' ? '/market' : '/recipient'}>
                Browse available food
              </Link>
            )}
          </div>
        )}
        <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
      </div>
    </>
  )
}
