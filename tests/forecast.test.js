import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectForecast, validForecastInput } from '../worker/forecast/project.js'
import { forecastInput, invoice, obligation, profile } from './fixtures/forecast-data.js'

test('no active snapshot returns an explicit empty forecast', () => {
  assert.deepEqual(projectForecast({ dashboard: { snapshot: null, summary: null, obligations: [] }, invoices: [], profiles: [] }), { snapshot: null, methodVersion: 1, coverage: null, scenarios: null })
})

test('forecast uses the business cutoff and 13 contiguous seven-day weeks, including leap days', () => {
  const result = projectForecast(forecastInput({ cutoff: '2028-02-28' }))
  assert.equal(result.scenarios.base.weeks.length, 13)
  assert.equal(result.scenarios.base.weeks[0].start, '2028-02-29')
  assert.equal(result.scenarios.base.weeks[0].end, '2028-03-06')
  assert.equal(result.scenarios.base.weeks[1].start, '2028-03-07')
  assert.equal(result.scenarios.base.closing, '100')
  assert.equal(result.scenarios.base.firstDeficit, null)
})

test('daily deficit is detected even when collections make the weekly close positive', () => {
  const result = projectForecast(forecastInput({ invoices: [invoice({ due: '2026-09-30' })], obligations: [obligation()], profiles: [profile()] }))
  assert.equal(result.scenarios.base.weeks[0].closing, '150')
  assert.equal(result.scenarios.base.weeks[0].minimum, '-50')
  assert.equal(result.scenarios.base.firstDeficit, '2026-09-28')
  assert.equal(result.scenarios.base.shortfall, '50')
})

test('overdue obligations are paid on day one; overdue receivables use future 7/21-day floors', () => {
  const result = projectForecast(forecastInput({ invoices: [invoice({ due: '2026-01-01' })], obligations: [obligation({ fecha_vencimiento: '2026-01-01' })], profiles: [profile()] }))
  assert.equal(result.scenarios.base.weeks[0].collections, '200')
  assert.equal(result.scenarios.base.weeks[0].obligations, '150')
  assert.equal(result.scenarios.base.firstDeficit, '2026-09-28')
  assert.equal(result.scenarios.conservative.weeks[0].collections, '0')
  assert.equal(result.scenarios.conservative.weeks[2].collections, '200')
})

test('profile selection respects customer/segment/global thresholds and documents fallback exposure', () => {
  const invoices = [invoice(), invoice({ id: 'F2', customer: 'C2' }), invoice({ id: 'F3', customer: 'C3', segment: null })]
  const profiles = [profile({ p50: 7, p80: 14 }), profile({ key: 'C2', samples: 4 }), profile({ scope: 'segment', key: 'taller', samples: 10, p50: 14, p80: 20 }), profile({ scope: 'global', key: null, samples: 10, p50: 21, p80: 30 })]
  const result = projectForecast(forecastInput({ invoices, profiles }))
  for (const key of ['customer', 'segment', 'global']) assert.deepEqual(result.coverage[key], { count: 1, amount: '200' })
  assert.equal(result.scenarios.base.weeks[1].collections, '200')
  assert.equal(result.scenarios.base.weeks[2].collections, '200')
  assert.equal(result.scenarios.base.weeks[3].collections, '200')
  const fallback = projectForecast(forecastInput({ invoices: [invoice()], profiles: [profile({ samples: 4 }), profile({ scope: 'global', key: null, samples: 9 })] }))
  assert.equal(fallback.coverage.default.count, 1)
  assert.equal(fallback.scenarios.base.weeks[4].collections, '200')
  assert.equal(fallback.scenarios.conservative.weeks[8].collections, '200')
})

test('disputed amounts are excluded from both scenarios without dropping their disclosure', () => {
  const result = projectForecast(forecastInput({ invoices: [invoice({ disputed: true })] }))
  assert.equal(result.coverage.disputed, '200')
  assert.equal(result.coverage.default.count, 0)
  for (const scenario of Object.values(result.scenarios)) {
    assert.equal(scenario.closing, '100')
    assert.equal(scenario.beyond, '0')
  }
})

test('horizon includes day 91 and separately discloses day 92 and delayed conservative collections', () => {
  const result = projectForecast(forecastInput({ invoices: [invoice({ due: '2026-12-27' }), invoice({ id: 'F2', due: '2026-12-28' })], obligations: [obligation({ fecha_vencimiento: '2026-12-27' }), obligation({ id_obligacion: 'O2', fecha_vencimiento: '2026-12-28' })], profiles: [profile()] }))
  assert.equal(result.scenarios.base.weeks[12].collections, '200')
  assert.equal(result.scenarios.base.weeks[12].obligations, '150')
  assert.equal(result.scenarios.base.beyond, '200')
  assert.equal(result.scenarios.conservative.beyond, '400')
  assert.equal(result.coverage.obligationsBeyond, '150')
})

test('amounts beyond Number precision stay exact and an initial negative bank is reported at cutoff', () => {
  const result = projectForecast(forecastInput({ bank: '-9007199254740993', invoices: [invoice({ amount: '9007199254740994' })], profiles: [profile()] }))
  assert.equal(result.scenarios.base.firstDeficit, '2026-09-27')
  assert.equal(result.scenarios.base.shortfall, '9007199254740993')
  assert.equal(result.scenarios.base.closing, '1')
})

test('every week reconciles and conservative cumulative collections never exceed base', () => {
  const invoices = Array.from({ length: 100 }, (_, index) => invoice({ id: `F${index}`, due: new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10), amount: `${1000 + index}`, disputed: index % 9 === 0 }))
  const result = projectForecast(forecastInput({ invoices, obligations: [obligation()], profiles: [profile({ p50: 8, p80: 28 })] }))
  let base = 0n, conservative = 0n
  for (let index = 0; index < 13; index++) {
    base += BigInt(result.scenarios.base.weeks[index].collections)
    conservative += BigInt(result.scenarios.conservative.weeks[index].collections)
    assert.ok(base >= conservative)
    for (const scenario of Object.values(result.scenarios)) {
      const week = scenario.weeks[index]
      assert.equal(BigInt(week.opening) + BigInt(week.collections) - BigInt(week.obligations), BigInt(week.closing))
      if (index) assert.equal(week.opening, scenario.weeks[index - 1].closing)
    }
  }
  assert.equal(base + BigInt(result.scenarios.base.beyond) + BigInt(result.coverage.disputed), BigInt(result.coverage.receivables))
})

test('malformed or unreconciled provider data cannot generate a forecast', () => {
  for (const mutate of [
    input => { input.invoices[0].amount = 200 },
    input => { input.invoices[0].due = '2026-02-30' },
    input => { input.invoices.push(input.invoices[0]) },
    input => { input.dashboard.summary.por_cobrar = '201' },
    input => { input.profiles[0].p80 = -1 },
    input => { input.profiles[0].samples = 2.5 },
    input => { input.profiles.push(input.profiles[0]) },
    input => { input.invoices[0].disputed = 'false' },
    input => { input.dashboard.obligations = [] },
  ]) {
    const input = forecastInput({ invoices: [invoice()], obligations: [obligation()], profiles: [profile()] })
    mutate(input)
    assert.equal(validForecastInput(input), false)
    assert.throws(() => projectForecast(input), /Invalid forecast input/)
  }
})
