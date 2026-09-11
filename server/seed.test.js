import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

test('npm run seed populates a fresh database without rolling back', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'envelope-seed-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // db.js reads DATA_DIR_OVERRIDE for the db location; seed.js imports db.js.
  execFileSync('node', ['server/seed.js'], { env: { ...process.env, DATA_DIR_OVERRIDE: dir }, stdio: 'pipe' })
  const db = new DatabaseSync(path.join(dir, 'budget.db'))
  const payees = db.prepare('SELECT COUNT(*) AS n FROM payees').get().n
  const cats = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n
  const accts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n
  assert.ok(payees > 0, 'payees seeded')
  assert.ok(cats > 0, 'categories seeded')
  assert.ok(accts > 0, 'accounts seeded')
  // every seeded payee belongs to workspace 1
  const orphan = db.prepare('SELECT COUNT(*) AS n FROM payees WHERE workspace_id IS NULL OR workspace_id != 1').get().n
  assert.equal(orphan, 0, 'all payees in workspace 1')
  db.close()
})
