import { isDashboardPayload } from '../../shared/dashboard-contract.js'

const DAY = 86400000
export const day = value => Date.parse(`${value}T00:00:00Z`) / DAY
export const date = value => new Date(value * DAY).toISOString().slice(0, 10)
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(day(value)) && date(day(value)) === value
const text = value => typeof value === 'string' && value.length > 0
const amount = value => typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n
const count = value => Number.isSafeInteger(value) && value >= 0

// Provider responses are untrusted. Check reconciliation before calculating or
// exposing forecasts; monetary arithmetic never passes through Number.
export function validForecastInput(input) {
  if (!input || !isDashboardPayload(input.dashboard) || !Array.isArray(input.invoices) || !Array.isArray(input.profiles)) return false
  if (!input.dashboard.snapshot) return input.invoices.length === 0 && input.profiles.length === 0
  const ids = new Set(), profiles = new Set()
  let total = 0n, disputed = 0n, overdue = 0n, overdueCount = 0
  for (const row of input.invoices) {
    if (!row || !text(row.id) || ids.has(row.id) || !text(row.customer) || !(row.segment === null || text(row.segment)) || !isDate(row.due) || typeof row.disputed !== 'boolean' || !amount(row.amount)) return false
    ids.add(row.id)
    total += BigInt(row.amount)
    if (row.disputed) disputed += BigInt(row.amount)
    if (row.due < input.dashboard.snapshot.fecha_corte) { overdue += BigInt(row.amount); overdueCount++ }
  }
  const summary = input.dashboard.summary
  if (total !== BigInt(summary.por_cobrar) || disputed !== BigInt(summary.en_disputa) || ids.size !== summary.facturas_pendientes || overdue !== BigInt(summary.vencido) || overdueCount !== summary.facturas_vencidas) return false
  for (const row of input.profiles) {
    if (!row || !['customer', 'segment', 'global'].includes(row.scope) || !(row.scope === 'global' ? row.key === null : text(row.key)) || !count(row.samples) || row.samples === 0 || !count(row.p50) || !count(row.p80) || row.p80 < row.p50 || row.p80 > 3650000) return false
    const key = JSON.stringify([row.scope, row.key])
    if (profiles.has(key)) return false
    profiles.add(key)
  }
  const near = input.dashboard.obligations.filter(row => day(row.fecha_vencimiento) <= day(input.dashboard.snapshot.fecha_corte) + 7).reduce((sum, row) => sum + BigInt(row.monto), 0n)
  return near === BigInt(summary.obligaciones_7_dias)
}

export function buildForecastSchedule(input) {
  if (!validForecastInput(input)) throw new Error('Invalid forecast input')
  const { snapshot, summary, obligations } = input.dashboard
  if (!snapshot) return { snapshot: null, coverage: null, scheduled: [] }
  const cutoff = day(snapshot.fecha_corte)
  const horizon = cutoff + 91
  const profileMap = new Map(input.profiles.map(row => [JSON.stringify([row.scope, row.key]), row]))
  const coverage = {
    customer: { count: 0, amount: 0n }, segment: { count: 0, amount: 0n },
    global: { count: 0, amount: 0n }, default: { count: 0, amount: 0n },
    disputed: summary.en_disputa, receivables: summary.por_cobrar,
    historySamples: profileMap.get(JSON.stringify(['global', null]))?.samples ?? 0,
    obligationsBeyond: '0',
  }
  const scheduled = []
  for (const invoice of input.invoices) {
    if (invoice.disputed) continue
    let source = 'default', profile = { p50: 30, p80: 60 }
    for (const [scope, key, minimum] of [['customer', invoice.customer, 5], ['segment', invoice.segment, 10], ['global', null, 10]]) {
      const candidate = profileMap.get(JSON.stringify([scope, key]))
      if (candidate && candidate.samples >= minimum) { source = scope; profile = candidate; break }
    }
    coverage[source].count++
    coverage[source].amount += BigInt(invoice.amount)
    const due = day(invoice.due)
    // Overdue debt needs a future assumption, not an income in the past or
    // automatic collection tomorrow. Conservative always delays >=14 days.
    const overdue = due <= cutoff
    const base = Math.max(cutoff + (overdue ? 7 : 1), due + profile.p50)
    const conservative = Math.max(base + 14, cutoff + (overdue ? 21 : 1), due + profile.p80)
    scheduled.push({ id: invoice.id, customer: invoice.customer, source, amount: BigInt(invoice.amount), base, conservative })
  }
  for (const key of ['customer', 'segment', 'global', 'default']) coverage[key].amount = coverage[key].amount.toString()
  coverage.obligationsBeyond = obligations.filter(row => day(row.fecha_vencimiento) > horizon).reduce((sum, row) => sum + BigInt(row.monto), 0n).toString()
  return { snapshot, coverage, scheduled }
}

export function aggregateCash(snapshot, obligations, collections) {
  const cutoff = day(snapshot.fecha_corte)
  const incoming = Array(91).fill(0n), outgoing = Array(91).fill(0n)
  let beyond = 0n
  for (const item of collections) {
    const index = item.day - cutoff - 1
    if (!Number.isInteger(index) || index < 0) throw new Error('Collection must be after cutoff')
    if (index >= 91) beyond += item.amount
    else incoming[index] += item.amount
  }
  for (const obligation of obligations) {
    const index = Math.max(0, day(obligation.fecha_vencimiento) - cutoff - 1)
    if (index < 91) outgoing[index] += BigInt(obligation.monto)
  }
  let cash = BigInt(snapshot.saldo_banco), minimum = cash
  let minimumDate = snapshot.fecha_corte
  let firstDeficit = cash < 0n ? snapshot.fecha_corte : null
  const weeks = [], daily = []
  for (let week = 0; week < 13; week++) {
    const opening = cash
    let collected = 0n, paid = 0n, weekMinimum = cash
    for (let offset = 0; offset < 7; offset++) {
      const index = week * 7 + offset
      collected += incoming[index]; paid += outgoing[index]
      cash += incoming[index] - outgoing[index]
      const currentDate = date(cutoff + index + 1)
      if (cash < minimum) { minimum = cash; minimumDate = currentDate }
      if (cash < weekMinimum) weekMinimum = cash
      if (cash < 0n && !firstDeficit) firstDeficit = currentDate
      daily.push({ date: currentDate, collections: incoming[index].toString(), obligations: outgoing[index].toString(), closing: cash.toString() })
    }
    weeks.push({ week: week + 1, start: date(cutoff + week * 7 + 1), end: date(cutoff + week * 7 + 7),
      opening: opening.toString(), collections: collected.toString(), obligations: paid.toString(), closing: cash.toString(), minimum: weekMinimum.toString() })
  }
  return { weeks, daily, minimum: minimum.toString(), minimumDate, firstDeficit, shortfall: (minimum < 0n ? -minimum : 0n).toString(), closing: cash.toString(), beyond: beyond.toString() }
}

export function projectForecast(input) {
  const { snapshot, coverage, scheduled } = buildForecastSchedule(input)
  if (!snapshot) return { snapshot: null, methodVersion: 1, coverage: null, scenarios: null }
  const scenarios = {}
  for (const scenario of ['base', 'conservative']) {
    const { weeks, firstDeficit, shortfall, closing, beyond } = aggregateCash(snapshot, input.dashboard.obligations, scheduled.map(item => ({ day: item[scenario], amount: item.amount })))
    scenarios[scenario] = { weeks, firstDeficit, shortfall, closing, beyond }
  }
  return { snapshot, methodVersion: 1, coverage, scenarios }
}
