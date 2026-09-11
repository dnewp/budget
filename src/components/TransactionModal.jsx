import { useState } from 'react'
import { api } from '../api.js'
import { parseAmount } from './Money.jsx'
import { Button, Field, Modal, inputClass, selectClass } from './ui.jsx'
import PayeeInput from './PayeeInput.jsx'

const blankLine = () => ({ category_id: '', amount: '', memo: '' })

export default function TransactionModal({
  initial,
  accounts,
  categories,
  payees,
  onClose,
  onSaved,
}) {
  const isEdit = Boolean(initial.id)
  const existingLines = initial.lines ?? []
  const total = existingLines.length
    ? existingLines.reduce((sum, l) => sum + l.amount_cents, 0)
    : (initial.amount_cents ?? 0)

  const [outflow, setOutflow] = useState(total <= 0)
  const [form, setForm] = useState({
    account_id: initial.account_id,
    date: initial.date,
    payee: initial.payee ?? '',
    category_id: initial.category_id ?? '',
    memo: initial.memo ?? '',
    amount: total ? String(Math.abs(total) / 100) : '',
    cleared: Boolean(initial.cleared),
  })
  const [splits, setSplits] = useState(
    existingLines.length > 1
      ? existingLines.map((l) => ({
          category_id: l.category_id ?? '',
          amount: String(Math.abs(l.amount_cents) / 100),
          memo: l.memo ?? '',
        }))
      : null
  )
  const [error, setError] = useState('')

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  // Picking a known payee fills in the envelope it usually belongs to.
  function pickPayee(payee) {
    setForm((f) => ({
      ...f,
      payee: payee.name,
      category_id:
        payee.last_category_id && !splits ? String(payee.last_category_id) : f.category_id,
    }))
  }

  const totalCents = parseAmount(form.amount)
  const splitCents = splits
    ? splits.reduce((sum, l) => sum + (parseAmount(l.amount) ?? 0), 0)
    : 0
  const remaining = (totalCents ?? 0) - splitCents

  function updateSplit(index, key, value) {
    setSplits(splits.map((l, i) => (i === index ? { ...l, [key]: value } : l)))
  }

  async function save(e) {
    e.preventDefault()
    setError('')
    if (totalCents === null || totalCents === 0) return setError('Enter an amount, like 24.99')
    const sign = outflow ? -1 : 1

    const body = {
      account_id: Number(form.account_id),
      date: form.date,
      payee: form.payee,
      memo: form.memo,
      cleared: form.cleared,
      amount_cents: sign * Math.abs(totalCents),
      category_id: splits ? null : form.category_id || null,
    }

    if (splits) {
      if (splits.some((l) => parseAmount(l.amount) === null || parseAmount(l.amount) === 0)) {
        return setError('Every split line needs an amount')
      }
      if (remaining !== 0) {
        const off = Math.abs(remaining) / 100
        return setError(
          remaining > 0
            ? `${off.toFixed(2)} still needs an envelope`
            : `Splits are over by ${off.toFixed(2)}`
        )
      }
      body.splits = splits.map((l) => ({
        category_id: l.category_id || null,
        amount_cents: sign * Math.abs(parseAmount(l.amount)),
        memo: l.memo,
      }))
    }

    try {
      await api(isEdit ? `/transactions/${initial.id}` : '/transactions', {
        method: isEdit ? 'PUT' : 'POST',
        body,
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove() {
    await api(`/transactions/${initial.id}`, { method: 'DELETE' })
    onSaved()
  }

  return (
    <Modal title={isEdit ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOutflow(true)}
            className={`rounded-lg py-2 font-medium border ${outflow ? 'bg-brick-soft border-brick text-brick' : 'bg-white border-mist'}`}
          >
            Spent
          </button>
          <button
            type="button"
            onClick={() => setOutflow(false)}
            className={`rounded-lg py-2 font-medium border ${!outflow ? 'bg-spruce-soft border-spruce text-spruce-deep' : 'bg-white border-mist'}`}
          >
            Received
          </button>
        </div>

        <Field label="Amount">
          <input
            autoFocus
            inputMode="decimal"
            placeholder="0.00"
            value={form.amount}
            onChange={set('amount')}
            className={`${inputClass} font-money text-2xl`}
          />
        </Field>

        <Field label="Payee">
          <PayeeInput
            value={form.payee}
            payees={payees}
            onChange={(payee) => setForm((f) => ({ ...f, payee }))}
            onPick={pickPayee}
          />
        </Field>

        {splits ? (
          <SplitEditor
            splits={splits}
            categories={categories}
            remaining={remaining}
            onUpdate={updateSplit}
            onAdd={() => setSplits([...splits, blankLine()])}
            onRemoveLine={(i) => setSplits(splits.filter((_, x) => x !== i))}
            onCancel={() => setSplits(null)}
          />
        ) : (
          <Field label="Envelope">
            <select value={form.category_id} onChange={set('category_id')} className={selectClass}>
              <option value="">Ready to Assign</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji ? `${c.emoji} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSplits([blankLine(), blankLine()])}
              className="mt-2 text-sm text-spruce underline"
            >
              Split across envelopes
            </button>
          </Field>
        )}

        {/* min-w-0 on both cells: a grid item defaults to min-width auto, and an
            iOS date input reports a wide intrinsic size that otherwise overflows
            its track and shunts the account field out of alignment. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" className="min-w-0">
            <input type="date" value={form.date} onChange={set('date')} className={inputClass} />
          </Field>
          <Field label="Account" className="min-w-0">
            <select value={form.account_id} onChange={set('account_id')} className={selectClass}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Memo">
          <input value={form.memo} onChange={set('memo')} className={inputClass} />
        </Field>

        {error && <p className="text-brick text-sm">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" className="flex-1">
            {isEdit ? 'Save changes' : 'Add transaction'}
          </Button>
          {isEdit && (
            <Button type="button" variant="danger" onClick={remove}>
              Delete
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

function SplitEditor({ splits, categories, remaining, onUpdate, onAdd, onRemoveLine, onCancel }) {
  const balanced = remaining === 0
  return (
    <div className="rounded-lg border border-mist bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Split</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-ink-soft underline py-2 pl-3 -mr-1 pr-1"
        >
          Use one envelope
        </button>
      </div>

      <div className="space-y-2">
        {splits.map((line, i) => (
          // Width lives on the wrappers: inputClass already sets w-full, and
          // adding another width class here would collide and win at random.
          <div key={i} className="flex gap-2 items-center">
            <div className="flex-1 min-w-0">
              <select
                value={line.category_id}
                onChange={(e) => onUpdate(i, 'category_id', e.target.value)}
                className={selectClass}
              >
                <option value="">Ready to Assign</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji ? `${c.emoji} ` : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24 shrink-0">
              <input
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Split ${i + 1} amount`}
                value={line.amount}
                onChange={(e) => onUpdate(i, 'amount', e.target.value)}
                className={`${inputClass} text-right font-money`}
              />
            </div>
            {splits.length > 2 && (
              <button
                type="button"
                onClick={() => onRemoveLine(i)}
                aria-label={`Remove split ${i + 1}`}
                className="w-10 h-10 shrink-0 rounded-md text-xl leading-none text-ink-soft hover:text-brick hover:bg-mist/60 flex items-center justify-center"
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-2">
        <button
          type="button"
          onClick={onAdd}
          className="text-sm text-spruce underline py-2.5 pr-3 -ml-1 pl-1"
        >
          Add a line
        </button>
        <span
          className={`font-money text-sm px-2 py-1 rounded-full ${
            balanced ? 'bg-spruce-soft text-spruce-deep' : 'bg-brick-soft text-brick'
          }`}
        >
          {balanced
            ? 'Balanced'
            : `${remaining > 0 ? '' : '-'}$${(Math.abs(remaining) / 100).toFixed(2)} ${
                remaining > 0 ? 'left' : 'over'
              }`}
        </span>
      </div>
    </div>
  )
}
