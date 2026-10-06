import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCookieHeader } from '@supabase/ssr'
import { readSupabaseConfig, SupabaseConfigurationError } from '../shared/supabase-config.js'
import { HttpError, withAuthenticatedUser } from '../worker/lib/supabase/action.js'
import worker from '../worker/index.js'

// All credentials, users, and sessions below are synthetic. Every Auth request
// is intercepted; these tests never require a Supabase project or network.
const env = {
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
}
const cookieName = 'sb-test-project-auth-token'

function sessionFor(id = 'user-one', { expired = false } = {}) {
  const expiresAt = Math.floor(Date.now() / 1000) + (expired ? -60 : 3600)
  const payload = Buffer.from(JSON.stringify({ sub: id, exp: expiresAt })).toString('base64url')
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`,
    refresh_token: `refresh-${id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id, email: 'untrusted-cookie@example.test', aud: 'authenticated' },
  }
}

function requestWithSession(session, path = '/api/session') {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  return new Request(`https://app.example.test${path}`, {
    headers: { Cookie: `${cookieName}=${value}` },
  })
}

function preventNetwork(t, implementation = () => {
  assert.fail('Unexpected network request')
}) {
  return t.mock.method(globalThis, 'fetch', implementation)
}

function refreshedSessionFrom(response) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${cookieName}=`))
  assert.ok(cookie, 'The refreshed session must reach the browser')
  const [{ value }] = parseCookieHeader(cookie.split(';')[0])
  return JSON.parse(Buffer.from(value.slice('base64-'.length), 'base64url').toString())
}

test('configuration accepts public keys and rejects missing/private credentials', () => {
  assert.deepEqual(readSupabaseConfig(` ${env.SUPABASE_URL}/ `, ` ${env.SUPABASE_PUBLISHABLE_KEY} `), {
    url: env.SUPABASE_URL,
    key: env.SUPABASE_PUBLISHABLE_KEY,
  })
  const jwtForRole = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
  assert.equal(readSupabaseConfig(env.SUPABASE_URL, jwtForRole('anon')).key, jwtForRole('anon'))
  assert.equal(readSupabaseConfig('http://localhost:54321', env.SUPABASE_PUBLISHABLE_KEY).url, 'http://localhost:54321')

  for (const [url, key] of [
    [undefined, undefined],
    [env.SUPABASE_URL, ''],
    [env.SUPABASE_URL, 'sb_secret_do_not_expose'],
    [env.SUPABASE_URL, jwtForRole('service_role')],
    ['https://your-project.supabase.co', env.SUPABASE_PUBLISHABLE_KEY],
    ['http://remote.example.test', env.SUPABASE_PUBLISHABLE_KEY],
    ['https://test-project.supabase.co/rest/v1', env.SUPABASE_PUBLISHABLE_KEY],
    ['https://user:password@test-project.supabase.co', env.SUPABASE_PUBLISHABLE_KEY],
  ]) {
    assert.throws(() => readSupabaseConfig(url, key), SupabaseConfigurationError)
  }
})

test('session endpoint returns 401 without cookies and does not contact Auth', async (t) => {
  const fetch = preventNetwork(t)
  const response = await worker.fetch(new Request('https://app.example.test/api/session'), env)
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.error.code, 'UNAUTHENTICATED')
  assert.equal(body.error.requestId, response.headers.get('X-Request-Id'))
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(fetch.mock.callCount(), 0)
})

test('Worker rejects unsupported API methods and routes, and serves frontend assets', async (t) => {
  preventNetwork(t)
  const response = await worker.fetch(new Request('https://app.example.test/api/session', { method: 'POST' }), env)
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('Allow'), 'GET')
  assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED')

  for (const path of ['/api', '/api/missing']) {
    const missing = await worker.fetch(new Request(`https://app.example.test${path}`), env)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'NOT_FOUND')
  }

  const request = new Request('https://app.example.test/')
  const assets = t.mock.fn(async (received) => {
    assert.equal(received, request)
    return new Response('frontend')
  })
  const frontend = await worker.fetch(request, { ...env, ASSETS: { fetch: assets } })
  assert.equal(await frontend.text(), 'frontend')
  assert.equal(assets.mock.callCount(), 1)
})

test('missing server configuration returns an actionable error without leaking configuration', async (t) => {
  preventNetwork(t)
  const log = t.mock.method(console, 'error', () => {})
  const response = await worker.fetch(new Request('https://app.example.test/api/session'), {})
  const body = await response.json()
  assert.equal(response.status, 503)
  assert.equal(body.error.code, 'SUPABASE_NOT_CONFIGURED')
  assert.equal(JSON.parse(log.mock.calls[0].arguments[0]).requestId, body.error.requestId)
})

