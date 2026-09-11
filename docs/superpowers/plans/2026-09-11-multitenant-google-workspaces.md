# Multi-Tenant Google Identity & Workspace Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Envelope's single shared password with Google-identity-based accounts, so any Google account gets its own private budget ("workspace"), and a workspace owner can invite specific other Google accounts to collaborate on the same budget.

**Architecture:** Cloudflare Access sits in front of the app with Google as the only login method and a policy that allows any authenticated Google account through. Access injects the signed-in email as the `Cf-Access-Authenticated-User-Email` header on every request; the Express app trusts that header (the app is only reachable through the tunnel — `HOST=127.0.0.1` already enforces this) to resolve a `users` row, then resolves which `workspaces` row that user belongs to, auto-provisioning a fresh personal workspace on a user's first-ever visit. Every table that holds budget data gets a `workspace_id` column. The old app-level password (`server/auth.js`, `Login.jsx`, session cookies) is deleted outright — Access is now the only gate.

**Tech Stack:** Node 24 (`node:sqlite`), Express, React 18 + Vite, Tailwind. No new dependencies.

## Global Constraints

- Every SQL query must stay a parameterized `db.prepare(...).run/get/all(...)` call — never string-concatenate user input into SQL (this repo has zero SQL injection surface today; keep it that way).
- Money stays integer cents everywhere, never floats.
- Migrations are append-only in `server/db.js`'s `migrations` array — never edit a migration that already shipped.
- No feature flags, no backwards-compat shim for the old password login. It is deleted, not deprecated.
- `npm test` (Node's built-in test runner) must pass after every task.
- Follow the existing code style: no semicolons, single quotes, comments explain *why* not *what* (see existing files for the tone — dry, a little wry, never restates the code).

---

## File Structure

| File | Responsibility |
|---|---|
| `server/db.js` | *Modify.* Add migration 7: `users`, `workspaces`, `workspace_members`, `workspace_invites` tables; `workspace_id` on `accounts`, `category_groups`, `transactions`; rebuild `payees` with a composite key. |
| `server/identity.js` | *Create.* Replaces `server/auth.js`. Resolves the Access header into `req.user` and `req.workspaceId`, auto-provisioning as needed. |
| `server/identity.test.js` | *Create.* Tests for the resolution/provisioning logic, using an in-memory-style fake db object (pure functions, no Express). |
| `server/auth.js`, `server/auth.test.js`, `server/set-password.js` | *Delete.* No more app-level password. |
| `server/workspaces.js` | *Create.* `GET /api/workspaces`, `POST /api/workspaces/:id/invites`, `DELETE /api/workspaces/:id/invites/:email`. |
| `server/workspaces.test.js` | *Create.* Tests for invite create/list/revoke and the membership-resolution helper shared with `identity.js`. |
| `server/routes.js` | *Modify.* Every query scoped to `req.workspaceId`; every route reads it from `req.workspaceId` (set by the identity middleware) instead of touching all rows. |
| `server/index.js` | *Modify.* Remove password login/logout routes and `requireAuth`; wire in `identity.js` middleware; mount `server/workspaces.js`. |
| `.env.example` | *Modify.* Drop `BUDGET_PASSWORD_HASH`/`SESSION_SECRET` requirement note, note `OWNER_EMAIL`. |
| `src/api.js` | *Modify.* Drop the 401→`budget:signed-out` redirect (no login screen to redirect to); surface a plain "reload to sign in again" error instead. |
| `src/pages/Login.jsx` | *Delete.* |
| `src/App.jsx` | *Modify.* Remove the authed/unauthed branch; add a workspace switcher in the sidebar; "Sign out" link now points at Cloudflare Access's logout path. |
| `src/pages/Workspace.jsx` | *Create.* Minimal settings page: current workspace name, member list, invite-by-email form. |
| `src/components/WorkspaceSwitcher.jsx` | *Create.* Dropdown in the sidebar listing the user's workspaces; switching sets `?workspace=<id>` and reloads data. |
| `deploy/README.md` | *Modify.* Replace step 7 (password + email-OTP Access policy) with Google IdP setup, "allow any authenticated Google account" policy, and `OWNER_EMAIL` bootstrap. |
| `CLAUDE.md` | *Modify.* Replace the "Single password" section with a description of the identity/workspace model. |

---

## Task 1: Schema migration — users, workspaces, membership, invites

**Files:**
- Modify: `server/db.js`

**Interfaces:**
- Produces: tables `users(id, email, created_at)`, `workspaces(id, name, created_at)`, `workspace_members(workspace_id, user_id, role)`, `workspace_invites(workspace_id, email, created_at)`; `workspace_id` column added to `accounts`, `category_groups`, `transactions`; `payees` rebuilt with `PRIMARY KEY (workspace_id, name)`. Workspace `id = 1` ("Personal") always exists after this migration runs, with a pending invite for `OWNER_EMAIL` (from `.env`, empty string if unset — an empty invite email matches nothing, which is fine for `npm run dev` without an owner configured yet).

- [ ] **Step 1: Write the failing test**

Create `server/db.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A3 'workspace 1 exists'`
Expected: FAIL — `workspaces` table does not exist yet.

- [ ] **Step 3: Add migration 7**

In `server/db.js`, append a 7th entry to the `migrations` array (after the `apr_bp`/`payment_category_id` one), and read `OWNER_EMAIL` before the loop:

```js
const migrations = [
  // ... five existing entries unchanged ...
  `
  ALTER TABLE accounts ADD COLUMN apr_bp INTEGER;
  ALTER TABLE accounts ADD COLUMN payment_category_id INTEGER REFERENCES categories(id);
  `,
  `
  -- Multi-tenant: every budget now belongs to a workspace, and a workspace has
  -- one or more members, each their own Google identity. Workspace 1 is created
  -- here so a fresh install and an already-seeded install both land somewhere.
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE workspace_members (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (workspace_id, user_id)
  );
  -- A pending invite by email, not yet a user. Resolved into a workspace_members
  -- row the first time that email ever signs in (see identity.js).
  CREATE TABLE workspace_invites (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, email)
  );
  INSERT INTO workspaces (id, name) VALUES (1, 'Personal');

  ALTER TABLE accounts ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id);
  ALTER TABLE category_groups ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id);
  ALTER TABLE transactions ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id);

  -- payees was keyed by name alone; two workspaces can both have a "Costco", so
  -- it needs rebuilding with workspace_id in the key rather than a plain ALTER.
  ALTER TABLE payees RENAME TO payees_old;
  CREATE TABLE payees (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    last_category_id INTEGER REFERENCES categories(id),
    PRIMARY KEY (workspace_id, name)
  );
  INSERT INTO payees (workspace_id, name, last_category_id)
    SELECT 1, name, last_category_id FROM payees_old;
  DROP TABLE payees_old;
  `,
]
```

Immediately below the migration loop at the bottom of the file, after the `for (let v = current; ...)` block, add the owner bootstrap (runs every start, is a no-op once the invite is claimed or already present):

