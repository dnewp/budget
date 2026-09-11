// Interest is checked against textbook values first: if the monthly charge is
// wrong, every payoff date built on it is fiction.
import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyInterest, payoffMonths, totalInterest, project } from './debt.js'

// A big balance at a low rate, and a smaller one at a high rate. The pair matters
// because the interesting case is when the cheaper rate costs more overall.
const BIG = { balance: 2000000, apr: 1200, payment: 35000 }
const SMALL = { balance: 500000, apr: 2400, payment: 25000 }

const near = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected within ${tolerance} of ${expected}`
  )

test('monthly interest is balance times rate over twelve', () => {
  assert.equal(monthlyInterest(2000000, 1200), 20000, '20,000 at 12% costs 200 a month')
  assert.equal(monthlyInterest(500000, 2400), 10000, '5,000 at 24% costs 100 a month')
  assert.equal(monthlyInterest(120000, 500), 500, '1,200 at 5% costs 5 a month')
})

test('a payment below the interest never pays anything off', () => {
  assert.equal(payoffMonths(BIG.balance, BIG.apr, 19999), null, 'a cent short is a treadmill')
  assert.equal(payoffMonths(BIG.balance, BIG.apr, 10000), null, 'well short is worse')
  assert.equal(totalInterest(BIG.balance, BIG.apr, 10000), null)
  assert.equal(payoffMonths(BIG.balance, BIG.apr, 0), null, 'paying nothing never clears it')
})

test('a payment barely above the interest is technically finite and practically not', () => {
  // A cent over the interest charge does pay off, in centuries. The maths is
  // honest; anything past HOPELESS_MONTHS is presented as never in the UI.
  const months = payoffMonths(BIG.balance, BIG.apr, 20001)
  assert.ok(months > 600, `expected an absurd horizon, got ${months} months`)
})

test('a thin payment stretches a low rate out for years', () => {
  // 20,000 at 12% costs 200 a month in interest, so a 350 payment only puts 150
  // against the balance and takes over seven years.
  const months = payoffMonths(BIG.balance, BIG.apr, BIG.payment)
  near(months, 86, 1, 'big balance payoff')
  assert.ok(totalInterest(BIG.balance, BIG.apr, BIG.payment) > 600000, 'costs over 6,000')
})

test('a bigger payment beats a lower rate', () => {
  // The whole point of ranking debts by cost rather than by rate: the 12% balance
  // above takes longer and costs more than this 24% one.
  const smallMonths = payoffMonths(SMALL.balance, SMALL.apr, SMALL.payment)
  const bigMonths = payoffMonths(BIG.balance, BIG.apr, BIG.payment)
  assert.ok(smallMonths < bigMonths, 'the higher rate clears first')
  assert.ok(
    totalInterest(SMALL.balance, SMALL.apr, SMALL.payment) <
      totalInterest(BIG.balance, BIG.apr, BIG.payment),
    'and costs less overall'
  )
})

test('a zero rate is simple division', () => {
  assert.equal(payoffMonths(250000, 0, 25000), 10, '2,500 at 0% takes ten months')
  assert.equal(totalInterest(250000, 0, 25000), 0)
})

test('an unknown rate is treated as zero rather than guessed', () => {
  assert.equal(monthlyInterest(250000, null), 0)
  assert.equal(payoffMonths(250000, null, 25000), 10)
})

test('paying more saves both time and money', () => {
  const debt = project({
    balance_cents: BIG.balance,
    apr_bp: BIG.apr,
    payment_cents: BIG.payment,
  })
  const plus100 = debt.scenarios.find((s) => s.extra_cents === 10000)
  assert.ok(plus100.months < debt.months, 'finishes sooner')
  assert.ok(plus100.interest_saved_cents > 100000, 'saves over 1,000 dollars')
  assert.ok(plus100.months_saved > 12, 'saves more than a year')
})

test('a cleared balance needs no projecting', () => {
  assert.equal(payoffMonths(0, 2549, 15600), 0)
  assert.equal(totalInterest(0, 2549, 15600), 0)
})
