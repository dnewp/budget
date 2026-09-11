import { Router } from 'express'
import { db as defaultDb } from './db.js'
import { HttpError } from './routes.js'

// A thin seam so tests can swap in an in-memory db without every route needing
// the db threaded through as a parameter. Production never calls this.
let db = defaultDb
export function setDbForTesting(testDb) {
  db = testDb
}

export const workspaceRoutes = Router()

workspaceRoutes.get('/workspaces/current/members', (req, res) => {
  const workspace = db.prepare('SELECT id, name FROM workspaces WHERE id = ?').get(req.workspaceId)
  const members = db
    .prepare(
      `SELECT u.email, m.role FROM workspace_members m
       JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY (m.role = 'owner') DESC, u.email`
    )
    .all(req.workspaceId)
  const pendingInvites = db
    .prepare('SELECT email FROM workspace_invites WHERE workspace_id = ? ORDER BY created_at')
    .all(req.workspaceId)
    .map((r) => r.email)
  res.json({ workspace, members, pendingInvites })
})

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

workspaceRoutes.post('/workspaces/current/invites', (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email
  if (!isEmail(email)) throw new HttpError(400, 'That does not look like an email address')
  const alreadyMember = db
    .prepare(
      `SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? AND u.email = ?`
    )
    .get(req.workspaceId, email)
  if (alreadyMember) throw new HttpError(409, 'Already a member')
  db.prepare(
    `INSERT INTO workspace_invites (workspace_id, email) VALUES (?, ?)
     ON CONFLICT(workspace_id, email) DO NOTHING`
  ).run(req.workspaceId, email)
  res.json({ ok: true })
})

workspaceRoutes.delete('/workspaces/current/invites/:email', (req, res) => {
  db.prepare('DELETE FROM workspace_invites WHERE workspace_id = ? AND email = ?').run(
    req.workspaceId,
    req.params.email
  )
  res.json({ ok: true })
})
