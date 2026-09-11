import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { applyStarterTemplate, STARTER_GROUPS } from './starterTemplate.js'

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE category_groups (
      id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, name TEXT NOT NULL,
      emoji TEXT, sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL
    );
  `)
  return db
}

const totalCategories = STARTER_GROUPS.reduce((sum, [, cats]) => sum + cats.length, 0)

test('applyStarterTemplate creates the lean groups, categories, and one account', () => {
  const db = freshDb()
  applyStarterTemplate(db, 5)

  const groups = db.prepare('SELECT * FROM category_groups WHERE workspace_id = 5').all()
  assert.equal(groups.length, STARTER_GROUPS.length)
  assert.equal(groups.length, 7)

  const cats = db.prepare(
    `SELECT c.* FROM categories c JOIN category_groups g ON g.id = c.group_id WHERE g.workspace_id = 5`
  ).all()
  assert.equal(cats.length, totalCategories)

  const accounts = db.prepare('SELECT * FROM accounts WHERE workspace_id = 5').all()
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].name, 'Checking')
  assert.equal(accounts[0].type, 'checking')
})

test('a second workspace gets its own template without colliding with the first', () => {
  const db = freshDb()
  applyStarterTemplate(db, 1)
  applyStarterTemplate(db, 2)

  const groups1 = db.prepare('SELECT * FROM category_groups WHERE workspace_id = 1').all()
  const groups2 = db.prepare('SELECT * FROM category_groups WHERE workspace_id = 2').all()
  assert.equal(groups1.length, STARTER_GROUPS.length)
  assert.equal(groups2.length, STARTER_GROUPS.length)

  const ids1 = new Set(groups1.map((g) => g.id))
  const ids2 = new Set(groups2.map((g) => g.id))
  for (const id of ids2) assert.ok(!ids1.has(id), 'workspace 2 groups must not reuse workspace 1 group ids')

  const accounts1 = db.prepare('SELECT * FROM accounts WHERE workspace_id = 1').all()
  const accounts2 = db.prepare('SELECT * FROM accounts WHERE workspace_id = 2').all()
  assert.equal(accounts1.length, 1)
  assert.equal(accounts2.length, 1)
  assert.notEqual(accounts1[0].id, accounts2[0].id)
})
