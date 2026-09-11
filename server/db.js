import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(path.join(dataDir, 'budget.db'))
db.exec('PRAGMA journal_mode = WAL')

// Migrations keyed off PRAGMA user_version. Append a new block, never edit an old one.
const migrations = [
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit', 'cash')),
    closed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE category_groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES category_groups(id),
    name TEXT NOT NULL,
    emoji TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    date TEXT NOT NULL,
    payee TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id),
    memo TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL,
    cleared INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE allocations (
    month TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    assigned_cents INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (month, category_id)
  );
  CREATE INDEX idx_tx_account ON transactions(account_id, date);
  CREATE INDEX idx_tx_category ON transactions(category_id, date);
  `,
  `
  -- A monthly funding goal per envelope, 0 meaning no goal set.
  ALTER TABLE categories ADD COLUMN target_cents INTEGER NOT NULL DEFAULT 0;
  -- A split is simply several transaction rows sharing one split_group, so the
  -- envelope math and account balances keep working with no special cases.
  ALTER TABLE transactions ADD COLUMN split_group INTEGER;
  CREATE INDEX idx_tx_split ON transactions(split_group);
  CREATE TABLE payees (
    name TEXT PRIMARY KEY,
    last_category_id INTEGER REFERENCES categories(id)
  );
  `,
  `
  -- How often the target amount is actually due. A quarterly or yearly bill is
  -- saved for in monthly instalments rather than demanded all at once.
  ALTER TABLE categories ADD COLUMN target_period TEXT NOT NULL DEFAULT 'monthly';
  `,
  `
  -- One row per account per month once its balance has been checked against the
  -- real bank balance. adjustment_cents records a forced reconcile, so a fudged
  -- month is always visible afterwards rather than silently absorbed.
  CREATE TABLE reconciliations (
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    month TEXT NOT NULL,
    actual_balance_cents INTEGER NOT NULL,
    adjustment_cents INTEGER NOT NULL DEFAULT 0,
    reconciled_at TEXT NOT NULL,
    PRIMARY KEY (account_id, month)
  );
  `,
  `
  -- Following YNAB: a reconciled transaction is locked, because it has been
  -- proven against a real bank statement and editing it would break that proof.
  ALTER TABLE transactions ADD COLUMN reconciled INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Rate in basis points (1649 = 16.49%) so it stays an integer, null when unknown.
  ALTER TABLE accounts ADD COLUMN apr_bp INTEGER;
  -- The envelope that pays this account, so the payoff projection reads the real
  -- budgeted payment instead of duplicating it and letting the two drift apart.
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

const current = db.prepare('PRAGMA user_version').get().user_version
for (let v = current; v < migrations.length; v++) {
  db.exec('BEGIN')
  db.exec(migrations[v])
  db.exec(`PRAGMA user_version = ${v + 1}`)
  db.exec('COMMIT')
}

const ownerEmail = process.env.OWNER_EMAIL
if (ownerEmail) {
  db.prepare(
    `INSERT INTO workspace_invites (workspace_id, email) VALUES (1, ?)
     ON CONFLICT(workspace_id, email) DO NOTHING`
  ).run(ownerEmail)
}
