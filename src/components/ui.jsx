export function Button({ variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-spruce text-white hover:bg-spruce-deep',
    quiet: 'bg-white text-ink border border-mist hover:border-ink-soft',
    danger: 'bg-white text-brick border border-brick/30 hover:bg-brick-soft',
  }
  return (
    <button
      className={`rounded-lg px-3 py-2 font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spruce ${styles[variant]} ${className}`}
      {...props}
    />
  )
}

// Adding a transaction is the thing you do standing in a shop, one-handed. On a
// phone that means the bottom right corner, not a header button you cannot reach.
// Hidden on desktop, where the header button is fine.
export function QuickAdd({ onClick, label = 'Add transaction' }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="md:hidden fixed right-4 z-40 w-14 h-14 rounded-full bg-spruce text-white text-3xl leading-none shadow-lg flex items-center justify-center active:bg-spruce-deep"
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
    >
      +
    </button>
  )
}

export function Field({ label, className = '', children }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-semibold uppercase tracking-wide text-ink-soft mb-1">
        {label}
      </span>
      {children}
    </label>
  )
}

// min-height keeps every field the same shape whatever control is inside it, and
// doubles as a comfortable tap target. Never append another width or height class
// to this: Tailwind will not resolve the conflict and the wrong one wins.
export const inputClass =
  'w-full min-h-[2.75rem] rounded-lg border border-mist bg-white px-3 py-2 outline-none focus:border-spruce focus:ring-2 focus:ring-spruce-soft'

// Selects need the arrow drawn back on, since appearance:none removes it.
export const selectClass = `${inputClass} select-field`

export function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/30 flex items-end md:items-center justify-center p-0 md:p-6"
      onClick={onClose}
    >
      <div
        className="bg-paper w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-5 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-xl">{title}</h2>
          <button
            onClick={onClose}
            className="text-ink-soft hover:text-ink -mr-2 px-3 py-2.5"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
