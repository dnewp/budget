import test from 'node:test'
import assert from 'node:assert/strict'
import { envelopeSummary } from './budget.js'

const categories = [
  { id: 1, group_id: 1, name: 'Groceries', emoji: null },
  { id: 2, group_id: 1, name: 'Motorcycle', emoji: null },
]

test('assigning money makes it available and leaves the rest to assign', () => {
  const out = envelopeSummary(
    {
      categories,
      allocations: [{ month: '2026-08', category_id: 1, assigned_cents: 40000 }],
      transactions: [{ date: '2026-08-01', category_id: null, amount_cents: 100000 }],
    },
    '2026-08'
  )
  const groceries = out.categories.find((c) => c.id === 1)
  assert.equal(groceries.assigned_cents, 40000)
  assert.equal(groceries.available_cents, 40000)
  assert.equal(out.ready_to_assign_cents, 60000)
})

test('spending reduces activity and available but not what was assigned', () => {
  const out = envelopeSummary(
    {
      categories,
      allocations: [{ month: '2026-08', category_id: 1, assigned_cents: 40000 }],
      transactions: [
        { date: '2026-08-01', category_id: null, amount_cents: 100000 },
        { date: '2026-08-14', category_id: 1, amount_cents: -12500 },
      ],
    },
    '2026-08'
  )
  const groceries = out.categories.find((c) => c.id === 1)
  assert.equal(groceries.assigned_cents, 40000)
  assert.equal(groceries.activity_cents, -12500)
  assert.equal(groceries.available_cents, 27500)
  assert.equal(out.ready_to_assign_cents, 60000)
})

test('leftover money carries into the next month', () => {
  const data = {
    categories,
    allocations: [
      { month: '2026-07', category_id: 1, assigned_cents: 40000 },
      { month: '2026-08', category_id: 1, assigned_cents: 40000 },
    ],
    transactions: [
      { date: '2026-07-05', category_id: null, amount_cents: 200000 },
      { date: '2026-07-20', category_id: 1, amount_cents: -30000 },
    ],
  }
  const august = envelopeSummary(data, '2026-08').categories.find((c) => c.id === 1)
  assert.equal(august.activity_cents, 0, 'July spending is not August activity')
  assert.equal(august.available_cents, 50000, 'July leftover of 100.00 plus August 400.00')
})

test('overspending carries forward as a negative envelope', () => {
  const data = {
    categories,
    allocations: [{ month: '2026-07', category_id: 2, assigned_cents: 10000 }],
    transactions: [
      { date: '2026-07-05', category_id: null, amount_cents: 200000 },
      { date: '2026-07-22', category_id: 2, amount_cents: -25000 },
    ],
  }
  const july = envelopeSummary(data, '2026-07').categories.find((c) => c.id === 2)
  const august = envelopeSummary(data, '2026-08').categories.find((c) => c.id === 2)
  assert.equal(july.available_cents, -15000)
  assert.equal(august.available_cents, -15000, 'the hole follows you into next month')
})

test('uncategorized spending comes straight out of Ready to Assign', () => {
  const out = envelopeSummary(
    {
      categories,
      allocations: [],
      transactions: [
        { date: '2026-08-01', category_id: null, amount_cents: 100000 },
        { date: '2026-08-03', category_id: null, amount_cents: -2500 },
      ],
    },
    '2026-08'
  )
  assert.equal(out.ready_to_assign_cents, 97500)
})

test('assigning into a future month is already spoken for today', () => {
  const out = envelopeSummary(
    {
      categories,
      allocations: [{ month: '2026-09', category_id: 1, assigned_cents: 30000 }],
      transactions: [{ date: '2026-08-01', category_id: null, amount_cents: 100000 }],
    },
    '2026-08'
  )
  assert.equal(out.ready_to_assign_cents, 70000)
  assert.equal(out.categories.find((c) => c.id === 1).available_cents, 0)
})
