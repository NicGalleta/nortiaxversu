import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import { IMPORT_FILES } from '../shared/import-contract.js'
import { prepareImport, ImportValidationError, integer } from '../worker/imports/parse.js'
import { readBoundedBody, readImportForm, sha256 } from '../worker/imports/request.js'
import { sourceRows, sourceCsv, importForm } from './fixtures/import-data.js'

const prepare = rows => prepareImport(sourceCsv(rows), '2026-09-27', '1000')
const invalid = change => {
  const rows = sourceRows()
  change(rows)
  assert.throws(() => prepare(rows), error => error instanceof ImportValidationError && error.details.length > 0)
}

test('CSV supports commas, multiline text, UTF-8 BOM, nullable credit-note due dates, and exact allocation', () => {
  const csv = sourceCsv()
  csv.clientes = '\uFEFF' + csv.clientes
  const result = prepareImport(csv, '2026-09-27', '001000')
  assert.equal(result.bank, '1000')
  assert.equal(result.data.clientes[0].razon_social, 'Cliente, Uno')
  assert.equal(result.data.documentos[0].observacion, 'Detalle con coma, y\nsegunda línea')
  assert.equal(result.data.documentos[2].fecha_vencimiento, null)
  assert.deepEqual(result.data.aplicaciones_pago.map(row => row.monto_aplicado), ['100', '800', '2000'])
  assert.equal(result.data.clientes[0].contacto_email, null)
  assert.equal(JSON.stringify(result.data).includes('_row'), false)
})

test('replacement references never subtract money; invoices can remain partially outstanding', () => {
  const rows = sourceRows()
  rows.pagos = rows.pagos.slice(0, 1)
  const result = prepare(rows)
  assert.equal(result.data.documentos[1].documento_referencia, 'F1')
  assert.equal(result.data.aplicaciones_pago.length, 1)
})

test('monetary input rejects decimals, separators, unsafe range, and preserves large integers', () => {
  assert.equal(integer('9007199254740993'), '9007199254740993')
  for (const value of ['1.000', '1,000', '1.5', '1e3', '9223372036854775808']) assert.equal(integer(value), null)
  assert.equal(integer('-9223372036854775808'), '-9223372036854775808')
})

test('source validation rejects duplicate, malformed, foreign, future, and nonreconciling records', async t => {
  const cases = {
    duplicate: rows => rows.clientes.push({ ...rows.clientes[0] }),
    foreignCustomer: rows => { rows.documentos[0].id_cliente = 'MISSING' },
    futureDocument: rows => { rows.documentos[0].fecha_emision = '2026-10-01' },
    invalidDate: rows => { rows.documentos[0].fecha_emision = '2026-02-30' },
    noInvoiceDue: rows => { rows.documentos[0].fecha_vencimiento = '' },
    creditAsReference: rows => { rows.pagos[0].facturas_referencia = 'NC1' },
    futurePayment: rows => { rows.pagos[0].fecha_pago = '2026-10-01' },
    noPaymentDate: rows => { rows.pagos[0].fecha_pago = '' },
    repeatedReference: rows => { rows.pagos[1].facturas_referencia = 'F1, F1' },
    multiMismatch: rows => { rows.pagos[1].monto = '2799' },
    overpayment: rows => { rows.pagos = [{ ...rows.pagos[0], monto: '1001' }] },
    badTax: rows => { rows.documentos[0].impuesto = '1' },
    wrongDispute: rows => { rows.documentos[0].en_disputa = 'true' },
    missingCreditTarget: rows => { rows.documentos[2].documento_referencia = '' },
    paidWithoutDate: rows => { rows.obligaciones[0].estado = 'pagada' },
    pendingWithDate: rows => { rows.obligaciones[0].fecha_pago = '2026-09-20' },
    cyclicReplacements: rows => { rows.documentos[0].documento_referencia = 'F2'; rows.documentos[1].fecha_emision = '2026-09-01' },
  }
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, () => invalid(mutate))
})

test('headers and malformed CSV produce actionable file/record errors', () => {
  for (const broken of ['', 'id_cliente,id_cliente\nC1,C1', sourceCsv().clientes.replace('razon_social', 'unknown'), '"unterminated']) {
    assert.throws(() => prepareImport({ ...sourceCsv(), clientes: broken }, '2026-09-27', '1000'), error =>
      error.details[0].file === 'clientes.csv' && error.details[0].row === 1)
  }
})

test('multipart validation bounds chunked bodies and enforces exactly four source files', async () => {
  const request = new Request('https://app.test/api/importaciones', { method: 'POST', body: importForm() })
  const parsed = await readImportForm(request)
  assert.equal(parsed.files.length, 4)
  assert.equal(parsed.bank, '1000')
  const duplicate = importForm()
  duplicate.append('saldo_banco', '1000')
  await assert.rejects(() => readImportForm(new Request('https://app.test/', { method: 'POST', body: duplicate })), error => error.status === 400)
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); controller.close() } })
  await assert.rejects(() => readBoundedBody(new Request('https://app.test/', { method: 'POST', body: stream, duplex: 'half' }), 10), error => error.status === 413)
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('provided ERP dataset reconciles all payment references without rounding', { skip: !fs.existsSync('datos_nortia_candidatos/clientes.csv') }, () => {
  const texts = Object.fromEntries(IMPORT_FILES.map(spec => [spec.key, fs.readFileSync(`datos_nortia_candidatos/${spec.name}`, 'utf8')]))
  const { data } = prepareImport(texts, '2026-09-27', '270000000')
  assert.equal(data.documentos.length, 7233)
  assert.equal(data.aplicaciones_pago.length, 6400)
  const balances = new Map(data.documentos.filter(row => row.tipo === 'factura').map(row => [row.id_documento, BigInt(row.monto_total)]))
  for (const row of data.documentos.filter(row => row.tipo === 'nota_credito')) balances.set(row.documento_referencia, balances.get(row.documento_referencia) + BigInt(row.monto_total))
  for (const row of data.aplicaciones_pago) balances.set(row.id_documento, balances.get(row.id_documento) - BigInt(row.monto_aplicado))
  assert.equal([...balances.values()].reduce((sum, value) => sum + value, 0n), 1404092132n)
  assert.equal([...balances.values()].filter(value => value > 0n).length, 1144)
})
