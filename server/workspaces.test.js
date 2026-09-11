import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import { workspaceRoutes } from './workspaces.js'

function appWithFixedIdentity(db, workspaceId, email) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.workspaceId = workspaceId
    req.user = { email }
    next()
  })
  app.use('/api', workspaceRoutes)
  app.locals.db = db
  return app
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE);
    CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE workspace_members (workspace_id INTEGER, user_id INTEGER, role TEXT, PRIMARY KEY (workspace_id, user_id));
    CREATE TABLE workspace_invites (workspace_id INTEGER, email TEXT, created_at TEXT, PRIMARY KEY (workspace_id, email));
    INSERT INTO workspaces (id, name) VALUES (1, 'Alice''s Budget');
    INSERT INTO users (id, email) VALUES (1, 'alice@example.com');
    INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (1, 1, 'owner');
  `)
  return db
}

test('inviting an email adds a pending invite', async () => {
  const db = freshDb()
  // workspaces.js reads the db module-level import, so this test imports it
  // fresh per-process via the real module — see Step 3 for why db.js needs no
  // change here (it already supports DATA_DIR_OVERRIDE from Task 3).
  const { setDbForTesting } = await import('./workspaces.js')
  setDbForTesting(db)
  const app = appWithFixedIdentity(db, 1, 'alice@example.com')
  const server = app.listen(0)
  const port = server.address().port
  const res = await fetch(`http://127.0.0.1:${port}/api/workspaces/current/invites`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'friend@example.com' }),
  })
  assert.equal(res.status, 200)
  const invite = db.prepare('SELECT email FROM workspace_invites WHERE workspace_id = 1').get()
  assert.equal(invite.email, 'friend@example.com')
  server.close()
})
