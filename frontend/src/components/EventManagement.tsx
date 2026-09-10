import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, useQuery } from '../lib/hooks'
import { eventSchema, type DistributionEvent } from '../lib/schemas'
import { formatDate, localInputDate } from '../lib/format'
import { ActionMessages, Badge, Empty, ErrorPanel, Field, Loading, Pagination } from './ui'
function EventForm({
  existing,
  onSaved,
  onCancel,
}: {
  existing?: DistributionEvent
  onSaved: () => void
  onCancel: () => void
}) {
  const { config } = useAuth(),
    action = useAction()
  const [startsAt, setStart] = useState(existing ? localInputDate(existing.startsAt) : ''),
    [endsAt, setEnd] = useState(existing ? localInputDate(existing.endsAt) : ''),
    [cutoffAt, setCutoff] = useState(existing ? localInputDate(existing.cutoffAt) : ''),
    [timezone, setTimezone] = useState(existing?.timezone || config.timezone),
    [location, setLocation] = useState(existing?.location || ''),
    [capacity, setCapacity] = useState(existing?.capacity || 50),
    [delivery, setDelivery] = useState(existing?.allowDelivery || false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      if (new Date(endsAt) <= new Date(startsAt)) throw new Error('The event must end after it starts.')
      if (new Date(cutoffAt) > new Date(startsAt))
        throw new Error('The reservation cutoff must be at or before the event starts.')
      const payload = existing
        ? {
            ...(startsAt !== localInputDate(existing.startsAt)
              ? { startsAt: new Date(startsAt).toISOString() }
              : {}),
            ...(endsAt !== localInputDate(existing.endsAt) ? { endsAt: new Date(endsAt).toISOString() } : {}),
            ...(cutoffAt !== localInputDate(existing.cutoffAt)
              ? { cutoffAt: new Date(cutoffAt).toISOString() }
              : {}),
            ...(timezone !== existing.timezone ? { timezone } : {}),
            ...(location !== existing.location ? { location } : {}),
            ...(capacity !== existing.capacity ? { capacity } : {}),
            ...(delivery !== existing.allowDelivery ? { allowDelivery: delivery } : {}),
          }
        : {
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            cutoffAt: new Date(cutoffAt).toISOString(),
            timezone,
            location,
            capacity,
            allowDelivery: delivery,
          }
      if (Object.keys(payload).length)
        await mutation(
          existing ? `/events/${existing.id}` : '/events',
          eventSchema,
          payload,
          existing ? 'PATCH' : 'POST',
        )
      onSaved()
    })
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h3>{existing ? 'Edit distribution' : 'Schedule a distribution'}</h3>
      <ActionMessages error={action.error} success={action.success} />
      <p className="small muted">
        Enter times in your device’s local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). The
        event timezone controls how collection details are displayed.
      </p>
      <div className="form-grid">
        <Field label="Starts" required>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label="Ends" required>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
        <Field label="Reservation cutoff" required>
          <input
            type="datetime-local"
            value={cutoffAt}
            onChange={(e) => setCutoff(e.target.value)}
            required
          />
        </Field>
        <Field label="Display timezone" required>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Europe/Berlin"
            required
            maxLength={100}
          />
        </Field>
        <Field label="Collection location" required>
          <input value={location} onChange={(e) => setLocation(e.target.value)} required maxLength={500} />
        </Field>
        <Field label="Capacity (orders)" required>
          <input
            type="number"
            min={1}
            max={100000}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            required
          />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} />
        Allow volunteer delivery requests for this event
      </label>
      <div className="row">
        <button className="btn" disabled={action.pending}>
          {action.pending ? 'Saving…' : existing ? 'Save event' : 'Create event'}
        </button>
        <button className="btn secondary" type="button" onClick={onCancel}>
          Close
        </button>
      </div>
    </form>
  )
}
function EventCard({ event, onChange }: { event: DistributionEvent; onChange: () => void }) {
  const action = useAction(),
    [editing, setEditing] = useState(false),
    [transition, setTransition] = useState<'cancelled' | 'completed' | null>(null)
  if (editing)
    return (
      <EventForm
        existing={event}
        onSaved={() => {
          setEditing(false)
          onChange()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  return (
    <article className="card stack">
      <div className="between">
        <h3>{event.location}</h3>
        <Badge status={event.status} />
      </div>
      <p>
        {formatDate(event.startsAt, event.timezone, true)} – {formatDate(event.endsAt, event.timezone, true)}
      </p>
      <p className="small muted">
        {event.timezone} · Reserve by {formatDate(event.cutoffAt, event.timezone, true)}
      </p>
      <div className="row">
        <span className="badge">
          {event.reservedCount} / {event.capacity} slots
        </span>
        <span className="badge">{event.allowDelivery ? 'Pickup + delivery' : 'Pickup only'}</span>
      </div>
      <ActionMessages error={action.error} success={action.success} />
      {event.status === 'scheduled' && (
        <div className="row">
          <button className="btn secondary small" onClick={() => setEditing(true)}>
            Edit event
          </button>
          <button className="btn secondary small" onClick={() => setTransition('completed')}>
            Mark complete
          </button>
          <button className="btn danger small" onClick={() => setTransition('cancelled')}>
            Cancel event
          </button>
        </div>
      )}
      {transition && (
        <div className="panel warning stack">
          <p>
            {transition === 'cancelled'
              ? 'Cancel this event? Eligible reservations will be cancelled and stock restored. Affected users receive a notification.'
              : 'Complete this event? Resolve outstanding pickups and deliveries first.'}
          </p>
          <div className="row">
            <button
              className="btn"
              disabled={action.pending}
              onClick={() =>
                void action.run(async () => {
                  await mutation(`/events/${event.id}`, eventSchema, { status: transition }, 'PATCH')
                  setTransition(null)
                  onChange()
                }, 'Event updated.')
              }
            >
              Confirm
            </button>
            <button className="btn secondary" onClick={() => setTransition(null)}>
              Keep event unchanged
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
export default function EventManagement() {
  const [offset, setOffset] = useState(0),
    query = useQuery(`/events?all=true&limit=50&offset=${offset}`, z.array(eventSchema)),
    [create, setCreate] = useState(false)
  return (
    <div className="stack-lg">
      <div className="between">
        <h2>Distribution events</h2>
        <button className="btn" onClick={() => setCreate(!create)}>
          Schedule event
        </button>
      </div>
      {create && (
        <EventForm
          onSaved={() => {
            setCreate(false)
            query.reload()
          }}
          onCancel={() => setCreate(false)}
        />
      )}{' '}
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        <div className="grid two">
          {query.data.map((event) => (
            <EventCard key={event.id} event={event} onChange={query.reload} />
          ))}
        </div>
      ) : (
        <Empty title="No distribution events">Create the next event to open collection slots.</Empty>
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
