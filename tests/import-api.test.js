import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../worker/index.js'
import { importForm } from './fixtures/import-data.js'

const env = { SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test' }
const id = '00000000-0000-4000-8000-000000000001'
const attemptId = '00000000-0000-4000-8000-000000000002'
const userId = '00000000-0000-4000-8000-000000000003'
function request(path = '/api/importaciones', { body = importForm(), method = 'POST', origin = 'https://app.test', auth = true } = {}) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const session = { access_token: `header.${Buffer.from(JSON.stringify({ sub: userId, exp })).toString('base64url')}.signature`, refresh_token: 'refresh', token_type: 'bearer', expires_at: exp, user: { id: 'untrusted' } }
  const headers = new Headers({ Origin: origin })
  if (auth) headers.set('Cookie', `sb-test-project-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`)
  if (typeof body === 'string') headers.set('Content-Type', 'application/json')
  return new Request(`https://app.test${path}`, { method, headers, ...(method !== 'GET' ? { body } : {}) })
}
function mockProvider(t, options = {}) {
  const calls = []
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ path: url.pathname, init })
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId, email: 'test@example.test' })
    if (url.pathname === '/rest/v1/usuarios_autorizados') return Response.json(options.denied ? [] : [{ user_id: userId }])
    if (url.pathname.startsWith('/storage/')) {
      assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_SECRET_KEY)
      assert.equal(init.method, 'POST')
      return options.storageError ? Response.json({ message: 'private provider detail' }, { status: 404 }) : Response.json({ Key: 'archived', Id: id })
    }
    const args = JSON.parse(init.body)
    if (url.pathname.endsWith('/nortia_listar_cargas_v1')) {
      assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_PUBLISHABLE_KEY)
      return Response.json({ active: null, selected: null, imports: [] })
    }
    assert.equal(new Headers(init.headers).get('apikey'), env.SUPABASE_SECRET_KEY)
    if (url.pathname.endsWith('/nortia_iniciar_carga_v1')) {
      assert.equal(args.p_actor, userId)
      assert.equal(args.p_saldo, '1000')
      assert.match(args.p_huella, /^[a-f0-9]{64}$/)
      if (options.beginError) return Response.json({ code: options.beginError, message: 'private detail' }, { status: 400 })
      return Response.json({ id, intento_id: attemptId, reutilizada: Boolean(options.duplicate) })
    }
    if (url.pathname.endsWith('/nortia_preparar_carga_v1')) {
      assert.equal(args.p_actor, userId)
      assert.deepEqual(args.p_datos.aplicaciones_pago.map(row => row.monto_aplicado), ['100', '800', '2000'])
      assert.equal(args.p_archivos.length, 4)
      assert.ok(args.p_archivos.every(file => file.ruta.startsWith(`${id}/${attemptId}/`)))
      if (options.stageError) return Response.json({ code: options.stageError, message: 'private detail' }, { status: 400 })
      return Response.json({ id, reutilizada: false })
    }
    if (url.pathname.endsWith('/nortia_fallar_carga_v1')) {
      assert.equal(args.p_intento, attemptId)
      return Response.json(true)
    }
    if (url.pathname.endsWith('/nortia_activar_carga_v1')) {
      assert.equal(args.p_actor, userId)
      assert.equal(args.p_id, id)
      assert.equal(args.p_activa_esperada, null)
      if (options.activationConflict) return Response.json({ code: '40001', message: 'private detail' }, { status: 400 })
      return Response.json({ id, activa: true })
    }
    assert.fail(`Unexpected request ${url.pathname}`)
  })
  return calls
}

test('only authorized same-origin users can upload or activate', async t => {
  const calls = mockProvider(t)
  assert.equal((await worker.fetch(request('/api/importaciones', { auth: false }), env)).status, 401)
  assert.equal(calls.length, 0)
  assert.equal((await worker.fetch(request('/api/importaciones', { origin: 'https://other.test' }), env)).status, 403)
  assert.equal(calls.length, 0)
})

test('unlisted users cannot invoke privileged import operations', async t => {
  const calls = mockProvider(t, { denied: true })
  assert.equal((await worker.fetch(request(), env)).status, 403)
  assert.equal(calls.length, 2)
})

test('missing secret is actionable and never silently falls back to a public key', async t => {
  const calls = mockProvider(t)
  const response = await worker.fetch(request(), { ...env, SUPABASE_SECRET_KEY: env.SUPABASE_PUBLISHABLE_KEY })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'IMPORT_NOT_CONFIGURED')
  assert.equal(calls.length, 2)
})

test('valid upload archives four originals and stages all rows without activating', async t => {
  const calls = mockProvider(t)
  const response = await worker.fetch(request(), env)
  assert.equal(response.status, 201)
  assert.equal((await response.json()).id, id)
  assert.equal(calls.filter(call => call.path.startsWith('/storage/')).length, 4)
  assert.ok(!calls.some(call => call.path.includes('activar')))
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
})

test('duplicate upload returns the existing snapshot with no repeated archive or data writes', async t => {
  const calls = mockProvider(t, { duplicate: true })
  const response = await worker.fetch(request(), env)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).reutilizada, true)
  assert.equal(calls.length, 3)
})

test('invalid CSV returns record-level errors before any privileged writes', async t => {
  const calls = mockProvider(t)
  const form = importForm()
  form.set('clientes', new File(['wrong,header\n1,2'], 'clientes.csv'))
  const response = await worker.fetch(request('/api/importaciones', { body: form }), env)
  assert.equal(response.status, 422)
  assert.equal((await response.json()).error.details[0].file, 'clientes.csv')
  assert.equal(calls.length, 2)
})

test('storage failure marks only the current attempt failed and never stages data', async t => {
  const calls = mockProvider(t, { storageError: true })
  const response = await worker.fetch(request(), env)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'ARCHIVE_FAILED')
  assert.ok(calls.some(call => call.path.endsWith('/nortia_fallar_carga_v1')))
  assert.ok(!calls.some(call => call.path.endsWith('/nortia_preparar_carga_v1')))
})

test('transaction rejection is sanitized, recorded separately, and retains archived originals', async t => {
  const calls = mockProvider(t, { stageError: '23503' })
  const response = await worker.fetch(request(), env)
  assert.equal(response.status, 422)
  assert.ok(!(await response.text()).includes('private detail'))
  assert.ok(calls.some(call => call.path.endsWith('/nortia_fallar_carga_v1')))
  assert.ok(!calls.some(call => call.init.method === 'DELETE'))
})

test('activation passes the reviewed active identity and detects stale previews', async t => {
  mockProvider(t, { activationConflict: true })
  const response = await worker.fetch(request(`/api/importaciones/${id}/activar`, { body: JSON.stringify({ active_id: null }) }), env)
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'IMPORT_CONFLICT')
})

test('activation succeeds only as a separate explicit request', async t => {
  mockProvider(t)
  const response = await worker.fetch(request(`/api/importaciones/${id}/activar`, { body: JSON.stringify({ active_id: null }) }), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { id, activa: true })
})

test('history uses user-scoped credentials and works without a server secret', async t => {
  mockProvider(t)
  const response = await worker.fetch(request('/api/importaciones', { method: 'GET' }), { ...env, SUPABASE_SECRET_KEY: undefined })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { active: null, selected: null, imports: [] })
})
