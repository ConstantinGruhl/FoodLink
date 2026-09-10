import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { mutation, request, downloadJson } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction } from '../lib/hooks'
import { okSchema, userSchema } from '../lib/schemas'
import { csvList, formatDate } from '../lib/format'
import { ActionMessages, Alert, Badge, Field, PageHead } from '../components/ui'
export default function Profile() {
  const auth = useAuth(),
    user = auth.user!,
    navigate = useNavigate(),
    profile = useAction(),
    security = useAction(),
    privacy = useAction(),
    verification = useAction()
  const [name, setName] = useState(user.name),
    [household, setHousehold] = useState(user.householdSize || 1),
    [diet, setDiet] = useState(user.dietaryNeeds.join(', ')),
    [requirements, setRequirements] = useState(user.specialRequirements || ''),
    [address, setAddress] = useState(user.address || ''),
    [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [deactivate, setDeactivate] = useState(false),
    [deletePassword, setDeletePassword] = useState(''),
    [reason, setReason] = useState(''),
    [acknowledge, setAcknowledge] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault()
    await profile.run(async () => {
      const updated = await mutation(
        '/auth/profile',
        userSchema,
        {
          name,
          address,
          ...(user.role === 'recipient'
            ? { householdSize: household, dietaryNeeds: csvList(diet), specialRequirements: requirements }
            : {}),
        },
        'PATCH',
      )
      auth.setUser(updated)
    }, 'Profile updated.')
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault()
    await security.run(async () => {
      if (password !== confirm) throw new Error('The new passwords do not match.')
      await mutation('/auth/change-password', okSchema, { currentPassword: current, newPassword: password })
      auth.clear()
      navigate('/login', { replace: true })
    })
  }
  async function deactivateAccount(e: FormEvent) {
    e.preventDefault()
    await privacy.run(async () => {
      await mutation('/auth/deactivate', okSchema, {
        password: deletePassword,
        ...(reason ? { reason } : {}),
      })
      auth.clear()
      navigate('/login', { replace: true })
    })
  }
  return (
    <>
      <PageHead
        eyebrow="Account settings"
        title="Your account, your information."
        description="Keep your details current, manage account security and request a copy of your records."
      />
      <div className="stack-lg">
        <section className="card stack">
          <div className="between">
            <div>
              <h2>{user.name}</h2>
              <p className="muted">{user.email}</p>
            </div>
            <div className="row">
              <Badge>{user.role}</Badge>
              <Badge status={user.emailVerified ? 'verified' : 'pending'}>
                {user.emailVerified ? 'Email verified' : 'Email verification pending'}
              </Badge>
              {user.role === 'recipient' && (
                <Badge status={user.verified ? 'verified' : 'pending'}>
                  {user.verified ? 'Recipient approved' : 'Eligibility review pending'}
                </Badge>
              )}
            </div>
          </div>
          <p className="small muted">Member since {formatDate(user.createdAt, auth.config.timezone)}</p>
          {!user.emailVerified && (
            <>
              <Alert kind="info">
                Check your email for a verification link. Verification is required before reserving or
                purchasing food.
              </Alert>
              <ActionMessages error={verification.error} success={verification.success} />
              <div className="row">
                <button
                  className="btn secondary"
                  disabled={verification.pending}
                  onClick={() =>
                    void verification.run(
                      () => mutation('/auth/resend-verification', okSchema),
                      'Verification email queued. Check your inbox.',
                    )
                  }
                >
                  Resend verification email
                </button>
                <button className="btn secondary" onClick={() => void auth.refresh()}>
                  Refresh verification status
                </button>
              </div>
            </>
          )}
        </section>
        <div className="grid two">
          <form className="card stack" onSubmit={save}>
            <h2>Profile & preferences</h2>
            <ActionMessages error={profile.error} success={profile.success} />
            <Field label="Full name" required>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                maxLength={120}
              />
            </Field>
            {user.role === 'recipient' && (
              <>
                <Field label="Household size" required>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={household}
                    onChange={(e) => setHousehold(Number(e.target.value))}
                    required
                  />
                </Field>
                <Field
                  label="Dietary preferences"
                  hint="Optional, comma-separated. Always check food labels yourself."
                >
                  <input value={diet} onChange={(e) => setDiet(e.target.value)} maxLength={500} />
                </Field>
                <Field
                  label="Access or collection requirements"
                  hint="Optional. Share only what the team needs to assist your collection."
                >
                  <textarea
                    value={requirements}
                    onChange={(e) => setRequirements(e.target.value)}
                    maxLength={1000}
                  />
                </Field>
              </>
            )}
            <Field
              label="Delivery address"
              hint="Optional. Used to prefill a delivery request, and shared with the assigned team for that order."
            >
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={500}
                autoComplete="street-address"
              />
            </Field>
            <button className="btn" disabled={profile.pending}>
              {profile.pending ? 'Saving…' : 'Save profile'}
            </button>
          </form>
          <div className="stack-lg">
            <form className="card stack" onSubmit={changePassword}>
              <h2>Password & security</h2>
              <ActionMessages error={security.error} success={security.success} />
              <Field label="Current password" required>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                  maxLength={128}
                />
              </Field>
              <Field label="New password" required hint="Use a unique passphrase of 12–128 characters.">
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
              <Field label="Confirm new password" required>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </Field>
              <p className="small muted">
                Changing your password signs out all sessions. Sign in again with your new password.
              </p>
              <button className="btn secondary" disabled={security.pending}>
                Change password
              </button>
            </form>
            <section className="card stack">
              <h2>Your data</h2>
              <p className="small muted">
                Download your profile and account activity as a JSON file for your own records. The file may
                contain personal information; store it carefully.
              </p>
              <ActionMessages error={privacy.error} success={privacy.success} />
              <button
                className="btn secondary"
                disabled={privacy.pending}
                onClick={() =>
                  void privacy.run(async () => {
                    const exported = await request('/auth/export', z.record(z.unknown()))
                    downloadJson(`foodlink-account-${new Date().toISOString().slice(0, 10)}.json`, exported)
                  }, 'Your account export is ready.')
                }
              >
                Download my data
              </button>
            </section>
          </div>
        </div>
        <section className="card danger-zone stack">
          <h2>Deactivate account & request data review</h2>
          <p className="muted small">
            Deactivation ends access immediately and opens a request for the operator to review personal data
            for deletion or anonymization. Completed donation and order history may need to be retained. The
            operator reviews retention obligations before erasing records.
          </p>
          {!deactivate ? (
            <button className="btn danger" onClick={() => setDeactivate(true)}>
              Start deactivation request
            </button>
          ) : (
            <form className="stack" onSubmit={deactivateAccount}>
              <Field label="Current password" required>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  required
                  maxLength={128}
                />
              </Field>
              <Field
                label="Request notes"
                hint="Optional. Tell the operator if you are requesting erasure or have a specific data concern."
              >
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                  required
                />
                I understand that I will be signed out and unable to use this account.
              </label>
              <div className="row">
                <button className="btn danger" disabled={privacy.pending || !acknowledge}>
                  Deactivate and submit request
                </button>
                <button className="btn secondary" type="button" onClick={() => setDeactivate(false)}>
                  Keep my account
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  )
}
