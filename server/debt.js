// Debt payoff maths. Pure functions so the projections are testable without a
// database. Rates are basis points (1649 = 16.49%) to keep them integers.

export const monthlyRate = (aprBp) => (aprBp ?? 0) / 10000 / 12

// Paying a cent more than the interest does clear the balance eventually, but a
// payoff measured in decades is a treadmill, not a plan. Past this, say so.
export const HOPELESS_MONTHS = 600

// What this balance costs in a month if nothing is paid.
export function monthlyInterest(balanceCents, aprBp) {
  return Math.round(Math.abs(balanceCents) * monthlyRate(aprBp))
}

/**
 * Months until the balance reaches zero at a fixed payment.
 * Returns null when the payment never clears the interest, which is not an edge
 * case worth hiding: it means the balance grows forever.
 */
export function payoffMonths(balanceCents, aprBp, paymentCents) {
  const balance = Math.abs(balanceCents)
  if (balance === 0) return 0
  if (paymentCents <= 0) return null
  const r = monthlyRate(aprBp)
  if (r === 0) return Math.ceil(balance / paymentCents)
  const interest = balance * r
  if (paymentCents <= interest) return null
  return Math.ceil(Math.log(paymentCents / (paymentCents - interest)) / Math.log(1 + r))
}

// Total interest paid getting to zero. Simulated month by month rather than
// derived, because the final payment is a partial one and the closed form
// quietly overstates it.
export function totalInterest(balanceCents, aprBp, paymentCents) {
  const months = payoffMonths(balanceCents, aprBp, paymentCents)
  if (months === null) return null
  const r = monthlyRate(aprBp)
  let balance = Math.abs(balanceCents)
  let interest = 0
  for (let i = 0; i < months; i++) {
    const charged = Math.round(balance * r)
    interest += charged
    balance = balance + charged - Math.min(paymentCents, balance + charged)
    if (balance <= 0) break
  }
  return interest
}

/**
 * One debt, projected at its current payment and at a few larger ones, so the
 * cost of the current plan sits next to what a bit more would do.
 */
export function project(debt, extras = [5000, 10000, 20000]) {
  const { balance_cents, apr_bp, payment_cents } = debt
  const base = {
    months: payoffMonths(balance_cents, apr_bp, payment_cents),
    interest_cents: totalInterest(balance_cents, apr_bp, payment_cents),
  }
  return {
    ...debt,
    monthly_interest_cents: monthlyInterest(balance_cents, apr_bp),
    principal_cents: payment_cents - monthlyInterest(balance_cents, apr_bp),
    ...base,
    scenarios: extras.map((extra) => {
      const payment = payment_cents + extra
      const months = payoffMonths(balance_cents, apr_bp, payment)
      const interest = totalInterest(balance_cents, apr_bp, payment)
      return {
        extra_cents: extra,
        payment_cents: payment,
        months,
        interest_cents: interest,
        months_saved: base.months !== null && months !== null ? base.months - months : null,
        interest_saved_cents:
          base.interest_cents !== null && interest !== null ? base.interest_cents - interest : null,
      }
    }),
  }
}
