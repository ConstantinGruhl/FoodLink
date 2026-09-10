import { useWorkspace } from '../lib/workspace'
import { Field, ErrorPanel } from './ui'
export default function LocationSelector() {
  const context = useWorkspace()
  return <section className="location-context no-print" aria-label="Current charity and location">
    <div className="between">
      <Field label="Your charity and location" hint="Food, visits and team actions use this location. Switching clears any unfinished basket.">
        <select value={context.selectedId} onChange={e => context.select(e.target.value)} disabled={context.loading && !context.locations.length}>
          {!context.locations.length && <option value="">{context.loading ? 'Finding locations…' : 'No active locations'}</option>}
          {[...new Set(context.locations.map(l => l.organizationName))].map(org => <optgroup label={org} key={org}>{context.locations.filter(l => l.organizationName === org).map(l => <option key={l.id} value={l.id}>{l.name} · {l.city || l.postalCode || l.code}</option>)}</optgroup>)}
        </select>
      </Field>
      {context.location && <p className="small muted">{context.location.address}<br />{context.location.openingHours}</p>}
    </div>
    {context.error && <ErrorPanel error={context.error} retry={context.reload} />}
  </section>
}