test('session endpoint uses the Auth-verified user instead of trusting cookie user data', async (t) => {
  const session = sessionFor()
  const fetch = preventNetwork(t, async (input, init) => {
    assert.equal(String(input), `${env.SUPABASE_URL}/auth/v1/user`)
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${session.access_token}`)
    return Response.json({ id: 'verified-user', email: 'verified@example.test', aud: 'authenticated' })
  })
  const response = await worker.fetch(requestWithSession(session), env)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { user: { id: 'verified-user', email: 'verified@example.test' } })
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
})

test('invalid sessions and Auth outages produce distinct safe errors', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  let providerStatus = 401
  preventNetwork(t, async () => Response.json({ message: 'private-provider-detail' }, { status: providerStatus }))

  for (const [status, expectedStatus, expectedCode] of [
    [401, 401, 'UNAUTHENTICATED'],
    [502, 503, 'AUTH_UNAVAILABLE'],
  ]) {
    providerStatus = status
    const response = await worker.fetch(requestWithSession(sessionFor()), env)
    const body = await response.json()
    assert.equal(response.status, expectedStatus)
    assert.equal(body.error.code, expectedCode)
    assert.equal(JSON.stringify(body).includes('private-provider-detail'), false)
  }
  assert.equal(log.mock.callCount(), 1)
  assert.equal(JSON.stringify(log.mock.calls).includes('private-provider-detail'), false)
})

test('refresh cookies and cache headers survive a handler error', async (t) => {
  const fresh = sessionFor('refreshed-user')
  const fetch = preventNetwork(t, async (input) => {
    const url = new URL(input)
    if (url.pathname === '/auth/v1/token') return Response.json(fresh)
    assert.equal(url.pathname, '/auth/v1/user')
    return Response.json({ id: fresh.user.id, email: 'verified@example.test' })
  })
  const action = withAuthenticatedUser(async ({ user }) => {
    assert.equal(user.id, 'refreshed-user')
    throw new HttpError(409, 'TEST_CONFLICT', 'Synthetic conflict')
  })
  const response = await action(requestWithSession(sessionFor('expired-user', { expired: true })), env)

  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'TEST_CONFLICT')
  assert.equal(refreshedSessionFrom(response).refresh_token, fresh.refresh_token)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('Pragma'), 'no-cache')
  assert.ok(response.headers.has('Expires'))
  assert.match(response.headers.getSetCookie()[0], /Secure/)
  assert.match(response.headers.getSetCookie()[0], /SameSite=Lax/)
  assert.equal(fetch.mock.callCount(), 2)
})

test('immutable redirect responses preserve refreshed cookies and response headers', async (t) => {
  const fresh = sessionFor('redirect-user')
  preventNetwork(t, async (input) => {
    const url = new URL(input)
    if (url.pathname === '/auth/v1/token') return Response.json(fresh)
    assert.equal(url.pathname, '/auth/v1/user')
    return Response.json({ id: fresh.user.id })
  })
  const location = 'https://app.example.test/'
  const action = withAuthenticatedUser(async () => Response.redirect(location, 303))
  const response = await action(requestWithSession(sessionFor('expired-user', { expired: true })), env)

  assert.equal(response.status, 303)
  assert.equal(response.headers.get('Location'), location)
  assert.equal(refreshedSessionFrom(response).refresh_token, fresh.refresh_token)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.ok(response.headers.get('X-Request-Id'))
})

test('concurrent requests keep refreshed sessions and response cookies isolated', async (t) => {
  const sessions = new Map(['alice', 'bob'].map((id) => [id, sessionFor(id)]))
  preventNetwork(t, async (input, init) => {
    const url = new URL(input)
    if (url.pathname === '/auth/v1/token') {
      const { refresh_token: refreshToken } = JSON.parse(init.body)
      const id = refreshToken.slice('refresh-'.length)
      assert.ok(sessions.has(id))
      return Response.json(sessions.get(id))
    }
    assert.equal(url.pathname, '/auth/v1/user')
    const authorization = new Headers(init.headers).get('Authorization')
    const session = [...sessions.values()].find((value) => authorization === `Bearer ${value.access_token}`)
    assert.ok(session)
    return Response.json({ id: session.user.id, email: `${session.user.id}@example.test` })
  })
  const responses = await Promise.all(['alice', 'bob'].map((id) =>
    worker.fetch(requestWithSession(sessionFor(id, { expired: true })), env),
  ))

  for (const [index, id] of ['alice', 'bob'].entries()) {
    const response = responses[index]
    assert.equal(response.status, 200)
    assert.equal((await response.json()).user.id, id)
    assert.equal(refreshedSessionFrom(response).refresh_token, `refresh-${id}`)
  }
  assert.notEqual(responses[0].headers.get('X-Request-Id'), responses[1].headers.get('X-Request-Id'))
})
