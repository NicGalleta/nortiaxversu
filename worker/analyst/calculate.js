import { buildForecastSchedule, aggregateCash, day, date } from '../forecast/project.js'
import { prepareCollections } from '../collections/prepare.js'
import { HttpError } from '../lib/supabase/action.js'
import { exactKeys } from '../../shared/analyst-contract.js'
import { formatAmount, formatDate } from '../../shared/format.js'

const invalid = message => { throw new HttpError(400, 'INVALID_SCENARIO', message) }
export function analystContext(source) {
  const portfolio = prepareCollections(source)
  const customers = portfolio.customers.filter(c => BigInt(c.total) > BigInt(c.disputed)).map(c => ({ id: c.id, name: c.name, amount: (BigInt(c.total) - BigInt(c.disputed)).toString() }))
  customers.sort((a, b) => BigInt(a.amount) > BigInt(b.amount) ? -1 : BigInt(a.amount) < BigInt(b.amount) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return { snapshot: portfolio.snapshot, customers }
}
export function validateSpec(spec, context) {
  if (!exactKeys(spec, ['snapshotId', 'task', 'baseline', 'selection', 'delays'])) invalid('Revisa los campos del escenario.')
  if (typeof spec.snapshotId !== 'string') invalid('Falta la importación revisada.')
  if (!context.snapshot || spec.snapshotId !== context.snapshot.id) throw new HttpError(409, 'SNAPSHOT_CHANGED', 'Cambió la importación activa. Actualiza Analista y revisa los clientes.')
  if (!['explain', 'simulate', 'compare'].includes(spec.task) || !['base', 'conservative'].includes(spec.baseline)) invalid('Selecciona una tarea y un escenario admitidos.')
  const length = { explain: 0, simulate: 1, compare: 2 }[spec.task]
  if (!Array.isArray(spec.delays) || spec.delays.length !== length || spec.delays.some(n => !Number.isInteger(n) || n < 1 || n > 60)) invalid('Usa entre 1 y 60 días adicionales para cada alternativa.')
  if (spec.task === 'explain') { if (spec.selection !== null) invalid('Explicar caja no requiere seleccionar clientes.'); return [] }
  const selection = spec.selection
  if (selection?.type === 'top' && exactKeys(selection, ['type', 'count'])) {
    if (!Number.isInteger(selection.count) || selection.count < 1 || selection.count > 5 || selection.count > context.customers.length) invalid('Selecciona entre 1 y 5 clientes elegibles disponibles.')
    return context.customers.slice(0, selection.count)
  }
  if (selection?.type === 'customers' && exactKeys(selection, ['type', 'ids'])) {
    if (!Array.isArray(selection.ids) || selection.ids.length < 1 || selection.ids.length > 5 || new Set(selection.ids).size !== selection.ids.length) invalid('Selecciona entre 1 y 5 clientes distintos.')
    const selected = selection.ids.map(id => context.customers.find(c => c.id === id))
    if (selected.some(c => !c)) invalid('Uno de los clientes no tiene saldo sin disputa en este corte.')
    return selected
  }
  invalid('Selecciona los clientes manualmente o por mayor saldo sin disputa.')
}

export function calculateAnalysis(source, spec) {
  const context = analystContext(source), selected = validateSpec(spec, context)
  const { snapshot, coverage, scheduled } = buildForecastSchedule(source)
  const chosen = new Set(selected.map(c => c.id))
  const eligible = scheduled.filter(item => chosen.has(item.customer))
  const scenarios = [0, ...spec.delays].map((delay, index) => ({ id: ['baseline', 'a', 'b'][index], label: index ? `Alternativa ${index === 1 ? 'A' : 'B'} · +${delay} días` : `Original · ${spec.baseline === 'base' ? 'base' : 'conservador'}`, delay,
    ...aggregateCash(snapshot, source.dashboard.obligations, scheduled.map(item => ({ day: item[spec.baseline] + (chosen.has(item.customer) ? delay : 0), amount: item.amount }))) }))
  const baseline = scenarios[0]
  for (const scenario of scenarios) {
    scenario.deltaClosing = (BigInt(scenario.closing) - BigInt(baseline.closing)).toString()
    scenario.deltaShortfall = (BigInt(scenario.shortfall) - BigInt(baseline.shortfall)).toString()
    scenario.deficitChange = scenario.firstDeficit === baseline.firstDeficit ? 'Sin cambio de fecha' : !baseline.firstDeficit ? 'Aparece un déficit frente al original' : !scenario.firstDeficit ? 'Desaparece el déficit' : `${day(baseline.firstDeficit) - day(scenario.firstDeficit)} días antes del original`
    scenario.noImpact = scenario.daily.every((entry, i) => entry.closing === baseline.daily[i].closing)
  }
  const names = new Map(context.customers.map(c => [c.id, c.name]))
  const focusDate = baseline.firstDeficit ?? baseline.minimumDate
  const endDay = day(focusDate), cutoff = day(snapshot.fecha_corte)
  const drivers = {
    date: focusDate,
    collections: scheduled.filter(i => i[spec.baseline] <= endDay).sort((a,b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.id.localeCompare(b.id)).slice(0,5).map(i => ({ id: i.id, customer: i.customer, name: names.get(i.customer), date: date(i[spec.baseline]), amount: i.amount.toString() })),
    obligations: source.dashboard.obligations.filter(o => Math.max(cutoff + 1, day(o.fecha_vencimiento)) <= endDay).sort((a,b) => BigInt(a.monto) > BigInt(b.monto) ? -1 : BigInt(a.monto) < BigInt(b.monto) ? 1 : a.id_obligacion.localeCompare(b.id_obligacion)).slice(0,5).map(o => ({ id: o.id_obligacion, name: o.acreedor, date: date(Math.max(cutoff+1,day(o.fecha_vencimiento))), amount: o.monto })),
  }
  const affected = eligible.map(i => ({ id: i.id, customer: i.customer, name: names.get(i.customer), amount: i.amount.toString(), original: date(i[spec.baseline]), alternatives: spec.delays.map(delay => date(i[spec.baseline] + delay)) }))
  const facts = [
    { id: 'scope', text: `Corte ${formatDate(snapshot.fecha_corte)}. Banco inicial: ${formatAmount(snapshot.saldo_banco)}. Horizonte: 13 semanas.`, kind: 'scope' },
    ...scenarios.map(s => ({ id: s.id, kind: 'scenario', text: `${s.label}: ${s.firstDeficit ? `primer déficit ${formatDate(s.firstDeficit)}` : 'sin déficit'}; faltante máximo ${formatAmount(s.shortfall)}; saldo final ${formatAmount(s.closing)}; mínimo ${formatAmount(s.minimum)} al ${formatDate(s.minimumDate)}; cobros fuera del horizonte ${formatAmount(s.beyond)}.` })),
    ...scenarios.slice(1).map(s => ({ id: `${s.id}-change`, kind: 'comparison', text: `${s.label}: cambio del saldo final ${formatAmount(s.deltaClosing)}; aumento del faltante máximo ${formatAmount(s.deltaShortfall)}.${s.noImpact ? ' Sin impacto dentro del horizonte.' : ''}` })),
    { id: 'selection', kind: 'scope', text: `Clientes afectados: ${selected.length}; facturas sin disputa: ${affected.length}; saldo afectado: ${formatAmount(eligible.reduce((sum,i)=>sum+i.amount,0n))}.` },
    { id: 'disputes', kind: 'scope', text: `Saldo en disputa excluido de todos los cobros: ${formatAmount(coverage.disputed)}.` },
    ...drivers.obligations.map((o,i) => ({ id: `obligation-${i}`, kind: 'obligation', sourceId: o.id, text: `Obligación ${o.id}: ${formatAmount(o.amount)} programados al ${formatDate(o.date)}, dentro de los mayores egresos hasta ${formatDate(focusDate)}.` })),
    ...drivers.collections.map((o,i) => ({ id: `collection-${i}`, kind: 'collection', sourceId: o.id, text: `Factura ${o.id}: cobro estimado de ${formatAmount(o.amount)} al ${formatDate(o.date)}, dentro de los mayores cobros hasta ${formatDate(focusDate)}.` })),
  ]
  return { snapshot, spec, scenarios, selected, affected, drivers, facts, coverage,
    explanation: { status: 'deterministic', factIds: facts.map(f => f.id), message: 'Resumen calculado. Las fechas de cobro son supuestos; no compromisos del cliente.' } }
}
