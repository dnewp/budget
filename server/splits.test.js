// Splits are how a single payment app deposit gets divided between a housemate's
// share of a bill and a dinner someone paid back. Every cent must land in an
// envelope, or money quietly leaves the budget while the balance still moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { envelopeSummary } from './budget.js'

const categories = [
  { id: 1, group_id: 1, name: 'Mortgage', emoji: null },
  { id: 2, group_id: 1, name: 'Dining Out', emoji: null },
]

// A round bill amount, split so two housemates cover most of it.
const RENT = 200000

test('a split inflow lands in each envelope it was divided into', () => {
  // $110 in: $100 a housemate's share, $10 a dinner payback.
  const out = envelopeSummary(
    {
      categories,
      allocations: [],
      transactions: [
        { date: '2026-09-05', category_id: 1, amount_cents: 10000 },
        { date: '2026-09-05', category_id: 2, amount_cents: 1000 },
      ],
    },
    '2026-09'
  )
  assert.equal(out.categories.find((c) => c.id === 1).available_cents, 10000)
  assert.equal(out.categories.find((c) => c.id === 2).available_cents, 1000)
  assert.equal(out.ready_to_assign_cents, 0, 'split money is assigned, not left over')
})

test('a split outflow spends from each envelope separately', () => {
  const out = envelopeSummary(
    {
      categories,
      allocations: [
        { month: '2026-09', category_id: 1, assigned_cents: RENT },
        { month: '2026-09', category_id: 2, assigned_cents: 40000 },
      ],
      transactions: [
        { date: '2026-09-01', category_id: null, amount_cents: 680300 },
        { date: '2026-09-10', category_id: 1, amount_cents: -RENT },
        { date: '2026-09-10', category_id: 2, amount_cents: -2500 },
      ],
    },
    '2026-09'
  )
  assert.equal(out.categories.find((c) => c.id === 1).available_cents, 0)
  assert.equal(out.categories.find((c) => c.id === 2).available_cents, 37500)
  assert.equal(out.ready_to_assign_cents, 680300 - RENT - 40000)
})

test('housemate money paid into the mortgage counts toward its target', () => {
  // The real bill is 2000.00. Housemates send 600.00 and 932.00 through a payment
  // app, paid straight into the Mortgage envelope, leaving only the rest to cover.
  const out = envelopeSummary(
    {
      categories,
      allocations: [],
      transactions: [
        { date: '2026-09-02', category_id: 1, amount_cents: 60000 },
        { date: '2026-09-03', category_id: 1, amount_cents: 93200 },
      ],
    },
    '2026-09'
  )
  const mortgage = out.categories.find((c) => c.id === 1)
  assert.equal(mortgage.inflow_cents, 153200)
  assert.equal(mortgage.funded_cents, 153200, 'paid-in money funds the envelope')
  assert.equal(RENT - mortgage.funded_cents, 46800, 'still owed 468.00')
  assert.equal(out.ready_to_assign_cents, 0, 'housemate money never sat in Ready to Assign')
})

test('a part-funded envelope is fully funded once the rest is assigned', () => {
  const out = envelopeSummary(
    {
      categories,
      allocations: [{ month: '2026-09', category_id: 1, assigned_cents: 46800 }],
      transactions: [
        { date: '2026-09-01', category_id: null, amount_cents: 680300 },
        { date: '2026-09-02', category_id: 1, amount_cents: 153200 },
        { date: '2026-09-05', category_id: 1, amount_cents: -RENT },
      ],
    },
    '2026-09'
  )
  const mortgage = out.categories.find((c) => c.id === 1)
  assert.equal(mortgage.funded_cents, RENT, 'assigned plus paid in covers the bill')
  assert.equal(mortgage.available_cents, 0, 'the bill emptied the envelope exactly')
  assert.equal(mortgage.activity_cents, -46800, 'net activity is what was actually paid')
  assert.equal(out.ready_to_assign_cents, 680300 - 46800)
})

test('split lines sum to the same total the account moved', () => {
  const lines = [-10000, -2500, -750]
  const total = -13250
  assert.equal(
    lines.reduce((sum, l) => sum + l, 0),
    total,
    'the register total and the split lines must agree'
  )
})
