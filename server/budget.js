// Envelope math. Pure functions over plain rows so the rules are testable
// without a database. Every amount is integer cents.

export const monthOf = (isoDate) => isoDate.slice(0, 7)

// A bill due every so often, saved for in instalments.
export const PERIOD_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 }
// Plus 'balance': not a bill at all, a bucket that should always hold this much.
export const TARGET_PERIODS = [...Object.keys(PERIOD_MONTHS), 'balance']

// What a target asks for in any single month. A quarterly bill is saved for in
// thirds so the envelope already holds the money when the bill lands. Rounded up,
// because coming up a cent short on a real bill is worse than a cent over.
export function monthlyNeed(targetCents, period) {
  const months = PERIOD_MONTHS[period] ?? 1
  return Math.ceil(targetCents / months)
}

const monthsApart = (a, b) => {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

/**
 * What this envelope actually costs in an average month, as a positive amount.
 * Seasonal bills swing hard, so the useful question is not what you paid last
 * month but what you pay across a run of months. Empty months are counted, or a
 * bill that only lands every other month would read twice its real cost.
 * Returns null until there are two months to average, since one month is not an
 * average. Inflows are ignored: this is what goes out to the bill.
 */
export function averageSpent(transactions, throughMonth) {
  const out = transactions.filter(
    (t) => t.amount_cents < 0 && monthOf(t.date) <= throughMonth
  )
  if (out.length === 0) return null
  const first = out.reduce((min, t) => (monthOf(t.date) < min ? monthOf(t.date) : min), '9999-99')
  const span = monthsApart(first, throughMonth) + 1
  if (span < 2) return null
  return Math.round(Math.abs(out.reduce((sum, t) => sum + t.amount_cents, 0)) / span)
}

/**
 * @param {object} data
 * @param {Array<{id:number, group_id:number, name:string, emoji:string|null}>} data.categories
 * @param {Array<{month:string, category_id:number, assigned_cents:number}>} data.allocations
 * @param {Array<{date:string, category_id:number|null, amount_cents:number}>} data.transactions
 * @param {string} month 'YYYY-MM' being viewed
 */
export function envelopeSummary({ categories, allocations, transactions }, month) {
  const perCategory = categories.map((c) => {
    const mine = allocations.filter((a) => a.category_id === c.id)
    const spend = transactions.filter((t) => t.category_id === c.id)

    const assigned = mine
      .filter((a) => a.month === month)
      .reduce((sum, a) => sum + a.assigned_cents, 0)
    const thisMonth = spend.filter((t) => monthOf(t.date) === month)
    const activity = thisMonth.reduce((sum, t) => sum + t.amount_cents, 0)

    // Money can land in an envelope two ways: assigned from Ready to Assign, or
    // paid straight in (a roommate sending their share of the mortgage). A target
    // asks how much needs to LAND here, so both count toward it.
    const inflow = thisMonth.filter((t) => t.amount_cents > 0).reduce((sum, t) => sum + t.amount_cents, 0)

    // Available rolls every prior month forward, negatives included.
    // ponytail: YNAB instead zeroes cash overspending and docks the next month's
    // Ready to Assign. Carry-forward is simpler and never loses a dollar.
    const assignedToDate = mine
      .filter((a) => a.month <= month)
      .reduce((sum, a) => sum + a.assigned_cents, 0)
    const activityToDate = spend
      .filter((t) => monthOf(t.date) <= month)
      .reduce((sum, t) => sum + t.amount_cents, 0)

    const available = assignedToDate + activityToDate
    const target = c.target_cents ?? 0
    const need = monthlyNeed(target, c.target_period)

    // A balance target measures the envelope, not the month: spend from the
    // bucket and it immediately asks to be topped back up. An instalment target
    // measures what landed this month and is satisfied once it has.
    const stillNeeded =
      target === 0
        ? 0
        : c.target_period === 'balance'
          ? Math.max(0, target - available)
          : Math.max(0, need - (assigned + inflow))

    return {
      ...c,
      assigned_cents: assigned,
      activity_cents: activity,
      inflow_cents: inflow,
      funded_cents: assigned + inflow,
      monthly_need_cents: need,
      needed_cents: stillNeeded,
      average_spent_cents: averageSpent(spend, month),
      available_cents: available,
    }
  })

  // Uncategorized money is money that has not been given a job yet: paychecks and
  // starting balances add to it, uncategorized spending takes from it.
  //
  // Credit accounts are excluded. Ready to Assign means spendable cash, and a card
  // balance is debt, not cash. Without this, entering a card's real balance would
  // read as losing that much money today and wreck the budget. Card purchases still
  // hit their envelopes normally, because those carry a category.
  //
  // ponytail: counts all time, not just through the viewed month. Revisit if
  // budgeting several months ahead ever makes the number confusing.
  const unassignedInflow = transactions
    .filter((t) => t.category_id === null && t.account_type !== 'credit')
    .reduce((sum, t) => sum + t.amount_cents, 0)
  const everAssigned = allocations.reduce((sum, a) => sum + a.assigned_cents, 0)

  return { categories: perCategory, ready_to_assign_cents: unassignedInflow - everAssigned }
}
