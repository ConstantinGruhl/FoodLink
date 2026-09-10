import { Link } from 'react-router-dom'
import { ArrowRight, Check, HandHeart, Leaf, PackageCheck, Salad, ShoppingBasket } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useQuery } from '../lib/hooks'
import { impactSchema } from '../lib/schemas'
import { roleHome } from '../lib/format'
export default function Home() {
  const { user } = useAuth(),
    impact = useQuery('/impact', impactSchema)
  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Good food. A second chance.</div>
          <h1 style={{ marginTop: '1rem' }}>
            Less food waste.
            <br />
            More community.
          </h1>
          <p>
            Connect surplus food with people who can use it. Offer a donation, reserve food, and make every
            collection count.
          </p>
          <div className="row">
            <Link className="btn" to={user ? roleHome[user.role] : '/register'}>
              {user ? 'Open my workspace' : 'Get involved'}
              <ArrowRight size={18} />
            </Link>
            <Link className="btn secondary" to="/impact">
              See our impact
            </Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="food-bowl">
            <Salad strokeWidth={1.3} />
          </div>
          <span className="hero-tag one">
            <Leaf size={20} color="#4c7936" />A little less wasted
          </span>
          <span className="hero-tag two">
            <HandHeart size={21} color="#aa6929" />A little more shared
          </span>
        </div>
      </section>
      <div className="section-title">
        <div>
          <p className="eyebrow">From offer to collection</p>
          <h2 style={{ marginTop: '.45rem' }}>A simple way to share good food</h2>
        </div>
      </div>
      <div className="grid">
        {[
          {
            title: 'Offer what you can share',
            text: 'Donors describe their food, quantities, expiry, storage and allergens. Food becomes available after a staff receiving check.',
            icon: HandHeart,
          },
          {
            title: 'Reserve a collection',
            text: 'Approved recipients choose available food and a distribution event. A single reservation keeps the basket together.',
            icon: ShoppingBasket,
          },
          {
            title: 'Collect and confirm',
            text: 'Bring your collection ticket. Staff verify each pickup once, keeping inventory and the impact record accurate.',
            icon: PackageCheck,
          },
        ].map((step, i) => (
          <section className="card" key={step.title}>
            <div className="between">
              <span className="step-number">0{i + 1}</span>
              <step.icon size={24} color="#537948" />
            </div>
            <h3>{step.title}</h3>
            <p className="muted" style={{ marginTop: '.7rem', fontSize: '.92rem' }}>
              {step.text}
            </p>
          </section>
        ))}
      </div>
      {impact.data && (
        <>
          <div className="section-title">
            <div>
              <p className="eyebrow">Recorded outcomes</p>
              <h2 style={{ marginTop: '.45rem' }}>Small actions, measurable impact</h2>
            </div>
            <Link to="/impact">
              How we count <ArrowRight size={15} style={{ display: 'inline' }} />
            </Link>
          </div>
          <div className="grid four">
            {[
              [impact.data.totalKgSaved.toLocaleString(), 'kg of food distributed'],
              [impact.data.totalMealsDistributed.toLocaleString(), 'meal equivalents'],
              [impact.data.totalOrdersCompleted.toLocaleString(), 'completed orders'],
              [impact.data.totalDonors.toLocaleString(), 'contributing donors'],
            ].map(([value, label]) => (
              <div className="card" key={label}>
                <p className="stat">{value}</p>
                <p className="stat-label">{label}</p>
              </div>
            ))}
          </div>
        </>
      )}
      <section className="panel" style={{ marginTop: '2rem', padding: '1.5rem' }}>
        <div className="row">
          <Check size={22} />
          <div>
            <h3>Clear information, every step of the way</h3>
            <p className="muted small" style={{ marginTop: '.35rem' }}>
              Food details, receiving records, reservation status and collection confirmations stay connected.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
