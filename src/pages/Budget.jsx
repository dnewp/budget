import { useEffect, useMemo, useState } from 'react'
import { api, formatCents } from '../api.js'
import { parseAmount } from '../components/Money.jsx'
import { Button, QuickAdd, Field, Modal, inputClass, selectClass } from '../components/ui.jsx'
import TransactionModal from '../components/TransactionModal.jsx'
import ReconcileModal from '../components/ReconcileModal.jsx'

const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7)

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function Budget() {
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [newTransaction, setNewTransaction] = useState(null)
  const [reconciling, setReconciling] = useState(false)
  const [reference, setReference] = useState({ accounts: [], categories: [], payees: [] })
  const [hidden, setHidden] = useState([])
  const [showHidden, setShowHidden] = useState(false)

  const load = () => api(`/budget/${month}`).then(setData)
  const loadHidden = () => api('/categories?hidden=1').then(setHidden)

  function loadReference() {
    Promise.all([api('/accounts'), api('/categories'), api('/payees')]).then(
      ([accounts, categories, payees]) => setReference({ accounts, categories, payees })
    )
  }

  useEffect(() => {
    load()
  }, [month])

  useEffect(() => {
    loadReference()
    loadHidden()
  }, [])

  if (!data) return null

  const allCategories = data.groups.flatMap((g) => g.categories)
  const underfunded = allCategories.reduce(
    (sum, c) => sum + Math.max(0, c.monthly_need_cents - c.funded_cents),
    0
  )

  async function fillTargets() {
    await api(`/budget/${month}/fill-targets`, { method: 'POST' })
    await load()
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <MonthButton onClick={() => setMonth(shiftMonth(month, -1))} label="Previous month">
            &lsaquo;
          </MonthButton>
          <h1 className="font-display font-bold text-2xl w-48 text-center">{monthLabel(month)}</h1>
          <MonthButton onClick={() => setMonth(shiftMonth(month, 1))} label="Next month">
            &rsaquo;
          </MonthButton>
        </div>
        <div className="flex items-center gap-2">
          {month !== thisMonth() && (
            <button onClick={() => setMonth(thisMonth())} className="text-sm text-spruce underline">
              Today
            </button>
          )}
          <Button variant="quiet" onClick={() => setReconciling(true)}>
            Reconcile
          </Button>
          <Button
            onClick={() =>
              setNewTransaction({
                account_id: reference.accounts[0]?.id,
                date: new Date().toLocaleDateString('en-CA'),
              })
            }
            disabled={reference.accounts.length === 0}
            className="hidden md:block"
          >
            Add transaction
          </Button>
        </div>
      </header>
      <QuickAdd
        onClick={() =>
          setNewTransaction({
            account_id: reference.accounts[0]?.id,
            date: new Date().toLocaleDateString('en-CA'),
          })
        }
      />

      <ReadyToAssign cents={data.ready_to_assign_cents} />

      {underfunded > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-mist bg-white px-4 py-3">
          <p className="text-sm text-ink-soft">
            <span className="font-money text-ink">{formatCents(underfunded)}</span> short of what
            your targets ask for this month.
          </p>
          <Button variant="quiet" onClick={fillTargets} className="shrink-0">
            Fill targets
          </Button>
        </div>
      )}

      <div className="flex justify-between items-center mt-8 mb-2">
        <h2 className="font-display font-bold text-lg">Envelopes</h2>
        <Button variant="quiet" onClick={() => setAdding(true)}>
          New envelope
        </Button>
      </div>

      {data.groups.length === 0 ? (
        <p className="text-ink-soft">
          No envelopes yet. Make one for something you actually spend money on.
        </p>
      ) : (
        data.groups.map((group) => (
          <Group key={group.id} group={group} month={month} onChanged={load} onEdit={setEditingCategory} />
        ))
      )}

      {hidden.length > 0 && (
        <section className="mt-8 border-t border-mist pt-4">
          <button
            onClick={() => setShowHidden(!showHidden)}
            className="text-sm text-ink-soft hover:text-ink"
          >
            {showHidden ? 'Hide' : 'Show'} {hidden.length} hidden{' '}
            {hidden.length === 1 ? 'envelope' : 'envelopes'}
          </button>
          {showHidden && (
            <ul className="mt-2 space-y-1">
              {hidden.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1">
                  <span className="flex items-baseline gap-2 min-w-0">
                    {c.emoji && <span aria-hidden="true">{c.emoji}</span>}
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-ink-soft truncate">{c.group_name}</span>
                  </span>
                  <button
                    onClick={async () => {
                      await api(`/categories/${c.id}`, { method: 'PATCH', body: { hidden: false } })
                      await load()
                      loadHidden()
                      loadReference()
                    }}
                    className="text-sm text-spruce underline shrink-0"
                  >
                    Bring back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {adding && (
        <EnvelopeModal
          groups={data.groups}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await load()
          }}
        />
      )}
      {editingCategory && (
        <EnvelopeModal
          category={editingCategory}
          groups={data.groups}
          month={month}
          onClose={() => setEditingCategory(null)}
          onSaved={async () => {
            setEditingCategory(null)
            await load()
            loadHidden()
          }}
        />
      )}
      {newTransaction && (
        <TransactionModal
          initial={newTransaction}
          accounts={reference.accounts}
          categories={reference.categories}
          payees={reference.payees}
          onClose={() => setNewTransaction(null)}
          onSaved={async () => {
            setNewTransaction(null)
            loadReference()
            await load()
          }}
        />
      )}
      {reconciling && (
        <ReconcileModal
          month={month}
          monthLabel={monthLabel(month)}
          onClose={() => setReconciling(false)}
          onChanged={load}
        />
      )}
    </div>
  )
}

function Group({ group, month, onChanged, onEdit }) {
  const assigned = group.categories.reduce((sum, c) => sum + c.assigned_cents, 0)
  return (
    <section className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft mb-1 flex justify-between items-baseline">
        <span>{group.name}</span>
        <span className="flex items-baseline gap-6 pr-1">
          <span className="font-money normal-case tracking-normal">{formatCents(assigned)}</span>
          <span className="hidden sm:inline w-24 text-right">Activity</span>
          <span className="hidden sm:inline w-24 text-right">Available</span>
        </span>
      </h3>
      <ul className="divide-y divide-mist border-y border-mist">
        {group.categories.map((c) => (
          <EnvelopeRow key={c.id} category={c} month={month} onChanged={onChanged} onEdit={onEdit} />
        ))}
      </ul>
    </section>
  )
}

function MonthButton({ onClick, label, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-9 h-9 rounded-lg text-xl leading-none text-ink-soft hover:bg-mist/60"
    >
      {children}
    </button>
  )
}

// The signature element: money waiting for a job, shown as a tear-off receipt strip.
function ReadyToAssign({ cents }) {
  const over = cents < 0
  return (
    <div
      className={`receipt-edge rounded-t-xl px-5 pt-4 pb-6 ${
        over ? 'bg-brick text-white' : 'bg-spruce-deep text-white'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-widest text-white/70">
        {over ? 'Assigned more than you have' : 'Ready to assign'}
      </div>
      <div className="font-money text-4xl mt-1 tabular-nums">{formatCents(cents)}</div>
      <p className="text-sm text-white/70 mt-1">
        {over
          ? 'Take some back out of an envelope to get to zero.'
          : cents === 0
            ? 'Every dollar has a job.'
            : 'Give this a job below.'}
      </p>
    </div>
  )
}

const PERIOD_LABEL = { quarterly: 'every 3 months', yearly: 'a year' }

// Emoji worth offering for an envelope with this word in its name. First match
// wins per pattern, and anything not matched falls through to the common set.
const EMOJI_HINTS = [
  [/motorcycle|moto\b|bike|harley|ducati/i, ['🏍️', '🛵', '🪖']],
  [/car|auto|vehicle|truck/i, ['🚗', '🚙', '🔧']],
  [/mortgage|house|home|rent/i, ['🏠', '🏡', '🔑']],
  [/power|electric|energy/i, ['⚡', '💡']],
  [/water/i, ['💧', '🚿']],
  [/natural gas|heat/i, ['🔥', '🌡️']],
  [/fuel|gasoline|petrol/i, ['⛽', '🛢️']],
  [/trash|garbage|waste|recycl/i, ['🗑️', '♻️']],
  [/clean|maid/i, ['🧹', '🧽']],
  [/internet|wifi|phone|mobile/i, ['📶', '📱', '🛜']],
  [/grocer|market|food|superm/i, ['🛒', '🥦', '🍎']],
  [/lunch|sandwich|breakfast/i, ['🥪', '🍔', '🌯']],
  [/dining|restaurant|going out|dinner/i, ['🍽️', '🍕', '🍣']],
  [/coffee|cafe|caffeine/i, ['☕', '🥤']],
  [/beer|bar|alcohol|wine|brew/i, ['🍺', '🍷']],
  [/card|credit|visa|amex|mastercard/i, ['💳', '🧾']],
  [/loan|bank|debt|payment/i, ['🏦', '💵', '📉']],
  [/insurance/i, ['🛡️', '📋']],
  [/pet|dog|cat|vet/i, ['🐕', '🐈', '🦴']],
  [/gam(e|ing)|steam|xbox|playstation/i, ['🎮', '🕹️']],
  [/gift|present|birthday/i, ['🎁', '🎂']],
  [/travel|vacation|trip|flight/i, ['✈️', '🏖️', '🧳']],
  [/saving|emergency|reserve/i, ['🏦', '🐖', '🚨']],
  [/invest|stock|retire|vanguard/i, ['📈', '💹']],
  [/cloth|shoe|apparel|shop/i, ['👕', '👟', '🛍️']],
  [/gym|fit|workout|health/i, ['💪', '🏋️']],
  [/music|spotify|concert/i, ['🎵', '🎧']],
  [/tv|netflix|stream|movie/i, ['📺', '🍿']],
  [/medical|doctor|dental|pharmac/i, ['🏥', '💊']],
  [/school|tuition|educat|book/i, ['🎓', '📚']],
  [/laundry|dry clean/i, ['🧺', '👔']],
  [/repair|maintenance|tool|fix/i, ['🔨', '🪛']],
  [/subscription|software|app|ai|cloud/i, ['💻', '🤖', '☁️']],
  [/entertain|fun|event|ticket/i, ['🎟️', '🎉']],
  [/church|charity|donat|tithe/i, ['🙏', '❤️']],
  [/tax|irs/i, ['🧾', '🏛️']],
  [/garden|lawn|plant|seed/i, ['🌱', '🪴']],
  [/hair|salon|beauty|nail/i, ['💇', '💅']],
  [/kid|child|baby|daycare/i, ['🧸', '🍼']],
]

const COMMON_EMOJI = [
  '🏠', '🚗', '🏍️', '⛽', '🛒', '🍽️', '🥪', '☕', '💳', '🏦', '📶', '💡',
  '🎮', '🎁', '✈️', '🐕', '👕', '💪', '🎵', '📺', '🔨', '🧾', '💰', '❤️',
]

function suggestEmoji(name) {
  const matched = EMOJI_HINTS.filter(([pattern]) => pattern.test(name)).flatMap(([, list]) => list)
  return [...new Set([...matched, ...COMMON_EMOJI])].slice(0, 28)
}

function EnvelopeRow({ category, month, onChanged, onEdit }) {
  const [draft, setDraft] = useState(null)
  const short = category.needed_cents
  const isBucket = category.target_period === 'balance'
  const cadence = PERIOD_LABEL[category.target_period]

  async function commit() {
    const cents = parseAmount(draft === '' ? '0' : draft)
    setDraft(null)
    if (cents === null || cents === category.assigned_cents) return
    await api(`/budget/${month}/${category.id}`, {
      method: 'PUT',
      body: { assigned_cents: cents },
    })
    onChanged()
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      <button
        onClick={() => onEdit(category)}
        className="flex-1 min-w-0 text-left group"
        aria-label={`Edit ${category.name}`}
      >
        <span className="flex items-baseline gap-2">
          {category.emoji && <span aria-hidden="true">{category.emoji}</span>}
          <span className="truncate font-medium group-hover:underline">{category.name}</span>
        </span>
        {category.target_cents > 0 && (
          <span className={`block text-xs ${short > 0 ? 'text-brick' : 'text-ink-soft'}`}>
            {isBucket ? (
              short > 0 ? (
                `${formatCents(short)} to top back up to ${formatCents(category.target_cents)}`
              ) : (
                `Bucket full at ${formatCents(category.target_cents)}`
              )
            ) : (
              <>
                {short > 0
                  ? `${formatCents(short)} more to hit ${formatCents(category.monthly_need_cents)}`
                  : `Target ${formatCents(category.monthly_need_cents)} met`}
                {category.inflow_cents > 0 && `, ${formatCents(category.inflow_cents)} paid in`}
                {cadence && (
                  <span className="block text-ink-soft">
                    Saving for {formatCents(category.target_cents)} {cadence}
                  </span>
                )}
              </>
            )}
          </span>
        )}
        {category.average_spent_cents !== null && (
          <span className="block text-xs text-ink-soft">
            Averaging {formatCents(category.average_spent_cents)} a month
          </span>
        )}
      </button>

      <input
        inputMode="decimal"
        aria-label={`Assigned to ${category.name}`}
        value={draft ?? (category.assigned_cents / 100).toFixed(2)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(String(category.assigned_cents / 100))
          e.target.select()
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        className="w-24 rounded-md border border-transparent hover:border-mist focus:border-spruce focus:ring-2 focus:ring-spruce-soft bg-transparent px-2 py-1 text-right font-money tabular-nums outline-none"
      />
      <span className="hidden sm:block w-24 text-right font-money text-ink-soft tabular-nums">
        {formatCents(category.activity_cents)}
      </span>
      <span className="w-24 text-right">
        <span
          className={`inline-block rounded-full px-2.5 py-1 font-money text-sm tabular-nums ${
            category.available_cents < 0
              ? 'bg-brick-soft text-brick'
              : category.available_cents === 0
                ? 'bg-mist/60 text-ink-soft'
                : 'bg-spruce-soft text-spruce-deep'
          }`}
        >
          {formatCents(category.available_cents)}
        </span>
      </span>
    </li>
  )
}

function EnvelopeModal({ category, groups, month, onClose, onSaved }) {
  const isEdit = Boolean(category)
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.emoji ?? '')
  const [target, setTarget] = useState(
    category?.target_cents ? String(category.target_cents / 100) : ''
  )
  const [targetPeriod, setTargetPeriod] = useState(category?.target_period ?? 'monthly')
  const [groupId, setGroupId] = useState(category?.group_id ?? groups[0]?.id ?? '')
  const [newGroup, setNewGroup] = useState(groups.length === 0 ? 'Monthly Bills' : '')
  const [error, setError] = useState('')
  const [stranded, setStranded] = useState(null)
  // Suggestions follow the name as it is typed, so renaming an envelope to
  // "Motorcycle" offers a motorcycle straight away.
  const suggested = useMemo(() => suggestEmoji(name), [name])

  async function save(e) {
    e.preventDefault()
    const targetCents = target ? parseAmount(target) : 0
    if (targetCents === null) return setError('Enter the target as a number, like 250.00')
    try {
      let group = groupId
      if (!group || newGroup.trim()) {
        const created = await api('/category-groups', {
          method: 'POST',
          body: { name: newGroup.trim() || 'Envelopes' },
        })
        group = created.id
      }
      if (isEdit) {
        await api(`/categories/${category.id}`, {
          method: 'PATCH',
          body: {
            name,
            emoji: icon || null,
            target_cents: targetCents,
            target_period: targetPeriod,
            group_id: group,
          },
        })
      } else {
        await api('/categories', {
          method: 'POST',
          body: {
            group_id: group,
            name,
            emoji: icon || null,
            target_cents: targetCents,
            target_period: targetPeriod,
          },
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    }
  }

  async function hide(release) {
    setError('')
    try {
      await api(`/categories/${category.id}`, {
        method: 'PATCH',
        body: { hidden: true, month, release },
      })
      onSaved()
    } catch (err) {
      // The server refuses to strand money, and reports how much is sitting there.
      if (/still has money/i.test(err.message)) setStranded(category.available_cents)
      else setError(err.message)
    }
  }

  return (
    <Modal title={isEdit ? 'Edit envelope' : 'New envelope'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="flex gap-3">
          <Field label="Icon" className="w-20 shrink-0">
            <input
              value={icon}
              onChange={(e) =>
                setIcon([...new Intl.Segmenter().segment(e.target.value)].at(-1)?.segment ?? '')
              }
              placeholder="+"
              className={`${inputClass} text-center text-xl`}
            />
          </Field>
          <Field label="Name" className="flex-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="-mt-2">
          <div className="flex flex-wrap gap-1">
            {suggested.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setIcon(choice)}
                aria-label={`Use ${choice} as the icon`}
                aria-pressed={icon === choice}
                className={`w-8 h-8 rounded-md text-lg leading-none flex items-center justify-center ${
                  icon === choice ? 'bg-spruce-soft ring-2 ring-spruce' : 'hover:bg-mist/60'
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-soft mt-1.5">
            Pick one, or press Windows key and period in the icon box for the full set.
            {icon && (
              <button
                type="button"
                onClick={() => setIcon('')}
                className="ml-2 text-spruce underline"
              >
                Clear
              </button>
            )}
          </p>
        </div>

        <div className="flex gap-3">
          <Field
            label={targetPeriod === 'balance' ? 'Keep this much in it' : 'Amount of the bill'}
            className="flex-1"
          >
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={`${inputClass} font-money`}
            />
          </Field>
          <Field label="How often" className="w-36 shrink-0">
            <select
              value={targetPeriod}
              onChange={(e) => setTargetPeriod(e.target.value)}
              className={selectClass}
            >
              <option value="monthly">Every month</option>
              <option value="quarterly">Every 3 months</option>
              <option value="yearly">Once a year</option>
              <option value="balance">Keep a balance</option>
            </select>
          </Field>
        </div>
        {targetPeriod === 'balance' && parseAmount(target) > 0 && (
          <p className="text-xs text-ink-soft -mt-2">
            A bucket rather than a bill. Spend from it and it asks to be topped back up to{' '}
            {formatCents(parseAmount(target))}.
          </p>
        )}
        {(targetPeriod === 'quarterly' || targetPeriod === 'yearly') && parseAmount(target) > 0 && (
          <p className="text-xs text-ink-soft -mt-2">
            Sets aside{' '}
            {formatCents(Math.ceil(parseAmount(target) / (targetPeriod === 'yearly' ? 12 : 3)))} a
            month so the money is there when the bill arrives.
          </p>
        )}

        {groups.length > 0 && (
          <Field label="Group">
            <select
              value={newGroup ? 'new' : groupId}
              onChange={(e) => {
                if (e.target.value === 'new') setNewGroup('New group')
                else {
                  setNewGroup('')
                  setGroupId(Number(e.target.value))
                }
              }}
              className={selectClass}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value="new">Create a new group</option>
            </select>
          </Field>
        )}
        {(newGroup || groups.length === 0) && (
          <Field label="New group name">
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}

        {stranded !== null && (
          <div className="rounded-lg bg-brick-soft p-3">
            <p className="text-sm text-brick">
              This envelope still holds <span className="font-money">{formatCents(stranded)}</span>.
              {stranded > 0
                ? ' Hiding it now would leave that money assigned but invisible.'
                : ' It is overspent, and hiding it would bury the shortfall.'}
            </p>
            <button
              type="button"
              onClick={() => hide(true)}
              className="mt-1.5 text-sm text-brick underline"
            >
              {stranded > 0
                ? `Hide it and return ${formatCents(stranded)} to Ready to Assign`
                : `Hide it and take ${formatCents(Math.abs(stranded))} back out of Ready to Assign`}
            </button>
          </div>
        )}

        {error && <p className="text-brick text-sm">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={!name.trim()} className="flex-1">
            {isEdit ? 'Save changes' : 'Create envelope'}
          </Button>
          {isEdit && (
            <Button type="button" variant="danger" onClick={() => hide(false)}>
              Hide
            </Button>
          )}
        </div>
        {isEdit && (
          <p className="text-xs text-ink-soft">
            Hiding keeps every transaction that used this envelope. You can bring it back from the
            bottom of the budget.
          </p>
        )}
      </form>
    </Modal>
  )
}
