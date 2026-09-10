import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { z } from 'zod'
import { useAuth } from '../lib/auth'
import { useQuery } from '../lib/hooks'
import { donationSchema } from '../lib/schemas'
import { Alert, Empty, ErrorPanel, Loading, PageHead, Pagination } from '../components/ui'
import DonationForm from '../components/DonationForm'
import DonationRecord from '../components/DonationRecord'
export default function DonorDashboard() {
  const { user } = useAuth(),
    [show, setShow] = useState(false),
    [message, setMessage] = useState(''),
    [offset, setOffset] = useState(0),
    query = useQuery(`/donations?limit=50&offset=${offset}`, z.array(donationSchema))
  return (
    <>
      <PageHead
        eyebrow="Donor workspace"
        title={`Make good food go further${user?.name ? `, ${user.name.split(' ')[0]}` : ''}.`}
        description="Submit an offer, add food details and photos, and follow it through receiving. Your original receiving record stays separate from remaining inventory."
        action={
          <button className="btn" disabled={!user?.emailVerified} onClick={() => setShow(!show)}>
            <Plus size={18} />
            {show ? 'Close form' : 'Offer food'}
          </button>
        }
      />
      <div className="stack-lg">
        {!user?.emailVerified && (
          <Alert kind="warning">
            Verify your email before offering food. <Link to="/profile">Open account settings</Link> to
            request a verification link.
          </Alert>
        )}
        {message && <Alert kind="success">{message}</Alert>}
        {show && (
          <section className="card stack">
            <h2>Offer a donation</h2>
            <DonationForm
              onSaved={() => {
                setShow(false)
                setMessage(
                  'Your offer has been saved. Add photos below and arrange handover with the operator.',
                )
                setOffset(0)
                query.reload()
              }}
              onCancel={() => setShow(false)}
            />
          </section>
        )}
        <h2>Your donation history</h2>
        {query.loading ? (
          <Loading />
        ) : query.error ? (
          <ErrorPanel error={query.error} retry={query.reload} />
        ) : query.data?.length ? (
          query.data.map((d) => <DonationRecord key={d.id} donation={d} onChange={query.reload} />)
        ) : (
          <div className="card">
            <Empty title="Your first food offer starts here">
              Use “Offer food” to tell the team what you can share.
            </Empty>
          </div>
        )}
        <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
      </div>
    </>
  )
}
