import { Router } from 'express'
import { db } from './db.js'
import { envelopeSummary, TARGET_PERIODS } from './budget.js'
import { project, HOPELESS_MONTHS } from './debt.js'

export const routes = Router()

// Reject anything that is not a whole number of cents. Money never rounds silently.
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

// One optional emoji, stored as given. Grapheme-aware so flags and skin tones survive.
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

routes.get('/accounts', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT a.id, a.name, a.type, a.closed, a.apr_bp, a.payment_category_id,
                COALESCE((SELECT SUM(amount_cents) FROM transactions t
                          WHERE t.account_id = a.id), 0) AS balance_cents,
                COALESCE((SELECT SUM(amount_cents) FROM transactions t
                          WHERE t.account_id = a.id AND t.cleared = 1), 0) AS cleared_balance_cents
         FROM accounts a ORDER BY a.closed, a.name`
      )
      .all()
  )
})

routes.post('/accounts', (req, res) => {
  const name = text(req.body.name, 'Account name', { max: 60 })
  const type = req.body.type
  if (!ACCOUNT_TYPES.includes(type)) throw new HttpError(400, 'Unknown account type')
  const { lastInsertRowid } = db
    .prepare('INSERT INTO accounts (name, type) VALUES (?, ?)')
    .run(name, type)
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
  if (!db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(id)) {
    throw new HttpError(404, 'Account not found')
  }
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
    if (categoryId !== null && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) {
      throw new HttpError(400, 'Unknown envelope')
    }
    db.prepare('UPDATE accounts SET payment_category_id = ? WHERE id = ?').run(categoryId, id)
  }
  if (req.body.closed !== undefined) {
    db.prepare('UPDATE accounts SET closed = ? WHERE id = ?').run(req.body.closed ? 1 : 0, id)
  }

  // A balance is never stored: it is always the sum of the transactions. Setting
  // one writes the difference as a visible adjustment, so the ledger still adds
  // up and the correction is something you can find later.
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
  db.exec('BEGIN')
  db.prepare('DELETE FROM transactions WHERE account_id = ?').run(id)
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  db.exec('COMMIT')
  res.json({ ok: true })
})

routes.get('/transactions', (req, res) => {
  const accountId = req.query.account_id ? Number(req.query.account_id) : null
  const sql = `SELECT t.*, a.name AS account_name, c.name AS category_name, c.emoji AS category_emoji
               FROM transactions t
               JOIN accounts a ON a.id = t.account_id
               LEFT JOIN categories c ON c.id = t.category_id
               ${accountId ? 'WHERE t.account_id = ?' : ''}
               ORDER BY t.date DESC, t.id DESC LIMIT 500`
  res.json(accountId ? db.prepare(sql).all(accountId) : db.prepare(sql).all())
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

// Splits must account for every cent of the transaction, otherwise money would
// quietly vanish from the budget while the account balance still moved.
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

function rememberPayee(name, categoryId) {
  if (!name) return
  db.prepare(
    `INSERT INTO payees (name, last_category_id) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET last_category_id = COALESCE(excluded.last_category_id, last_category_id)`
  ).run(name, categoryId)
}

function insertTransaction(t, lines) {
  const insert = db.prepare(
    `INSERT INTO transactions (account_id, date, payee, category_id, memo, amount_cents, cleared, split_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  if (!lines) {
    const { lastInsertRowid } = insert.run(
      t.account_id, t.date, t.payee, t.category_id, t.memo, t.amount_cents, t.cleared, null
    )
    rememberPayee(t.payee, t.category_id)
    return Number(lastInsertRowid)
  }
  const group =
    (db.prepare('SELECT COALESCE(MAX(split_group), 0) AS m FROM transactions').get().m ?? 0) + 1
  for (const line of lines) {
    insert.run(
      t.account_id, t.date, t.payee, line.category_id,
      line.memo || t.memo, line.amount_cents, t.cleared, group
    )
  }
  rememberPayee(t.payee, null)
  return group
}

routes.post('/transactions', (req, res) => {
  const t = transactionFields(req.body)
  if (!db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(t.account_id)) {
    throw new HttpError(400, 'Unknown account')
  }
  const lines = splitLines(req.body)
  db.exec('BEGIN')
  try {
    const id = insertTransaction(t, lines)
    db.exec('COMMIT')
    res.json({ id })
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})

// Editing replaces the whole transaction, so a split can gain or lose lines
// without the update needing to reconcile row by row.
routes.put('/transactions/:id', (req, res) => {
  const t = transactionFields(req.body)
  const lines = splitLines(req.body)
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT split_group, reconciled FROM transactions WHERE id = ?').get(id)
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
    insertTransaction(t, lines)
    db.exec('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})

routes.delete('/transactions/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.prepare('SELECT split_group, reconciled FROM transactions WHERE id = ?').get(id)
  if (existing?.reconciled) {
    throw new HttpError(409, 'That transaction is reconciled and locked. Undo the reconcile first.')
  }
  if (existing?.split_group) {
    db.prepare('DELETE FROM transactions WHERE split_group = ?').run(existing.split_group)
  } else {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
  }
  res.json({ ok: true })
})

// Reconciling means proving the app agrees with the bank to the penny. Only cash
// accounts are reconciled: you check that what went in and out of checking
// matches what he recorded, and that the closing balance matches the bank site.
// Card balances are maintained from transactions and manual edits instead, so
// reconciling never turns into a five-account chore.
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
         WHERE a.closed = 0 AND a.type != 'credit'
         ORDER BY a.name`
      )
      .all(month, month, month, month, month, month)
  )
})

routes.post('/reconcile/:month/:accountId', (req, res) => {
  const month = monthParam(req.params.month)
  const accountId = Number(req.params.accountId)
  if (!db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(accountId)) {
    throw new HttpError(400, 'Unknown account')
  }
  const actual = cents(req.body.actual_balance_cents, 'Bank balance')
  // Compare against the CLEARED balance, as YNAB does. Money the bank has not
  // finished processing should not be expected to show up on its website yet.
  const cleared =
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions
         WHERE account_id = ? AND cleared = 1 AND substr(date, 1, 7) <= ?`
      )
      .get(accountId, month).total ?? 0
  const difference = actual - cleared

  // Refuse to reconcile a mismatch unless explicitly overridden, so the
  // default path is always finding the missing transaction rather than papering
  // over it.
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
      // Dated the last day of the month so it lands inside the month it fixes.
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
    // Lock everything cleared up to this month: it has been proven against a
    // statement, so it should not drift afterwards.
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

// Undoing a reconcile unlocks that month so mistakes stay fixable. Any balance
// adjustment it created is left in place on purpose: deleting it would silently
// change the balance, and it is an ordinary transaction you can remove yourself.
routes.delete('/reconcile/:month/:accountId', (req, res) => {
  const month = monthParam(req.params.month)
  const accountId = Number(req.params.accountId)
  db.exec('BEGIN')
  db.prepare(
    `UPDATE transactions SET reconciled = 0
     WHERE account_id = ? AND substr(date, 1, 7) <= ?`
  ).run(accountId, month)
  db.prepare('DELETE FROM reconciliations WHERE account_id = ? AND month = ?').run(accountId, month)
  db.exec('COMMIT')
  res.json({ ok: true })
})

// Toggling cleared is the everyday gesture before reconciling: it marks that the
// bank has finished processing something. Locked rows are past that point.
routes.patch('/transactions/:id/cleared', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT reconciled, split_group FROM transactions WHERE id = ?').get(id)
  if (!row) throw new HttpError(404, 'Transaction not found')
  if (row.reconciled) throw new HttpError(409, 'That transaction is reconciled and locked')
  const cleared = req.body.cleared ? 1 : 0
  if (row.split_group) {
    db.prepare('UPDATE transactions SET cleared = ? WHERE split_group = ?').run(
      cleared,
      row.split_group
    )
  } else {
    db.prepare('UPDATE transactions SET cleared = ? WHERE id = ?').run(cleared, id)
  }
  res.json({ ok: true, cleared: Boolean(cleared) })
})

// What the debt actually costs and when it ends, ranked by total interest rather
// than by rate: the cheapest rate can still cost the most when the payment barely
// clears the interest, which is common on a large low-rate balance.
routes.get('/debt', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.apr_bp, a.payment_category_id,
              COALESCE((SELECT SUM(amount_cents) FROM transactions t WHERE t.account_id = a.id), 0) AS balance_cents,
              c.name AS payment_envelope,
              COALESCE(c.target_cents, 0) AS payment_cents
       FROM accounts a
       LEFT JOIN categories c ON c.id = a.payment_category_id
       WHERE a.closed = 0 AND a.type = 'credit'
       ORDER BY a.name`
    )
    .all()

  const debts = rows
    .filter((d) => Math.abs(d.balance_cents) > 0)
    .map((d) => project({ ...d, balance_cents: Math.abs(d.balance_cents) }))

  // Longest payoff wins: the whole plan is only done when the last card is.
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

routes.get('/payees', (_req, res) => {
  res.json(db.prepare('SELECT name, last_category_id FROM payees ORDER BY name').all())
})

routes.get('/categories', (req, res) => {
  const hidden = req.query.hidden === '1' ? 1 : 0
  res.json(
    db
      .prepare(
        `SELECT c.id, c.name, c.emoji, c.group_id, c.hidden, g.name AS group_name
         FROM categories c JOIN category_groups g ON g.id = c.group_id
         WHERE c.hidden = ? ORDER BY g.sort_order, g.name, c.sort_order, c.name`
      )
      .all(hidden)
  )
})

routes.post('/category-groups', (req, res) => {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO category_groups (name) VALUES (?)')
    .run(text(req.body.name, 'Group name', { max: 60 }))
  res.json({ id: Number(lastInsertRowid) })
})

routes.post('/categories', (req, res) => {
  const groupId = Number(req.body.group_id)
  if (!db.prepare('SELECT 1 FROM category_groups WHERE id = ?').get(groupId)) {
    throw new HttpError(400, 'Unknown group')
  }
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
    if (!db.prepare('SELECT 1 FROM category_groups WHERE id = ?').get(groupId)) {
      throw new HttpError(400, 'Unknown group')
    }
    db.prepare('UPDATE categories SET group_id = ? WHERE id = ?').run(groupId, id)
  }
  if (req.body.hidden !== undefined) {
    // Hiding an envelope that still holds money would strand it: invisible on the
    // budget screen but still counted as assigned, so it never returns to Ready to
    // Assign. Refuse unless the caller says what to do with the money.
    if (req.body.hidden) {
      const month = req.body.month ? monthParam(req.body.month) : thisMonth()
      const envelope = summaryFor(month).categories.find((c) => c.id === id)
      const stranded = envelope?.available_cents ?? 0
      if (stranded !== 0 && !req.body.release) {
        return res.status(409).json({
          error: 'That envelope still has money in it',
          available_cents: stranded,
        })
      }
      if (stranded !== 0) {
        // Take the leftover back out of this month's assignment, which returns it
        // to Ready to Assign. A negative balance comes back as a debt to cover.
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

function summaryFor(month) {
  const rows = {
    categories: db
      .prepare(
        `SELECT c.id, c.group_id, c.name, c.emoji, c.target_cents, c.target_period,
                g.name AS group_name, g.sort_order AS group_order
         FROM categories c JOIN category_groups g ON g.id = c.group_id
         WHERE c.hidden = 0 ORDER BY g.sort_order, g.name, c.sort_order, c.name`
      )
      .all(),
    allocations: db.prepare('SELECT month, category_id, assigned_cents FROM allocations').all(),
    transactions: db
      .prepare(
        `SELECT t.date, t.category_id, t.amount_cents, a.type AS account_type
         FROM transactions t JOIN accounts a ON a.id = t.account_id`
      )
      .all(),
  }
  return envelopeSummary(rows, month)
}

routes.get('/budget/:month', (req, res) => {
  const month = monthParam(req.params.month)
  const summary = summaryFor(month)

  const groups = []
  for (const c of summary.categories) {
    let group = groups.find((g) => g.id === c.group_id)
    if (!group) groups.push((group = { id: c.group_id, name: c.group_name, categories: [] }))
    group.categories.push(c)
  }
  res.json({ month, ready_to_assign_cents: summary.ready_to_assign_cents, groups })
})

// Top every envelope up to its monthly target in one go. Money already paid
// straight into an envelope counts, so an envelope a roommate part-funded only
// needs the remainder assigned. Envelopes already at or past target are left
// alone, so this never claws money back.
routes.post('/budget/:month/fill-targets', (req, res) => {
  const month = monthParam(req.params.month)
  const assign = db.prepare(
    `INSERT INTO allocations (month, category_id, assigned_cents) VALUES (?, ?, ?)
     ON CONFLICT(month, category_id) DO UPDATE SET assigned_cents = excluded.assigned_cents`
  )
  let filled = 0
  let assigned = 0
  db.exec('BEGIN')
  for (const c of summaryFor(month).categories) {
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
  const assigned = cents(req.body.assigned_cents, 'Assigned')
  db.prepare(
    `INSERT INTO allocations (month, category_id, assigned_cents) VALUES (?, ?, ?)
     ON CONFLICT(month, category_id) DO UPDATE SET assigned_cents = excluded.assigned_cents`
  ).run(month, Number(req.params.categoryId), assigned)
  res.json({ ok: true })
})
