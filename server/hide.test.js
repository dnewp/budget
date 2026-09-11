// Hiding an envelope must never strand the money inside it. The released amount
// is taken back out of that month's assignment, which is what returns it to
// Ready to Assign, so the arithmetic below is what the route relies on.
import test from 'node:test'
import assert from 'node:assert/strict'
import { envelopeSummary } from './budget.js'

const categories = [{ id: 1, group_id: 1, name: 'Pets', emoji: null, target_cents: 8500 }]
const income = { date: '2026-09-01', category_id: null, amount_cents: 265740, account_type: 'checking' }

test('releasing an envelope returns its money to Ready to Assign', () => {
  const assigned = 8500
  const before = envelopeSummary(
    {
      categories,
      allocations: [{ month: '2026-09', category_id: 1, assigned_cents: assigned }],
      transactions: [income],
    },
    '2026-09'
  )
  assert.equal(before.categories[0].available_cents, 8500)
  assert.equal(before.ready_to_assign_cents, 265740 - 8500)

  // What the route does: subtract the leftover from this month's assignment.
  const released = assigned - before.categories[0].available_cents
  const after = envelopeSummary(
    {
      categories,
      allocations: [{ month: '2026-09', category_id: 1, assigned_cents: released }],
      transactions: [income],
    },
    '2026-09'
  )
  assert.equal(after.categories[0].available_cents, 0, 'nothing left stranded')
  assert.equal(after.ready_to_assign_cents, 265740, 'the money is spendable again')
})

test('releasing an overspent envelope hands the shortfall back, not a windfall', () => {
  const assigned = 8500
  const data = {
    categories,
    allocations: [{ month: '2026-09', category_id: 1, assigned_cents: assigned }],
    transactions: [income, { date: '2026-09-10', category_id: 1, amount_cents: -12000, account_type: 'checking' }],
  }
  const before = envelopeSummary(data, '2026-09')
  assert.equal(before.categories[0].available_cents, -3500, 'overspent by 35.00')

  const released = assigned - before.categories[0].available_cents
  assert.equal(released, 12000, 'assignment rises to cover what was actually spent')

  const after = envelopeSummary(
    { ...data, allocations: [{ month: '2026-09', category_id: 1, assigned_cents: released }] },
    '2026-09'
  )
  assert.equal(after.categories[0].available_cents, 0)
  assert.equal(
    after.ready_to_assign_cents,
    265740 - 12000,
    'Ready to Assign absorbs the overspending instead of it vanishing'
  )
})

test('an envelope holding nothing can be hidden with no adjustment', () => {
  const out = envelopeSummary({ categories, allocations: [], transactions: [income] }, '2026-09')
  assert.equal(out.categories[0].available_cents, 0)
  assert.equal(out.ready_to_assign_cents, 265740)
})
