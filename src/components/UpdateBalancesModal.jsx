import { useEffect, useState } from 'react'
import { api, formatCents } from '../api.js'
import { parseAmount } from './Money.jsx'
import { Button, Modal, inputClass } from './ui.jsx'

// The monthly card ritual: copy each statement balance in, all in one pass.
// Card spending is not tracked transaction by transaction, so the statement
// balance is the source of truth and the difference is recorded as an adjustment.
export default function UpdateBalancesModal({ onClose, onSaved }) {
  const [cards, setCards] = useState(null)
  const [values, setValues] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/accounts').then((all) => {
      const credit = all.filter((a) => a.type === 'credit' && !a.closed)
      setCards(credit)
      setValues(Object.fromEntries(credit.map((a) => [a.id, ''])))
    })
  }, [])

  // Statements quote what you owe as a positive number, so 24703.46 means
  // owing that much. Stored as negative, the way the account actually sits.
  const owedToCents = (text) => {
    const parsed = parseAmount(text)
    return parsed === null ? null : -Math.abs(parsed)
  }

  async function save(e) {
    e.preventDefault()
    setError('')
    const changes = []
    for (const card of cards) {
      const raw = values[card.id]
      if (!raw.trim()) continue
      const cents = owedToCents(raw)
      if (cents === null) return setError(`${card.name}: enter a number, like 24703.46`)
      changes.push({ card, cents })
    }
    if (changes.length === 0) return setError('Nothing filled in yet')

    setBusy(true)
    try {
      for (const { card, cents } of changes) {
        await api(`/accounts/${card.id}`, {
          method: 'PATCH',
          body: { balance_cents: cents, memo: 'Statement balance' },
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Update card balances" onClose={onClose}>
      <p className="text-sm text-ink-soft mb-4">
        Put in what each statement says you owe. Leave a card blank to skip it. The difference is
        recorded as an adjustment, so the payoff dates update straight away.
      </p>
      {!cards ? null : (
        <form onSubmit={save} className="space-y-3">
          {cards.map((card) => {
            const entered = owedToCents(values[card.id] ?? '')
            const change = entered === null ? null : entered - card.balance_cents
            return (
              <div key={card.id}>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`bal-${card.id}`}
                    className="flex-1 min-w-0 text-sm truncate"
                  >
                    <span className="block font-medium truncate">{card.name}</span>
                    <span className="block text-xs text-ink-soft font-money">
                      now {formatCents(Math.abs(card.balance_cents))}
                    </span>
                  </label>
                  {/* Width on the wrapper: inputClass already sets w-full and a
                      second width class here would collide and win at random,
                      which is what once squeezed these labels to nothing. */}
                  <div className="w-32 shrink-0">
                    <input
                      id={`bal-${card.id}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={values[card.id] ?? ''}
                      onChange={(e) => setValues({ ...values, [card.id]: e.target.value })}
                      className={`${inputClass} text-right font-money`}
                    />
                  </div>
                </div>
                {change !== null && change !== 0 && (
                  <p
                    className={`text-xs mt-0.5 text-right ${change > 0 ? 'text-spruce' : 'text-brick'}`}
                  >
                    {change > 0
                      ? `down ${formatCents(change)}`
                      : `up ${formatCents(Math.abs(change))}`}
                  </p>
                )}
              </div>
            )
          })}
          {error && <p className="text-brick text-sm">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            Save balances
          </Button>
        </form>
      )}
    </Modal>
  )
}
