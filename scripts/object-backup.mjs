import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { compose, docker, output, root, writeContainerFile } from './docker.mjs'

const file = process.env.COMPOSE_FILE || 'docker-compose.yml'
const container = output(['compose', '-f', file, 'ps', '-q', 'backend'])
if (!container) throw new Error('Backend must be running for local storage backup')
const name = `foodlink-objects-${randomUUID()}.ndjson`
const directory = resolve(root, 'backups')
mkdirSync(directory, { recursive: true, mode: 0o700 })
const destination = resolve(directory, name)
const worker = '/tmp/foodlink-object-backup-worker.mjs'
const temporary = `/tmp/${name}`
writeContainerFile(file, 'backend', worker, readFileSync(resolve(root, 'scripts/object-backup-worker.mjs')))
try {
  compose(file, ['exec', '-T', 'backend', 'node', worker, 'backup', temporary])
  const archiveFile = openSync(destination, 'wx', 0o600)
  try {
    docker(
      [
        'compose',
        '-f',
        file,
        'exec',
        '-T',
        'backend',
        'node',
        '-e',
        "require('node:fs').createReadStream(process.argv[1]).pipe(process.stdout)",
        temporary,
      ],
      { stdio: ['ignore', archiveFile, 'inherit'] },
    )
  } finally {
    closeSync(archiveFile)
  }
  const sha256 = createHash('sha256').update(readFileSync(destination)).digest('hex')
  writeFileSync(`${destination}.sha256`, `${sha256}  ${name}\n`, { mode: 0o600 })
  console.log(`Local object archive and checksum saved to ${destination}`)
} finally {
  compose(file, ['exec', '-T', 'backend', 'rm', '-f', worker, temporary])
}
