import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire('/app/package.json')
const { Pool } = require('pg')
const connectionString = process.env.TEST_DATABASE_URL
if (!connectionString || new URL(connectionString).pathname !== '/foodlink_test')
  throw new Error('Dedicated test database required')
const control = new Pool({ connectionString })
const name = 'foodlink_upgrade_test'
// This project starts with a fresh ephemeral cluster; never drop another DB.
await control.query(`CREATE DATABASE ${name}`)
const target = new URL(connectionString)
target.pathname = `/${name}`
const db = new Pool({ connectionString: target.href })
try {
  await db.query(await readFile('/tests/legacy-baseline.sql', 'utf8'))
  const tables = ['users', 'items', 'donations', 'events', 'orders', 'item_images']
  const before = {}
  for (const table of tables) before[table] = (await db.query(`SELECT id FROM ${table} ORDER BY id`)).rows
  const baselineStock = (await db.query('SELECT id,qty,name FROM items ORDER BY id')).rows
  execFileSync(process.execPath, ['/app/dist/migrate.js'], {
    cwd: '/app',
    env: { ...process.env, DATABASE_URL: target.href },
    stdio: 'inherit',
  })
  execFileSync(process.execPath, ['/app/dist/migrate.js'], {
    cwd: '/app',
    env: { ...process.env, DATABASE_URL: target.href },
    stdio: 'inherit',
  })
  for (const table of tables)
    assert.deepEqual(
      (await db.query(`SELECT id FROM ${table} ORDER BY id`)).rows,
      before[table],
      `${table}: legacy row IDs preserved`,
    )
  assert.deepEqual(
    (await db.query('SELECT id,qty,name FROM items ORDER BY id')).rows,
    baselineStock,
    'Legacy stock values and names preserved',
  )
  assert.ok((await db.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n >= 2)
  const mismatch = await db.query(
    'SELECT i.id FROM items i JOIN inventory_movements m ON m.item_id=i.id GROUP BY i.id HAVING i.qty <> sum(m.delta)',
  )
  assert.deepEqual(mismatch.rows, [], 'Upgraded legacy stock matches opening ledger')
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM users WHERE password_hash IS NOT NULL')).rows[0].n,
    0,
    'Migration does not add a shared password to legacy accounts',
  )
  const roleSql = (await readFile('/ops/database-role.sql', 'utf8'))
    .replace(":'app_password'", "'test-limited-role-password-2026'")
    .replace(':"database_name"', name)
  await db.query(roleSql)
  const limitedUrl = new URL(target)
  limitedUrl.username = 'foodlink_app'
  limitedUrl.password = 'test-limited-role-password-2026'
  const limited = new Pool({ connectionString: limitedUrl.href })
  try {
    assert.equal(
      (await limited.query('SELECT usesuper FROM pg_user WHERE usename=current_user')).rows[0].usesuper,
      false,
    )
    for (const table of ['audit_log', 'inventory_movements', 'stripe_events']) {
      assert.equal(
        (await limited.query("SELECT has_table_privilege(current_user,$1,'INSERT') ok", [table])).rows[0].ok,
        true,
      )
      assert.equal(
        (await limited.query("SELECT has_table_privilege(current_user,$1,'UPDATE') ok", [table])).rows[0].ok,
        false,
      )
      assert.equal(
        (await limited.query("SELECT has_table_privilege(current_user,$1,'DELETE') ok", [table])).rows[0].ok,
        false,
      )
    }
    assert.equal(
      (await limited.query("SELECT has_table_privilege(current_user,'schema_migrations','UPDATE') ok"))
        .rows[0].ok,
      false,
    )
    assert.equal(
      (await limited.query("SELECT has_schema_privilege(current_user,'public','CREATE') ok")).rows[0].ok,
      false,
    )
    assert.ok((await limited.query('SELECT count(*)::int n FROM users')).rows[0].n > 0)
    console.log(
      'Production runtime role verified: data access without superuser/schema/migration or append-only history modification privileges.',
    )
  } finally {
    await limited.end()
  }
  console.log(
    'Legacy schema upgrade and migration reapplication passed; all legacy IDs and stock values preserved.',
  )
} finally {
  await db.end()
  await control.end()
}
