// Resolves a Cloudflare Access email into a user and their workspace(s).
//
// Trusting the Cf-Access-Authenticated-User-Email header is safe only because
// nothing reaches this server except through the tunnel (HOST=127.0.0.1), and
// the tunnel's only public hostname is gated by Access. There is no other way
// in, so a request that has the header got it from Access, not from a client
// that typed it in.

const ACCESS_EMAIL_HEADER = 'cf-access-authenticated-user-email'

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 * @returns {{ userId: number, workspaces: Array<{id: number, name: string, role: string}> }}
 */
export function resolveIdentity(db, email) {
  email = String(email).trim().toLowerCase()
  db.exec('BEGIN')
  try {
    let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    if (!user) {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (email) VALUES (?)').run(email)
      user = { id: Number(lastInsertRowid) }
    }

    // Claim any pending invites: an invite by email becomes real membership the
    // moment that email actually signs in, because only then do we have a user
    // row to attach it to.
    const invites = db.prepare('SELECT workspace_id FROM workspace_invites WHERE email = ?').all(email)
    const addMember = db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')
       ON CONFLICT(workspace_id, user_id) DO NOTHING`
    )
    for (const invite of invites) addMember.run(invite.workspace_id, user.id)
    db.prepare('DELETE FROM workspace_invites WHERE email = ?').run(email)

    // First-ever sign-in with no invite waiting: give them a workspace of their
    // own rather than leaving them with nowhere to go.
    const hasMembership = db
      .prepare('SELECT 1 FROM workspace_members WHERE user_id = ?').get(user.id)
    if (!hasMembership) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO workspaces (name) VALUES (?)')
        .run(`${email}'s Budget`)
      db.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')`
      ).run(lastInsertRowid, user.id)
    }

    const workspaces = db
      .prepare(
        `SELECT w.id, w.name, m.role FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.user_id = ? ORDER BY (m.role = 'owner') DESC, w.id`
      )
      .all(user.id)

    db.exec('COMMIT')
    return { userId: user.id, workspaces }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function identityMiddleware(db) {
  return (req, res, next) => {
    const rawEmail = req.headers[ACCESS_EMAIL_HEADER] ||
      (process.env.NODE_ENV !== 'production' ? 'dev@localhost' : null)
    if (!rawEmail) return res.status(401).json({ error: 'Not signed in' })

    const email = String(rawEmail).trim().toLowerCase()
    const identity = resolveIdentity(db, email)
    req.user = { id: identity.userId, email }

    const requested = req.query.workspace ? Number(req.query.workspace) : null
    const match = requested
      ? identity.workspaces.find((w) => w.id === requested)
      : identity.workspaces[0]
    if (!match) return res.status(403).json({ error: 'Not a member of that workspace' })

    req.workspaceId = match.id
    req.workspaces = identity.workspaces
    next()
  }
}
