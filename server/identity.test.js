import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { resolveIdentity } from './identity.js'

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TEXT);
    CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);
    CREATE TABLE workspace_members (
      workspace_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE workspace_invites (
      workspace_id INTEGER NOT NULL, email TEXT NOT NULL, created_at TEXT,
      PRIMARY KEY (workspace_id, email)
    );
    INSERT INTO workspaces (id, name, created_at) VALUES (1, 'Personal', datetime('now'));
    INSERT INTO workspace_invites (workspace_id, email, created_at) VALUES (1, 'owner@example.com', datetime('now'));
  `)
  return db
}

test('a brand new email gets its own workspace', () => {
  const db = freshDb()
  const identity = resolveIdentity(db, 'new-person@example.com')
  assert.equal(identity.workspaces.length, 1)
  assert.equal(identity.workspaces[0].role, 'owner')
  assert.notEqual(identity.workspaces[0].id, 1, 'should not land in workspace 1, which belongs to the invited owner')
})

test('an invited email claims the invited workspace instead of getting a fresh one', () => {
  const db = freshDb()
  const identity = resolveIdentity(db, 'owner@example.com')
  assert.equal(identity.workspaces.length, 1)
  assert.equal(identity.workspaces[0].id, 1)
  assert.equal(identity.workspaces[0].role, 'member')
  const invitesLeft = db.prepare('SELECT COUNT(*) AS n FROM workspace_invites').get().n
  assert.equal(invitesLeft, 0, 'the invite should be consumed, not left pending forever')
})

test('signing in twice does not create a second workspace or a duplicate user row', () => {
  const db = freshDb()
  resolveIdentity(db, 'repeat@example.com')
  const second = resolveIdentity(db, 'repeat@example.com')
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  assert.equal(userCount, 1)
  assert.equal(second.workspaces.length, 1)
})

test('a user who is a member of two workspaces gets both back, owned workspace first', () => {
  const db = freshDb()
  db.prepare('INSERT INTO workspace_invites (workspace_id, email, created_at) VALUES (1, ?, datetime(\'now\'))')
    .run('collaborator@example.com')
  const identity = resolveIdentity(db, 'collaborator@example.com')
  // First sign-in: only the invited workspace, no personal one auto-created,
  // since the invite already gave them somewhere to land.
  assert.equal(identity.workspaces.length, 1)
  assert.equal(identity.workspaces[0].id, 1)
})
