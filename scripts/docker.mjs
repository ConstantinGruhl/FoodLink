import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../', import.meta.url))
export function docker(args, options = {}) {
  return execFileSync('docker', args, { cwd: root, stdio: 'inherit', ...options })
}
export function output(args) {
  return docker(args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim()
}
export function compose(file, args) {
  return docker(['compose', '-f', file, ...args])
}
export function writeContainerFile(file, service, path, bytes) {
  // Docker cp cannot extract into a read-only rootfs, even when /tmp is tmpfs.
  // Write as the service's unprivileged user through standard input instead.
  return docker(
    [
      'compose',
      '-f',
      file,
      'exec',
      '-T',
      service,
      'node',
      '-e',
      "require('node:fs').writeFileSync(process.argv[1],require('node:fs').readFileSync(0),{mode:0o600})",
      path,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'], input: bytes },
  )
}
