import { compose } from './docker.mjs'

// A separate Compose project, no published ports, no shared volumes and a tmpfs DB.
// Never point the blackbox test harness at a user database.
const file = 'docker-compose.test.yml'
let failure
try {
  compose(file, ['--profile', 'payments-test', 'down', '--remove-orphans'])
  compose(file, ['build', 'backend'])
  compose(file, ['up', '-d', '--wait', '--wait-timeout', '120', 'backend'])
  // Reapplying migrations must be harmless on an already initialized database.
  compose(file, ['exec', '-T', 'backend', 'node', 'dist/migrate.js'])
  compose(file, ['run', '--rm', 'migration-tests'])
  compose(file, ['run', '--rm', 'tests'])
  compose(file, [
    '--profile',
    'payments-test',
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '60',
    'payments-backend',
  ])
  compose(file, ['run', '--rm', 'payments-tests'])
} catch (error) {
  failure = error
  try {
    compose(file, ['logs', '--no-color', '--tail', '100', 'backend'])
  } catch {}
} finally {
  compose(file, ['--profile', 'payments-test', 'down', '--remove-orphans'])
}
if (failure) process.exit(1)
