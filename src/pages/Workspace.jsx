import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function Workspace() {
  const [data, setData] = useState(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  function load() {
    api('/workspaces/current/members').then(setData).catch((e) => setError(e.message))
  }
  useEffect(load, [])

  async function invite(e) {
    e.preventDefault()
    setError('')
    try {
      await api('/workspaces/current/invites', { method: 'POST', body: { email } })
      setEmail('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function revoke(inviteEmail) {
    await api(`/workspaces/current/invites/${encodeURIComponent(inviteEmail)}`, { method: 'DELETE' })
    load()
  }

  if (!data) return null

  return (
    <div className="p-6 max-w-lg">
      <h1 className="font-display font-extrabold text-2xl text-spruce-deep mb-1">{data.workspace.name}</h1>
      <p className="text-ink-soft mb-6">Who can see and edit this budget.</p>

      <h2 className="font-semibold mb-2">Members</h2>
      <ul className="mb-6 space-y-1">
        {data.members.map((m) => (
          <li key={m.email} className="text-sm">
            {m.email} <span className="text-ink-soft">- {m.role}</span>
          </li>
        ))}
      </ul>

      {data.pendingInvites.length > 0 && (
        <>
          <h2 className="font-semibold mb-2">Pending invites</h2>
          <ul className="mb-6 space-y-1">
            {data.pendingInvites.map((inviteEmail) => (
              <li key={inviteEmail} className="text-sm flex items-center gap-2">
                {inviteEmail}
                <button onClick={() => revoke(inviteEmail)} className="text-brick text-xs">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <form onSubmit={invite} className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="someone@gmail.com"
          className="flex-1 rounded-lg border border-mist px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-spruce text-white px-4 py-2 text-sm font-semibold">
          Invite
        </button>
      </form>
      {error && <p className="text-brick text-sm mt-2">{error}</p>}
    </div>
  )
}
