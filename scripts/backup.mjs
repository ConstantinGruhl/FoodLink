import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { compose, output, docker, root } from './docker.mjs'
import { spawn } from 'node:child_process'

const file = process.env.COMPOSE_FILE || 'docker-compose.yml'
const database = process.env.BACKUP_DATABASE || 'foodlink'
if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error('Invalid database identifier')
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const directory = resolve(root, 'backups')
mkdirSync(directory, { recursive: true, mode: 0o700 })
const name = `${database}-${stamp}.dump`
const destination = resolve(directory, name)
const containerPath = `/tmp/${name}`
const container = output(['compose', '-f', file, 'ps', '-q', 'db'])
if (!container) throw new Error('Database service must be running')
// Keep an exported PostgreSQL snapshot open so the archive and count manifest
// describe the same committed state, even while normal requests keep running.
const snapshotSession = spawn(
  'docker',
  [
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
  ],
  { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] },
)
const snapshot = await new Promise((resolveSnapshot, reject) => {
  let buffer = ''
  const timer = setTimeout(() => {
    snapshotSession.kill()
    reject(new Error('Timed out opening backup snapshot'))
  }, 15000)
  snapshotSession.on('error', (error) => {
    clearTimeout(timer)
    reject(error)
  })
  snapshotSession.on('exit', (code) => {
    if (code !== 0) {
      clearTimeout(timer)
      reject(new Error('Backup snapshot session failed'))
    }
  })
  snapshotSession.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    if (!buffer.includes('\n')) return
    try {
      const result = JSON.parse(buffer.trim())
      clearTimeout(timer)
      resolveSnapshot(result)
    } catch (error) {
      clearTimeout(timer)
      reject(error)
    }
  })
  snapshotSession.stdin.write(
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT json_build_object('snapshot',pg_export_snapshot(),'counts',json_build_object('users',(SELECT count(*) FROM users),'donations',(SELECT count(*) FROM donations),'donation_items',(SELECT count(*) FROM donation_items),'items',(SELECT count(*) FROM items),'orders',(SELECT count(*) FROM orders),'order_items',(SELECT count(*) FROM order_items),'item_images',(SELECT count(*) FROM item_images)));\n",
  )
})
// pg_dump writes its binary archive inside the container to avoid PowerShell
// pipeline encoding corrupting it. docker cp copies the exact bytes.
try {
  compose(file, [
    'exec',
    '-T',
    'db',
    'pg_dump',
    '-U',
    'foodlink',
    '-d',
    database,
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--snapshot',
    snapshot.snapshot,
    '--file',
    containerPath,
  ])
  docker(['cp', `${container}:${containerPath}`, destination])
} finally {
  compose(file, ['exec', '-T', 'db', 'rm', '-f', containerPath])
  snapshotSession.stdin.end('COMMIT;\n')
}
const sha256 = createHash('sha256').update(readFileSync(destination)).digest('hex')
writeFileSync(`${destination}.sha256`, `${sha256}  ${name}\n`, { mode: 0o600 })
writeFileSync(
  `${destination}.manifest.json`,
  JSON.stringify(
    { database, createdAt: new Date().toISOString(), sha256, counts: snapshot.counts },
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
)
console.log(`Archive, snapshot count manifest and checksum saved to ${destination}`)
console.log('Copy it to encrypted off-host storage; a local copy is not disaster recovery.')
