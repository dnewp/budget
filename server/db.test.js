import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db } from './db.js'

test('workspace 1 exists after migrating', () => {
  const ws = db.prepare('SELECT id, name FROM workspaces WHERE id = 1').get()
  assert.equal(ws.name, 'Personal')
})

test('accounts, category_groups, and transactions carry a workspace_id', () => {
  for (const table of ['accounts', 'category_groups', 'transactions']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
    assert.ok(cols.includes('workspace_id'), `${table} is missing workspace_id`)
  }
})

test('payees is keyed by (workspace_id, name)', () => {
  db.prepare('INSERT INTO payees (workspace_id, name) VALUES (1, ?)').run('Same Name')
  db.prepare('INSERT INTO payees (workspace_id, name) VALUES (2, ?)').run('Same Name')
  const rows = db.prepare('SELECT workspace_id, name FROM payees WHERE name = ?').all('Same Name')
  assert.equal(rows.length, 2)
})
