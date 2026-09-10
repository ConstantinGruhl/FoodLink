import { pool, transaction } from './db.js'
import { migrate } from './migrate.js'
import { hashPassword } from './security.js'
import { passwordSchema } from './auth.js'
import { z } from 'zod'
async function bootstrap() {
  const email = z.string().email().parse(process.env.ADMIN_EMAIL).toLowerCase()
  const name = z
    .string()
    .min(1)
    .max(120)
    .parse(process.env.ADMIN_NAME || 'Administrator')
  const password = passwordSchema.parse(process.env.ADMIN_PASSWORD)
  await migrate()
  const encoded = await hashPassword(password)
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(742193002)')
    if (
      (
        await db.query(
          "SELECT 1 FROM users WHERE role='admin' AND password_hash IS NOT NULL AND NOT disabled",
        )
      ).rowCount
    )
      throw new Error('An active administrator already exists; use the administration interface')
    const existing = (await db.query('SELECT * FROM users WHERE lower(email)=$1', [email])).rows[0]
    if (existing && existing.role !== 'admin')
      throw new Error('This email belongs to a non-administrator account')
    await db.query(
      "INSERT INTO users(email,name,role,password_hash,verified,email_verified) VALUES($1,$2,'admin',$3,true,true) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,email_verified=true,disabled=false",
      [email, name, encoded],
    )
  })
  console.log('Administrator bootstrap complete')
}
bootstrap()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
    void pool.end()
  })
