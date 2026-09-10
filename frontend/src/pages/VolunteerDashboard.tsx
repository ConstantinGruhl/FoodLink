import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardList, PackageCheck, ScanLine, Truck } from 'lucide-react'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useQuery, useAction } from '../lib/hooks'
import { donationSchema, orderSchema, type Order } from '../lib/schemas'
import { ActionMessages, Empty, ErrorPanel, Field, Loading, PageHead, Pagination } from '../components/ui'
import DonationRecord from '../components/DonationRecord'
import EventManagement from '../components/EventManagement'
import InventoryManagement from '../components/InventoryManagement'
import TaskManagement from '../components/TaskManagement'
import DeliveryManagement from '../components/DeliveryManagement'
import TicketScanner from '../components/TicketScanner'
import OrderCard from '../components/OrderCard'
function Receiving() {
  const [offset, setOffset] = useState(0),
    query = useQuery(`/donations?limit=50&offset=${offset}`, z.array(donationSchema))
  const [all, setAll] = useState(false)
  return (
    <div className="stack">
      <div className="between">
        <h2>Receive food offers</h2>
        <label className="check small">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Include received and cancelled
        </label>
      </div>
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.filter((d) => all || ['scheduled', 'offered'].includes(d.status)).length ? (
        query.data
          .filter((d) => all || ['scheduled', 'offered'].includes(d.status))
          .map((d) => <DonationRecord key={d.id} donation={d} staff onChange={query.reload} />)
      ) : (
        <Empty title="No food offers waiting here">
          New donor offers appear here before entering available inventory.
        </Empty>
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
function Pickups() {
  const action = useAction(),
    [token, setToken] = useState(''),
    [result, setResult] = useState<Order | null>(null),
    [offset, setOffset] = useState(0),
    query = useQuery(`/orders?limit=50&offset=${offset}`, z.array(orderSchema))
  async function submit(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      const order = await mutation('/orders/redeem', orderSchema, { token: token.trim() })
      setResult(order)
      setToken('')
      query.reload()
    }, 'Pickup confirmed. This ticket is now used and cannot be redeemed again.')
  }
  return (
    <div className="stack-lg">
      <section className="card stack">
        <h2>Verify a food pickup</h2>
        <p className="muted">
          Scan or enter the recipient’s ticket, check the basket, then confirm handover. A ticket can be
          redeemed once.
        </p>
        <TicketScanner onDetected={setToken} />
        <ActionMessages error={action.error} success={action.success} />
        <form className="stack" onSubmit={submit}>
          <Field label="Collection ticket" required>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              maxLength={1000}
              placeholder="Scan a QR code or paste the text ticket"
            />
          </Field>
          <button className="btn" disabled={action.pending || !token.trim()}>
            <ScanLine size={17} />
            {action.pending ? 'Verifying…' : 'Confirm food handover'}
          </button>
        </form>
      </section>
      {result && <OrderCard order={result} staff onChange={() => setResult(null)} />}
      <h2>Recent reservations & orders</h2>
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        query.data.map((order) => <OrderCard key={order.id} order={order} staff onChange={query.reload} />)
      ) : (
        <Empty title="No orders yet" />
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
export default function VolunteerDashboard() {
  const [params, setParams] = useSearchParams(),
    tab = params.get('tab') || 'receive'
  const tabs = [
    ['receive', 'Receiving', PackageCheck],
    ['inventory', 'Inventory', ClipboardList],
    ['events', 'Events', ClipboardList],
    ['pickups', 'Pickups', ScanLine],
    ['tasks', 'Tasks', ClipboardList],
    ['deliveries', 'Deliveries', Truck],
  ] as const
  return (
    <>
      <PageHead
        eyebrow="Team operations"
        title="A smoother day of sharing."
        description="Receive donations, manage available food, coordinate the team and confirm every handover."
        action={
          <Link className="btn secondary" to="/reports">
            Reports & export
          </Link>
        }
      />
      <nav className="tabs no-print" aria-label="Operations sections">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            className={`btn small ${tab === id ? '' : 'secondary'}`}
            aria-pressed={tab === id}
            onClick={() => setParams({ tab: id })}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      {tab === 'receive' ? (
        <Receiving />
      ) : tab === 'inventory' ? (
        <InventoryManagement />
      ) : tab === 'events' ? (
        <EventManagement />
      ) : tab === 'pickups' ? (
        <Pickups />
      ) : tab === 'tasks' ? (
        <TaskManagement />
      ) : tab === 'deliveries' ? (
        <DeliveryManagement />
      ) : (
        <Receiving />
      )}
    </>
  )
}
