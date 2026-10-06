import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareCollections, validCustomerDetail } from '../worker/collections/prepare.js'
import { forecastInput, invoice } from './fixtures/forecast-data.js'
import { collectionsSource, customerDetail } from './fixtures/collections-data.js'

test('ranking prioritizes overdue undisputed amounts, keeps disputes separate, and preserves exact sums', () => {
  const invoices = [invoice({ id: 'F1', customer: 'A', due: '2026-09-01', amount: '200' }), invoice({ id: 'F2', customer: 'B', due: '2026-09-20', amount: '201' }), invoice({ id: 'F3', customer: 'A', due: '2026-01-01', amount: '9007199254740993', disputed: true }), invoice({ id: 'F4', customer: 'C', amount: '500' }), invoice({ id: 'F5', customer: 'D', amount: '999', disputed: true })]
  const source = { ...forecastInput({ invoices }), customers: ['A','B','C','D'].map(id => ({ id, name: id, segment: 'taller', taxId: null })) }
  const result = prepareCollections(source)
  assert.deepEqual(result.customers.map(row => row.id), ['B','A','C','D'])
  assert.equal(result.customers[1].total, '9007199254741193')
  assert.equal(result.customers[1].maxOverdueDays, 26, 'Older disputed invoices do not inflate the collectible age')
  assert.equal(result.summary.collectibleOverdue, '401')
  assert.equal(result.summary.total, source.dashboard.summary.por_cobrar)
  assert.equal(result.customers[3].category, 'dispute')
  assert.equal(result.customers[1].reasons.length, 3)
})
test('ties use age then undisputed total then stable customer identity, not history or names', () => {
  const invoices = ['A','B','C'].map(customer => invoice({ id: customer, customer, due: customer === 'A' ? '2026-09-15' : '2026-09-01' }))
  const source = { ...forecastInput({ invoices }), customers: ['C','B','A'].map(id => ({ id, name: 'Same name', segment: 'taller', taxId: null })) }
  assert.deepEqual(prepareCollections(source).customers.map(row => row.id), ['B','C','A'])
})
test('due today is preventive, and historical samples are factual context', () => {
  const source = collectionsSource()
  source.invoices[0].due = source.dashboard.snapshot.fecha_corte
  source.dashboard.summary.vencido = '0'; source.dashboard.summary.facturas_vencidas = 0
  const result = prepareCollections(source)
  assert.equal(result.customers[0].category, 'upcoming')
  assert.deepEqual(result.customers[0].history, { samples: 5, medianDelay: 0 })
})
test('missing customer joins and duplicate identities cannot silently drop receivables', () => {
  for (const mutate of [s => { s.customers = [] }, s => s.customers.push(s.customers[0]), s => { s.customers[0].segment = 'unknown' }, s => { s.invoices[0].amount = '201' }]) {
    const source = collectionsSource(); mutate(source)
    assert.throws(() => prepareCollections(source), /Invalid collections data/)
  }
})
test('empty states distinguish no snapshot from an active snapshot without debt', () => {
  assert.deepEqual(prepareCollections({ dashboard: { snapshot: null, summary: null, obligations: [] }, invoices: [], profiles: [], customers: [] }), { snapshot: null, summary: null, customers: [] })
  const result = prepareCollections({ ...forecastInput(), customers: [] })
  assert.ok(result.snapshot)
  assert.equal(result.summary.count, 0)
})
test('customer detail reconciles credit notes, installments, replacements and multi-invoice payments once', () => {
  const detail = customerDetail()
  assert.equal(validCustomerDetail(detail), true)
  assert.equal(detail.invoices.reduce((sum,row) => sum + BigInt(row.remaining),0n), 200n)
})
test('customer detail rejects duplicated, unallocated, future and inconsistent financial records', () => {
  const mutations = [
    d => d.invoices.push(d.invoices[0]), d => d.payments.push(d.payments[0]), d => d.credits.push(d.credits[0]),
    d => { d.payments[0].amount = '900' }, d => { d.payments[0].allocations[0].invoice = 'OTHER' },
    d => d.payments[0].allocations.push(d.payments[0].allocations[0]), d => { d.invoices[0].remaining = '-1' },
    d => { d.invoices[0].paid = '899' }, d => { d.credits[0].amount = '100' }, d => { d.credits[0].date = '2026-02-30' },
    d => { d.payments[0].date = '2026-09-28' }, d => { d.invoices[1].reference = 'OTHER' }, d => { d.payments = [] },
    d => { d.customer.limite_credito = Number('9007199254740993') },
  ]
  for (const mutate of mutations) { const detail = customerDetail(); mutate(detail); assert.equal(validCustomerDetail(detail), false) }
})
