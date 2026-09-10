import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAssignees } from '../lib/useAssignees'
import { useAction, useQuery } from '../lib/hooks'
import { eventSchema, taskSchema, type Task } from '../lib/schemas'
import { formatDate } from '../lib/format'
import { ActionMessages, Badge, Empty, ErrorPanel, Field, Loading, Pagination } from './ui'
function TaskCard({
  task,
  onChange,
  volunteers,
  assignmentUnavailable = false,
}: {
  task: Task
  onChange: () => void
  volunteers: { id: string; name: string }[]
  assignmentUnavailable?: boolean
}) {
  const { user, config } = useAuth(),
    action = useAction()
  const [assigned, setAssigned] = useState(task.assignedVolunteerId || '')
  return (
    <article className="card stack">
      <div className="between">
        <h3>{task.title}</h3>
        <Badge status={task.status} />
      </div>
      {task.description && <p className="small muted">{task.description}</p>}
      <p className="small muted">
        Due: {formatDate(task.dueAt, config.timezone, true)} · Assigned:{' '}
        {task.assignedVolunteerId === user?.id
          ? 'You'
          : volunteers.find((v) => v.id === task.assignedVolunteerId)?.name ||
            (task.assignedVolunteerId ? 'Team member' : 'Unassigned')}
      </p>
      <ActionMessages error={action.error} success={action.success} />
      <div className="inline-form">
        <Field label="Assign task">
          <select
            disabled={assignmentUnavailable}
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
          >
            <option value="">Unassigned</option>
            {volunteers.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.id === user?.id ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="btn secondary small"
          disabled={action.pending || assignmentUnavailable}
          onClick={() =>
            void action.run(async () => {
              await mutation(
                `/tasks/${task.id}`,
                taskSchema,
                { assignedVolunteerId: assigned || null },
                'PATCH',
              )
              onChange()
            }, 'Task assignment updated.')
          }
        >
          Save assignment
        </button>
      </div>
      <div className="row">
        {task.status === 'open' && (
          <button
            className="btn small"
            disabled={action.pending}
            onClick={() =>
              void action.run(async () => {
                await mutation(`/tasks/${task.id}`, taskSchema, { status: 'in-progress' }, 'PATCH')
                onChange()
              })
            }
          >
            Start task
          </button>
        )}
        {['open', 'in-progress'].includes(task.status) && (
          <>
            <button
              className="btn secondary small"
              disabled={action.pending}
              onClick={() =>
                void action.run(async () => {
                  await mutation(`/tasks/${task.id}`, taskSchema, { status: 'completed' }, 'PATCH')
                  onChange()
                })
              }
            >
              Mark completed
            </button>
            <button
              className="btn danger small"
              disabled={action.pending}
              onClick={() =>
                void action.run(async () => {
                  await mutation(`/tasks/${task.id}`, taskSchema, { status: 'cancelled' }, 'PATCH')
                  onChange()
                })
              }
            >
              Cancel task
            </button>
          </>
        )}
      </div>
    </article>
  )
}
export default function TaskManagement() {
  const { user } = useAuth(),
    [offset, setOffset] = useState(0),
    query = useQuery(`/tasks?limit=50&offset=${offset}`, z.array(taskSchema)),
    users = useAssignees(user?.role === 'admin'),
    events = useQuery('/events?limit=100', z.array(eventSchema)),
    action = useAction()
  const [show, setShow] = useState(false),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [eventId, setEventId] = useState(''),
    [assigned, setAssigned] = useState(''),
    [due, setDue] = useState('')
  const volunteers = user?.role === 'admin' ? users.data : user?.emailVerified ? [user] : []
  async function create(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      await mutation('/tasks', taskSchema, {
        title,
        description,
        ...(eventId ? { eventId } : {}),
        ...(assigned ? { assignedVolunteerId: assigned } : {}),
        ...(due ? { dueAt: new Date(due).toISOString() } : {}),
      })
      setShow(false)
      setTitle('')
      setDescription('')
      query.reload()
    }, 'Task created.')
  }
  return (
    <div className="stack-lg">
      <div className="between">
        <h2>Volunteer tasks</h2>
        <button className="btn" onClick={() => setShow(!show)}>
          Create task
        </button>
      </div>
      <ActionMessages error={action.error} success={action.success} />
      {users.loading && <Loading label="Loading eligible volunteers…" />}
      {users.error && <ErrorPanel error={users.error} retry={users.reload} />}{' '}
      {show && (
        <form className="card stack" onSubmit={create}>
          <div className="form-grid">
            <Field label="Task title" required>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
            </Field>
            <Field label="Distribution event">
              <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                <option value="">No event</option>
                {events.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.location} · {formatDate(e.startsAt, e.timezone, true)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assign to">
              <select value={assigned} onChange={(e) => setAssigned(e.target.value)}>
                <option value="">Unassigned</option>
                {volunteers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date" hint="In your device’s timezone.">
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          <Field label="Instructions">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <button className="btn" disabled={action.pending}>
            {action.pending ? 'Creating…' : 'Create task'}
          </button>
        </form>
      )}
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        <div className="grid two">
          {query.data.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onChange={query.reload}
              volunteers={volunteers}
              assignmentUnavailable={users.loading || !!users.error}
            />
          ))}
        </div>
      ) : (
        <Empty title="No tasks yet">Create a task for receiving, packing or event preparation.</Empty>
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
