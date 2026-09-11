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
  app.use('/api', (err, _req, res, _next) => {
    const status = err.status ?? 500
    if (status === 500) console.error(err)
    res.status(status).json({ error: status === 500 ? 'Internal error' : err.message })
  })
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

  // Each new workspace also gets the starter template's "Checking" account, so
  // there are two accounts per workspace, not one.
  assert.equal(aliceView.body.length, 2)
  assert.ok(aliceView.body.some((a) => a.name === "Alice's Checking"))
  assert.ok(!aliceView.body.some((a) => a.name === "Bob's Checking"))
  assert.equal(bobView.body.length, 2)
  assert.ok(bobView.body.some((a) => a.name === "Bob's Checking"))
  assert.ok(!bobView.body.some((a) => a.name === "Alice's Checking"))
})

function makeCaller(port) {
  return async function call(path, opts = {}, headers) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers: { ...opts.headers, ...headers } })
    return { status: res.status, body: await res.json() }
  }
}

async function setupAccountAndCategories(call, headers, label) {
  const account = await call(
    '/api/accounts',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${label} Checking`, type: 'checking' }) },
    headers
  )
  const group = await call(
    '/api/category-groups',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${label} Group` }) },
    headers
  )
  const catA = await call(
    '/api/categories',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${label} Envelope A`, group_id: group.body.id }) },
    headers
  )
  const catB = await call(
    '/api/categories',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${label} Envelope B`, group_id: group.body.id }) },
    headers
  )
  return { accountId: account.body.id, categoryAId: catA.body.id, categoryBId: catB.body.id }
}

test('cross-workspace split isolation: deleting/editing one workspace\'s split leaves the other\'s intact', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'envelope-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const app = await bootApp(dir)

  const asAlice = { 'cf-access-authenticated-user-email': 'alice@example.com' }
  const asBob = { 'cf-access-authenticated-user-email': 'bob@example.com' }

  const server = app.listen(0)
  const port = server.address().port
  t.after(() => server.close())
  const call = makeCaller(port)

  const alice = await setupAccountAndCategories(call, asAlice, 'Alice')
  const bob = await setupAccountAndCategories(call, asBob, 'Bob')

  const aliceSplit = await call(
    '/api/transactions',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: alice.accountId,
        date: '2026-01-15',
        payee: 'Alice Store',
        amount_cents: -1000,
        splits: [
          { category_id: alice.categoryAId, amount_cents: -600 },
          { category_id: alice.categoryBId, amount_cents: -400 },
        ],
      }) },
    asAlice
  )
  assert.equal(aliceSplit.status, 200)

  const bobSplit = await call(
    '/api/transactions',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: bob.accountId,
        date: '2026-01-15',
        payee: 'Bob Store',
        amount_cents: -1000,
        splits: [
          { category_id: bob.categoryAId, amount_cents: -700 },
          { category_id: bob.categoryBId, amount_cents: -300 },
        ],
      }) },
    asBob
  )
  assert.equal(bobSplit.status, 200)

  const aliceTxnsBefore = await call(`/api/transactions?account_id=${alice.accountId}`, {}, asAlice)
  assert.equal(aliceTxnsBefore.body.length, 2, 'Alice should see both her split lines before Bob touches his')

  // Bob's split_group number collides with Alice's (each starts at 1 within its
  // own workspace). Deleting Bob's split must not touch Alice's rows.
  const bobTxns = await call(`/api/transactions?account_id=${bob.accountId}`, {}, asBob)
  const bobTxnId = bobTxns.body[0].id
  const deleteResult = await call(`/api/transactions/${bobTxnId}`, { method: 'DELETE' }, asBob)
  assert.equal(deleteResult.status, 200)

  const aliceTxnsAfter = await call(`/api/transactions?account_id=${alice.accountId}`, {}, asAlice)
  assert.equal(aliceTxnsAfter.body.length, 2, "Alice's split rows must survive Bob deleting his own split")
  const totalCents = aliceTxnsAfter.body.reduce((sum, row) => sum + row.amount_cents, 0)
  assert.equal(totalCents, -1000)

  const bobTxnsAfter = await call(`/api/transactions?account_id=${bob.accountId}`, {}, asBob)
  assert.equal(bobTxnsAfter.body.length, 0, "Bob's own split should be gone")
})

test('cross-workspace mutation by id is blocked with 404, and the target row is untouched', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'envelope-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const app = await bootApp(dir)

  const asAlice = { 'cf-access-authenticated-user-email': 'alice@example.com' }
  const asBob = { 'cf-access-authenticated-user-email': 'bob@example.com' }

  const server = app.listen(0)
  const port = server.address().port
  t.after(() => server.close())
  const call = makeCaller(port)

  const alice = await setupAccountAndCategories(call, asAlice, 'Alice')
  // Bob needs his own account so the PUT body's account_id passes his own
  // ownedAccount check, isolating the assertion to ownedTransaction's 404 on
  // Alice's transaction id rather than an earlier 400 on an unknown account.
  const bob = await setupAccountAndCategories(call, asBob, 'Bob')

  const created = await call(
    '/api/transactions',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: alice.accountId,
        date: '2026-02-01',
        payee: 'Alice Grocer',
        category_id: alice.categoryAId,
        amount_cents: -500,
      }) },
    asAlice
  )
  assert.equal(created.status, 200)
  const aliceTxnId = created.body.id

  const putResult = await call(
    `/api/transactions/${aliceTxnId}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: bob.accountId,
        date: '2026-02-02',
        payee: 'Hijacked',
        amount_cents: -999,
      }) },
    asBob
  )
  assert.equal(putResult.status, 404)

  const deleteResult = await call(`/api/transactions/${aliceTxnId}`, { method: 'DELETE' }, asBob)
  assert.equal(deleteResult.status, 404)

  const clearedResult = await call(
    `/api/transactions/${aliceTxnId}/cleared`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cleared: true }) },
    asBob
  )
  assert.equal(clearedResult.status, 404)

  const aliceTxns = await call(`/api/transactions?account_id=${alice.accountId}`, {}, asAlice)
  assert.equal(aliceTxns.body.length, 1)
  assert.equal(aliceTxns.body[0].payee, 'Alice Grocer')
  assert.equal(aliceTxns.body[0].amount_cents, -500)
  assert.equal(aliceTxns.body[0].cleared, 0)
})
