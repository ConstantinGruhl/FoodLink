import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { pool, transaction } from './db.js'
export async function migrate() {
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(742193001)')
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    const dir = new URL('../migrations/', import.meta.url)
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = (await readFile(new URL(file, dir), 'utf8')).replace(/^\uFEFF/, '')
      const hash = createHash('sha256').update(sql).digest('hex')
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [file])
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== hash) throw new Error(`Migration checksum changed: ${file}`)
        continue
      }
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [file, hash])
    }
  })
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  migrate()
    .then(() => pool.end())
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
      void pool.end()
    })
