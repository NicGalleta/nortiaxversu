import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../worker/index.js'
import { forecastInput, invoice, profile } from './fixtures/forecast-data.js'

const env = { SUPABASE_URL: 'https://forecast-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only' }
function provider(t, { authorized = true, payload = forecastInput({ invoices: [invoice()], profiles: [profile()] }), error } = {}) {
  const expires = Math.floor(Date.now() / 1000) + 3600
  const session = { access_token: `e30.${Buffer.from(JSON.stringify({ sub: 'user', exp: expires })).toString('base64url')}.signature`, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires, user: { id: 'user' } }
  const cookie = `sb-forecast-test-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  const calls = []
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname
    calls.push(path)
    assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_PUBLISHABLE_KEY)
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${session.access_token}`)
    if (path === '/auth/v1/user') return Response.json({ id: 'user', email: 'test@example.test' })
    if (path === '/rest/v1/usuarios_autorizados') return Response.json(authorized ? [{ user_id: 'user' }] : [])
    assert.equal(path, '/rest/v1/rpc/nortia_forecast_v1')
    if (error) return Response.json({ code: error, message: 'private-provider-detail' }, { status: 400 })
    return Response.json(payload)
  })
  return { calls, request: new Request('https://app.test/api/forecast', { headers: { Cookie: cookie } }) }
}

test('forecast rejects unauthenticated requests before querying data', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network expected'))
  assert.equal((await worker.fetch(new Request('https://app.test/api/forecast'), env)).status, 401)
})
test('forecast membership is checked before querying data', async t => {
  const { request, calls } = provider(t, { authorized: false })
  assert.equal((await worker.fetch(request, env)).status, 403)
  assert.equal(calls.length, 2)
})
test('forecast needs only user-scoped credentials and returns reconciled scenarios without source customer rows', async t => {
  const { request, calls } = provider(t)
  const response = await worker.fetch(request, env)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  const body = await response.json()
  assert.equal(body.scenarios.base.weeks.length, 13)
  assert.equal(body.scenarios.base.closing, '300')
  assert.equal(body.invoices, undefined)
  assert.equal(calls.length, 3)
})
test('missing migrations, revoked permissions and invalid source data return safe errors', async t => {
  for (const [error, status, code] of [['PGRST202', 503, 'DATABASE_NOT_READY'], ['42501', 403, 'ACCESS_DENIED'], ['22000', 422, 'DATA_INTEGRITY_ERROR'], ['XX000', 503, 'DATA_UNAVAILABLE']]) {
    await t.test(error, async t => {
      const { request } = provider(t, { error })
      const response = await worker.fetch(request, env)
      assert.equal(response.status, status)
      const body = await response.json()
      assert.equal(body.error.code, code)
      assert.ok(!JSON.stringify(body).includes('private-provider-detail'))
      assert.equal(body.error.requestId, response.headers.get('X-Request-Id'))
    })
  }
})
test('forecast refuses a provider response that does not reconcile', async t => {
  const payload = forecastInput({ invoices: [invoice()] })
  payload.invoices[0].amount = '999'
  const { request } = provider(t, { payload })
  const response = await worker.fetch(request, env)
  assert.equal(response.status, 502)
  assert.equal((await response.json()).error.code, 'INVALID_DATA')
})
test('forecast endpoint is read-only', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network expected'))
  const response = await worker.fetch(new Request('https://app.test/api/forecast', { method: 'POST' }), env)
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('Allow'), 'GET')
})
