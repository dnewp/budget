import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto'

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const candidate = scryptSync(password, salt, 64)
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'))
}

// Stateless session: the cookie value is an HMAC of a fixed string under the
// session secret. Logging out everywhere = rotate SESSION_SECRET in .env.
export function sessionToken(secret) {
  return createHmac('sha256', secret).update('budget-session-v1').digest('hex')
}

const COOKIE = 'budget_session'

/**
 * Is this request actually running over HTTPS?
 *
 * A tunnel or reverse proxy terminates TLS and forwards plain HTTP to us, so the
 * socket looks insecure even though the browser is on HTTPS. The forwarded header
 * is what tells us the truth. Trusting it is safe here because nothing reaches
 * this server except through that proxy or from the same machine.
 */
export const isHttps = (req) =>
  Boolean(req.secure) || req.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https'

/**
 * Secure is added only when the connection really is HTTPS. Setting it always
 * would mean the browser refuses to send the cookie back over plain HTTP, which
 * silently breaks signing in on localhost.
 */
export function sessionCookie(value, maxAgeSeconds, req) {
  const parts = [`${COOKIE}=${value}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSeconds}`]
  if (isHttps(req)) parts.push('Secure')
  return parts.join('; ')
}

export function requireAuth(secret) {
  return (req, res, next) => {
    const cookie = req.headers.cookie || ''
    const match = cookie.match(/(?:^|;\s*)budget_session=([0-9a-f]+)/)
    if (match && match[1] === sessionToken(secret)) return next()
    res.status(401).json({ error: 'Not signed in' })
  }
}
