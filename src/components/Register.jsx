import { Money } from './Money.jsx'

// Split rows share a split_group and belong together as one entry in a register.
export function groupTransactions(rows) {
  const entries = []
  const byGroup = new Map()
  for (const row of rows) {
    if (!row.split_group) {
      entries.push({ ...row, lines: [row] })
      continue
    }
    let entry = byGroup.get(row.split_group)
    if (!entry) {
      entry = { ...row, lines: [] }
      byGroup.set(row.split_group, entry)
      entries.push(entry)
    }
    entry.lines.push(row)
  }
  for (const entry of entries) {
    entry.amount_cents = entry.lines.reduce((sum, l) => sum + l.amount_cents, 0)
    // A split is cleared or locked as a whole, never line by line.
    entry.cleared = entry.lines.every((l) => l.cleared)
    entry.reconciled = entry.lines.some((l) => l.reconciled)
  }
  return entries
}

const envelopeOf = (row) =>
  `${row.category_emoji ? `${row.category_emoji} ` : ''}${row.category_name || 'Ready to Assign'}`

export function Register({
  entries,
  onEdit,
  onToggleCleared,
  showAccount = false,
  empty = 'No transactions yet.',
}) {
  if (entries.length === 0) return <p className="text-ink-soft">{empty}</p>

  return (
    <ul className="divide-y divide-mist">
      {entries.map((entry) => {
        const split = entry.lines.length > 1
        return (
          <li key={entry.id} className="flex items-center gap-1">
            {onToggleCleared && (
              <ClearedToggle entry={entry} onToggle={onToggleCleared} />
            )}
            <button
              onClick={() => onEdit(entry)}
              className="flex-1 min-w-0 text-left py-3 flex items-baseline gap-3 hover:bg-mist/30 px-2 -mx-1 rounded"
            >
              <span className="font-money text-xs text-ink-soft w-16 shrink-0">
                {entry.date.slice(5)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{entry.payee || 'No payee'}</span>
                <span className="block truncate text-sm text-ink-soft">
                  {split ? `Split across ${entry.lines.length} envelopes` : envelopeOf(entry)}
                  {entry.memo && !split ? ` . ${entry.memo}` : ''}
                  {showAccount && ` . ${entry.account_name}`}
                </span>
                {split && (
                  <span className="block text-xs text-ink-soft mt-1 space-y-0.5">
                    {entry.lines.map((l) => (
                      <span key={l.id} className="flex justify-between max-w-xs">
                        <span className="truncate">{envelopeOf(l)}</span>
                        <span className="font-money">
                          {(Math.abs(l.amount_cents) / 100).toFixed(2)}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <Money cents={entry.amount_cents} tone="positive" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// Grey circle for uncleared, green C for cleared, lock once reconciled. Same
// vocabulary as YNAB, so the states read the same way.
function ClearedToggle({ entry, onToggle }) {
  if (entry.reconciled) {
    return (
      <span
        title="Reconciled and locked"
        aria-label="Reconciled and locked"
        className="w-6 h-6 shrink-0 flex items-center justify-center text-spruce text-xs"
      >
        &#128274;
      </span>
    )
  }
  return (
    <button
      onClick={() => onToggle(entry, !entry.cleared)}
      aria-label={entry.cleared ? `Mark ${entry.payee || 'transaction'} uncleared` : `Mark ${entry.payee || 'transaction'} cleared`}
      aria-pressed={entry.cleared}
      title={entry.cleared ? 'Cleared at the bank' : 'Not cleared yet'}
      className={`w-6 h-6 shrink-0 rounded-full border text-xs font-bold flex items-center justify-center ${
        entry.cleared
          ? 'bg-spruce border-spruce text-white'
          : 'border-mist text-transparent hover:border-ink-soft'
      }`}
    >
      C
    </button>
  )
}
