import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { identityMiddleware } from './identity.js'
import { routes } from './routes.js'
import { workspaceRoutes } from './workspaces.js'
import { db } from './db.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const app = express()
app.use(express.json())

app.use('/api', identityMiddleware(db))
app.use('/api', routes)
app.use('/api', workspaceRoutes)

app.use('/api', (err, _req, res, _next) => {
  const status = err.status ?? 500
  if (status === 500) console.error(err)
  res.status(status).json({ error: status === 500 ? 'Internal error' : err.message })
})

const dist = path.join(root, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const port = process.env.PORT || 4517
const host = process.env.HOST || '0.0.0.0'
app.listen(port, host, () => console.log(`Envelope listening on ${host}:${port}`))
