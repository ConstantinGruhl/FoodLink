import RefundManagement from '../components/RefundManagement'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, useQuery } from '../lib/hooks'
import {
  auditSchema,
  configSchema,
  okSchema,
  outboxSchema,
  roleSchema,
  userSchema,
  type Config,
  type User,
} from '../lib/schemas'
import { formatDate, shortId } from '../lib/format'
import {
  ActionMessages,
  Alert,
  Badge,
  Empty,
  ErrorPanel,
  Field,
  Loading,
  PageHead,
  Pagination,
} from '../components/ui'
function UserCard({ user, onChange }: { user: User; onChange: () => void }) {
  const auth = useAuth(),
    action = useAction(),
    [role, setRole] = useState(user.role),
    [verified, setVerified] = useState(user.verified),
    [disabled, setDisabled] = useState(user.disabled),
    [confirm, setConfirm] = useState(false)
  return (
    <article className="card stack">
      <div className="between">
        <div>
          <h3>{user.name}</h3>
          <p className="small muted">{user.email}</p>
        </div>
        <Badge status={user.disabled ? 'suspended' : 'active'}>{user.disabled ? 'Disabled' : 'Active'}</Badge>
      </div>
      <div className="row">
        <Badge>{user.role}</Badge>
        <Badge status={user.emailVerified ? 'verified' : 'pending'}>
          {user.emailVerified ? 'Email verified' : 'Email pending'}
        </Badge>
        {user.role === 'recipient' && (
          <Badge status={user.verified ? 'verified' : 'pending'}>
            {user.verified ? 'Eligibility approved' : 'Needs review'}
          </Badge>
        )}
      </div>
      {user.role === 'recipient' && (
        <details>
          <summary>Eligibility information</summary>
          <dl className="detail-list">
            <div>
              <dt>Household size</dt>
              <dd>{user.householdSize || 'Not given'}</dd>
            </div>
            <div>
              <dt>Dietary preferences</dt>
              <dd>{user.dietaryNeeds.join(', ') || 'None given'}</dd>
            </div>
            <div>
              <dt>Collection requirements</dt>
              <dd>{user.specialRequirements || 'None given'}</dd>
            </div>
          </dl>
        </details>
      )}
      <ActionMessages error={action.error} success={action.success} />
      <div className="form-grid">
        <Field label={`Role for ${user.name}`}>
          <select value={role} onChange={(e) => setRole(roleSchema.parse(e.target.value))}>
            {roleSchema.options.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <div className="stack" style={{ justifyContent: 'center' }}>
          {role === 'recipient' && (
            <label className="check small">
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
              Eligibility approved
            </label>
          )}
          <label className="check small">
            <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
            Disable account access
          </label>
        </div>
      </div>
      <button
        className="btn secondary small"
        disabled={
          action.pending || (role === user.role && verified === user.verified && disabled === user.disabled)
        }
        onClick={() => setConfirm(true)}
      >
        Review account change
      </button>
      {confirm && (
        <div className="panel warning stack">
          <p className="small">
            Save role “{role}”, {disabled ? 'disabled' : 'active'} access
            {role === 'recipient' ? ` and ${verified ? 'approved' : 'unapproved'} eligibility` : ''} for{' '}
            {user.name}? Role and access changes may end their sessions.
          </p>
          <div className="row">
            <button
              className="btn small"
              disabled={action.pending}
              onClick={() =>
                void action.run(async () => {
                  const updated = await mutation(
                    `/admin/users/${user.id}`,
                    userSchema,
                    {
                      ...(role !== user.role ? { role } : {}),
                      ...(verified !== user.verified ? { verified } : {}),
                      ...(disabled !== user.disabled ? { disabled } : {}),
                    },
                    'PATCH',
                  )
                  setConfirm(false)
                  onChange()
                  if (user.id === auth.user?.id) await auth.refresh()
                  return updated
                }, 'Account updated.')
              }
            >
              Confirm account change
            </button>
            <button className="btn secondary small" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
function Users() {
  const [offset, setOffset] = useState(0),
    query = useQuery(`/admin/users?limit=50&offset=${offset}`, z.array(userSchema)),
    action = useAction(),
    [show, setShow] = useState(false),
    [search, setSearch] = useState(''),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [role, setRole] = useState('volunteer')
  async function create(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      await mutation('/admin/users', userSchema, { name, email, password, role })
      setShow(false)
      setName('')
      setEmail('')
      setPassword('')
      query.reload()
    }, 'Account created. A verification message was queued. Share the initial password privately and ask the user to change it.')
  }
  return (
    <div className="stack-lg">
      <div className="between">
        <h2>People & permissions</h2>
        <button className="btn" onClick={() => setShow(!show)}>
          Create team account
        </button>
      </div>
      <ActionMessages error={action.error} success={action.success} />
      {show && (
        <form className="card stack" onSubmit={create}>
          <div className="form-grid">
            <Field label="Full name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
              />
            </Field>
            <Field
              label="Initial password"
              hint="Share privately; the user can change it in Account."
              required
            >
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Field label="Role" required>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {roleSchema.options.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
          </div>
          <button className="btn" disabled={action.pending}>
            Create account
          </button>
        </form>
      )}
      <input
        className="input"
        type="search"
        aria-label="Search users on this page"
        placeholder="Find a person on this page…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        <div className="grid two">
          {query.data
            .filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()))
            .map((u) => (
              <UserCard key={u.id} user={u} onChange={query.reload} />
            ))}
        </div>
      ) : (
        <Empty title="No accounts found" />
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
function ConfigForm({ initial, onSaved }: { initial: Config; onSaved: () => void }) {
  const action = useAction(),
    auth = useAuth(),
    [name, setName] = useState(initial.organizationName),
    [support, setSupport] = useState(initial.supportEmail),
    [address, setAddress] = useState(initial.organizationAddress),
    [contact, setContact] = useState(initial.privacyContact),
    [retention, setRetention] = useState(initial.retentionDays)
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault()
        void action.run(async () => {
          await mutation(
            '/admin/config',
            configSchema,
            {
              organizationName: name,
              ...(support ? { supportEmail: support } : {}),
              ...(address ? { organizationAddress: address } : {}),
              ...(contact ? { privacyContact: contact } : {}),
              retentionDays: retention,
            },
            'PATCH',
          )
          await auth.refreshConfig()
          onSaved()
        }, 'Operator information updated.')
      }}
    >
      <h2>Operator information</h2>
      <ActionMessages error={action.error} success={action.success} />
      <Alert kind="info">
        Contact details appear on the public information pages. Payment, currency, email transport and
        timezone settings are managed through server configuration.
      </Alert>
      <div className="form-grid">
        <Field label="Organization name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
        </Field>
        <Field label="Support email">
          <input type="email" value={support} onChange={(e) => setSupport(e.target.value)} maxLength={254} />
        </Field>
        <Field label="Organization address">
          <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Privacy contact email">
          <input type="email" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={254} />
        </Field>
        <Field
          label="Retention review period (days)"
          required
          hint="Document the legal basis and record-specific retention rules separately."
        >
          <input
            type="number"
            min={30}
            max={3650}
            value={retention}
            onChange={(e) => setRetention(Number(e.target.value))}
            required
          />
        </Field>
      </div>
      <button className="btn" disabled={action.pending}>
        Save operator details
      </button>
      <dl className="detail-list">
        <div>
          <dt>Currency</dt>
          <dd>{initial.currency}</dd>
        </div>
        <div>
          <dt>Operating timezone</dt>
          <dd>{initial.timezone}</dd>
        </div>
        <div>
          <dt>Payments</dt>
          <dd>{initial.paymentsEnabled ? 'Enabled' : 'Disabled'}</dd>
        </div>
        <div>
          <dt>Email transport</dt>
          <dd>{initial.mailMode}</dd>
        </div>
      </dl>
      <p className="small muted">
        Completing contact fields does not establish legal compliance. Review the public notices and your
        operational policies before real-world use.
      </p>
    </form>
  )
}
function Settings() {
  const query = useQuery('/admin/config', configSchema)
  return query.loading ? (
    <Loading />
  ) : query.error ? (
    <ErrorPanel error={query.error} retry={query.reload} />
  ) : query.data ? (
    <ConfigForm initial={query.data} onSaved={query.reload} />
  ) : null
}
function Audit() {
  const { config } = useAuth(),
    [offset, setOffset] = useState(0),
    query = useQuery(`/admin/audit?limit=50&offset=${offset}`, z.array(auditSchema))
  return (
    <div className="stack">
      <h2>Audit history</h2>
      <p className="muted">
        Recorded account, inventory, order and configuration changes. Entries identify the acting account and
        affected record.
      </p>
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        <div className="table-wrap">
          <table className="table">
            <caption>Recent audited actions</caption>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Record</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.createdAt, config.timezone, true)}</td>
                  <td>{entry.action}</td>
                  <td>
                    {entry.entityType}
                    <br />
                    {entry.entityId ? shortId(entry.entityId) : '—'}
                  </td>
                  <td>{entry.actorId ? shortId(entry.actorId) : 'System'}</td>
                  <td>
                    <details>
                      <summary>View</summary>
                      <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No audit entries" />
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
function Outbox() {
  const { config } = useAuth(),
    [offset, setOffset] = useState(0),
    query = useQuery(`/admin/outbox?limit=50&offset=${offset}`, z.array(outboxSchema)),
    action = useAction()
  return (
    <div className="stack">
      <h2>Message delivery</h2>
      <p className="muted">
        Messages remain queued until the configured email service delivers them. Failed messages can be
        retried after the underlying issue is resolved.
      </p>
      {config.mailMode === 'outbox' && (
        <Alert kind="info">
          Local outbox mode records messages without sending them. Verification and recovery links below are
          available for local testing.
        </Alert>
      )}
      <ActionMessages error={action.error} success={action.success} />
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        query.data.map((message) => (
          <article className="card stack" key={message.id}>
            <div className="between">
              <div>
                <h3>{message.subject || 'Operational message'}</h3>
                <p className="muted small">
                  {message.recipient || 'Recipient hidden'} ·{' '}
                  {formatDate(message.createdAt, config.timezone, true)}
                </p>
              </div>
              <Badge status={message.status} />
            </div>
            <p className="small muted">
              Delivery attempts: {message.attempts || 0}
              {message.lastError ? ` · ${message.lastError}` : ''}
            </p>
            {message.body && (
              <details>
                <summary>View local message</summary>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.body}</p>
                {message.body.match(/https?:\/\/[^\s]+/g)?.map((url) => {
                  try {
                    const link = new URL(url)
                    return link.origin === window.location.origin ? (
                      <Link
                        key={url}
                        to={link.pathname + link.search}
                        className="btn secondary small"
                        style={{ marginTop: '.75rem' }}
                      >
                        Open local verification / recovery link
                      </Link>
                    ) : (
                      <span key={url} className="small muted">
                        {' '}
                        Use the link above in its configured local application.
                      </span>
                    )
                  } catch {
                    return null
                  }
                })}
              </details>
            )}
            {message.status === 'failed' && (
              <button
                className="btn secondary small"
                disabled={action.pending}
                onClick={() =>
                  void action.run(async () => {
                    await mutation(`/admin/outbox/${message.id}/retry`, okSchema)
                    query.reload()
                  }, 'Message queued for retry.')
                }
              >
                Retry delivery
              </button>
            )}
          </article>
        ))
      ) : (
        <Empty title="No queued messages" />
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
const privacySchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  reason: z.string(),
  status: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})
