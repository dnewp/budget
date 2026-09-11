import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { Register, groupTransactions } from '../components/Register.jsx'
import TransactionModal from '../components/TransactionModal.jsx'
import { Button, QuickAdd, inputClass } from '../components/ui.jsx'

const today = () => new Date().toLocaleDateString('en-CA')

export default function Transactions() {
  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [payees, setPayees] = useState([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  function load() {
    api('/transactions').then(setRows)
    api('/accounts').then(setAccounts)
    api('/categories').then(setCategories)
    api('/payees').then(setPayees)
  }

  useEffect(() => {
    load()
  }, [])

  // Search the whole entry, so a split is found by any envelope inside it.
  const entries = useMemo(() => {
    const all = groupTransactions(rows)
    const term = search.trim().toLowerCase()
    if (!term) return all
    return all.filter((entry) =>
      [
        entry.payee,
        entry.memo,
        entry.account_name,
        entry.date,
        ...entry.lines.map((l) => l.category_name ?? ''),
        (Math.abs(entry.amount_cents) / 100).toFixed(2),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    )
  }, [rows, search])

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h1 className="font-display font-bold text-2xl">Transactions</h1>
        <Button
          onClick={() => setEditing({ account_id: accounts[0]?.id, date: today() })}
          disabled={accounts.length === 0}
          className="hidden md:block"
        >
          Add transaction
        </Button>
      </header>
      <QuickAdd onClick={() => setEditing({ account_id: accounts[0]?.id, date: today() })} />

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search payee, envelope, memo or amount"
        className={`${inputClass} mb-4`}
      />

      <p className="text-sm text-ink-soft mb-2">
        {entries.length} {entries.length === 1 ? 'transaction' : 'transactions'}
        {search && ' matching'}
      </p>

      <Register
        entries={entries}
        onEdit={setEditing}
        onToggleCleared={async (entry, cleared) => {
          await api(`/transactions/${entry.id}/cleared`, { method: 'PATCH', body: { cleared } })
          load()
        }}
        showAccount
        empty={search ? 'Nothing matches that search.' : 'No transactions yet. Add your first one.'}
      />

      {editing && (
        <TransactionModal
          initial={editing}
          accounts={accounts}
          categories={categories}
          payees={payees}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}
