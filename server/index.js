import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyPassword, sessionToken, requireAuth, sessionCookie } from './auth.js'
import { routes } from './routes.js'
import './db.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  console.error('No .env found. Run: npm run set-password -- <password>')
  process.exit(1)
}
const SECRET = process.env.SESSION_SECRET
const PASSWORD_HASH = process.env.BUDGET_PASSWORD_HASH
if (!SECRET || !PASSWORD_HASH) {
  console.error('.env is missing SESSION_SECRET or BUDGET_PASSWORD_HASH. Run: npm run set-password -- <password>')
  process.exit(1)
}

const app = express()
app.use(express.json())

const YEAR = 365 * 24 * 60 * 60
app.post('/api/login', (req, res) => {
  const { password } = req.body || {}
  if (typeof password !== 'string' || !verifyPassword(password, PASSWORD_HASH)) {
    return res.status(401).json({ error: 'Wrong password' })
  }
  res.setHeader('Set-Cookie', sessionCookie(sessionToken(SECRET), YEAR, req))
  res.json({ ok: true })
})

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', sessionCookie('', 0, req))
  res.json({ ok: true })
})

app.use('/api', requireAuth(SECRET))
app.get('/api/me', (_req, res) => res.json({ ok: true }))
app.use('/api', routes)

app.use('/api', (err, _req, res, _next) => {
  if (!err.status) console.error(err)
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' })
})

// One process, one port. Dev mounts Vite in middleware mode; production serves the
// build. The mode is an explicit flag, so a leftover dist/ never shadows dev.
const dist = path.join(root, 'dist')
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite')
  const vite = await createServer({ root, appType: 'spa', server: { middlewareMode: true } })
  app.use(vite.middlewares)
} else if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
} else {
  console.error('No dist/ found. Run `npm run build` first, or use `npm run dev`.')
  process.exit(1)
}

// Behind a tunnel, HOST should be 127.0.0.1 so nothing on the LAN can reach the
// app directly; only cloudflared, running on the same box, can. Defaults to all
// interfaces so plain local development still works from another device.
const PORT = Number(process.env.PORT) || 4517
const HOST = process.env.HOST || '0.0.0.0'
app.listen(PORT, HOST, () => console.log(`Budget listening on http://${HOST}:${PORT}`))
