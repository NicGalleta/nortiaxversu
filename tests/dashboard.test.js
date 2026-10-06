import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../worker/index.js'

// These credentials and sessions are synthetic. The real Supabase SSR client
// runs against mocked Auth/PostgREST responses; no network or project is needed.
const env = {
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
}
const verifiedUser = { id: 'verified-user', email: 'verified@example.test', aud: 'authenticated' }
const providerDetail = 'private-provider-error-detail'

function sessionFor() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const payload = Buffer.from(JSON.stringify({ sub: 'cookie-user', exp: expiresAt })).toString('base64url')
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`,
    refresh_token: 'synthetic-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: 'cookie-user', email: 'untrusted@example.test', aud: 'authenticated' },
  }
}

function dashboardRequest(session, method = 'GET') {
  const headers = new Headers()
  if (session) {
    const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
    headers.set('Cookie', `sb-test-project-auth-token=${value}`)
  }
  return new Request('https://app.example.test/api/dashboard', { method, headers })
}

function dashboardPayload() {
  return {
    snapshot: {
      id: 'e1e0b2c9-797a-48d8-94ef-412b223969c9',
      fecha_corte: '2026-09-27',
      saldo_banco: '9007199254740993',
    },
    summary: {
      por_cobrar: '1404100000',
      vencido: '509400000',
      en_disputa: '18300000',
      facturas_pendientes: 1144,
      facturas_vencidas: 472,
      obligaciones_7_dias: '9007199254741093',
      saldo_sin_cobros_7_dias: '-100',
    },
    obligations: [{
      id_obligacion: 'OBL-0001',
      tipo: 'proveedor',
      acreedor: 'Proveedor de prueba',
      descripcion: 'Pago pendiente',
      fecha_vencimiento: '2026-09-30',
      monto: '9007199254741093',
    }],
  }
}

function mockProvider(t, options = {}) {
  const session = sessionFor()
  const calls = []
  const log = t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input)
    const headers = new Headers(init.headers)
    calls.push({ pathname: url.pathname, headers, searchParams: url.searchParams, method: init.method })
    assert.equal(url.origin, env.SUPABASE_URL)
    assert.equal(headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY)
    assert.equal(headers.get('Authorization'), `Bearer ${session.access_token}`)

    if (url.pathname === '/auth/v1/user') return Response.json(verifiedUser)
    if (url.pathname === '/rest/v1/usuarios_autorizados') {
      assert.equal(url.searchParams.get('select'), 'user_id')
      assert.equal(url.searchParams.get('user_id'), `eq.${verifiedUser.id}`)
      if (options.authorizationError) return providerError(options.authorizationError)
      return Response.json(options.authorized === false ? [] : [{ user_id: verifiedUser.id }])
    }
    assert.equal(url.pathname, '/rest/v1/rpc/nortia_dashboard_v1', 'Unexpected provider request')
    if (options.rpcError) return providerError(options.rpcError)
    return Response.json(Object.hasOwn(options, 'payload') ? options.payload : dashboardPayload())
  })
  return { session, calls, log }
}

function providerError({ code, status = 500 }) {
  return Response.json({ code, message: providerDetail, details: providerDetail, hint: providerDetail }, { status })
}

async function expectError(response, status, code) {
  const body = await response.json()
  assert.equal(response.status, status)
  assert.equal(body.error.code, code)
  assert.equal(typeof body.error.message, 'string')
  assert.equal(body.error.requestId, response.headers.get('X-Request-Id'))
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(JSON.stringify(body).includes(providerDetail), false)
}

test('dashboard returns 401 without a session and never calls the provider', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network request'))
  await expectError(await worker.fetch(dashboardRequest(), env), 401, 'UNAUTHENTICATED')
  assert.equal(fetch.mock.callCount(), 0)
})

test('authenticated users outside the allowlist receive 403 without querying financial data', async (t) => {
  const { session, calls } = mockProvider(t, { authorized: false })
  await expectError(await worker.fetch(dashboardRequest(session), env), 403, 'ACCESS_DENIED')
  assert.deepEqual(calls.map(call => call.pathname), ['/auth/v1/user', '/rest/v1/usuarios_autorizados'])
})

test('a missing authorization table returns an actionable database setup error', async (t) => {
  for (const code of ['42P01', 'PGRST205']) {
    await t.test(code, async (t) => {
      const { session, calls, log } = mockProvider(t, { authorizationError: { code, status: 404 } })
      await expectError(await worker.fetch(dashboardRequest(session), env), 503, 'DATABASE_NOT_READY')
      assert.equal(calls.length, 2)
      assert.equal(JSON.stringify(log.mock.calls).includes(providerDetail), false)
    })
  }
})

test('authorization and dashboard query failures hide raw provider details', async (t) => {
  for (const stage of ['authorizationError', 'rpcError']) {
    await t.test(stage, async (t) => {
      const { session, calls, log } = mockProvider(t, { [stage]: { code: 'XX000' } })
      await expectError(await worker.fetch(dashboardRequest(session), env), 503, 'DATA_UNAVAILABLE')
      assert.equal(calls.length, stage === 'authorizationError' ? 2 : 3)
      assert.equal(log.mock.callCount(), 1)
      assert.equal(JSON.stringify(log.mock.calls).includes(providerDetail), false)
    })
  }
})

test('a missing dashboard RPC returns an actionable database setup error', async (t) => {
  const { session } = mockProvider(t, { rpcError: { code: 'PGRST202', status: 404 } })
  await expectError(await worker.fetch(dashboardRequest(session), env), 503, 'DATABASE_NOT_READY')
})

test('the allowlist uses the verified user and the dashboard RPC keeps the caller session and public key', async (t) => {
  const payload = dashboardPayload()
  const { session, calls } = mockProvider(t, { payload })
  const response = await worker.fetch(dashboardRequest(session), env)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, payload, 'Snapshot identifiers, cutoff dates and bigint strings must remain unchanged')
  assert.equal(body.snapshot.saldo_banco, '9007199254740993')
  assert.equal(body.summary.saldo_sin_cobros_7_dias, '-100')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(calls.map(call => call.pathname), [
    '/auth/v1/user', '/rest/v1/usuarios_autorizados', '/rest/v1/rpc/nortia_dashboard_v1',
  ])
  assert.notEqual(verifiedUser.id, session.user.id, 'Fixture must distinguish verified and cookie identities')
  assert.equal(calls[1].searchParams.get('user_id'), `eq.${verifiedUser.id}`)
  assert.equal(calls[2].method, 'POST')
  assert.equal(calls[2].headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY)
  assert.equal(calls[2].headers.get('Authorization'), `Bearer ${session.access_token}`)
})

test('an authorized user with no active snapshot receives a genuine empty result', async (t) => {
  const payload = { snapshot: null, summary: null, obligations: [] }
  const { session } = mockProvider(t, { payload })
  const response = await worker.fetch(dashboardRequest(session), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), payload)
})

test('authorization revoked between the allowlist check and RPC returns 403', async (t) => {
  const { session } = mockProvider(t, { rpcError: { code: '42501', status: 403 } })
  await expectError(await worker.fetch(dashboardRequest(session), env), 403, 'ACCESS_DENIED')
})

test('invalid balances rejected by SQL return 422 without exposing provider details', async (t) => {
  const { session, calls, log } = mockProvider(t, { rpcError: { code: '22000', status: 400 } })
  await expectError(await worker.fetch(dashboardRequest(session), env), 422, 'DATA_INTEGRITY_ERROR')
  assert.equal(calls.length, 3)
  assert.equal(JSON.stringify(log.mock.calls).includes(providerDetail), false)
})

test('malformed or inconsistent RPC payloads return a safe 502', async (t) => {
  const fixtures = [
    ['null response', null],
    ['missing snapshot', { summary: null, obligations: [] }],
    ['missing summary', { snapshot: null, obligations: [] }],
    ['non-array obligations', { snapshot: null, summary: null, obligations: {} }],
    ['incomplete snapshot', { ...dashboardPayload(), snapshot: {} }],
    ['missing summary for active snapshot', { ...dashboardPayload(), summary: null }],
    ['numeric money', (() => {
      const payload = dashboardPayload()
      payload.snapshot.saldo_banco = 270000000
      return payload
    })()],
    ['invalid money string', (() => {
      const payload = dashboardPayload()
      payload.summary.por_cobrar = 'NaN'
      return payload
    })()],
    ['incomplete obligation', { ...dashboardPayload(), obligations: [{}] }],
    ['obligations without active snapshot', { ...dashboardPayload(), snapshot: null, summary: null }],
  ]
  for (const [name, payload] of fixtures) {
    await t.test(name, async (t) => {
      const { session } = mockProvider(t, { payload })
      await expectError(await worker.fetch(dashboardRequest(session), env), 502, 'INVALID_DATA')
    })
  }
})

test('dashboard POST requests receive 405 without contacting Supabase', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network request'))
  const response = await worker.fetch(dashboardRequest(sessionFor(), 'POST'), env)
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('Allow'), 'GET')
  assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED')
  assert.equal(fetch.mock.callCount(), 0)
})
