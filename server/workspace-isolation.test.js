import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function bootApp(dataDir) {
  process.env.DATA_DIR_OVERRIDE = dataDir // read by db.js, see Step 2 below
  const { default: express } = await import('express')
  const { identityMiddleware } = await import('./identity.js')
  const { db } = await import('./db.js')
  const { routes } = await import('./routes.js')
  const app = express()
  app.use(express.json())
  app.use('/api', identityMiddleware(db))
  app.use('/api', routes)
  return app
}

test('two workspaces cannot see each other\'s accounts', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'envelope-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const app = await bootApp(dir)

  const asAlice = { headers: { 'cf-access-authenticated-user-email': 'alice@example.com' } }
  const asBob = { headers: { 'cf-access-authenticated-user-email': 'bob@example.com' } }

  // Use supertest-free raw http calls against the app via a listener, since this
  // repo has no supertest dependency and doesn't need one for two calls.
  const server = app.listen(0)
  const port = server.address().port
  t.after(() => server.close())

  async function call(path, opts, headers) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers: { ...opts.headers, ...headers } })
    return { status: res.status, body: await res.json() }
  }

  await call('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: "Alice's Checking", type: 'checking' }) }, asAlice.headers)
  await call('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: "Bob's Checking", type: 'checking' }) }, asBob.headers)

  const aliceView = await call('/api/accounts', {}, asAlice.headers)
  const bobView = await call('/api/accounts', {}, asBob.headers)

  assert.equal(aliceView.body.length, 1)
  assert.equal(aliceView.body[0].name, "Alice's Checking")
  assert.equal(bobView.body.length, 1)
  assert.equal(bobView.body[0].name, "Bob's Checking")
})
