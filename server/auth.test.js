// The session cookie is the only thing standing between the internet and every
// balance in here, so the flags on it are worth pinning down.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionCookie, isHttps, hashPassword, verifyPassword, sessionToken } from './auth.js'

const plain = { secure: false, headers: {} }
const tls = { secure: true, headers: {} }
const behindProxy = { secure: false, headers: { 'x-forwarded-proto': 'https' } }

test('a cookie sent over HTTPS is marked Secure', () => {
  assert.match(sessionCookie('abc', 3600, tls), /; Secure$/)
  assert.match(sessionCookie('abc', 3600, behindProxy), /; Secure$/, 'a tunnel terminates TLS for us')
})

test('a cookie over plain HTTP is not marked Secure', () => {
  // Setting it here would stop the browser sending the cookie back at all, which
  // looks like being unable to sign in on localhost.
  assert.doesNotMatch(sessionCookie('abc', 3600, plain), /Secure/)
  assert.doesNotMatch(sessionCookie('abc', 3600, { headers: { 'x-forwarded-proto': 'http' } }), /Secure/)
})

test('the cookie always carries its other defences', () => {
  for (const req of [plain, tls, behindProxy]) {
    const cookie = sessionCookie('abc', 3600, req)
    assert.match(cookie, /HttpOnly/, 'scripts must not be able to read it')
    assert.match(cookie, /SameSite=Lax/, 'blunts cross-site requests')
    assert.match(cookie, /Path=\//)
  }
})

test('logging out sends an immediately expiring cookie', () => {
  assert.match(sessionCookie('', 0, plain), /^budget_session=; /)
  assert.match(sessionCookie('', 0, plain), /Max-Age=0/)
})

test('a proxy header listing several protocols uses the first', () => {
  const chained = { secure: false, headers: { 'x-forwarded-proto': 'https, http' } }
  assert.equal(isHttps(chained), true, 'the client-facing hop is the one that matters')
})

test('a missing or odd forwarded header is treated as insecure', () => {
  assert.equal(isHttps({ headers: {} }), false)
  assert.equal(isHttps({ headers: { 'x-forwarded-proto': 'ftp' } }), false)
})

test('passwords verify against their own hash and nothing else', () => {
  const stored = hashPassword('correct horse battery staple')
  assert.equal(verifyPassword('correct horse battery staple', stored), true)
  assert.equal(verifyPassword('wrong password', stored), false)
})

test('two hashes of the same password differ, so the salt is doing its job', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'))
})

test('the session token changes when the secret is rotated', () => {
  assert.notEqual(sessionToken('old-secret'), sessionToken('new-secret'))
  assert.equal(sessionToken('steady'), sessionToken('steady'), 'and is stable otherwise')
})
