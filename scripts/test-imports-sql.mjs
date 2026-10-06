// Owns a fresh local cluster using a private Unix socket; never uses remote DB credentials.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { prepareCollections, validCustomerDetail } from '../worker/collections/prepare.js'
import { projectForecast, validForecastInput } from '../worker/forecast/project.js'
import { prepareImport } from '../worker/imports/parse.js'
import { IMPORT_FILES } from '../shared/import-contract.js'
import { sourceCsv } from '../tests/fixtures/import-data.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nortia-imports-pg-'))
const databaseDir = path.join(directory, 'data')
const socket = path.join(directory, 'socket')
fs.mkdirSync(socket)
const bin = name => process.env.NORTIA_PG_BIN ? path.join(process.env.NORTIA_PG_BIN, name) : name
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55439', '-U', 'nortia_test', '-d', 'nortia_imports_test']
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
const sql = input => execFileSync(bin('psql'), args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const service = command => `set role service_role; ${command}; reset role;`
const get = command => {
  const value = sql(command).split('\n').at(-1)
  return value === 't' ? true : value === 'f' ? false : JSON.parse(value)
}
const actor = '00000000-0000-4000-8000-000000000001'
let running = false
let serial = 0
function begin(bank = '1000') {
  const hash = (++serial).toString(16).padStart(64, '0')
  return { ...get(service(`select public.nortia_iniciar_carga_v1('${actor}','${hash}','2026-09-27',${bank})`)), hash }
}
function stage(attempt, prepared) {
  const archives = IMPORT_FILES.map(spec => ({ nombre: spec.name, nombre_original: spec.name,
    ruta: `${attempt.id}/${attempt.intento_id}/${spec.name}`, sha256: 'a'.repeat(64), bytes: 100, filas: prepared.data[spec.table].length }))
  sql(`insert into storage.objects values ${archives.map(file => `('nortia-importaciones',${quote(file.ruta)})`).join(',')} on conflict do nothing;`)
  return get(service(`select public.nortia_preparar_carga_v1('${actor}','${attempt.id}','${attempt.intento_id}',${json(prepared.data)},${json(archives)})`))
}
const activate = (item, active) => service(`select public.nortia_activar_carga_v1('${actor}','${item.id}',${active ? quote(active) : 'null'})`)
function sqlAsync(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin('psql'), args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => code ? reject(new Error(error)) : resolve(output))
    child.stdin.end(input)
  })
}
try {
  execFileSync(bin('initdb'), ['-D', databaseDir, '-U', 'nortia_test', '--auth=trust', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' })
  execFileSync(bin('pg_ctl'), ['-D', databaseDir, '-l', path.join(directory, 'postgres.log'), '-o', `-F -k ${socket} -h '' -p 55439`, '-w', 'start'], { stdio: 'pipe' })
  running = true
  execFileSync(bin('createdb'), ['-h', socket, '-p', '55439', '-U', 'nortia_test', 'nortia_imports_test'], { stdio: 'pipe' })
  for (const file of ['supabase/tests/import-schema.sql', 'supabase/migrations/202610060001_dashboard.sql', 'supabase/migrations/202610060002_imports.sql', 'supabase/migrations/202610060003_forecast.sql', 'supabase/migrations/202610060004_collections.sql']) sql(fs.readFileSync(file, 'utf8'))
  sql(`insert into auth.users values ('${actor}'); insert into public.usuarios_autorizados(user_id) values('${actor}');`)
  assert.throws(() => sql(`set role authenticated; select public.nortia_iniciar_carga_v1('${actor}', repeat('a',64),'2026-09-27',1000);`))
  assert.throws(() => sql(service(`select public.nortia_iniciar_carga_v1('00000000-0000-4000-8000-000000000099', repeat('a',64),'2026-09-27',1000)`)))
  assert.equal(sql("select has_function_privilege('anon','public.nortia_forecast_v1()','EXECUTE');"), 'f')
  assert.throws(() => sql('set role authenticated; select public.nortia_forecast_v1();'))
  assert.throws(() => sql("set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'; select public.nortia_forecast_v1();"))
  const readForecast = () => get(`set role authenticated; set request.jwt.claim.sub='${actor}'; select public.nortia_forecast_v1();`)
  assert.equal(projectForecast(readForecast()).snapshot, null)
  for (const fn of ['public.nortia_cobranza_v1()', 'public.nortia_cliente_v1(uuid,text)']) assert.equal(sql(`select has_function_privilege('anon','${fn}','EXECUTE');`), 'f')
  assert.throws(() => sql('set role authenticated; select public.nortia_cobranza_v1();'))
  assert.throws(() => sql(`set role authenticated; select public.nortia_cliente_v1('${actor}','C1');`))
  const readCollections = () => get(`set role authenticated; set request.jwt.claim.sub='${actor}'; select public.nortia_cobranza_v1();`)
  const readCustomer = (id,customer) => get(`set role authenticated; set request.jwt.claim.sub='${actor}'; select public.nortia_cliente_v1('${id}',${quote(customer)});`)
  assert.equal(prepareCollections(readCollections()).snapshot, null)
  const prepared = prepareImport(sourceCsv(), '2026-09-27', '1000')
  const first = begin()
  assert.equal(sql('select count(*) from public.importaciones where activa;'), '0')
  stage(first, prepared)
  assert.equal(sql('select count(*) from public.importaciones where activa;'), '0')
  const report = get(`select resumen_validacion from public.importaciones where id='${first.id}';`)
  assert.equal(report.summary.por_cobrar, '0')
  assert.equal(report.summary.saldo_sin_cobros_7_dias, '-200')
  assert.equal(get(activate(first, null)).activa, true)
  const syntheticDetail = readCustomer(first.id,'C1')
  assert.equal(validCustomerDetail(syntheticDetail),true)
  assert.equal(syntheticDetail.payments.length,2)
  assert.equal(syntheticDetail.payments.find(p=>p.id==='P2').allocations.length,2)
  assert.equal(syntheticDetail.invoices.find(i=>i.id==='F1').credits,'-100')
  assert.equal(prepareCollections(readCollections()).customers.length,0)
  assert.throws(() => readCustomer(first.id,'UNKNOWN'))
  assert.throws(() => readCustomer(actor,'C1'))
  const syntheticForecast = readForecast()
  assert.equal(validForecastInput(syntheticForecast), true)
  assert.equal(syntheticForecast.profiles.find(p => p.scope === 'global').samples, 1)
  assert.equal(projectForecast(syntheticForecast).scenarios.base.shortfall, '200')
  // One completed invoice with two installments: use the last payment, ignore
  // future payments, and exclude the other invoice's credit/dispute history.
  const historical = get(`begin;
    update public.documentos set fecha_vencimiento='2026-09-10' where importacion_id='${first.id}' and id_documento='F2';
    update public.aplicaciones_pago set monto_aplicado=1000 where importacion_id='${first.id}' and id_documento='F2';
    insert into public.pagos(importacion_id,id_pago,id_cliente,fecha_pago,monto,facturas_referencia)
      values ('${first.id}','P3','C1','2026-09-26',1000,'F2'), ('${first.id}','FUTURE','C1','2026-09-30',100,'F2');
    insert into public.aplicaciones_pago values ('${first.id}','P3','F2','C1',1000), ('${first.id}','FUTURE','F2','C1',100);
    set role authenticated; set request.jwt.claim.sub='${actor}'; select public.nortia_forecast_v1(); rollback;`)
  assert.equal(validForecastInput(historical), true)
  assert.deepEqual(historical.profiles.find(p => p.scope === 'global'), { scope: 'global', key: null, samples: 1, p50: 16, p80: 16 })
  const duplicate = get(service(`select public.nortia_iniciar_carga_v1('${actor}','${first.hash}','2026-09-27',1000)`))
  assert.equal(duplicate.id, first.id)
  assert.equal(duplicate.reutilizada, true)

  const failed = begin()
  const broken = structuredClone(prepared)
  broken.data.aplicaciones_pago[0].id_documento = 'MISSING'
  assert.throws(() => stage(failed, broken))
  assert.equal(sql(`select count(*) from public.clientes where importacion_id='${failed.id}';`), '0')
  assert.equal(sql('select id from public.importaciones where activa;'), first.id)
  assert.equal(get(service(`select public.nortia_fallar_carga_v1('${failed.id}','${failed.intento_id}','TEST_FAILURE')`)), true)
  const retry = get(service(`select public.nortia_iniciar_carga_v1('${actor}','${failed.hash}','2026-09-27',1000)`))
  assert.equal(retry.id, failed.id)
  assert.notEqual(retry.intento_id, failed.intento_id)
  assert.equal(get(service(`select public.nortia_fallar_carga_v1('${failed.id}','${failed.intento_id}','STALE_FAILURE')`)), false)
  stage(retry, prepared)
  assert.equal(get(service(`select public.nortia_fallar_carga_v1('${retry.id}','${retry.intento_id}','LOST_RESPONSE')`)), false)

  const concurrent = begin('1100')
  stage(concurrent, prepared)
  const outcomes = await Promise.allSettled([sqlAsync(activate(retry, first.id)), sqlAsync(activate(concurrent, first.id))])
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1)
  assert.equal(sql('select count(*) from public.importaciones where activa;'), '1')
  const active = sql('select id from public.importaciones where activa;')
  const history = get(`set role authenticated; set request.jwt.claim.sub='${actor}'; select public.nortia_listar_cargas_v1('${first.id}');`)
  assert.equal(history.active.id, active)
  assert.equal(history.selected.id, first.id)
  assert.equal(typeof history.active.saldo_banco, 'string')
  const interrupted = begin()
  assert.throws(() => sql(service(`select public.nortia_iniciar_carga_v1('${actor}','${interrupted.hash}','2026-09-27',1000)`)))
  sql(`update public.cargas_importacion set iniciado_en=now()-interval '16 minutes' where importacion_id='${interrupted.id}';`)
  const recovered = get(service(`select public.nortia_iniciar_carga_v1('${actor}','${interrupted.hash}','2026-09-27',1000)`))
  assert.notEqual(recovered.intento_id, interrupted.intento_id)
  console.log('SQL regression passed: permissions, reconciliation, atomic staging, duplicates, retry leases, stale attempts, and concurrent activation.')

  if (fs.existsSync('datos_nortia_candidatos/clientes.csv')) {
    const texts = Object.fromEntries(IMPORT_FILES.map(spec => [spec.key, fs.readFileSync(`datos_nortia_candidatos/${spec.name}`, 'utf8')]))
    const real = prepareImport(texts, '2026-09-27', '270000000')
    const full = begin('270000000')
    stage(full, real)
    get(activate(full, active))
    const dashboard = get(`set role authenticated; set request.jwt.claim.sub='${actor}'; select public.nortia_dashboard_v1();`)
    assert.equal(dashboard.summary.por_cobrar, '1404092132')
    assert.equal(dashboard.summary.vencido, '509356177')
    assert.equal(dashboard.summary.obligaciones_7_dias, '296228000')
    assert.equal(dashboard.summary.saldo_sin_cobros_7_dias, '-26228000')
    assert.equal(dashboard.obligations.length, 44)
    const forecastSource = readForecast()
    assert.equal(validForecastInput(forecastSource), true)
    assert.equal(forecastSource.dashboard.snapshot.id, full.id)
    const forecast = projectForecast(forecastSource)
    assert.equal(forecast.coverage.receivables, dashboard.summary.por_cobrar)
    assert.equal(forecast.coverage.disputed, dashboard.summary.en_disputa)
    assert.ok(forecast.coverage.historySamples > 0)
    for (const scenario of Object.values(forecast.scenarios)) {
      assert.equal(scenario.weeks[0].obligations, dashboard.summary.obligaciones_7_dias)
      assert.equal(scenario.weeks.reduce((sum,w) => sum+BigInt(w.collections),0n)+BigInt(scenario.beyond)+BigInt(forecast.coverage.disputed),BigInt(forecast.coverage.receivables))
      assert.equal(scenario.weeks.reduce((sum,w) => sum+BigInt(w.obligations),0n).toString(),'1605572000')
    }
    console.log('Forecast SQL passed: authorization, cutoff isolation, final-payment timing, reconciled totals, and both scenarios.')
    console.log(JSON.stringify({ forecast: Object.fromEntries(Object.entries(forecast.scenarios).map(([key,value]) => [key,{ firstDeficit:value.firstDeficit,shortfall:value.shortfall,closing:value.closing,beyond:value.beyond }])), coverage:forecast.coverage }))
    const collections = prepareCollections(readCollections())
    assert.equal(collections.summary.total, dashboard.summary.por_cobrar)
    assert.equal(collections.summary.disputed, dashboard.summary.en_disputa)
    assert.equal(collections.customers.reduce((sum,c)=>sum+c.count,0),1144)
    assert.throws(() => readCustomer(first.id,collections.customers[0].id))
    const targets = new Set([collections.customers[0].id, collections.customers.find(c=>BigInt(c.disputed)>0n).id,
      real.data.documentos.find(d=>d.tipo==='nota_credito').id_cliente,
      real.data.pagos.find(p=>p.facturas_referencia.includes(',')).id_cliente])
    for (const customer of targets) {
      const detail = readCustomer(full.id,customer)
      assert.equal(validCustomerDetail(detail),true,`Invalid customer detail: ${customer}`)
      const outstanding = detail.invoices.reduce((sum,i)=>sum+BigInt(i.remaining),0n).toString()
      assert.equal(outstanding,collections.customers.find(c=>c.id===customer)?.total ?? '0')
    }
    console.log('Collections SQL passed: read permissions, active snapshot guards, exact ranking totals, credit notes, and multi-invoice payment details.')
    console.log(JSON.stringify({collections:collections.summary}))
    console.log('Real CSVs passed end-to-end through the isolated database; expected dashboard totals verified.')
  }
} finally {
  if (running) execFileSync(bin('pg_ctl'), ['-D', databaseDir, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' })
  fs.rmSync(directory, { recursive: true, force: true })
}
