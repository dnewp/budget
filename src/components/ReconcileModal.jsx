import { useEffect, useState } from 'react'
import { api, formatCents } from '../api.js'
import { parseAmount } from './Money.jsx'
import { Button, Modal, inputClass } from './ui.jsx'

export default function ReconcileModal({ month, monthLabel, onClose, onChanged }) {
  const [accounts, setAccounts] = useState(null)

  const load = () => api(`/reconcile/${month}`).then(setAccounts)
  useEffect(() => {
    load()
  }, [month])

  return (
    <Modal title={`Reconcile ${monthLabel}`} onClose={onClose}>
      <p className="text-sm text-ink-soft mb-4">
        Mark transactions cleared in the register as the bank finishes them, then put the balance
        from your bank's website here. Cards are not reconciled, only the money you actually spend
        from.
      </p>
      {!accounts ? null : accounts.length === 0 ? (
        <p className="text-ink-soft">No spending accounts to reconcile.</p>
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => (
            <AccountRow
              key={a.account_id}
              account={a}
              month={month}
              monthLabel={monthLabel}
              onDone={async () => {
                await load()
                onChanged()
              }}
            />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function AccountRow({ account, month, monthLabel, onDone }) {
  const [value, setValue] = useState(
    account.actual_balance_cents !== null ? String(account.actual_balance_cents / 100) : ''
  )
  const [mismatch, setMismatch] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(force) {
    const actual = parseAmount(value)
    if (actual === null) return setError('Enter the balance as a number, like 1250.00')
    setBusy(true)
    setError('')
    try {
      await api(`/reconcile/${month}/${account.account_id}`, {
        method: 'POST',
        body: { actual_balance_cents: actual, force },
      })
      setMismatch(null)
      await onDone()
    } catch (err) {
      if (/do not match/i.test(err.message)) setMismatch(actual - account.cleared_balance_cents)
      else setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    setBusy(true)
    try {
      await api(`/reconcile/${month}/${account.account_id}`, { method: 'DELETE' })
      setMismatch(null)
      await onDone()
    } finally {
      setBusy(false)
    }
  }

  const done = Boolean(account.reconciled_at)

  return (
    <li className="rounded-lg border border-mist bg-white p-3">
      <div className="font-medium">{account.name}</div>

      <dl className="mt-2 text-sm space-y-1">
        <Line label={`Money in during ${monthLabel}`} cents={account.money_in_cents} />
        <Line label={`Money out during ${monthLabel}`} cents={account.money_out_cents} />
        <Line label="Cleared balance" cents={account.cleared_balance_cents} strong />
        {account.uncleared_count > 0 && (
          <div className="flex justify-between text-ink-soft">
            <dt>
              {account.uncleared_count} not cleared yet, worth{' '}
              {formatCents(account.working_balance_cents - account.cleared_balance_cents)}
            </dt>
            <dd />
          </div>
        )}
      </dl>

      {done ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-sm text-spruce">
            Reconciled
            {account.adjustment_cents !== 0 &&
              ` with a ${formatCents(account.adjustment_cents)} adjustment`}
          </p>
          <button onClick={undo} disabled={busy} className="text-sm text-ink-soft underline">
            Undo
          </button>
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <div className="flex-1 min-w-0">
            <input
              inputMode="decimal"
              placeholder="Balance at the bank"
              aria-label={`Bank balance for ${account.name}`}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setMismatch(null)
              }}
              className={`${inputClass} font-money`}
            />
          </div>
          <Button onClick={() => submit(false)} disabled={busy || !value} className="shrink-0">
            Reconcile
          </Button>
        </div>
      )}

      {mismatch !== null && (
        <div className="mt-2 rounded-lg bg-brick-soft p-2.5">
          <p className="text-sm text-brick">
            Off by <span className="font-money">{formatCents(Math.abs(mismatch))}</span>.{' '}
            {mismatch > 0
              ? 'The bank has more than you recorded, so an income is missing or something is marked cleared too early.'
              : 'The bank has less than you recorded, so a purchase is missing.'}
          </p>
          <button
            onClick={() => submit(true)}
            disabled={busy}
            className="mt-1.5 text-sm text-brick underline"
          >
            Reconcile anyway and add a {formatCents(mismatch)} adjustment
          </button>
        </div>
      )}

      {error && <p className="text-brick text-sm mt-2">{error}</p>}
    </li>
  )
}

function Line({ label, cents, strong = false }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'text-ink font-medium' : 'text-ink-soft'}`}>
      <dt className="truncate">{label}</dt>
      <dd className="font-money shrink-0">{formatCents(cents)}</dd>
    </div>
  )
}
