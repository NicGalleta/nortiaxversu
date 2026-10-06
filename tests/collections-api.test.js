import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../worker/index.js'
import { collectionsSource, customerDetail } from './fixtures/collections-data.js'

const env = { SUPABASE_URL: 'https://forecast-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only' }
function provider(t, { authorized = true, payload = collectionsSource(), error, detail = false, query } = {}) {
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
    assert.equal(path, detail ? '/rest/v1/rpc/nortia_cliente_v1' : '/rest/v1/rpc/nortia_cobranza_v1')
    if (detail) assert.deepEqual(JSON.parse(init.body), { p_importacion: customerDetail().snapshot.id, p_cliente: 'C1' })
    if (error) return Response.json({ code: error, message: 'private-provider-detail' }, { status: 400 })
    return Response.json(payload)
  })
  return { calls, request: new Request(`https://app.test/api/collections${detail ? '/customer?' + (query ?? new URLSearchParams({ customer: 'C1', snapshot: customerDetail().snapshot.id })) : ''}`, { headers: { Cookie: cookie } }) }
}

test('collections endpoints require authentication and are read-only', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No provider calls expected'))
  for (const path of ['/api/collections', '/api/collections/customer']) {
    assert.equal((await worker.fetch(new Request(`https://app.test${path}`), env)).status, 401)
    const response = await worker.fetch(new Request(`https://app.test${path}`, { method: 'POST' }), env)
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('Allow'), 'GET')
  }
})
test('collections checks membership before either financial query', async t => {
  for (const detail of [false, true]) await t.test(String(detail), async t => {
    const { request, calls } = provider(t, { authorized: false, detail })
    assert.equal((await worker.fetch(request, env)).status, 403)
    assert.equal(calls.length, 2)
  })
})
test('list exposes aggregated priorities using user-scoped credentials', async t => {
  const { request } = provider(t)
  const response = await worker.fetch(request, env)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  const body = await response.json()
  assert.equal(body.customers[0].collectibleOverdue, '200')
  assert.equal(body.invoices, undefined)
})
test('detail passes both identity and reviewed snapshot, and retains exact amounts', async t => {
  const payload = customerDetail(), { request } = provider(t, { detail: true, payload })
  const response = await worker.fetch(request, env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), payload)
})
test('stale snapshots, absent customers and missing migration get distinct safe errors', async t => {
  for (const [error, status, code] of [['40001',409,'SNAPSHOT_CHANGED'],['P0002',404,'CUSTOMER_NOT_FOUND'],['PGRST202',503,'DATABASE_NOT_READY'],['42501',403,'ACCESS_DENIED'],['22000',422,'DATA_INTEGRITY_ERROR']]) await t.test(error, async t => {
    const { request } = provider(t, { detail: true, error })
    const response = await worker.fetch(request, env), body = await response.json()
    assert.equal(response.status, status); assert.equal(body.error.code, code)
    assert.ok(!JSON.stringify(body).includes('private-provider-detail'))
  })
})
test('malformed detail selection never reaches the customer RPC', async t => {
  for (const query of ['customer=C1', 'snapshot=bad&customer=C1', `snapshot=${customerDetail().snapshot.id}&customer=C1&customer=C2`]) await t.test(query, async t => {
    const { request, calls } = provider(t, { detail: true, query })
    assert.equal((await worker.fetch(request, env)).status, 400)
    assert.equal(calls.length, 2)
  })
})
test('incorrect customer or snapshot identities and broken reconciliation fail closed', async t => {
  for (const mutate of [d => { d.customer.id_cliente = 'OTHER' }, d => { d.snapshot.id = 'OTHER' }, d => { d.invoices[0].paid = '1' }]) await t.test('invalid detail', async t => {
    const payload = customerDetail(); mutate(payload)
    const { request } = provider(t, { detail: true, payload })
    assert.equal((await worker.fetch(request, env)).status, 502)
  })
})