```js
const ownerEmail = process.env.OWNER_EMAIL
if (ownerEmail) {
  db.prepare(
    `INSERT INTO workspace_invites (workspace_id, email) VALUES (1, ?)
     ON CONFLICT(workspace_id, email) DO NOTHING`
  ).run(ownerEmail)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | grep -A3 'workspace 1 exists\|carry a workspace_id\|keyed by'`
Expected: all three PASS. Also run the full suite (`npm test`) and confirm nothing else broke — the existing tests don't touch the live `db` module directly (they call pure functions from `budget.js`/`debt.js` with hand-built rows), so this should be a clean pass.

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/db.test.js
git commit -m "Add workspace/user/invite schema, migrate existing data into workspace 1"
```

---

## Task 2: Identity middleware — resolve Access header into user + workspace

**Files:**
- Create: `server/identity.js`
- Create: `server/identity.test.js`
- Delete: `server/auth.js`, `server/auth.test.js`, `server/set-password.js`

**Interfaces:**
- Consumes: `db` from `./db.js` (Task 1's schema).
- Produces: `resolveIdentity(db, email)` — pure-ish function taking the db handle and an email string, returning `{ userId, workspaces: [{id, name, role}] }`, auto-provisioning a user row, resolving pending invites, and creating a personal workspace if the user has none. `identityMiddleware(req, res, next)` — Express middleware that reads the email header, calls `resolveIdentity`, and sets `req.user = {id, email}` and `req.workspaceId` (validated against `req.query.workspace` if present, else the first workspace).

- [ ] **Step 1: Write the failing test**

Create `server/identity.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/identity.test.js`
Expected: FAIL — `./identity.js` does not exist.

- [ ] **Step 3: Write `server/identity.js`**

```js
// Resolves a Cloudflare Access email into a user and their workspace(s).
//
// Trusting the Cf-Access-Authenticated-User-Email header is safe only because
// nothing reaches this server except through the tunnel (HOST=127.0.0.1), and
// the tunnel's only public hostname is gated by Access. There is no other way
// in, so a request that has the header got it from Access, not from a client
// that typed it in.

const ACCESS_EMAIL_HEADER = 'cf-access-authenticated-user-email'

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 * @returns {{ userId: number, workspaces: Array<{id: number, name: string, role: string}> }}
 */
