import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { downloadJson } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useQuery } from '../lib/hooks'
import { reportSchema } from '../lib/schemas'
import { formatDate, shortId, calendarDay } from '../lib/format'
import { Alert, Empty, ErrorPanel, Field, Loading, PageHead } from '../components/ui'
export default function Reports() {
  const { config } = useAuth(),
    today = calendarDay(config.timezone),
    [from, setFrom] = useState(today.slice(0, 7) + '-01'),
    [to, setTo] = useState(today),
    [period, setPeriod] = useState({ from, to })
  const query = useQuery(`/reports?from=${period.from}&to=${period.to}`, reportSchema)
  return (
    <>
      <PageHead
        eyebrow="Operations reporting"
        title="Food distribution report"
        description="A defined reporting period, confirmed outcomes, and the records behind the totals."
        action={
          <Link className="btn secondary" to="/volunteer">
            Back to operations
          </Link>
        }
      />
      <div className="stack-lg">
        <form
          className="card inline-form no-print"
          onSubmit={(e) => {
            e.preventDefault()
            if (from <= to) setPeriod({ from, to })
          }}
        >
          <Field label="From date" required>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required max={to} />
          </Field>
          <Field label="Through date" required>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required min={from} />
          </Field>
          <button className="btn" disabled={from > to}>
            Apply period
          </button>
        </form>
        {from > to && <Alert>The start date must be on or before the end date.</Alert>}
        {query.loading ? (
          <Loading />
        ) : query.error ? (
          <ErrorPanel error={query.error} retry={query.reload} />
        ) : (
          query.data && (
            <>
              {query.data.truncated && (
                <Alert kind="warning">
                  Totals cover the whole period. Only the first 2,000 order records are shown; choose a
                  shorter period for all detail records.
                </Alert>
              )}
              <section className="card stack">
                <div className="between">
                  <div>
                    <h2>{config.organizationName}</h2>
                    <p className="muted">
                      {formatDate(query.data.from, config.timezone)} –{' '}
                      {formatDate(query.data.to, config.timezone)}
                    </p>
                  </div>
                  <div className="row no-print">
                    <button className="btn secondary small" onClick={() => window.print()}>
                      <Printer size={16} />
                      Print / save PDF
                    </button>
                    <button
                      className="btn secondary small"
                      onClick={() =>
                        downloadJson(`foodlink-report-${period.from}-${period.to}.json`, query.data)
                      }
                    >
                      <Download size={16} />
                      Export data
                    </button>
                  </div>
                </div>
                <div className="grid four">
                  {[
                    [query.data.kgDistributed.toLocaleString(), 'kg distributed'],
                    [query.data.mealsDistributed.toLocaleString(), 'meal equivalents'],
                    [query.data.completedOrders.toLocaleString(), 'completed orders'],
                    [query.data.receivedDonations.toLocaleString(), 'received donations'],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <p className="stat">{value}</p>
                      <p className="stat-label">{label}</p>
                    </div>
                  ))}
                </div>
                <p className="small muted">
                  Disposed food in this period: {query.data.disposedKg.toLocaleString()} kg. Distribution
                  totals include completed pickups and deliveries only. One meal equivalent is 500 g of food.
                </p>
              </section>
              {query.data.orders.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <caption>Completed order records</caption>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Completed</th>
                        <th>Method</th>
                        <th>Food</th>
                        <th>Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.orders.map((order) => (
                        <tr key={order.id}>
                          <td>{shortId(order.id)}</td>
                          <td>{formatDate(order.completedAt, config.timezone, true)}</td>
                          <td>{order.fulfillment}</td>
                          <td>{order.items.map((i) => `${i.qty} ${i.unit} ${i.name}`).join(', ')}</td>
                          <td>
                            {(
                              order.items.reduce((sum, i) => sum + i.weightGrams * i.qty, 0) / 1000
                            ).toLocaleString()}{' '}
                            kg
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="card">
                  <Empty title="No completed orders in this period">
                    Choose another period or complete a collection to create a distribution record.
                  </Empty>
                </div>
              )}
            </>
          )
        )}
      </div>
    </>
  )
}
