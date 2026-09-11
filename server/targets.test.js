// Bills that are not monthly get saved for in instalments, so the money is
// already in the envelope when the bill lands.
import test from 'node:test'
import assert from 'node:assert/strict'
import { envelopeSummary, monthlyNeed, averageSpent } from './budget.js'

const bucket = {
  id: 1, group_id: 1, name: 'Repairs float', emoji: null,
  target_cents: 100000, target_period: 'balance',
}

test('an empty bucket asks for the whole float', () => {
  const out = envelopeSummary({ categories: [bucket], allocations: [], transactions: [] }, '2026-09')
  assert.equal(out.categories[0].needed_cents, 100000)
})

test('a full bucket asks for nothing', () => {
  const out = envelopeSummary(
    {
      categories: [bucket],
      allocations: [{ month: '2026-09', category_id: 1, assigned_cents: 100000 }],
      transactions: [],
    },
    '2026-09'
  )
  assert.equal(out.categories[0].available_cents, 100000)
  assert.equal(out.categories[0].needed_cents, 0)
})

test('spending from a bucket asks for exactly the top-up', () => {
  const data = {
    categories: [bucket],
    allocations: [{ month: '2026-09', category_id: 1, assigned_cents: 100000 }],
    transactions: [{ date: '2026-10-08', category_id: 1, amount_cents: -18500 }],
  }
  const october = envelopeSummary(data, '2026-10').categories[0]
  assert.equal(october.available_cents, 81500, 'the float dropped by what was spent')
  assert.equal(october.needed_cents, 18500, 'and asks for exactly that back')
})

test('a bucket topped back up is full again', () => {
  const out = envelopeSummary(
    {
      categories: [bucket],
      allocations: [
        { month: '2026-09', category_id: 1, assigned_cents: 100000 },
        { month: '2026-10', category_id: 1, assigned_cents: 18500 },
      ],
      transactions: [{ date: '2026-10-08', category_id: 1, amount_cents: -18500 }],
    },
    '2026-10'
  )
  assert.equal(out.categories[0].available_cents, 100000)
  assert.equal(out.categories[0].needed_cents, 0)
})

test('a seasonal bill averages across empty months, not just months it landed', () => {
  // A bill that lands every other month. Averaging only the months it appears
  // would read 150 a month when the real cost is 100.
  const water = [
    { date: '2026-07-02', category_id: 1, amount_cents: -15000 },
    { date: '2026-09-12', category_id: 1, amount_cents: -15000 },
  ]
  assert.equal(averageSpent(water, '2026-09'), Math.round(30000 / 3), 'three months, not two')
  assert.equal(averageSpent(water, '2026-09'), 10000)
})

test('one month of history is not an average', () => {
  assert.equal(averageSpent([{ date: '2026-09-02', category_id: 1, amount_cents: -8000 }], '2026-09'), null)
  assert.equal(averageSpent([], '2026-09'), null)
})

test('housemate payments in do not flatter the average spent', () => {
  const power = [
    { date: '2026-08-03', category_id: 1, amount_cents: -20000 },
    { date: '2026-09-03', category_id: 1, amount_cents: -20000 },
    { date: '2026-09-04', category_id: 1, amount_cents: 13333 },
  ]
  assert.equal(averageSpent(power, '2026-09'), 20000, 'measures the bill, not one share of it')
})

test('a quarterly bill is saved for in thirds', () => {
  assert.equal(monthlyNeed(9000, 'quarterly'), 3000)
  assert.ok(3000 * 3 >= 9000, 'three instalments must cover the bill, never fall short')
})

test('a yearly bill is saved for in twelfths', () => {
  assert.equal(monthlyNeed(12000, 'yearly'), 1000)
  assert.ok(1000 * 12 >= 12000, 'twelve instalments must cover the bill')
})

test('a monthly bill asks for its full amount', () => {
  assert.equal(monthlyNeed(20000, 'monthly'), 20000)
})

test('an unknown or missing period is treated as monthly', () => {
  assert.equal(monthlyNeed(5000, undefined), 5000)
  assert.equal(monthlyNeed(5000, 'weekly'), 5000)
})

test('three months of instalments cover the quarterly bill', () => {
  const trash = { id: 1, group_id: 1, name: 'Quarterly bill', emoji: null, target_cents: 9000, target_period: 'quarterly' }
  const allocations = ['2026-09', '2026-10', '2026-11'].map((month) => ({
    month,
    category_id: 1,
    assigned_cents: 3000,
  }))

  const september = envelopeSummary({ categories: [trash], allocations, transactions: [] }, '2026-09')
  assert.equal(september.categories[0].monthly_need_cents, 3000)
  assert.equal(september.categories[0].available_cents, 3000, 'one instalment saved so far')

  // By November the envelope holds enough, and the bill empties it without
  // ever leaving the envelope negative.
  const november = envelopeSummary(
    {
      categories: [trash],
      allocations,
      transactions: [{ date: '2026-11-20', category_id: 1, amount_cents: -9000 }],
    },
    '2026-11'
  )
  assert.equal(november.categories[0].available_cents, 3000 * 3 - 9000)
  assert.ok(november.categories[0].available_cents >= 0, 'the saved money covered the bill')
})

test('a housemate paying into a quarterly envelope reduces that month instalment', () => {
  const trash = { id: 1, group_id: 1, name: 'Quarterly bill', emoji: null, target_cents: 9000, target_period: 'quarterly' }
  const out = envelopeSummary(
    {
      categories: [trash],
      allocations: [],
      transactions: [{ date: '2026-09-04', category_id: 1, amount_cents: 1660 }],
    },
    '2026-09'
  )
  const row = out.categories[0]
  assert.equal(row.monthly_need_cents, 3000)
  assert.equal(row.funded_cents, 1660)
  assert.equal(row.monthly_need_cents - row.funded_cents, 1340, 'the rest still needs assigning')
})