function Privacy() {
  const { config } = useAuth(),
    [offset, setOffset] = useState(0),
    query = useQuery(`/admin/privacy?limit=50&offset=${offset}`, z.array(privacySchema)),
    action = useAction(),
    [confirm, setConfirm] = useState<string | null>(null)
  return (
    <div className="stack">
      <h2>Privacy requests</h2>
      <Alert kind="warning">
        Review the request and applicable retention obligations. Resolve active donations and orders before
        anonymizing. Anonymization removes personal account and delivery details and cannot be undone.
      </Alert>
      <ActionMessages error={action.error} success={action.success} />
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        query.data.map((p) => (
          <article className="card stack" key={p.id}>
            <div className="between">
              <h3>{p.userName}</h3>
              <Badge status={p.status} />
            </div>
            <p className="small muted">Requested {formatDate(p.createdAt, config.timezone, true)}</p>
            <p>{p.reason || 'Account deactivation and data review requested.'}</p>
            {p.status === 'pending' &&
              (confirm === p.id ? (
                <div className="panel warning stack">
                  <p>
                    Anonymize this account and complete its privacy request? Operational records remain
                    without the account’s identifying profile details.
                  </p>
                  <div className="row">
                    <button
                      className="btn danger"
                      disabled={action.pending}
                      onClick={() =>
                        void action.run(async () => {
                          await mutation(`/admin/privacy/${p.id}`, okSchema, { status: 'completed' }, 'PATCH')
                          setConfirm(null)
                          query.reload()
                        }, 'Account anonymized and request completed.')
                      }
                    >
                      Confirm anonymization
                    </button>
                    <button className="btn secondary" onClick={() => setConfirm(null)}>
                      Keep request open
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn danger small" onClick={() => setConfirm(p.id)}>
                  Review & anonymize account
                </button>
              ))}
          </article>
        ))
      ) : (
        <Empty title="No privacy requests" />
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
function Health() {
  const action = useAction(),
    query = useQuery('/admin/health', z.record(z.union([z.string(), z.number()])))
  return (
    <div className="stack">
      <h2>Operational status</h2>
      <ActionMessages error={action.error} success={action.success} />
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : (
        query.data && (
          <div className="grid four">
            {Object.entries(query.data).map(([key, value]) => (
              <div className="card" key={key}>
                <p className="stat">{value}</p>
                <p className="stat-label">
                  {(
                    {
                      failedmail: 'Failed emails',
                      pendingmail: 'Pending emails',
                      pendingrefunds: 'Pending refunds',
                      privacyrequests: 'Privacy requests',
                    } as Record<string, string>
                  )[key.toLowerCase()] || key}
                </p>
              </div>
            ))}
          </div>
        )
      )}
      <section className="card stack">
        <h3>Reservation and stock maintenance</h3>
        <p className="muted small">
          The server periodically expires uncollected reservations and unavailable food, restores eligible
          stock, and queues collection reminders. You can also run a pass now.
        </p>
        <button
          className="btn secondary"
          disabled={action.pending}
          onClick={() =>
            void action.run(async () => {
              const result = await mutation(
                '/admin/maintenance',
                z.object({
                  expiredOrders: z.number(),
                  expiredItems: z.number(),
                  remindersQueued: z.number(),
                }),
              )
              query.reload()
              action.setSuccess(
                `Maintenance complete: ${result.expiredOrders} orders expired, ${result.expiredItems} food items expired, ${result.remindersQueued} reminders queued.`,
              )
            })
          }
        >
          {action.pending ? 'Running maintenance…' : 'Run maintenance now'}
        </button>
      </section>
    </div>
  )
}
export default function AdminPanel() {
  const [params, setParams] = useSearchParams(),
    tab = params.get('tab') || 'users',
    tabs = [
      ['users', 'People'],
      ['settings', 'Operator settings'],
      ['audit', 'Audit history'],
      ['outbox', 'Email outbox'],
      ['privacy', 'Privacy requests'],
      ['health', 'Operations status'],
      ['refunds', 'Refunds'],
    ]
  return (
    <>
      <PageHead
        eyebrow="Administrator workspace"
        title="A well-run community starts here."
        description="Manage access, review eligibility, keep operator information accurate and follow the operational record."
        action={
          <Link className="btn secondary" to="/volunteer">
            Open team operations
          </Link>
        }
      />
      <nav className="tabs" aria-label="Administration sections">
        {tabs.map(([id, title]) => (
          <button
            className={`btn small ${tab === id ? '' : 'secondary'}`}
            aria-pressed={tab === id}
            key={id}
            onClick={() => setParams({ tab: id })}
          >
            {title}
          </button>
        ))}
      </nav>
      {tab === 'users' ? (
        <Users />
      ) : tab === 'settings' ? (
        <Settings />
      ) : tab === 'audit' ? (
        <Audit />
      ) : tab === 'outbox' ? (
        <Outbox />
      ) : tab === 'privacy' ? (
        <Privacy />
      ) : tab === 'health' ? (
        <Health />
      ) : tab === 'refunds' ? (
        <RefundManagement />
      ) : (
        <Users />
      )}
    </>
  )
}
