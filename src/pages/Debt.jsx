import { useEffect, useState } from 'react'
import { api, formatCents } from '../api.js'
import { Button } from '../components/ui.jsx'
import UpdateBalancesModal from '../components/UpdateBalancesModal.jsx'

const YEAR = 12

function duration(months, hopeless) {
  if (months === null) return 'Never at this payment'
  if (months > hopeless) return 'Decades at this payment'
  if (months === 0) return 'Paid off'
  if (months < YEAR) return `${months} ${months === 1 ? 'month' : 'months'}`
  const years = Math.floor(months / YEAR)
  const rest = months % YEAR
  return rest === 0
    ? `${years} ${years === 1 ? 'year' : 'years'}`
    : `${years}y ${rest}m`
}

const percent = (bp) => (bp === null ? 'rate unknown' : `${(bp / 100).toFixed(2)}%`)

export default function Debt() {
  const [data, setData] = useState(null)
  const [updating, setUpdating] = useState(false)

  const load = () => api('/debt').then(setData)
  useEffect(() => {
    load()
  }, [])

  if (!data) return null

  const balancesModal = updating && (
    <UpdateBalancesModal
      onClose={() => setUpdating(false)}
      onSaved={async () => {
        setUpdating(false)
        await load()
      }}
    />
  )

  if (data.debts.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-6">
        <h1 className="font-display font-bold text-2xl mb-2">Debt</h1>
        <p className="text-ink-soft mb-4">
          Nothing to show yet. Put in what each card owes, then set its rate under Accounts and
          point it at the envelope that pays it.
        </p>
        <Button onClick={() => setUpdating(true)}>Update balances</Button>
        {balancesModal}
      </div>
    )
  }

  const worst = data.debts[0]

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h1 className="font-display font-bold text-2xl">Debt</h1>
        <Button onClick={() => setUpdating(true)}>Update balances</Button>
      </header>
      {balancesModal}

      <div className="receipt-edge rounded-t-xl bg-brick text-white px-5 pt-4 pb-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-white/70">
          What you owe
        </div>
        <div className="font-money text-4xl mt-1 tabular-nums">
          {formatCents(data.total_balance_cents)}
        </div>
        <p className="text-sm text-white/80 mt-2">
          Costing <span className="font-money">{formatCents(data.total_monthly_interest_cents)}</span>{' '}
          a month in interest.
          {data.total_interest_cents !== null && (
            <>
              {' '}
              At your current payments that is{' '}
              <span className="font-money">{formatCents(data.total_interest_cents)}</span> more
              before it is gone, and the last card clears in{' '}
              {duration(data.longest_months, data.hopeless_months).toLowerCase()}.
            </>
          )}
        </p>
      </div>

      <h2 className="font-display font-bold text-lg mt-8 mb-1">What each one costs</h2>
      <p className="text-sm text-ink-soft mb-3">
        Ordered by the interest you will actually pay, which is not the same as ordering by rate.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-ink-soft text-left">
              <th className="py-2 pr-3 font-semibold">Card</th>
              <th className="py-2 px-2 font-semibold text-right">Balance</th>
              <th className="py-2 px-2 font-semibold text-right">Payment</th>
              <th className="py-2 px-2 font-semibold text-right">Interest</th>
              <th className="py-2 px-2 font-semibold text-right">Principal</th>
              <th className="py-2 pl-2 font-semibold text-right">Gone in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-mist">
            {data.debts.map((d) => (
              <tr key={d.id}>
                <td className="py-2.5 pr-3">
                  <span className="block font-medium">{d.name}</span>
                  <span className="block text-xs text-ink-soft">{percent(d.apr_bp)}</span>
                </td>
                <td className="py-2.5 px-2 text-right font-money">{formatCents(d.balance_cents)}</td>
                <td className="py-2.5 px-2 text-right font-money">{formatCents(d.payment_cents)}</td>
                <td className="py-2.5 px-2 text-right font-money text-brick">
                  {formatCents(d.monthly_interest_cents)}
                </td>
                <td className="py-2.5 px-2 text-right font-money">
                  {formatCents(d.principal_cents)}
                </td>
                <td className="py-2.5 pl-2 text-right">
                  <span className="block">{duration(d.months, data.hopeless_months)}</span>
                  {d.interest_cents !== null && (
                    <span className="block text-xs text-brick font-money">
                      {formatCents(d.interest_cents)} interest
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display font-bold text-lg mt-8 mb-1">
        Where an extra {formatCents(10000)} goes furthest
      </h2>
      <p className="text-sm text-ink-soft mb-3">
        {worst.name} costs you the most, so it is where more money changes the outcome most.
      </p>

      <ul className="space-y-2">
        {worst.scenarios.map((s) => (
          <li
            key={s.extra_cents}
            className="flex items-baseline justify-between gap-3 rounded-lg border border-mist bg-white px-4 py-3"
          >
            <span>
              <span className="font-medium font-money">
                +{formatCents(s.extra_cents)}
              </span>
              <span className="text-ink-soft"> a month</span>
            </span>
            <span className="text-right">
              <span className="block">{duration(s.months, data.hopeless_months)}</span>
              {s.interest_saved_cents !== null && s.interest_saved_cents > 0 && (
                <span className="block text-sm text-spruce font-money">
                  saves {formatCents(s.interest_saved_cents)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-ink-soft mt-6">
        Projections assume the balance stays put and the payment does not change. Anything new you
        put on a card pushes these dates back.
      </p>
    </div>
  )
}
