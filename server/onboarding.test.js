import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function bootApp(dataDir) {
  process.env.DATA_DIR_OVERRIDE = dataDir // read by db.js, see workspace-isolation.test.js
  const { default: express } = await import('express')
  const { identityMiddleware } = await import('./identity.js')
  const { db } = await import('./db.js')
  const { routes } = await import('./routes.js')
  const app = express()
  app.use(express.json())
  app.use('/api', identityMiddleware(db))
  app.use('/api', routes)
  app.use('/api', (err, _req, res, _next) => {
    const status = err.status ?? 500
    if (status === 500) console.error(err)
    res.status(status).json({ error: status === 500 ? 'Internal error' : err.message })
  })
  return app
}

function makeCaller(port) {
  return async function call(path, opts = {}, headers) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers: { ...opts.headers, ...headers } })
    return { status: res.status, body: await res.json() }
  }
}

test('a fresh user starts unonboarded and can mark onboarding done', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'envelope-onboarding-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const app = await bootApp(dir)

  const asChris = { 'cf-access-authenticated-user-email': 'chris@example.com' }
  const server = app.listen(0)
  const port = server.address().port
  t.after(() => server.close())
  const call = makeCaller(port)

  const before = await call('/api/me', {}, asChris)
  assert.equal(before.status, 200)
  assert.equal(before.body.onboarded, false)

  const marked = await call('/api/me/onboarded', { method: 'POST' }, asChris)
  assert.equal(marked.status, 200)
  assert.deepEqual(marked.body, { ok: true })

  const after = await call('/api/me', {}, asChris)
  assert.equal(after.status, 200)
  assert.equal(after.body.onboarded, true)
})
