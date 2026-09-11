// A credit card balance is debt, not spendable cash. Entering the real balance
// must not read as losing that much money out of the budget today.
import test from 'node:test'
import assert from 'node:assert/strict'
import { envelopeSummary } from './budget.js'

const categories = [{ id: 1, group_id: 1, name: 'Groceries', emoji: null, target_cents: 0 }]

test('a card balance does not come out of Ready to Assign', () => {
  const out = envelopeSummary(
    {
      categories,
      allocations: [],
      transactions: [
        { date: '2026-09-01', category_id: null, amount_cents: 265740, account_type: 'checking' },
        { date: '2026-09-01', category_id: null, amount_cents: -843219, account_type: 'credit' },
      ],
    },
    '2026-09'
  )
  assert.equal(out.ready_to_assign_cents, 265740, 'only the paycheck is spendable')
})

test('spending on a card still empties its envelope', () => {
  const out = envelopeSummary(
    {
      categories,
      allocations: [{ month: '2026-09', category_id: 1, assigned_cents: 42000 }],
      transactions: [
        { date: '2026-09-01', category_id: null, amount_cents: 265740, account_type: 'checking' },
        { date: '2026-09-01', category_id: null, amount_cents: -843219, account_type: 'credit' },
        { date: '2026-09-08', category_id: 1, amount_cents: -12500, account_type: 'credit' },
      ],
    },
    '2026-09'
  )
  const groceries = out.categories[0]
  assert.equal(groceries.activity_cents, -12500, 'a card purchase is still real spending')
  assert.equal(groceries.available_cents, 29500)
  assert.equal(out.ready_to_assign_cents, 265740 - 42000, 'assigning is what moves Ready to Assign')
})

test('cash accounts still feed Ready to Assign', () => {
  for (const type of ['checking', 'savings', 'cash']) {
    const out = envelopeSummary(
      {
        categories,
        allocations: [],
        transactions: [{ date: '2026-09-01', category_id: null, amount_cents: 50000, account_type: type }],
      },
      '2026-09'
    )
    assert.equal(out.ready_to_assign_cents, 50000, `${type} balances are spendable`)
  }
})
