import { useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { mutation } from '../lib/api'
import { useAction } from '../lib/hooks'
import { donationSchema, type Donation, type DonationInput } from '../lib/schemas'
import { csvList, localInputDate } from '../lib/format'
import { ActionMessages, Alert, Field } from './ui'
type Draft = DonationInput & { id?: string; key: string; allergenText: string }
function blank(): Draft {
  return {
    key: crypto.randomUUID(),
    name: '',
    qty: 1,
    unit: 'unit',
    storage: 'ambient',
    expiresOn: '',
    weightGrams: 500,
    category: 'Other',
    allergens: [],
    allergenText: '',
    handlingNotes: '',
  }
}
export default function DonationForm({
  existing,
  onSaved,
  onCancel,
}: {
  existing?: Donation
  onSaved: (donation: Donation) => void
  onCancel?: () => void
}) {
  const action = useAction()
  const [date, setDate] = useState(existing ? localInputDate(existing.date) : '')
  const [lines, setLines] = useState<Draft[]>(
    existing
      ? existing.items.map((item) => ({
          key: item.id,
          id: item.id,
          name: item.name,
          qty: item.offeredQty,
          unit: item.unit,
          storage: item.storage,
          expiresOn: item.expiresOn?.slice(0, 10) || '',
          weightGrams: item.weightGrams,
          category: item.category,
          allergens: item.allergens,
          allergenText: item.allergens.join(', '),
          handlingNotes: item.handlingNotes || '',
        }))
      : [blank()],
  )
  function update(index: number, patch: Partial<Draft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    await action.run(async () => {
      const items = lines.map(({ key: _key, allergenText, ...line }) => ({
        ...line,
        allergens: csvList(allergenText),
        expiresOn: line.expiresOn ? new Date(`${line.expiresOn}T23:59:59`).toISOString() : undefined,
      }))
      const data = await mutation(
        existing ? `/donations/${existing.id}` : '/donations',
        donationSchema,
        { ...(date ? { date: new Date(date).toISOString() } : {}), items },
        existing ? 'PUT' : 'POST',
      )
      onSaved(data)
    })
  }
  return (
    <form className="stack-lg" onSubmit={submit}>
      <ActionMessages error={action.error} success={action.success} />
      <Alert kind="info">
        Describe the food accurately. Staff must receive and check it before anyone can reserve it. Add photos
        to individual food items after saving.
      </Alert>
      <Field label="Planned handover" hint="Optional. Time is entered in your device’s local timezone.">
        <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {lines.map((line, i) => (
        <fieldset className="card stack" key={line.key}>
          <legend className="eyebrow">Food item {i + 1}</legend>
          <div className="form-grid">
            <Field label="Food name" required>
              <input
                value={line.name}
                onChange={(e) => update(i, { name: e.target.value })}
                maxLength={160}
                required
                placeholder="e.g. Wholemeal bread"
              />
            </Field>
            <Field label="Category">
              <select value={line.category} onChange={(e) => update(i, { category: e.target.value })}>
                {['Produce', 'Bakery', 'Dairy', 'Prepared food', 'Pantry', 'Other'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Quantity offered" required>
              <input
                type="number"
                min={1}
                max={10000}
                step={1}
                value={line.qty}
                onChange={(e) => update(i, { qty: Number(e.target.value) })}
                required
              />
            </Field>
            <Field label="Unit" required hint="One quantity unit, e.g. loaf, pack or bag.">
              <input
                value={line.unit}
                onChange={(e) => update(i, { unit: e.target.value })}
                maxLength={30}
                required
              />
            </Field>
            <Field
              label="Weight per unit (grams)"
              required
              hint="Used to measure distributed food, not to assess nutrition."
            >
              <input
                type="number"
                min={1}
                max={100000}
                step={1}
                value={line.weightGrams}
                onChange={(e) => update(i, { weightGrams: Number(e.target.value) })}
                required
              />
            </Field>
            <Field label="Storage" required>
              <select
                value={line.storage}
                onChange={(e) => update(i, { storage: e.target.value as Draft['storage'] })}
              >
                <option value="ambient">Room temperature</option>
                <option value="chilled">Keep chilled</option>
                <option value="frozen">Keep frozen</option>
              </select>
            </Field>
            <Field
              label="Use-by / availability end date"
              hint="Available until the end of this date in your device timezone. Include the exact label wording in notes."
            >
              <input
                type="date"
                value={line.expiresOn}
                onChange={(e) => update(i, { expiresOn: e.target.value })}
              />
            </Field>
            <Field
              label="Allergens"
              hint="Comma-separated. Leave empty only if unknown or none declared; staff must check."
            >
              <input
                value={line.allergenText}
                onChange={(e) => update(i, { allergenText: e.target.value })}
                maxLength={500}
                placeholder="e.g. wheat, milk"
              />
            </Field>
            <div className="span-all">
              <Field label="Handling and label notes">
                <textarea
                  value={line.handlingNotes}
                  onChange={(e) => update(i, { handlingNotes: e.target.value })}
                  maxLength={1000}
                  placeholder="Ingredients, packaging condition, storage temperatures or label details"
                />
              </Field>
            </div>
          </div>
          {!existing && lines.length > 1 && (
            <button
              type="button"
              className="btn danger small"
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              <Trash2 size={15} />
              Remove item {i + 1}
            </button>
          )}
        </fieldset>
      ))}
      <div className="row">
        {!existing && (
          <button
            type="button"
            className="btn secondary"
            disabled={lines.length >= 30}
            onClick={() => setLines([...lines, blank()])}
          >
            <Plus size={17} />
            Add another item
          </button>
        )}
        <button className="btn" disabled={action.pending}>
          {action.pending ? 'Saving…' : existing ? 'Save donation changes' : 'Submit food offer'}
        </button>
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel} disabled={action.pending}>
            Close
          </button>
        )}
      </div>
    </form>
  )
}
