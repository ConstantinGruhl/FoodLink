import { Link } from 'react-router-dom'
import { useQuery } from '../lib/hooks'
import { impactSchema } from '../lib/schemas'
import { Empty, ErrorPanel, Loading, PageHead } from '../components/ui'
export default function PublicImpact() {
  const query = useQuery('/impact', impactSchema)
  return (
    <>
      <PageHead
        eyebrow="FoodLink impact"
        title="Food shared. Impact recorded."
        description="Figures come from confirmed pickups and completed deliveries, with no projected or demonstration marketing totals."
      />
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : (
        query.data && (
          <div className="stack-lg">
            <div className="grid four">
              {[
                [query.data.totalKgSaved.toLocaleString(), 'kg distributed'],
                [query.data.totalMealsDistributed.toLocaleString(), 'meal equivalents'],
                [query.data.totalOrdersCompleted.toLocaleString(), 'completed orders'],
                [query.data.totalDonors.toLocaleString(), 'contributing donors'],
              ].map(([n, label]) => (
                <div className="card" key={label}>
                  <p className="stat">{n}</p>
                  <p className="stat-label">{label}</p>
                </div>
              ))}
            </div>
            <section className="card stack">
              <h2>Distribution over time</h2>
              {query.data.monthly.length ? (
                <div className="stack">
                  {query.data.monthly.map((m) => (
                    <div className="chart-row" key={m.month}>
                      <span>{m.month.slice(0, 7)}</span>
                      <div className="chart-bar" aria-hidden="true">
                        <span
                          style={{
                            width: `${(m.kg / Math.max(...query.data!.monthly.map((x) => x.kg), 1)) * 100}%`,
                          }}
                        />
                      </div>
                      <span>{m.kg.toLocaleString()} kg</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="The first completed collection starts the story">
                  Completed orders will appear here.
                </Empty>
              )}
            </section>
            <section className="card stack">
              <h2>How these figures are calculated</h2>
              <p className="muted">{query.data.methodology}</p>
              <p className="small muted">
                Meal equivalents are a weight-based estimate, not a count of meals served or a nutritional
                assessment. Offers, cancellations and uncollected reservations do not count as distributed
                food.
              </p>
              <Link to="/">Back to FoodLink</Link>
            </section>
          </div>
        )
      )}
    </>
  )
}
