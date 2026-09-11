import { useEffect, useState } from 'react'
import { api, formatCents } from '../api.js'
import { Money, parseAmount } from '../components/Money.jsx'
import { Button, Field, Modal, inputClass, selectClass } from '../components/ui.jsx'
import TransactionModal from '../components/TransactionModal.jsx'
import { Register, groupTransactions } from '../components/Register.jsx'

const TYPES = [
  { id: 'checking', label: 'Checking' },
  { id: 'savings', label: 'Savings' },
  { id: 'credit', label: 'Credit card' },
  { id: 'cash', label: 'Cash' },
]

const today = () => new Date().toLocaleDateString('en-CA')

export default function Accounts() {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [payees, setPayees] = useState([])
  const [selected, setSelected] = useState(null)
  const [entries, setEntries] = useState([])
  const [editing, setEditing] = useState(null)
  const [newAccount, setNewAccount] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)

  async function loadAccounts() {
    const rows = await api('/accounts')
    setAccounts(rows)
    setSelected((prev) => (rows.some((a) => a.id === prev) ? prev : (rows[0]?.id ?? null)))
  }

  function loadReference() {
    api('/categories').then(setCategories)
    api('/payees').then(setPayees)
  }

  useEffect(() => {
    loadAccounts()
    loadReference()
  }, [])

  useEffect(() => {
    if (selected) api(`/transactions?account_id=${selected}`).then((r) => setEntries(groupTransactions(r)))
    else setEntries([])
  }, [selected])

  async function refresh() {
    await loadAccounts()
    loadReference()
    if (selected) setEntries(groupTransactions(await api(`/transactions?account_id=${selected}`)))
  }

  async function toggleCleared(entry, cleared) {
    await api(`/transactions/${entry.id}/cleared`, { method: 'PATCH', body: { cleared } })
    await refresh()
  }

  const account = accounts.find((a) => a.id === selected)

  return (
    <div className="lg:flex lg:h-full">
      <div className="lg:w-72 lg:shrink-0 lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-mist p-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display font-bold text-2xl">Accounts</h1>
          <Button variant="quiet" onClick={() => setNewAccount(true)}>
            Add
          </Button>
        </div>
        <ul className="space-y-1">
          {accounts.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => setSelected(a.id)}
                className={`w-full text-left rounded-lg px-3 py-2 flex justify-between items-baseline gap-2 ${
                  a.id === selected ? 'bg-spruce-soft' : 'hover:bg-mist/50'
                }`}
              >
                <span className="font-medium truncate">{a.name}</span>
                <Money cents={a.balance_cents} className="text-sm" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex-1 lg:overflow-y-auto p-4">
        {account ? (
          <>
            <div className="flex items-baseline justify-between mb-4 gap-3">
              <div>
                <h2 className="font-display font-bold text-xl">{account.name}</h2>
                <Money cents={account.balance_cents} className="text-2xl" />
                <span className="block text-sm text-ink-soft">
                  <span className="font-money">{formatCents(account.cleared_balance_cents)}</span>{' '}
                  cleared
                </span>
                <button
                  onClick={() => setEditingAccount(account)}
                  className="block text-sm text-spruce underline mt-0.5"
                >
                  Edit account
                </button>
              </div>
              <Button onClick={() => setEditing({ account_id: account.id, date: today() })}>
                Add transaction
              </Button>
            </div>
            <Register entries={entries} onEdit={setEditing} onToggleCleared={toggleCleared} />
          </>
        ) : (
          <p className="text-ink-soft">Pick an account to see its transactions.</p>
        )}
      </div>

      {newAccount && (
        <NewAccountModal
          onClose={() => setNewAccount(false)}
          onSaved={async (id) => {
            setNewAccount(false)
            await loadAccounts()
            setSelected(id)
          }}
        />
      )}
      {editingAccount && (
        <EditAccountModal
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onSaved={async () => {
            setEditingAccount(null)
            await refresh()
          }}
        />
      )}
      {editing && (
        <TransactionModal
          initial={editing}
          accounts={accounts}
          categories={categories}
          payees={payees}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </div>
  )
}


function EditAccountModal({ account, onClose, onSaved }) {
  const [name, setName] = useState(account.name)
  const [type, setType] = useState(account.type)
  const [balance, setBalance] = useState(String(account.balance_cents / 100))
  const [error, setError] = useState('')

  const target = parseAmount(balance)
  const difference = target === null ? 0 : target - account.balance_cents

  async function save(e) {
    e.preventDefault()
    if (target === null) return setError('Enter the balance as a number, like 1250.00')
    try {
      await api(`/accounts/${account.id}`, {
        method: 'PATCH',
        body: { name, type, balance_cents: target },
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal title="Edit account" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Balance">
          <input
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className={`${inputClass} font-money`}
          />
        </Field>

        <p className="text-xs text-ink-soft -mt-2">
          {difference === 0
            ? 'Balances follow your transactions. Change this and the difference is recorded as an adjustment you can see in the register.'
            : `Records a ${formatCents(difference)} adjustment dated today, so the register still adds up.`}
        </p>

        {error && <p className="text-brick text-sm">{error}</p>}
        <Button type="submit" disabled={!name.trim()} className="w-full">
          Save changes
        </Button>
      </form>
    </Modal>
  )
}

function NewAccountModal({ onClose, onSaved }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('checking')
  const [balance, setBalance] = useState('')
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    const cents = balance ? parseAmount(balance) : 0
    if (cents === null) return setError('Enter the balance as a number, like 1250.00')
    try {
      const { id } = await api('/accounts', {
        method: 'POST',
        body: { name, type, starting_balance_cents: cents },
      })
      onSaved(id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal title="Add account" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Balance today">
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && <p className="text-brick text-sm">{error}</p>}
        <Button type="submit" disabled={!name.trim()} className="w-full">
          Add account
        </Button>
      </form>
    </Modal>
  )
}
