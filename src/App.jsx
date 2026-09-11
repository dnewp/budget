import { useEffect, useState } from 'react'
import { api } from './api.js'
import Login from './pages/Login.jsx'
import Budget from './pages/Budget.jsx'
import Accounts from './pages/Accounts.jsx'
import Transactions from './pages/Transactions.jsx'
import Debt from './pages/Debt.jsx'

const VIEWS = [
  { id: 'budget', label: 'Budget' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'debt', label: 'Debt' },
]

function currentView() {
  const hash = window.location.hash.replace('#', '')
  return VIEWS.some((v) => v.id === hash) ? hash : 'budget'
}

export default function App() {
  const [authed, setAuthed] = useState(null) // null = checking
  const [view, setView] = useState(currentView)

  useEffect(() => {
    api('/me').then(() => setAuthed(true)).catch(() => setAuthed(false))
    const onHash = () => setView(currentView())
    const onSignedOut = () => setAuthed(false)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('budget:signed-out', onSignedOut)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('budget:signed-out', onSignedOut)
    }
  }, [])

  if (authed === null) return null
  if (!authed) return <Login onSignedIn={() => setAuthed(true)} />

  // App shell: the page itself never scrolls, only <main> does. On iOS the
  // collapsing Safari toolbar changes the visual viewport mid-scroll, which
  // leaves a position:fixed bottom bar stranded off screen. Keeping the shell
  // exactly one viewport tall and scrolling the inside means the tab bar is
  // simply always there.
  return (
    <div className="h-dvh flex flex-col md:flex-row overflow-hidden">
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-spruce-deep text-white p-4">
        <div className="font-display font-extrabold text-2xl mb-8">Envelope</div>
        <nav className="space-y-1">
          {VIEWS.map((v) => (
            <a
              key={v.id}
              href={`#${v.id}`}
              className={`block rounded-lg px-3 py-2 font-medium ${
                view === v.id ? 'bg-spruce text-white' : 'text-white/70 hover:text-white'
              }`}
            >
              {v.label}
            </a>
          ))}
        </nav>
        <button
          onClick={() => api('/logout', { method: 'POST' }).then(() => setAuthed(false))}
          className="mt-auto text-left text-white/60 hover:text-white px-3 py-2 text-sm"
        >
          Sign out
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {view === 'budget' && <Budget />}
        {view === 'transactions' && <Transactions />}
        {view === 'accounts' && <Accounts />}
        {view === 'debt' && <Debt />}
      </main>

      {/* In the layout flow rather than fixed, and padded for the home indicator
          so the last tab is not under the gesture bar. */}
      <nav
        className="md:hidden shrink-0 bg-white border-t border-mist flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {VIEWS.map((v) => (
          <a
            key={v.id}
            href={`#${v.id}`}
            aria-current={view === v.id ? 'page' : undefined}
            className={`flex-1 text-center py-4 text-sm font-medium ${
              view === v.id ? 'text-spruce' : 'text-ink-soft'
            }`}
          >
            {v.label}
          </a>
        ))}
      </nav>
    </div>
  )
}
