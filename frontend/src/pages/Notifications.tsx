import { useState } from 'react'
import { z } from 'zod'
import { mutation } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, useQuery } from '../lib/hooks'
import { notificationSchema, okSchema } from '../lib/schemas'
import { formatDate } from '../lib/format'
import { ActionMessages, Badge, Empty, ErrorPanel, Loading, PageHead, Pagination } from '../components/ui'
export default function Notifications() {
  const { config } = useAuth(),
    [offset, setOffset] = useState(0),
    query = useQuery(`/notifications?limit=50&offset=${offset}`, z.array(notificationSchema)),
    action = useAction()
  return (
    <>
      <PageHead
        eyebrow="Keep in touch"
        title="Your FoodLink inbox"
        description="Reservation confirmations, donation updates, collection reminders and account messages in one place."
      />
      <div className="stack">
        <ActionMessages error={action.error} success={action.success} />
        {query.loading ? (
          <Loading />
        ) : query.error ? (
          <ErrorPanel error={query.error} retry={query.reload} />
        ) : query.data?.length ? (
          query.data.map((n) => (
            <article className={`card stack notification ${!n.readAt ? 'unread' : ''}`} key={n.id}>
              <div className="between">
                <h3>{n.subject}</h3>
                {!n.readAt && <Badge status="confirmed">New</Badge>}
              </div>
              <p style={{ whiteSpace: 'pre-line' }}>{n.body}</p>
              <div className="between">
                <span className="small muted">{formatDate(n.createdAt, config.timezone, true)}</span>
                {!n.readAt && (
                  <button
                    className="btn secondary small"
                    disabled={action.pending}
                    onClick={() =>
                      void action.run(async () => {
                        await mutation(`/notifications/${n.id}`, okSchema, { read: true }, 'PATCH')
                        query.reload()
                      })
                    }
                  >
                    Mark as read
                  </button>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className="card">
            <Empty title="You’re all caught up">Updates about your FoodLink activity will appear here.</Empty>
          </div>
        )}
        <Pagination offset={offset} count={query.data?.length || 0} setOffset={setOffset} />
      </div>
    </>
  )
}
