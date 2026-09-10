import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { mutation } from '../lib/api'
import { useAction } from '../lib/hooks'
import { okSchema } from '../lib/schemas'
import { roleHome, signInDestination } from '../lib/format'
import { ActionMessages, Alert, Field, PageHead } from '../components/ui'

const demoRoles = ['Donor', 'Recipient', 'Buyer', 'Volunteer', 'Admin'] as const
const demoPassword = 'FoodLink-demo-2026!'

export default function Auth() {
  const location = useLocation(),
    navigate = useNavigate(),
    [params] = useSearchParams(),
    auth = useAuth(),
    action = useAction()
  const mode = location.pathname.slice(1)
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [role, setRole] = useState('donor'),
    [household, setHousehold] = useState(1),
    [accepted, setAccepted] = useState(false)
  const token = params.get('token') || ''
  useEffect(() => {
    action.setError('')
    action.setSuccess('')
    setPassword('')
    setConfirm('')
  }, [mode])
  async function submit(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      if (['register', 'reset-password'].includes(mode) && password !== confirm)
        throw new Error('The passwords do not match.')
      if (mode === 'login') {
        const user = await auth.login(email.trim().toLowerCase(), password)
        const from = (location.state as { from?: string } | null)?.from
        navigate(signInDestination(user.role, from), {
          replace: true,
        })
      } else if (mode === 'register') {
        if (!accepted) throw new Error('Please review and acknowledge the privacy and food information.')
        const user = await auth.register({
          name,
          email: email.trim().toLowerCase(),
          password,
          role,
          ...(role === 'recipient' ? { householdSize: household } : {}),
        })
        navigate(roleHome[user.role], { replace: true })
      } else if (mode === 'forgot-password') {
        await mutation('/auth/forgot-password', okSchema, { email })
        action.setSuccess(
          'If an account exists for that address, recovery instructions have been queued. Check your email.',
        )
      } else if (mode === 'reset-password') {
        await mutation('/auth/reset-password', okSchema, { token, password })
        await auth.refresh()
        action.setSuccess('Your password has been updated. You can now sign in.')
        setPassword('')
        setConfirm('')
      } else {
        await mutation('/auth/verify-email', okSchema, { token })
        await auth.refresh()
        action.setSuccess('Your email address is verified. You can continue to your workspace.')
      }
    })
  }
  const title =
    mode === 'register'
      ? 'Join your food community'
      : mode === 'forgot-password'
        ? 'Reset your password'
        : mode === 'reset-password'
          ? 'Choose a new password'
          : mode === 'verify-email'
            ? 'Verify your email'
            : 'Welcome back'
  return (
    <div className="auth-wrap">
      <PageHead
        eyebrow="FoodLink account"
        title={title}
        description={
          mode === 'login'
            ? 'Sign in to manage your food, collections and community activity.'
            : mode === 'register'
              ? 'Choose how you would like to take part. Staff review recipient eligibility before reservations.'
              : undefined
        }
      />
      <div className="card stack">
        <ActionMessages error={action.error} success={action.success} />
        {mode === 'verify-email' ? (
          <>
            <p>
              Confirm the email address associated with this link. This verification link can be used once.
            </p>
            {!token ? (
              <Alert>
                This link is missing its verification token. Request another link from your account page.
              </Alert>
            ) : (
              !action.success && (
                <form onSubmit={submit}>
                  <button className="btn block" disabled={action.pending}>
                    {action.pending ? 'Verifying…' : 'Verify email address'}
                  </button>
                </form>
              )
            )}
            {action.success && (
              <Link className="btn" to={auth.user ? roleHome[auth.user.role] : '/login'}>
                Continue
              </Link>
            )}
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            {mode === 'register' && (
              <Field label="Full name" required>
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  required
                />
              </Field>
            )}
            {['login', 'register', 'forgot-password'].includes(mode) && (
              <Field label="Email address" required>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  required
                />
              </Field>
            )}
            {mode === 'register' && (
              <>
                <Field label="I would like to" required>
                  <select value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="donor">Donate surplus food</option>
                    <option value="recipient">Receive food support</option>
                    <option value="buyer">Purchase released surplus</option>
                  </select>
                </Field>
                {role === 'recipient' && (
                  <Field
                    label="Household size"
                    hint="Used by the operator when reviewing eligibility."
                    required
                  >
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={household}
                      onChange={(e) => setHousehold(Number(e.target.value))}
                      required
                    />
                  </Field>
                )}
                {role === 'buyer' && !auth.config.paymentsEnabled && (
                  <Alert kind="info">
                    Surplus checkout is currently unavailable. You can browse released food after creating
                    your account.
                  </Alert>
                )}
              </>
            )}
            {['login', 'register', 'reset-password'].includes(mode) && (
              <Field
                label={mode === 'login' ? 'Password' : 'New password'}
                required
                hint={
                  mode === 'login' ? undefined : 'Use 12–128 characters. A long unique passphrase works well.'
                }
              >
                <input
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={mode === 'login' ? 1 : 12}
                  maxLength={128}
                  required
                />
              </Field>
            )}
            {['register', 'reset-password'].includes(mode) && (
              <Field label="Confirm password" required>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={12}
                  maxLength={128}
                  required
                />
              </Field>
            )}
            {mode === 'register' && (
              <label className="check small">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  required
                />
                <span>
                  I have read the{' '}
                  <Link to="/privacy" target="_blank" rel="noreferrer">
                    privacy information
                  </Link>{' '}
                  and{' '}
                  <Link to="/terms" target="_blank" rel="noreferrer">
                    terms and food guidance
                  </Link>
                  .
                </span>
              </label>
            )}
            {mode === 'reset-password' && !token && (
              <Alert>This recovery link is incomplete. Request a new reset link.</Alert>
            )}
            <button className="btn block" disabled={action.pending || (mode === 'reset-password' && !token)}>
              {action.pending
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'register'
                    ? 'Create account'
                    : mode === 'forgot-password'
                      ? 'Send recovery instructions'
                      : 'Update password'}
            </button>
          </form>
        )}
        {mode === 'login' ? (
          <>
            <Link to="/forgot-password" className="small">
              Forgot your password?
            </Link>
            <p className="muted small">
              New to FoodLink? <Link to="/register">Create an account</Link>
            </p>
            {auth.config.demoLoginEnabled && (
              <section className="panel stack" aria-labelledby="demo-accounts-title">
                <div>
                  <h2 id="demo-accounts-title" className="demo-accounts-title">
                    Try a demo account
                  </h2>
                  <p className="small muted">
                    Choose a role to fill the default demo details, then select Sign in.
                  </p>
                </div>
                <div className="row">
                  {demoRoles.map((demoRole) => (
                    <button
                      key={demoRole}
                      type="button"
                      className="btn secondary small"
                      disabled={action.pending}
                      onClick={() => {
                        setEmail(`${demoRole.toLowerCase()}@email.com`)
                        setPassword(demoPassword)
                        action.setError('')
                        action.setSuccess('')
                      }}
                    >
                      {demoRole}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <Link to="/login" className="small">
            Back to sign in
          </Link>
        )}
        {auth.config.mailMode === 'outbox' && (
          <p className="small muted">
            Local environment: verification and recovery messages are recorded in the administrator’s email
            outbox.
          </p>
        )}
      </div>
    </div>
  )
}
