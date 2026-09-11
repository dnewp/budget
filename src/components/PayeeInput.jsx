import { useMemo, useState } from 'react'
import { inputClass } from './ui.jsx'

/**
 * Payee entry with suggestions.
 *
 * Deliberately not a <datalist>: support on iOS Safari is patchy and the native
 * dropdown gives tiny tap targets, on the one device this is most used from.
 * A plain filtered list is reliable everywhere and the rows can be thumb-sized.
 */
export default function PayeeInput({ value, payees, onChange, onPick }) {
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    const term = value.trim().toLowerCase()
    if (!term) return payees.slice(0, 8)
    // Names starting with what was typed come first, the rest just contain it.
    const starts = payees.filter((p) => p.name.toLowerCase().startsWith(term))
    const contains = payees.filter(
      (p) => !p.name.toLowerCase().startsWith(term) && p.name.toLowerCase().includes(term)
    )
    return [...starts, ...contains].slice(0, 8)
  }, [value, payees])

  const exactly = payees.some((p) => p.name.toLowerCase() === value.trim().toLowerCase())

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // Blur fires before a tap registers, so let the tap land first.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={inputClass}
        placeholder="Start typing, like QuikTrip"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
      />
      {open && matches.length > 0 && !exactly && (
        <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-mist rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {matches.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                onClick={() => {
                  onPick(p)
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-3 hover:bg-spruce-soft active:bg-spruce-soft border-b border-mist last:border-0"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
