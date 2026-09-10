import nodemailer from 'nodemailer'
import { config } from './config.js'
import { pool, transaction, type Db } from './db.js'
export async function audit(
  db: Db,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown = {},
) {
  await db.query(
    'INSERT INTO audit_log(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
    [actorId, action, entityType, entityId, JSON.stringify(details)],
  )
}
export async function mail(db: Db, userId: string, subject: string, body: string) {
  await db.query(
    'INSERT INTO mail_outbox(user_id,recipient,subject,body) SELECT id,email,$2,$3 FROM users WHERE id=$1',
    [userId, subject, body],
  )
}
export async function notify(db: Db, userId: string, subject: string, body: string) {
  await db.query('INSERT INTO notifications(user_id,subject,body) VALUES($1,$2,$3)', [userId, subject, body])
  await mail(db, userId, subject, body)
}
const transport =
  config.mailMode === 'smtp'
    ? nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
        auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      })
    : null
let processing = false
export async function processMail() {
  if (!transport || processing) return
  processing = true
  try {
    for (let n = 0; n < 20; n++) {
      const sent = await transaction(async (db) => {
        const { rows } = await db.query(
          "SELECT * FROM mail_outbox WHERE status='pending' AND available_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
        const m = rows[0]
        if (!m) return false
        try {
          await transport.sendMail({
            from: config.mailFrom,
            to: m.recipient,
            subject: m.subject,
            text: m.body,
            messageId: `<${m.id}@foodlink.local>`,
          })
          await db.query(
            "UPDATE mail_outbox SET status='sent',sent_at=now(),attempts=attempts+1,last_error=null WHERE id=$1",
            [m.id],
          )
        } catch {
          await db.query(
            "UPDATE mail_outbox SET attempts=attempts+1,status=CASE WHEN attempts>=7 THEN 'failed' ELSE 'pending' END,available_at=now()+least(3600,power(2,attempts+1)*30)*interval '1 second',last_error='SMTP delivery failed; inspect mail service' WHERE id=$1",
            [m.id],
          )
        }
        return true
      })
      if (!sent) break
    }
  } finally {
    processing = false
  }
}
export async function communicationReadiness() {
  if (transport) await transport.verify()
  await pool.query('SELECT 1')
}
