import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { compose, output, docker } from './docker.mjs'
import assert from 'node:assert/strict'

const archive = process.argv[2] && resolve(process.argv[2])
if (!archive || !existsSync(archive))
  throw new Error('Usage: node scripts/restore-drill.mjs backups/<archive>.dump')
const expected = readFileSync(`${archive}.sha256`, 'utf8').split(/\s/)[0]
const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
if (expected !== actual) throw new Error('Archive checksum mismatch')
const file = process.env.COMPOSE_FILE || 'docker-compose.yml'
const database = `foodlink_restore_${randomUUID().replaceAll('-', '').slice(0, 16)}`
if (!/^foodlink_restore_[a-f0-9]{16}$/.test(database)) throw new Error('Unsafe restore target')
const container = output(['compose', '-f', file, 'ps', '-q', 'db'])
if (!container) throw new Error('Database service must be running')
const containerPath = `/tmp/${database}.dump`
// Only a new, isolated database is restored. Existing databases are never dropped.
docker(['cp', archive, `${container}:${containerPath}`])
try {
  compose(file, ['exec', '-T', 'db', 'createdb', '-U', 'foodlink', database])
  compose(file, [
    'exec',
    '-T',
    'db',
    'pg_restore',
    '-U',
    'foodlink',
    '-d',
    database,
    '--no-owner',
    '--no-acl',
    '--exit-on-error',
    containerPath,
  ])
  const countsSql =
    "SELECT json_build_object('users',(SELECT count(*) FROM users),'donations',(SELECT count(*) FROM donations),'donation_items',(SELECT count(*) FROM donation_items),'items',(SELECT count(*) FROM items),'orders',(SELECT count(*) FROM orders),'order_items',(SELECT count(*) FROM order_items),'item_images',(SELECT count(*) FROM item_images));"
  const counts = JSON.parse(
    output([
      'compose',
      '-f',
      file,
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'foodlink',
      '-d',
      database,
      '-qAtX',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      countsSql,
    ]),
  )
  const manifestPath = `${archive}.manifest.json`
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.deepEqual(counts, manifest.counts, 'Restored row counts differ from exported backup snapshot')
    console.log('All seven business-table counts match the original backup snapshot.')
  } else {
    console.log('Legacy archive has no snapshot manifest; restored counts:', JSON.stringify(counts))
  }
  compose(file, [
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    'foodlink',
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    "DO $$ BEGIN IF EXISTS (SELECT 1 FROM items WHERE qty < 0) THEN RAISE EXCEPTION 'Negative stock'; END IF; IF EXISTS (SELECT 1 FROM order_items oi LEFT JOIN orders o ON o.id=oi.order_id WHERE o.id IS NULL) THEN RAISE EXCEPTION 'Orphan order lines'; END IF; END $$;",
  ])
  const upgraded =
    output([
      'compose',
      '-f',
      file,
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'foodlink',
      '-d',
      database,
      '-qAtX',
      '-c',
      "SELECT to_regclass('public.inventory_movements') IS NOT NULL;",
    ]) === 't'
  if (upgraded) {
    compose(file, [
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'foodlink',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "DO $$ BEGIN IF EXISTS (SELECT i.id FROM items i JOIN inventory_movements m ON m.item_id=i.id GROUP BY i.id HAVING i.qty <> sum(m.delta)) THEN RAISE EXCEPTION 'Inventory ledger mismatch'; END IF; IF NOT EXISTS (SELECT 1 FROM schema_migrations) THEN RAISE EXCEPTION 'No schema migrations recorded'; END IF; END $$;",
    ])
    console.log('Restored migration records, foreign-key relationships, stock and inventory ledger verified.')
  }
  console.log(`Restore verified in isolated database ${database}. It is retained for inspection.`)
  console.log(
    'Use object-backup.mjs and object-restore-drill.mjs for separate local object-storage recovery verification.',
  )
} finally {
  compose(file, ['exec', '-T', 'db', 'rm', '-f', containerPath])
}
