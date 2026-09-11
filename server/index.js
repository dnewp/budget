import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { identityMiddleware } from './identity.js'
import { routes } from './routes.js'
import { workspaceRoutes } from './workspaces.js'
import { db } from './db.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// .env is optional now (no required password). OWNER_EMAIL, when set, is read by
// db.js; loading here is best-effort so a fresh dev run with no .env still works.
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {}

const app = express()
app.use(express.json())

app.use('/api', identityMiddleware(db))
app.use('/api', routes)
app.use('/api', workspaceRoutes)

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
