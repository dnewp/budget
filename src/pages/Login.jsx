import { useState } from 'react'
import { api } from '../api.js'

export default function Login({ onSignedIn }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/login', { method: 'POST', body: { password } })
      onSignedIn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-xs">
        <h1 className="font-display font-extrabold text-4xl text-spruce-deep mb-1">Envelope</h1>
        <p className="text-ink-soft mb-8">Your money, in envelopes.</p>
        <label className="block text-sm font-medium mb-1" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-mist bg-white px-3 py-2 outline-none focus:border-spruce focus:ring-2 focus:ring-spruce-soft"
        />
        {error && <p className="text-brick text-sm mt-2">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-spruce text-white font-semibold py-2 hover:bg-spruce-deep disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
    </div>
  )
}
