import { useState } from 'react'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAssignees } from '../lib/useAssignees'
import { useAction, useQuery } from '../lib/hooks'
import { orderSchema, type Order } from '../lib/schemas'
import { formatDate, shortId } from '../lib/format'
import { ActionMessages, Badge, Empty, ErrorPanel, Field, Loading, Pagination } from './ui'
function DeliveryCard({
  order,
  onChange,
  volunteers,
  assignmentUnavailable = false,
}: {
  order: Order
  onChange: () => void
  volunteers: { id: string; name: string }[]
  assignmentUnavailable?: boolean
}) {
  const { user, config } = useAuth(),
    action = useAction(),
    [assigned, setAssigned] = useState(order.assignedVolunteerId || user?.id || ''),
    [proof, setProof] = useState(''),
    [confirm, setConfirm] = useState(false)
  const active = order.status === 'confirmed',
    mine = order.assignedVolunteerId === user?.id
  return (
    <article className="card stack">
      <div className="between">
        <div>
          <h3>Delivery {shortId(order.id)}</h3>
          <p className="small muted">
            {order.userName} · {formatDate(order.createdAt, config.timezone, true)}
          </p>
        </div>
        <Badge status={order.status} />
      </div>
      <p>
        <strong>Delivery address:</strong> {order.deliveryAddress || 'Unavailable'}
      </p>
      <p className="small muted">{order.items.map((i) => `${i.qty} ${i.unit} ${i.name}`).join(' · ')}</p>
      <p className="small">
        Assigned:{' '}
        {mine
          ? 'You'
          : volunteers.find((v) => v.id === order.assignedVolunteerId)?.name ||
            (order.assignedVolunteerId ? 'Team member' : 'Unassigned')}
      </p>
      <ActionMessages error={action.error} success={action.success} />
      {active && (!order.assignedVolunteerId || user?.role === 'admin') && (
        <div className="inline-form">
          <Field label="Delivery volunteer">
            <select
              disabled={assignmentUnavailable}
              value={assigned}
              onChange={(e) => setAssigned(e.target.value)}
            >
              {volunteers.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="btn secondary small"
            disabled={action.pending || !assigned || assignmentUnavailable}
            onClick={() =>
              void action.run(async () => {
                await mutation(`/orders/${order.id}/assign`, orderSchema, { volunteerId: assigned })
                onChange()
              }, 'Delivery assigned.')
            }
          >
            {user?.role === 'admin' ? 'Assign delivery' : 'Take this delivery'}
          </button>
        </div>
      )}
      {active && (mine || user?.role === 'admin') && (
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault()
            void action.run(async () => {
              await mutation(`/orders/${order.id}/deliver`, orderSchema, { proof })
              onChange()
            }, 'Delivery completed and recorded.')
          }}
        >
          <Field
            label="Delivery confirmation"
            required
            hint="Record a concise handover confirmation. Do not include sensitive personal details or identity documents."
          >
            <textarea
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              minLength={3}
              maxLength={2000}
              placeholder="e.g. Handed to recipient at front door at 14:20"
              required
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              required
            />
            I have handed over this food to the recipient.
          </label>
          <button className="btn" disabled={!confirm || action.pending}>
            Confirm completed delivery
          </button>
        </form>
      )}
    </article>
  )
}
export default function DeliveryManagement() {
  const { user } = useAuth(),
    [offset, setOffset] = useState(0),
    query = useQuery(`/deliveries?limit=50&offset=${offset}`, z.array(orderSchema)),
    users = useAssignees(user?.role === 'admin')
  const volunteers = user?.role === 'admin' ? users.data : user?.emailVerified ? [user] : []
  return (
    <div className="stack-lg">
      <h2>Delivery assignments</h2>
      <p className="muted">
        Take an unassigned delivery, coordinate handover, and record completion after the food reaches its
        recipient.
      </p>
      {users.loading && <Loading label="Loading eligible volunteers…" />}
      {users.error && <ErrorPanel error={users.error} retry={users.reload} />}{' '}
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        <div className="grid two">
          {query.data.map((order) => (
            <DeliveryCard
              key={order.id}
              order={order}
              onChange={query.reload}
              volunteers={volunteers}
              assignmentUnavailable={users.loading || !!users.error}
            />
          ))}
        </div>
      ) : (
        <Empty title="No deliveries in this view">
          Delivery orders appear when recipients choose an event that offers delivery.
        </Empty>
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
