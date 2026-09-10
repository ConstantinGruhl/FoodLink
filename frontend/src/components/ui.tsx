import {
  Component,
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
  type ErrorInfo,
} from 'react'
import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={22} className="spin" />
      {label}
    </div>
  )
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={32} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}
export function Alert({
  children,
  kind = 'error',
}: {
  children: ReactNode
  kind?: 'error' | 'success' | 'warning' | 'info'
}) {
  return (
    <div className={`panel ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <AlertCircle size={19} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>{children}</div>
      </div>
    </div>
  )
}
export function Field({
  label,
  children,
  hint,
  required = false,
}: {
  label: string
  children: ReactNode
  hint?: string
  required?: boolean
}) {
  const id = useId()
  const child = Children.only(children)
  const control = isValidElement(child)
    ? cloneElement(child as ReactElement<{ id?: string; 'aria-describedby'?: string }>, {
        id,
        'aria-describedby': hint ? id + '-hint' : undefined,
      })
    : child
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {hint && <small id={id + '-hint'}>{hint}</small>}
    </div>
  )
}
export function Badge({ children, status = '' }: { children?: ReactNode; status?: string }) {
  const kind = /cancelled|failed|disposed|rejected|suspended|expired|no-show/.test(status)
    ? 'danger'
    : /received|collected|picked-up|delivered|completed|active|verified|paid|confirmed/.test(status)
      ? 'success'
      : /pending|scheduled|offered|unverified/.test(status)
        ? 'warning'
        : 'muted'
  return (
    <span className={`badge ${kind}`}>{children || status.replaceAll('_', ' ').replaceAll('-', ' ')}</span>
  )
}
export function PageHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && (
          <p className="eyebrow" style={{ marginBottom: '.55rem' }}>
            {eyebrow}
          </p>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  )
}
export function ErrorPanel({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <Alert>
      {error}
      {retry && (
        <div style={{ marginTop: '.7rem' }}>
          <button className="btn secondary small" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </Alert>
  )
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not record personal data in client logs. */
  }
  render() {
    if (this.state.failed)
      return (
        <main className="page">
          <PageHead
            title="We couldn’t display this page"
            description="Reload to restore the application. If the problem continues, contact your operator."
          />
          <button className="btn" onClick={() => window.location.assign('/')}>
            Return home
          </button>
        </main>
      )
    return this.props.children
  }
}
export function ActionMessages({ error, success }: { error: string; success: string }) {
  return (
    <>
      {error && <Alert>{error}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
    </>
  )
}
export function Pagination({
  offset,
  count,
  setOffset,
  limit = 50,
}: {
  offset: number
  count: number
  setOffset: (value: number) => void
  limit?: number
}) {
  if (offset === 0 && count < limit) return null
  return (
    <nav className="pagination no-print" aria-label="Pagination">
      <button
        className="btn secondary small"
        disabled={!offset}
        onClick={() => setOffset(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span className="muted small">Page {Math.floor(offset / limit) + 1}</span>
      <button
        className="btn secondary small"
        disabled={count < limit}
        onClick={() => setOffset(offset + limit)}
      >
        Next
      </button>
    </nav>
  )
}
