// Usage: npm run set-password -- <new-password>
// Writes BUDGET_PASSWORD_HASH (and SESSION_SECRET if missing) into .env.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './auth.js'

const password = process.argv[2]
if (!password) {
  console.error('Usage: npm run set-password -- <new-password>')
  process.exit(1)
}

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
let lines = existsSync(envPath)
  ? readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean)
  : []
lines = lines.filter((l) => !l.startsWith('BUDGET_PASSWORD_HASH='))
lines.push(`BUDGET_PASSWORD_HASH=${hashPassword(password)}`)
if (!lines.some((l) => l.startsWith('SESSION_SECRET='))) {
  lines.push(`SESSION_SECRET=${randomBytes(32).toString('hex')}`)
}
writeFileSync(envPath, lines.join('\n') + '\n')
console.log('Password updated. Restart the server to apply.')
