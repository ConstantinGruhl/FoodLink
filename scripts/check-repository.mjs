import { execFileSync } from 'node:child_process'
import { root } from './docker.mjs'
const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
const forbidden = paths.filter(
  (path) =>
    /(^|\/)(node_modules|dist|coverage|backups)\//.test(path) ||
    (/(^|\/)\.env(?:\.|$)/.test(path) && !/\.example$/.test(path)),
)
if (forbidden.length) {
  console.error('Generated files or real environment files are tracked:', forbidden.slice(0, 15))
  process.exit(1)
}
console.log('Repository hygiene check passed.')
