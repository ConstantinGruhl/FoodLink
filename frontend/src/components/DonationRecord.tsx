import { useState } from 'react'
import { Printer, Pencil, Check } from 'lucide-react'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction } from '../lib/hooks'
import { donationSchema, type Donation } from '../lib/schemas'
import { formatDate, printRecord, shortId, storageLabel } from '../lib/format'
import { ActionMessages, Badge, Field } from './ui'
import DonationForm from './DonationForm'
import ImageUploader from './ImageUploader'
export default function DonationRecord({
  donation,
  staff = false,
  onChange,
}: {
  donation: Donation
  staff?: boolean
  onChange: () => void
}) {
  const { config } = useAuth(),
    action = useAction()
  const [edit, setEdit] = useState(false),
    [receive, setReceive] = useState(false),
    [cancel, setCancel] = useState(false),
    [checked, setChecked] = useState(false),
    [notes, setNotes] = useState('')
  const scheduled = ['scheduled', 'offered'].includes(donation.status)
  if (edit)
    return (
      <section className="card stack">
        <h2>Edit offer {shortId(donation.id)}</h2>
        <DonationForm
          existing={donation}
          onSaved={() => {
            setEdit(false)
            onChange()
          }}
          onCancel={() => setEdit(false)}
        />
      </section>
    )
  return (
    <article className="card stack">
      <div className="between">
        <div>
          <h3>Donation {shortId(donation.id)}</h3>
          <p className="small muted">
            {staff ? `${donation.donorName} · ` : ''}
            {formatDate(donation.date, config.timezone, true)}
          </p>
        </div>
        <Badge status={donation.status} />
      </div>
      <ActionMessages error={action.error} success={action.success} />
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Donation food quantities</caption>
          <thead>
            <tr>
              <th>Food</th>
              <th>Offered</th>
              <th>Received</th>
              <th>Available</th>
              <th>Food information</th>
            </tr>
          </thead>
          <tbody>
            {donation.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  <div className="small muted">
                    {item.unit} ·{' '}
                    {item.weightGrams > 0 ? `${item.weightGrams}g per unit` : 'Weight not recorded'}
                  </div>
                </td>
                <td>{item.offeredQty}</td>
                <td>{item.receivedQty}</td>
                <td>{item.qty}</td>
                <td>
                  <div>{storageLabel(item.storage)}</div>
                  <div className="small muted">Until {formatDate(item.expiresOn, config.timezone)}</div>
                  <div className="small">
                    Allergens:{' '}
                    {item.allergens.length ? item.allergens.join(', ') : 'none declared; check label'}
                  </div>
                  {item.handlingNotes && <div className="small">{item.handlingNotes}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {donation.notes && <p className="small muted">Staff note: {donation.notes}</p>}
      <div className="row no-print">
        {scheduled && (
          <>
            <button className="btn secondary small" onClick={() => setEdit(true)}>
              <Pencil size={15} />
              Edit offer
            </button>
            {staff && (
              <button
                className="btn small"
                onClick={() => {
                  setReceive(!receive)
                  setCancel(false)
                }}
              >
                <Check size={15} />
                Receive donation
              </button>
            )}
            <button
              className="btn danger small"
              onClick={() => {
                setCancel(!cancel)
                setReceive(false)
              }}
            >
              Cancel offer
            </button>
          </>
        )}
        {donation.receivedAt && (
          <button
            className="btn secondary small"
            onClick={(e) => printRecord(e.currentTarget.closest('article'))}
          >
            <Printer size={15} />
            Print receipt
          </button>
        )}
      </div>
      {receive && (
        <form
          className="panel stack no-print"
          onSubmit={(e) => {
            e.preventDefault()
            void action.run(async () => {
              await mutation(
                `/donations/${donation.id}`,
                donationSchema,
                { status: 'received', notes },
                'PATCH',
              )
              setReceive(false)
              onChange()
            }, 'Donation received. Stock is now available.')
          }}
        >
          <h3>Confirm receiving check</h3>
          <p className="small">
            Receive the full offered quantity. Check quantity, packaging, dates, storage and allergen
            information before confirming. Edit the offer first if the received quantity differs.
          </p>
          <Field label="Receiving notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              required
            />
            I have checked the food and accept the listed quantities.
          </label>
          <button className="btn" disabled={!checked || action.pending}>
            {action.pending ? 'Receiving…' : 'Confirm receipt'}
          </button>
        </form>
      )}
      {cancel && (
        <div className="panel warning stack no-print">
          <p>Cancel this offer? It will remain in history and cannot become available.</p>
          <div className="row">
            <button
              className="btn danger small"
              disabled={action.pending}
              onClick={() =>
                void action.run(async () => {
                  await mutation(
                    `/donations/${donation.id}`,
                    donationSchema,
                    { status: 'cancelled' },
                    'PATCH',
                  )
                  setCancel(false)
                  onChange()
                }, 'Offer cancelled.')
              }
            >
              Confirm cancellation
            </button>
            <button className="btn secondary small" onClick={() => setCancel(false)}>
              Keep offer
            </button>
          </div>
        </div>
      )}
      {donation.receivedAt && (
        <div className="receipt">
          <div className="eyebrow">Receipt of food donation</div>
          <h3 style={{ margin: '.5rem 0' }}>
            {config.organizationName} · {shortId(donation.id)}
          </h3>
          <p className="small">
            Received from {donation.donorName} on {formatDate(donation.receivedAt, config.timezone, true)}.
          </p>
          <p className="small">
            Confirmed weight:{' '}
            {(
              donation.items.reduce((sum, item) => sum + item.receivedQty * item.weightGrams, 0) / 1000
            ).toLocaleString()}{' '}
            kg.
          </p>
          <p className="muted small">
            This is an operational receiving record, not a tax receipt or a food-safety certification.
          </p>
        </div>
      )}
      <details className="no-print">
        <summary>Manage food photos</summary>
        <div className="stack" style={{ paddingTop: '1rem' }}>
          {donation.items.map((item) => (
            <ImageUploader key={item.id} item={item} onChange={onChange} />
          ))}
        </div>
      </details>
    </article>
  )
}
