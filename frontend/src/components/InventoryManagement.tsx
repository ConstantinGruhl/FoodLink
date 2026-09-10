import { useState } from 'react'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, useQuery } from '../lib/hooks'
import { itemSchema, ledgerSchema, type Item } from '../lib/schemas'
import { formatDate, money, storageLabel } from '../lib/format'
import { ActionMessages, Badge, Empty, ErrorPanel, Field, Loading, Pagination } from './ui'
function StockCard({ item, onChange }: { item: Item; onChange: () => void }) {
  const { config } = useAuth(),
    action = useAction()
  const [mode, setMode] = useState<'edit' | 'dispose' | 'ledger' | null>(null),
    [surplus, setSurplus] = useState(item.isSurplus),
    [price, setPrice] = useState(item.priceCents / 100),
    [notes, setNotes] = useState(item.handlingNotes || ''),
    [qty, setQty] = useState(1),
    [reason, setReason] = useState('')
  const ledger = useQuery(mode === 'ledger' ? `/items/${item.id}/ledger` : null, z.array(ledgerSchema))
  return (
    <article className="card stack">
      <div className="between">
        <div>
          <h3>{item.name}</h3>
          <p className="small muted">
            {item.category} · {storageLabel(item.storage)}
          </p>
        </div>
        <Badge status={item.status} />
      </div>
      <div className="row">
        <strong>
          {item.qty} {item.unit} available
        </strong>
        <span className="badge">
          {item.isSurplus ? `Surplus · ${money(item.priceCents, config.currency)}` : 'Recipient allocation'}
        </span>
      </div>
      <p className="small muted">
        Availability end: {formatDate(item.expiresOn, config.timezone)} · {item.weightGrams}g / {item.unit}
      </p>
      <p className="small">
        Allergens: {item.allergens.length ? item.allergens.join(', ') : 'None declared; verify packaging'}
      </p>
      <ActionMessages error={action.error} success={action.success} />
      <div className="row">
        <button className="btn secondary small" onClick={() => setMode(mode === 'edit' ? null : 'edit')}>
          Allocation & notes
        </button>
        <button
          className="btn danger small"
          disabled={item.qty < 1}
          onClick={() => setMode(mode === 'dispose' ? null : 'dispose')}
        >
          Record disposal
        </button>
        <button className="btn secondary small" onClick={() => setMode(mode === 'ledger' ? null : 'ledger')}>
          Stock ledger
        </button>
      </div>
      {mode === 'edit' && (
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault()
            void action.run(async () => {
              await mutation(
                `/items/${item.id}`,
                itemSchema,
                {
                  ...(surplus !== item.isSurplus || Math.round(price * 100) !== item.priceCents
                    ? { isSurplus: surplus, priceCents: Math.round(price * 100) }
                    : {}),
                  handlingNotes: notes,
                },
                'PATCH',
              )
              setMode(null)
              onChange()
            }, 'Allocation updated.')
          }}
        >
          <label className="check">
            <input type="checkbox" checked={surplus} onChange={(e) => setSurplus(e.target.checked)} />
            Release unallocated available stock to surplus sales
          </label>
          {surplus && (
            <Field label={`Price per unit (${config.currency})`} required>
              <input
                type="number"
                min={0.01}
                max={1000}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                required
              />
            </Field>
          )}
          <Field label="Handling notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
          <p className="small muted">
            Stock allocated to existing orders cannot be reclassified. Payment availability is controlled
            separately.
          </p>
          <button className="btn" disabled={action.pending}>
            Save allocation
          </button>
        </form>
      )}
      {mode === 'dispose' && (
        <form
          className="panel warning stack"
          onSubmit={(e) => {
            e.preventDefault()
            void action.run(async () => {
              await mutation(`/items/${item.id}/dispose`, itemSchema, { qty, reason })
              setMode(null)
              onChange()
            }, 'Disposal recorded in the stock ledger.')
          }}
        >
          <Field label="Quantity to dispose" required>
            <input
              type="number"
              min={1}
              max={item.qty}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Reason" required>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              maxLength={1000}
              required
              placeholder="e.g. Damaged packaging found during receiving"
            />
          </Field>
          <button className="btn danger" disabled={action.pending}>
            Confirm disposal
          </button>
        </form>
      )}
      {mode === 'ledger' &&
        (ledger.loading ? (
          <Loading />
        ) : ledger.error ? (
          <ErrorPanel error={ledger.error} retry={ledger.reload} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption>Stock movements</caption>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Change</th>
                  <th>Action</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data?.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.createdAt, config.timezone, true)}</td>
                    <td>
                      {entry.delta > 0 ? '+' : ''}
                      {entry.delta}
                    </td>
                    <td>{entry.kind}</td>
                    <td>{entry.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </article>
  )
}
export default function InventoryManagement() {
  const [offset, setOffset] = useState(0),
    query = useQuery(`/inventory?limit=50&offset=${offset}`, z.array(itemSchema))
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('')
  return (
    <div className="stack">
      <h2>Inventory & stock movements</h2>
      <p className="muted small">
        Available quantities exclude reservations. Receiving, allocation, cancellation and disposal each leave
        a traceable movement.
      </p>
      <div className="filters">
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Find stock on this page"
          placeholder="Find stock on this page…"
        />
        <select
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter stock status"
        >
          <option value="">All states</option>
          {['offered', 'available', 'exhausted', 'disposed'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.filter(
          (i) => i.name.toLowerCase().includes(search.toLowerCase()) && (!status || i.status === status),
        ).length ? (
        <div className="grid two">
          {query.data
            .filter(
              (i) => i.name.toLowerCase().includes(search.toLowerCase()) && (!status || i.status === status),
            )
            .map((item) => (
              <StockCard key={item.id} item={item} onChange={query.reload} />
            ))}
        </div>
      ) : (
        <Empty title="No stock matches this view" />
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
