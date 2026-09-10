import { useState } from 'react'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, useQuery } from '../lib/hooks'
import { okSchema } from '../lib/schemas'
import { money, shortId, formatDate } from '../lib/format'
import { ActionMessages, Alert, Badge, Empty, ErrorPanel, Loading, Pagination } from './ui'
const refundSchema = z.object({
  id: z.string(),
  userName: z.string(),
  totalCents: z.number(),
  paymentStatus: z.string(),
  refundStatus: z.string().nullable(),
  refundAttempt: z.number(),
  refundError: z.string().nullable(),
  refundNextAt: z.string().nullable(),
})
export default function RefundManagement() {
  const { config } = useAuth(),
    [offset, setOffset] = useState(0),
    query = useQuery(`/admin/refunds?limit=50&offset=${offset}`, z.array(refundSchema)),
    action = useAction()
  return (
    <div className="stack">
      <h2>Refund reconciliation</h2>
      {!config.paymentsEnabled && (
        <Alert kind="info">
          Purchasing is disabled in this installation. Historical refund records, if any, remain available for
          review.
        </Alert>
      )}
      <p className="muted small">
        Refunds are confirmed by the payment provider. A retry resumes a failed attempt; it does not mark an
        order refunded.
      </p>
      <ActionMessages error={action.error} success={action.success} />
      {query.loading ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={query.reload} />
      ) : query.data?.length ? (
        query.data.map((refund) => (
          <article className="card stack" key={refund.id}>
            <div className="between">
              <div>
                <h3>
                  Order {shortId(refund.id)} · {refund.userName}
                </h3>
                <p>{money(refund.totalCents, config.currency)}</p>
              </div>
              <Badge status={refund.paymentStatus} />
            </div>
            <p className="small muted">
              Provider status: {refund.refundStatus || 'Awaiting submission'} · Attempt {refund.refundAttempt}
            </p>
            {refund.refundError && <Alert>{refund.refundError}</Alert>}
            {refund.refundNextAt && (
              <p className="small muted">
                Next attempt: {formatDate(refund.refundNextAt, config.timezone, true)}
              </p>
            )}
            {refund.paymentStatus === 'refund-pending' && (
              <button
                className="btn secondary small"
                disabled={action.pending || !config.paymentsEnabled}
                onClick={() =>
                  void action.run(async () => {
                    await mutation(`/admin/refunds/${refund.id}/retry`, okSchema)
                    query.reload()
                  }, 'Refund retry queued. Check the provider status for its outcome.')
                }
              >
                Retry refund processing
              </button>
            )}
          </article>
        ))
      ) : (
        <Empty title="No refund records" />
      )}
      <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
    </div>
  )
}