export function resolveIdentity(db, email) {
  db.exec('BEGIN')
  try {
    let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    if (!user) {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (email) VALUES (?)').run(email)
      user = { id: Number(lastInsertRowid) }
    }

    // Claim any pending invites: an invite by email becomes real membership the
    // moment that email actually signs in, because only then do we have a user
    // row to attach it to.
    const invites = db.prepare('SELECT workspace_id FROM workspace_invites WHERE email = ?').all(email)
    const addMember = db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')
       ON CONFLICT(workspace_id, user_id) DO NOTHING`
    )
    for (const invite of invites) addMember.run(invite.workspace_id, user.id)
    db.prepare('DELETE FROM workspace_invites WHERE email = ?').run(email)

    // First-ever sign-in with no invite waiting: give them a workspace of their
    // own rather than leaving them with nowhere to go.
    const hasMembership = db
      .prepare('SELECT 1 FROM workspace_members WHERE user_id = ?').get(user.id)
    if (!hasMembership) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO workspaces (name) VALUES (?)')
        .run(`${email}'s Budget`)
      db.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')`
      ).run(lastInsertRowid, user.id)
    }

    const workspaces = db
      .prepare(
        `SELECT w.id, w.name, m.role FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.user_id = ? ORDER BY (m.role = 'owner') DESC, w.id`
      )
      .all(user.id)

    db.exec('COMMIT')
    return { userId: user.id, workspaces }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function identityMiddleware(db) {
  return (req, res, next) => {
    const email = req.headers[ACCESS_EMAIL_HEADER]
    if (!email) return res.status(401).json({ error: 'Not signed in' })

    const identity = resolveIdentity(db, email)
    req.user = { id: identity.userId, email }

    const requested = req.query.workspace ? Number(req.query.workspace) : null
    const match = requested
      ? identity.workspaces.find((w) => w.id === requested)
      : identity.workspaces[0]
    if (!match) return res.status(403).json({ error: 'Not a member of that workspace' })

    req.workspaceId = match.id
    req.workspaces = identity.workspaces
    next()
  }
}
```

- [ ] **Step 4: Delete the old password auth files**

```bash
rm server/auth.js server/auth.test.js server/set-password.js
```

- [ ] **Step 5: Run tests to verify identity.test.js passes and nothing references the deleted files**

Run: `node --test server/identity.test.js && grep -rn "auth.js\|set-password" server/ src/ package.json`
Expected: all 4 `identity.test.js` cases PASS. The `grep` will still show `package.json`'s `"set-password"` npm script line and `README.md`/`deploy/README.md` mentions — that's expected here, those get cleaned up in Task 5. No `server/*.js` file should import from `./auth.js` after this step (Task 3 removes the last import, in `index.js`).

- [ ] **Step 6: Commit**

```bash
git add server/identity.js server/identity.test.js
git rm server/auth.js server/auth.test.js server/set-password.js
git commit -m "Replace password auth with Cloudflare Access identity resolution"
```

---

## Task 3: Workspace-scope every route

**Files:**
- Modify: `server/routes.js` (every query gets a `workspace_id` filter or join)
- Modify: `server/index.js` (mount `identityMiddleware`, drop `/api/login`, `/api/logout`, `requireAuth`)

**Interfaces:**
- Consumes: `req.workspaceId` (set by Task 2's `identityMiddleware`), `req.user`, `req.workspaces` (for the `/api/me` response).
- Produces: unchanged route paths and response shapes for the frontend — this task changes *what data each query can see*, not the API surface, except `GET /api/me` now returns `{ email, workspaces: [{id, name, role}], workspaceId }` instead of `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

Create `server/workspace-isolation.test.js` — an integration-style test that spins up the real Express app against a temp SQLite file and proves one workspace can't see another's data:

```js
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
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers })
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
```

- [ ] **Step 2: Make the data directory overridable for tests**

In `server/db.js`, change the `dataDir` line so tests can point it at a temp folder instead of the real `data/` (needed for Step 1's test to not collide with real data or other test runs):

```js
const dataDir = process.env.DATA_DIR_OVERRIDE
  ? process.env.DATA_DIR_OVERRIDE
  : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test server/workspace-isolation.test.js`
Expected: FAIL — Bob currently sees Alice's account too, since nothing is scoped yet.

- [ ] **Step 4: Rewrite `server/routes.js`**

Replace the full file with this version — every query that touches `accounts`, `category_groups`, `categories`, `transactions`, `payees`, `allocations`, or `reconciliations` is scoped to `req.workspaceId`, either directly (tables that now carry the column) or via a join through a table that does:

```js
import { Router } from 'express'
import { db } from './db.js'
import { envelopeSummary, TARGET_PERIODS } from './budget.js'
import { project, HOPELESS_MONTHS } from './debt.js'

export const routes = Router()

function cents(value, field) {
  if (!Number.isInteger(value)) throw new HttpError(400, `${field} must be a whole number of cents`)
  return value
}

function text(value, field, { max = 200, required = true } = {}) {
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new HttpError(400, `${field} is required`)
  }
  if (value.length > max) throw new HttpError(400, `${field} is too long`)
  return value.trim()
}

function period(value) {
  if (value === undefined || value === null || value === '') return 'monthly'
  if (!TARGET_PERIODS.includes(value)) {
    throw new HttpError(400, `Target period must be one of: ${TARGET_PERIODS.join(', ')}`)
  }
  return value
}

const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7)

function monthParam(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new HttpError(400, 'month must be YYYY-MM')
  return value
}

function emoji(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || [...new Intl.Segmenter().segment(value)].length !== 1) {
    throw new HttpError(400, 'Pick a single emoji')
  }
  return value
}

function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'date must be YYYY-MM-DD')
  }
  return value
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash']

// Every mutating route that takes an :id checks the row is actually in the
// caller's workspace before touching it — otherwise workspace scoping on GETs
// alone would still let someone guess another workspace's account/category ids
// and edit them directly.
function ownedAccount(id, workspaceId) {
  return db.prepare('SELECT 1 FROM accounts WHERE id = ? AND workspace_id = ?').get(id, workspaceId)
}
function ownedCategory(id, workspaceId) {
  return db
    .prepare(
      `SELECT 1 FROM categories c JOIN category_groups g ON g.id = c.group_id
       WHERE c.id = ? AND g.workspace_id = ?`
    )
    .get(id, workspaceId)
}
function ownedGroup(id, workspaceId) {
  return db.prepare('SELECT 1 FROM category_groups WHERE id = ? AND workspace_id = ?').get(id, workspaceId)
}
function ownedTransaction(id, workspaceId) {
  return db
    .prepare(
      `SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ? AND a.workspace_id = ?`
    )
    .get(id, workspaceId)
}

routes.get('/me', (req, res) => {
  res.json({ email: req.user.email, workspaces: req.workspaces, workspaceId: req.workspaceId })
})

routes.get('/accounts', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT a.id, a.name, a.type, a.closed, a.apr_bp, a.payment_category_id,
                COALESCE((SELECT SUM(amount_cents) FROM transactions t
                          WHERE t.account_id = a.id), 0) AS balance_cents,
                COALESCE((SELECT SUM(amount_cents) FROM transactions t
                          WHERE t.account_id = a.id AND t.cleared = 1), 0) AS cleared_balance_cents
         FROM accounts a WHERE a.workspace_id = ? ORDER BY a.closed, a.name`
      )
      .all(req.workspaceId)
  )
})

routes.post('/accounts', (req, res) => {
  const name = text(req.body.name, 'Account name', { max: 60 })
  const type = req.body.type
  if (!ACCOUNT_TYPES.includes(type)) throw new HttpError(400, 'Unknown account type')
  const { lastInsertRowid } = db
    .prepare('INSERT INTO accounts (workspace_id, name, type) VALUES (?, ?, ?)')
    .run(req.workspaceId, name, type)
  const balance = cents(req.body.starting_balance_cents ?? 0, 'Starting balance')
  if (balance !== 0) {
    db.prepare(
      `INSERT INTO transactions (account_id, date, payee, amount_cents, cleared)
       VALUES (?, date('now', 'localtime'), 'Starting balance', ?, 1)`
    ).run(lastInsertRowid, balance)
  }
  res.json({ id: Number(lastInsertRowid) })
})

routes.patch('/accounts/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!ownedAccount(id, req.workspaceId)) throw new HttpError(404, 'Account not found')
  if (req.body.name !== undefined) {
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(
      text(req.body.name, 'Account name', { max: 60 }),
      id
    )
  }
  if (req.body.type !== undefined) {
    if (!ACCOUNT_TYPES.includes(req.body.type)) throw new HttpError(400, 'Unknown account type')
    db.prepare('UPDATE accounts SET type = ? WHERE id = ?').run(req.body.type, id)
  }
  if (req.body.apr_bp !== undefined) {
    const apr = req.body.apr_bp
    if (apr !== null && (!Number.isInteger(apr) || apr < 0 || apr > 100000)) {
      throw new HttpError(400, 'Rate must be a percentage between 0 and 1000')
    }
    db.prepare('UPDATE accounts SET apr_bp = ? WHERE id = ?').run(apr, id)
  }
  if (req.body.payment_category_id !== undefined) {
    const categoryId = req.body.payment_category_id
    if (categoryId !== null && !ownedCategory(categoryId, req.workspaceId)) {
      throw new HttpError(400, 'Unknown envelope')
    }
    db.prepare('UPDATE accounts SET payment_category_id = ? WHERE id = ?').run(categoryId, id)
  }
  if (req.body.closed !== undefined) {
    db.prepare('UPDATE accounts SET closed = ? WHERE id = ?').run(req.body.closed ? 1 : 0, id)
  }

  let adjustment = 0
  if (req.body.balance_cents !== undefined) {
    const target = cents(req.body.balance_cents, 'Balance')
    const current =
      db
        .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE account_id = ?')
        .get(id).total ?? 0
    adjustment = target - current
    if (adjustment !== 0) {
      db.prepare(
        `INSERT INTO transactions (account_id, date, payee, memo, amount_cents, cleared)
         VALUES (?, date('now', 'localtime'), 'Balance adjustment', ?, ?, 1)`
      ).run(id, req.body.memo || 'Set by hand', adjustment)
    }
  }
  res.json({ ok: true, adjustment_cents: adjustment })
})

routes.delete('/accounts/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!ownedAccount(id, req.workspaceId)) throw new HttpError(404, 'Account not found')
  db.exec('BEGIN')
  db.prepare('DELETE FROM transactions WHERE account_id = ?').run(id)
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  db.exec('COMMIT')
  res.json({ ok: true })
})

routes.get('/transactions', (req, res) => {
  const accountId = req.query.account_id ? Number(req.query.account_id) : null
  if (accountId && !ownedAccount(accountId, req.workspaceId)) {
    throw new HttpError(404, 'Account not found')
  }
  const sql = `SELECT t.*, a.name AS account_name, c.name AS category_name, c.emoji AS category_emoji
               FROM transactions t
               JOIN accounts a ON a.id = t.account_id
               LEFT JOIN categories c ON c.id = t.category_id
               WHERE a.workspace_id = ? ${accountId ? 'AND t.account_id = ?' : ''}
               ORDER BY t.date DESC, t.id DESC LIMIT 500`
  res.json(accountId ? db.prepare(sql).all(req.workspaceId, accountId) : db.prepare(sql).all(req.workspaceId))
})

function transactionFields(body) {
  return {
    account_id: Number(body.account_id),
    date: isoDate(body.date),
    payee: text(body.payee, 'Payee', { max: 100, required: false }) ?? '',
    category_id: body.category_id ? Number(body.category_id) : null,
    memo: text(body.memo ?? '', 'Memo', { max: 200, required: false }),
    amount_cents: cents(body.amount_cents, 'Amount'),
    cleared: body.cleared ? 1 : 0,
  }
}

function splitLines(body) {
  if (!Array.isArray(body.splits) || body.splits.length === 0) return null
  const lines = body.splits.map((s, i) => ({
    category_id: s.category_id ? Number(s.category_id) : null,
    memo: text(s.memo ?? '', 'Split memo', { max: 200, required: false }),
    amount_cents: cents(s.amount_cents, `Split ${i + 1} amount`),
  }))
  const sum = lines.reduce((total, l) => total + l.amount_cents, 0)
  const target = cents(body.amount_cents, 'Amount')
  if (sum !== target) {
    const off = (sum - target) / 100
    throw new HttpError(
      400,
      `Splits add up to ${(sum / 100).toFixed(2)} but the transaction is ${(target / 100).toFixed(2)}. ` +
        `${off > 0 ? 'Remove' : 'Assign'} ${Math.abs(off).toFixed(2)}.`
    )
  }
  return lines
}

function rememberPayee(workspaceId, name, categoryId) {
  if (!name) return
  db.prepare(
    `INSERT INTO payees (workspace_id, name, last_category_id) VALUES (?, ?, ?)
     ON CONFLICT(workspace_id, name) DO UPDATE SET last_category_id = COALESCE(excluded.last_category_id, last_category_id)`
  ).run(workspaceId, name, categoryId)
}

function insertTransaction(workspaceId, t, lines) {
  const insert = db.prepare(
    `INSERT INTO transactions (account_id, date, payee, category_id, memo, amount_cents, cleared, split_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  if (!lines) {
    const { lastInsertRowid } = insert.run(
      t.account_id, t.date, t.payee, t.category_id, t.memo, t.amount_cents, t.cleared, null
    )
    rememberPayee(workspaceId, t.payee, t.category_id)
    return Number(lastInsertRowid)
  }
  const group =
    (db
      .prepare(
        `SELECT COALESCE(MAX(t.split_group), 0) AS m FROM transactions t
         JOIN accounts a ON a.id = t.account_id WHERE a.workspace_id = ?`
      )
      .get(workspaceId).m ?? 0) + 1
  for (const line of lines) {
    insert.run(
      t.account_id, t.date, t.payee, line.category_id,
      line.memo || t.memo, line.amount_cents, t.cleared, group
    )
  }
  rememberPayee(workspaceId, t.payee, null)
  return group
}

routes.post('/transactions', (req, res) => {
  const t = transactionFields(req.body)
  if (!ownedAccount(t.account_id, req.workspaceId)) throw new HttpError(400, 'Unknown account')
  const lines = splitLines(req.body)
  db.exec('BEGIN')
  try {
    const id = insertTransaction(req.workspaceId, t, lines)
    db.exec('COMMIT')
    res.json({ id })
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})

routes.put('/transactions/:id', (req, res) => {
  const t = transactionFields(req.body)
  if (!ownedAccount(t.account_id, req.workspaceId)) throw new HttpError(400, 'Unknown account')
  const lines = splitLines(req.body)
  const id = Number(req.params.id)
  const existing = ownedTransaction(id, req.workspaceId)
  if (!existing) throw new HttpError(404, 'Transaction not found')
  if (existing.reconciled) {
    throw new HttpError(409, 'That transaction is reconciled and locked. Undo the reconcile first.')
  }
  db.exec('BEGIN')
  try {
    if (existing.split_group) {
      db.prepare('DELETE FROM transactions WHERE split_group = ?').run(existing.split_group)
    } else {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
    }
    insertTransaction(req.workspaceId, t, lines)
    db.exec('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})

routes.delete('/transactions/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = ownedTransaction(id, req.workspaceId)
  if (!existing) throw new HttpError(404, 'Transaction not found')
  if (existing.reconciled) {
    throw new HttpError(409, 'That transaction is reconciled and locked. Undo the reconcile first.')
  }
  if (existing.split_group) {
    db.prepare('DELETE FROM transactions WHERE split_group = ?').run(existing.split_group)
  } else {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
  }
  res.json({ ok: true })
})

routes.get('/reconcile/:month', (req, res) => {
  const month = monthParam(req.params.month)
  res.json(
    db
      .prepare(
        `SELECT a.id AS account_id, a.name, a.type,
                COALESCE((SELECT SUM(amount_cents) FROM transactions t
                          WHERE t.account_id = a.id AND t.cleared = 1
                            AND substr(t.date, 1, 7) <= ?), 0) AS cleared_balance_cents,
                COALESCE((SELECT SUM(amount_cents) FROM transactions t
                          WHERE t.account_id = a.id AND substr(t.date, 1, 7) <= ?), 0) AS working_balance_cents,
                COALESCE((SELECT COUNT(*) FROM transactions t
                          WHERE t.account_id = a.id AND t.cleared = 0
                            AND substr(t.date, 1, 7) <= ?), 0) AS uncleared_count,
                COALESCE((SELECT SUM(amount_cents) FROM transactions t
                          WHERE t.account_id = a.id AND substr(t.date, 1, 7) = ? AND t.amount_cents > 0), 0) AS money_in_cents,
                COALESCE((SELECT SUM(amount_cents) FROM transactions t
                          WHERE t.account_id = a.id AND substr(t.date, 1, 7) = ? AND t.amount_cents < 0), 0) AS money_out_cents,
                r.actual_balance_cents, r.adjustment_cents, r.reconciled_at
         FROM accounts a
         LEFT JOIN reconciliations r ON r.account_id = a.id AND r.month = ?
         WHERE a.workspace_id = ? AND a.closed = 0 AND a.type != 'credit'
         ORDER BY a.name`
      )
      .all(month, month, month, month, month, month, req.workspaceId)
  )
})

routes.post('/reconcile/:month/:accountId', (req, res) => {
  const month = monthParam(req.params.month)
  const accountId = Number(req.params.accountId)
  if (!ownedAccount(accountId, req.workspaceId)) throw new HttpError(400, 'Unknown account')
  const actual = cents(req.body.actual_balance_cents, 'Bank balance')
  const cleared =
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions
         WHERE account_id = ? AND cleared = 1 AND substr(date, 1, 7) <= ?`
      )
      .get(accountId, month).total ?? 0
  const difference = actual - cleared

  if (difference !== 0 && !req.body.force) {
    return res.status(409).json({
      error: 'Balances do not match',
      cleared_balance_cents: cleared,
      actual_balance_cents: actual,
      difference_cents: difference,
    })
  }

  db.exec('BEGIN')
  try {
    if (difference !== 0) {
      const [y, m] = month.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      db.prepare(
        `INSERT INTO transactions (account_id, date, payee, memo, amount_cents, cleared)
         VALUES (?, ?, 'Reconciliation Balance Adjustment', ?, ?, 1)`
      ).run(
        accountId,
        `${month}-${String(lastDay).padStart(2, '0')}`,
        'Created during reconcile',
        difference
      )
    }
    db.prepare(
      `UPDATE transactions SET reconciled = 1
       WHERE account_id = ? AND cleared = 1 AND substr(date, 1, 7) <= ?`
    ).run(accountId, month)
    db.prepare(
      `INSERT INTO reconciliations (account_id, month, actual_balance_cents, adjustment_cents, reconciled_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(account_id, month) DO UPDATE SET
         actual_balance_cents = excluded.actual_balance_cents,
         adjustment_cents = adjustment_cents + excluded.adjustment_cents,
         reconciled_at = excluded.reconciled_at`
    ).run(accountId, month, actual, difference)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  res.json({ ok: true, adjustment_cents: difference })
})

routes.delete('/reconcile/:month/:accountId', (req, res) => {
  const month = monthParam(req.params.month)
  const accountId = Number(req.params.accountId)
  if (!ownedAccount(accountId, req.workspaceId)) throw new HttpError(400, 'Unknown account')
  db.exec('BEGIN')
  db.prepare(
    `UPDATE transactions SET reconciled = 0
     WHERE account_id = ? AND substr(date, 1, 7) <= ?`
  ).run(accountId, month)
  db.prepare('DELETE FROM reconciliations WHERE account_id = ? AND month = ?').run(accountId, month)
  db.exec('COMMIT')
  res.json({ ok: true })
})

routes.patch('/transactions/:id/cleared', (req, res) => {
  const id = Number(req.params.id)
  const row = ownedTransaction(id, req.workspaceId)
  if (!row) throw new HttpError(404, 'Transaction not found')
  if (row.reconciled) throw new HttpError(409, 'That transaction is reconciled and locked')
  const cleared = req.body.cleared ? 1 : 0
  if (row.split_group) {
    db.prepare('UPDATE transactions SET cleared = ? WHERE split_group = ?').run(cleared, row.split_group)
  } else {
    db.prepare('UPDATE transactions SET cleared = ? WHERE id = ?').run(cleared, id)
  }
  res.json({ ok: true, cleared: Boolean(cleared) })
})

routes.get('/debt', (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.apr_bp, a.payment_category_id,
              COALESCE((SELECT SUM(amount_cents) FROM transactions t WHERE t.account_id = a.id), 0) AS balance_cents,
              c.name AS payment_envelope,
              COALESCE(c.target_cents, 0) AS payment_cents
       FROM accounts a
       LEFT JOIN categories c ON c.id = a.payment_category_id
       WHERE a.workspace_id = ? AND a.closed = 0 AND a.type = 'credit'
       ORDER BY a.name`
    )
    .all(req.workspaceId)

  const debts = rows
    .filter((d) => Math.abs(d.balance_cents) > 0)
    .map((d) => project({ ...d, balance_cents: Math.abs(d.balance_cents) }))

  const finiteMonths = debts.map((d) => d.months).filter((m) => m !== null)
  res.json({
    debts: debts.sort((a, b) => (b.interest_cents ?? Infinity) - (a.interest_cents ?? Infinity)),
    total_balance_cents: debts.reduce((sum, d) => sum + d.balance_cents, 0),
    total_monthly_interest_cents: debts.reduce((sum, d) => sum + d.monthly_interest_cents, 0),
    total_payment_cents: debts.reduce((sum, d) => sum + d.payment_cents, 0),
    total_interest_cents: debts.some((d) => d.interest_cents === null)
      ? null
      : debts.reduce((sum, d) => sum + d.interest_cents, 0),
    longest_months: finiteMonths.length === debts.length ? Math.max(...finiteMonths, 0) : null,
    hopeless_months: HOPELESS_MONTHS,
  })
})

routes.get('/payees', (req, res) => {
  res.json(
    db.prepare('SELECT name, last_category_id FROM payees WHERE workspace_id = ? ORDER BY name').all(req.workspaceId)
  )
})

routes.get('/categories', (req, res) => {
  const hidden = req.query.hidden === '1' ? 1 : 0
  res.json(
    db
      .prepare(
        `SELECT c.id, c.name, c.emoji, c.group_id, c.hidden, g.name AS group_name
         FROM categories c JOIN category_groups g ON g.id = c.group_id
         WHERE g.workspace_id = ? AND c.hidden = ? ORDER BY g.sort_order, g.name, c.sort_order, c.name`
      )
      .all(req.workspaceId, hidden)
  )
})

routes.post('/category-groups', (req, res) => {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO category_groups (workspace_id, name) VALUES (?, ?)')
    .run(req.workspaceId, text(req.body.name, 'Group name', { max: 60 }))
  res.json({ id: Number(lastInsertRowid) })
})

routes.post('/categories', (req, res) => {
  const groupId = Number(req.body.group_id)
  if (!ownedGroup(groupId, req.workspaceId)) throw new HttpError(400, 'Unknown group')
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO categories (group_id, name, emoji, target_cents, target_period) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      groupId,
      text(req.body.name, 'Envelope name', { max: 60 }),
      emoji(req.body.emoji),
      cents(req.body.target_cents ?? 0, 'Target'),
      period(req.body.target_period)
    )
  res.json({ id: Number(lastInsertRowid) })
})

routes.patch('/categories/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!ownedCategory(id, req.workspaceId)) throw new HttpError(404, 'Envelope not found')
  if (req.body.name !== undefined) {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(
      text(req.body.name, 'Envelope name', { max: 60 }),
      id
    )
  }
  if (req.body.emoji !== undefined) {
    db.prepare('UPDATE categories SET emoji = ? WHERE id = ?').run(emoji(req.body.emoji), id)
  }
  if (req.body.group_id !== undefined) {
    const groupId = Number(req.body.group_id)
    if (!ownedGroup(groupId, req.workspaceId)) throw new HttpError(400, 'Unknown group')
    db.prepare('UPDATE categories SET group_id = ? WHERE id = ?').run(groupId, id)
  }
  if (req.body.hidden !== undefined) {
    if (req.body.hidden) {
      const month = req.body.month ? monthParam(req.body.month) : thisMonth()
      const envelope = summaryFor(req.workspaceId, month).categories.find((c) => c.id === id)
      const stranded = envelope?.available_cents ?? 0
      if (stranded !== 0 && !req.body.release) {
        return res.status(409).json({
          error: 'That envelope still has money in it',
          available_cents: stranded,
        })
      }
      if (stranded !== 0) {
        const current =
          db
            .prepare('SELECT assigned_cents FROM allocations WHERE month = ? AND category_id = ?')
            .get(month, id)?.assigned_cents ?? 0
        db.prepare(
          `INSERT INTO allocations (month, category_id, assigned_cents) VALUES (?, ?, ?)
           ON CONFLICT(month, category_id) DO UPDATE SET assigned_cents = excluded.assigned_cents`
        ).run(month, id, current - stranded)
      }
    }
    db.prepare('UPDATE categories SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, id)
  }
  if (req.body.target_cents !== undefined) {
    db.prepare('UPDATE categories SET target_cents = ? WHERE id = ?').run(
      cents(req.body.target_cents, 'Target'),
      id
    )
  }
  if (req.body.target_period !== undefined) {
    db.prepare('UPDATE categories SET target_period = ? WHERE id = ?').run(
      period(req.body.target_period),
      id
    )
  }
  res.json({ ok: true })
})

function summaryFor(workspaceId, month) {
  const rows = {
    categories: db
      .prepare(
        `SELECT c.id, c.group_id, c.name, c.emoji, c.target_cents, c.target_period,
                g.name AS group_name, g.sort_order AS group_order
         FROM categories c JOIN category_groups g ON g.id = c.group_id
         WHERE g.workspace_id = ? AND c.hidden = 0 ORDER BY g.sort_order, g.name, c.sort_order, c.name`
      )
      .all(workspaceId),
    allocations: db
      .prepare(
        `SELECT al.month, al.category_id, al.assigned_cents FROM allocations al
         JOIN categories c ON c.id = al.category_id JOIN category_groups g ON g.id = c.group_id
         WHERE g.workspace_id = ?`
      )
      .all(workspaceId),
    transactions: db
      .prepare(
        `SELECT t.date, t.category_id, t.amount_cents, a.type AS account_type
         FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.workspace_id = ?`
      )
      .all(workspaceId),
  }
  return envelopeSummary(rows, month)
}

routes.get('/budget/:month', (req, res) => {
  const month = monthParam(req.params.month)
  const summary = summaryFor(req.workspaceId, month)

  const groups = []
  for (const c of summary.categories) {
    let group = groups.find((g) => g.id === c.group_id)
    if (!group) groups.push((group = { id: c.group_id, name: c.group_name, categories: [] }))
    group.categories.push(c)
  }
  res.json({ month, ready_to_assign_cents: summary.ready_to_assign_cents, groups })
})

routes.post('/budget/:month/fill-targets', (req, res) => {
  const month = monthParam(req.params.month)
  const assign = db.prepare(
    `INSERT INTO allocations (month, category_id, assigned_cents) VALUES (?, ?, ?)
     ON CONFLICT(month, category_id) DO UPDATE SET assigned_cents = excluded.assigned_cents`
  )
  let filled = 0
  let assigned = 0
  db.exec('BEGIN')
  for (const c of summaryFor(req.workspaceId, month).categories) {
    if (c.needed_cents <= 0) continue
    assign.run(month, c.id, c.assigned_cents + c.needed_cents)
    assigned += c.needed_cents
    filled++
  }
  db.exec('COMMIT')
  res.json({ filled, assigned_cents: assigned })
})

routes.put('/budget/:month/:categoryId', (req, res) => {
  const month = monthParam(req.params.month)
  const categoryId = Number(req.params.categoryId)
  if (!ownedCategory(categoryId, req.workspaceId)) throw new HttpError(404, 'Envelope not found')
  const assigned = cents(req.body.assigned_cents, 'Assigned')
  db.prepare(
    `INSERT INTO allocations (month, category_id, assigned_cents) VALUES (?, ?, ?)
     ON CONFLICT(month, category_id) DO UPDATE SET assigned_cents = excluded.assigned_cents`
  ).run(month, categoryId, assigned)
  res.json({ ok: true })
})
```

- [ ] **Step 5: Update `server/index.js`**

Replace the whole file:

```js
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
```

(`server/workspaces.js` is created in Task 4 — this file won't run standalone until then, which is fine since Task 4 is next and nothing outside this repo imports `index.js`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test server/workspace-isolation.test.js`
Expected: PASS — Alice and Bob each see only their own account.

Run the full suite: `npm test`
Expected: all existing tests (`budget.test.js`, `debt.test.js`, `splits.test.js`, `targets.test.js`, `credit.test.js`, `hide.test.js`) still pass unchanged, since they test the pure functions in `budget.js`/`debt.js` directly and never touched auth or workspace scoping.

- [ ] **Step 7: Commit**

```bash
git add server/routes.js server/index.js server/workspace-isolation.test.js server/db.js
git commit -m "Scope every query to the caller's workspace"
```

---

## Task 4: Workspace listing and invites

**Files:**
- Create: `server/workspaces.js`
- Create: `server/workspaces.test.js`

**Interfaces:**
- Consumes: `req.workspaceId`, `req.user` (from Task 2/3's `identityMiddleware`); `db` from `db.js`.
- Produces: `GET /api/workspaces/current/members` → `{ workspace: {id, name}, members: [{email, role}], pendingInvites: [email] }`; `POST /api/workspaces/current/invites` (`{email}`) → `{ ok: true }`; `DELETE /api/workspaces/current/invites/:email` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

Create `server/workspaces.test.js`:

```js
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
    INSERT INTO workspaces (id, name) VALUES (1, "Alice's Budget");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/workspaces.test.js`
Expected: FAIL — `./workspaces.js` does not exist.

- [ ] **Step 3: Write `server/workspaces.js`**

```js
import { Router } from 'express'
import { db as defaultDb } from './db.js'
import { HttpError } from './routes.js'

// A thin seam so tests can swap in an in-memory db without every route needing
// the db threaded through as a parameter. Production never calls this.
let db = defaultDb
export function setDbForTesting(testDb) {
  db = testDb
}

export const workspaceRoutes = Router()

workspaceRoutes.get('/workspaces/current/members', (req, res) => {
  const workspace = db.prepare('SELECT id, name FROM workspaces WHERE id = ?').get(req.workspaceId)
  const members = db
    .prepare(
      `SELECT u.email, m.role FROM workspace_members m
       JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY (m.role = 'owner') DESC, u.email`
    )
    .all(req.workspaceId)
  const pendingInvites = db
    .prepare('SELECT email FROM workspace_invites WHERE workspace_id = ? ORDER BY created_at')
    .all(req.workspaceId)
    .map((r) => r.email)
  res.json({ workspace, members, pendingInvites })
})

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

workspaceRoutes.post('/workspaces/current/invites', (req, res) => {
  const email = req.body.email
  if (!isEmail(email)) throw new HttpError(400, 'That does not look like an email address')
  const alreadyMember = db
    .prepare(
      `SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? AND u.email = ?`
    )
    .get(req.workspaceId, email)
  if (alreadyMember) throw new HttpError(409, 'Already a member')
  db.prepare(
    `INSERT INTO workspace_invites (workspace_id, email) VALUES (?, ?)
     ON CONFLICT(workspace_id, email) DO NOTHING`
  ).run(req.workspaceId, email)
  res.json({ ok: true })
})

workspaceRoutes.delete('/workspaces/current/invites/:email', (req, res) => {
  db.prepare('DELETE FROM workspace_invites WHERE workspace_id = ? AND email = ?').run(
    req.workspaceId,
    req.params.email
  )
  res.json({ ok: true })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/workspaces.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/workspaces.js server/workspaces.test.js
git commit -m "Add workspace member listing and invite-by-email routes"
```

---

## Task 5: Drop password-auth remnants from package.json, .env.example, README, CLAUDE.md

**Files:**
- Modify: `package.json`, `.env.example`, `README.md`, `CLAUDE.md`

**Interfaces:**
- No code interfaces — documentation and script cleanup so nothing references the deleted password flow.

- [ ] **Step 1: Remove the `set-password` script from `package.json`**

Delete the line `"set-password": "node server/set-password.js",` from the `scripts` block.

- [ ] **Step 2: Rewrite `.env.example`**

```
# The Google account that should own the pre-existing "Personal" workspace
# (workspace id 1) the first time it signs in. Leave blank for a fresh install
# with no pre-claimed workspace.
OWNER_EMAIL=
```

- [ ] **Step 3: Update `README.md`**

In the "Running it" section, replace:

```
npm install
npm run set-password -- your-password
npm run seed        # optional starter envelopes, accounts and payees
npm run dev         # http://localhost:4517
```

with:

```
npm install
npm run seed        # optional starter envelopes, accounts and payees (workspace 1)
npm run dev         # http://localhost:4517
```

And add a line after it: "Locally, without Cloudflare Access in front of you, every request is treated as `dev@localhost` — see `identityMiddleware` in `server/identity.js` if you need to test as a different identity; there is no login screen to click through."

Actually — implement that dev fallback now, since the README promises it: in `server/identity.js`, change the header read in `identityMiddleware` to:

```js
const email = req.headers[ACCESS_EMAIL_HEADER] || (process.env.NODE_ENV !== 'production' ? 'dev@localhost' : null)
```

- [ ] **Step 4: Update "How it is built" in `README.md`**

Replace the closing paragraph about `.env` holding "your password hash and session secret" with: "`.env` holds `OWNER_EMAIL`, used once to claim the pre-existing workspace on first sign-in. It does not belong in version control."

- [ ] **Step 5: Update `CLAUDE.md`**

Find the section describing "Single password" auth (`Single password. npm run set-password ...`) and replace it with:

```markdown
## Identity and workspaces

There is no app-level password. Cloudflare Access sits in front of the whole
app, with Google as the only login method and a policy that allows any
authenticated Google account through — Access is the gate, not this code.
Access injects the signed-in email as `Cf-Access-Authenticated-User-Email` on
every request; `server/identity.js` trusts that header because nothing reaches
this server except through the tunnel (`HOST=127.0.0.1`).

Every budget belongs to a `workspace`. A user's first-ever sign-in either
claims a pending invite (if someone invited that email already) or gets a
fresh personal workspace — never both, and never a second personal workspace
on a later sign-in. `workspace_members` is the source of truth for who can see
what; every route in `routes.js` filters by `req.workspaceId`, and every
mutating route re-checks that the referenced account/category/group actually
belongs to that workspace before touching it, since a plain GET-scoped query
alone wouldn't stop someone from guessing another workspace's row id in a
PATCH or DELETE.

Sharing a budget means inviting a specific email to your workspace
(`POST /api/workspaces/current/invites`), not sharing a login. The invited
person still signs in with their own Google account; the invite just
determines which workspace they land in the first time they do.
```

- [ ] **Step 6: Run the full test suite one more time**

Run: `npm test`
Expected: all tests PASS, including the new `dev@localhost` fallback path is exercised implicitly by `workspace-isolation.test.js` if `NODE_ENV` isn't `production` in the test environment — if that test now fails because both Alice and Bob resolve to `dev@localhost`, that's a real bug in this task's change, not a flaky test: it means the fallback swallowed the explicit headers the test sent. Fix by keeping the explicit-header case first: `req.headers[ACCESS_EMAIL_HEADER] || (...)` already does this correctly since `||` only falls through when the header is truly absent — confirm the test still passes and move on.

- [ ] **Step 7: Commit**

```bash
git add package.json .env.example README.md CLAUDE.md server/identity.js
git commit -m "Document the identity/workspace model, add local-dev identity fallback"
```

---

## Task 6: Frontend — remove password login, add workspace switcher and invite UI

**Files:**
- Delete: `src/pages/Login.jsx`
- Modify: `src/App.jsx`, `src/api.js`
- Create: `src/components/WorkspaceSwitcher.jsx`, `src/pages/Workspace.jsx`

**Interfaces:**
- Consumes: `GET /api/me` → `{ email, workspaces: [{id, name, role}], workspaceId }` (Task 3); `GET/POST/DELETE /api/workspaces/current/*` (Task 4).
- Produces: no new consumers outside this task — this is the UI leaf.

- [ ] **Step 1: Update `src/api.js`**

Replace the 401 handling — there's no login screen to bounce to anymore, so surface a clear message instead of a silent event nobody's listening for after this task:

```js
export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (res.status === 401) {
    throw new Error('Signed out. Reload the page to sign in again.')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return res.json()
}

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100).toLocaleString('en-US')
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`
}
```

- [ ] **Step 2: Delete `src/pages/Login.jsx`**

```bash
rm src/pages/Login.jsx
```

- [ ] **Step 3: Create `src/components/WorkspaceSwitcher.jsx`**

```jsx
export default function WorkspaceSwitcher({ workspaces, currentId, onSwitch }) {
  if (workspaces.length <= 1) return null
  return (
    <select
      value={currentId}
      onChange={(e) => onSwitch(Number(e.target.value))}
      className="w-full rounded-lg bg-spruce text-white text-sm px-2 py-1.5 mb-4 border border-white/20"
    >
      {workspaces.map((w) => (
        <option key={w.id} value={w.id} className="text-ink">
          {w.name}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 4: Create `src/pages/Workspace.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function Workspace() {
  const [data, setData] = useState(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  function load() {
    api('/workspaces/current/members').then(setData).catch((e) => setError(e.message))
  }
  useEffect(load, [])

  async function invite(e) {
    e.preventDefault()
    setError('')
    try {
      await api('/workspaces/current/invites', { method: 'POST', body: { email } })
      setEmail('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function revoke(inviteEmail) {
    await api(`/workspaces/current/invites/${encodeURIComponent(inviteEmail)}`, { method: 'DELETE' })
    load()
  }

  if (!data) return null

  return (
    <div className="p-6 max-w-lg">
      <h1 className="font-display font-extrabold text-2xl text-spruce-deep mb-1">{data.workspace.name}</h1>
      <p className="text-ink-soft mb-6">Who can see and edit this budget.</p>

      <h2 className="font-semibold mb-2">Members</h2>
      <ul className="mb-6 space-y-1">
        {data.members.map((m) => (
          <li key={m.email} className="text-sm">
            {m.email} <span className="text-ink-soft">— {m.role}</span>
          </li>
        ))}
      </ul>

      {data.pendingInvites.length > 0 && (
        <>
          <h2 className="font-semibold mb-2">Pending invites</h2>
          <ul className="mb-6 space-y-1">
            {data.pendingInvites.map((inviteEmail) => (
              <li key={inviteEmail} className="text-sm flex items-center gap-2">
                {inviteEmail}
                <button onClick={() => revoke(inviteEmail)} className="text-brick text-xs">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <form onSubmit={invite} className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="someone@gmail.com"
          className="flex-1 rounded-lg border border-mist px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-spruce text-white px-4 py-2 text-sm font-semibold">
          Invite
        </button>
      </form>
      {error && <p className="text-brick text-sm mt-2">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Rewrite `src/App.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { api } from './api.js'
import Budget from './pages/Budget.jsx'
import Accounts from './pages/Accounts.jsx'
import Transactions from './pages/Transactions.jsx'
import Debt from './pages/Debt.jsx'
import Workspace from './pages/Workspace.jsx'
import WorkspaceSwitcher from './components/WorkspaceSwitcher.jsx'

const VIEWS = [
  { id: 'budget', label: 'Budget' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'debt', label: 'Debt' },
  { id: 'workspace', label: 'Sharing' },
]

function currentView() {
  const hash = window.location.hash.replace('#', '')
  return VIEWS.some((v) => v.id === hash) ? hash : 'budget'
}

export default function App() {
  const [me, setMe] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [view, setView] = useState(currentView)

  useEffect(() => {
    api('/me').then(setMe).catch((e) => setError(e.message))
    const onHash = () => setView(currentView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function switchWorkspace(id) {
    const url = new URL(window.location.href)
    url.searchParams.set('workspace', id)
    window.location.href = url.toString()
  }

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 text-center">
        <p className="text-brick">{error}</p>
      </div>
    )
  }
  if (!me) return null

  return (
    <div className="h-dvh flex flex-col md:flex-row overflow-hidden">
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-spruce-deep text-white p-4">
        <div className="font-display font-extrabold text-2xl mb-4">Envelope</div>
        <WorkspaceSwitcher workspaces={me.workspaces} currentId={me.workspaceId} onSwitch={switchWorkspace} />
        <nav className="space-y-1">
          {VIEWS.map((v) => (
            <a
              key={v.id}
              href={`#${v.id}`}
              className={`block rounded-lg px-3 py-2 font-medium ${
                view === v.id ? 'bg-spruce text-white' : 'text-white/70 hover:text-white'
              }`}
            >
              {v.label}
            </a>
          ))}
        </nav>
        <div className="mt-auto text-white/60 text-sm px-3 py-2 truncate">{me.email}</div>
      </aside>

      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {view === 'budget' && <Budget />}
        {view === 'transactions' && <Transactions />}
        {view === 'accounts' && <Accounts />}
        {view === 'debt' && <Debt />}
        {view === 'workspace' && <Workspace />}
      </main>

      <nav
        className="md:hidden shrink-0 bg-white border-t border-mist flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {VIEWS.map((v) => (
          <a
            key={v.id}
            href={`#${v.id}`}
            aria-current={view === v.id ? 'page' : undefined}
            className={`flex-1 text-center py-4 text-sm font-medium ${
              view === v.id ? 'text-spruce' : 'text-ink-soft'
            }`}
          >
            {v.label}
          </a>
        ))}
      </nav>
    </div>
  )
}
```

- [ ] **Step 6: Build and smoke-test**

Run: `npm run build`
Expected: builds clean, no reference to `./pages/Login.jsx` remains anywhere (`grep -rn "pages/Login" src/` should return nothing).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Replace password login screen with workspace switcher and sharing page"
```

---

## Task 7: Update the deploy runbook for Google Access and OWNER_EMAIL

**Files:**
- Modify: `deploy/README.md`

**Interfaces:** None — documentation only, but it's the actual operational instructions, so get it right.

- [ ] **Step 1: Replace step 3 ("Password and secrets")**

```markdown
## 3. The owner's email

```bash
echo "OWNER_EMAIL=you@gmail.com" | sudo -u envelope tee /opt/envelope/.env
sudo chmod 600 /opt/envelope/.env
```

That's the Google account that should land in the pre-existing "Personal"
workspace instead of getting a brand-new empty one on its first sign-in.
Everyone else who signs in gets their own workspace automatically, or lands in
whatever workspace they were invited to from inside the app (see "Sharing" in
the app once you're in).
```

- [ ] **Step 2: Replace step 7 ("Access, which is the part that matters")**

```markdown
## 7. Access, which is the part that matters

Cloudflare Access is the entire login system now — there is no app password.
Getting this step right is not optional.

Zero Trust dashboard, then **Settings, Authentication**:

1. Add a login method: **Google**. Follow Cloudflare's prompts to create a
   Google OAuth client (Google Cloud Console → APIs & Services → Credentials);
   Cloudflare shows you exactly what redirect URI to register.

Then **Access, Applications, Add a self-hosted application**:

- Domain: whatever public hostname you routed the tunnel to
- Policy: **Allow**, selector **Login Methods**, value **Google** — deliberately
  not scoped to your email, since anyone with a Google account should be able
  to sign up for their own budget
- Under **Settings** for the application, confirm **Add Authorization Header:
  On** — this is what puts `Cf-Access-Authenticated-User-Email` on every
  request the app sees, which is the only thing `server/identity.js` trusts

This is a real login gate, not a "thin cover" the way the old email-only
policy was: Google's own account security (their own 2FA, if the visitor has
it on) sits in front of everyone who reaches the app, not just you.

Google sign-in is close to instant when the visitor is already signed into
Google in their browser — no emailed one-time code to wait on, which was the
whole reason to move off Access's default login method.
```

- [ ] **Step 3: Update step 8's mention of the deploy-restart sudoers line if it mentions the password**

Read the current step 8 and confirm it doesn't reference the password anywhere (it currently only talks about `systemctl restart envelope`, so no change is expected — verify with `grep -n password deploy/README.md`, expected: no matches after this task).

- [ ] **Step 4: Commit**

```bash
git add deploy/README.md
git commit -m "Rewrite deploy runbook for Google-based Access instead of password + email OTP"
```

---

## Task 8: End-to-end verification on the webhost

**Files:** None modified — this is a verification pass on the already-cloned `~/repos/budget` on the webhost (`192.168.6.13`), not a code task.

- [ ] **Step 1: Pull the branch and install**

```bash
cd ~/repos/budget
git pull
npm ci
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: every test file passes — `auth.test.js` is gone (deleted in Task 2), replaced by `identity.test.js`; `workspace-isolation.test.js` and `workspaces.test.js` are new and passing; `budget.test.js`, `debt.test.js`, `splits.test.js`, `targets.test.js`, `credit.test.js`, `hide.test.js` are unchanged and still passing.

- [ ] **Step 3: Build and boot locally on the webhost, bypassing Access, to prove the dev fallback and the real app boot both work**

```bash
npm run build
NODE_ENV=development PORT=4517 HOST=127.0.0.1 node server/index.js &
sleep 1
curl -s http://127.0.0.1:4517/api/me
```

Expected: JSON with `"email":"dev@localhost"` and a freshly auto-provisioned workspace. Kill the background process afterward (`kill %1`).

- [ ] **Step 4: Report back**

Summarize: test results, and confirm `npm run build` produced `dist/` with no errors. Do not proceed to actually standing up the systemd service, Cloudflare tunnel ingress entry, or Access application here — those are separate deploy actions the user does deliberately (per `deploy/README.md`), not something to trigger as a side effect of finishing this plan.
