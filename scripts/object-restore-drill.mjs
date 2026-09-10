import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { compose, output, root, writeContainerFile } from './docker.mjs'

if (!process.argv[2]) throw new Error('Usage: node scripts/object-restore-drill.mjs backups/<archive>.ndjson')
const archive = resolve(process.argv[2])
const expected = readFileSync(`${archive}.sha256`, 'utf8').split(/\s/)[0]
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== expected)
  throw new Error('Archive checksum mismatch')
const file = process.env.COMPOSE_FILE || 'docker-compose.yml'
const container = output(['compose', '-f', file, 'ps', '-q', 'backend'])
if (!container) throw new Error('Backend must be running')
const worker = '/tmp/foodlink-object-backup-worker.mjs'
const temporary = `/tmp/foodlink-objects-${randomUUID()}.ndjson`
writeContainerFile(file, 'backend', worker, readFileSync(resolve(root, 'scripts/object-backup-worker.mjs')))
writeContainerFile(file, 'backend', temporary, readFileSync(archive))
try {
  compose(file, ['exec', '-T', 'backend', 'node', worker, 'restore', temporary])
} finally {
  compose(file, ['exec', '-T', 'backend', 'rm', '-f', worker, temporary])
}
