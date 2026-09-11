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
]

const current = db.prepare('PRAGMA user_version').get().user_version
for (let v = current; v < migrations.length; v++) {
  db.exec('BEGIN')
  db.exec(migrations[v])
  db.exec(`PRAGMA user_version = ${v + 1}`)
  db.exec('COMMIT')
}
