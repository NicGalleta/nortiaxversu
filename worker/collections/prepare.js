import { validForecastInput } from '../forecast/project.js'
import { formatAmount } from '../../shared/format.js'

const text = value => typeof value === 'string' && value.length > 0
const optional = value => value === null || typeof value === 'string'
const amount = value => typeof value === 'string' && /^-?\d+$/.test(value)
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000)
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
function requireValid(condition) { if (!condition) throw new Error('Invalid collections data') }

export function prepareCollections(source) {
  requireValid(validForecastInput(source) && Array.isArray(source.customers))
  const snapshot = source.dashboard.snapshot
  if (!snapshot) { requireValid(source.customers.length === 0); return { snapshot: null, summary: null, customers: [] } }
  const profiles = new Map(source.profiles.filter(row => row.scope === 'customer').map(row => [row.key, row]))
  const customers = new Map()
  for (const row of source.customers) {
    requireValid(row && text(row.id) && text(row.name) && optional(row.taxId) && optional(row.segment) && !customers.has(row.id))
    const history = profiles.get(row.id)
    customers.set(row.id, { ...row, total: 0n, overdue: 0n, collectibleOverdue: 0n, disputed: 0n,
      count: 0, maxOverdueDays: 0, oldestDue: null,
      history: history ? { samples: history.samples, medianDelay: history.p50 } : { samples: 0, medianDelay: null } })
  }
  for (const invoice of source.invoices) {
    const customer = customers.get(invoice.customer)
    requireValid(customer && customer.segment === invoice.segment)
    const value = BigInt(invoice.amount)
    customer.count++; customer.total += value
    if (!customer.oldestDue || invoice.due < customer.oldestDue) customer.oldestDue = invoice.due
    if (invoice.disputed) customer.disputed += value
    if (invoice.due < snapshot.fecha_corte) {
      customer.overdue += value
      if (!invoice.disputed) {
        customer.collectibleOverdue += value
        customer.maxOverdueDays = Math.max(customer.maxOverdueDays, days(snapshot.fecha_corte, invoice.due))
      }
    }
  }
  const rows = [...customers.values()]
  requireValid(rows.every(row => row.count > 0))
  const bucket = row => row.collectibleOverdue > 0n ? 0 : row.total > row.disputed ? 1 : 2
  rows.sort((a, b) => bucket(a) - bucket(b) || compare(b.collectibleOverdue, a.collectibleOverdue) || b.maxOverdueDays - a.maxOverdueDays || compare(b.total - b.disputed, a.total - a.disputed) || a.id.localeCompare(b.id))
  return {
    snapshot,
    summary: { total: source.dashboard.summary.por_cobrar, overdue: source.dashboard.summary.vencido, disputed: source.dashboard.summary.en_disputa,
      collectibleOverdue: rows.reduce((sum, row) => sum + row.collectibleOverdue, 0n).toString(), count: rows.length },
    customers: rows.map((row, index) => {
      const category = ['overdue', 'upcoming', 'dispute'][bucket(row)]
      const reasons = category === 'overdue'
        ? [`${formatAmount(row.collectibleOverdue)} vencidos sin disputa`, `Hasta ${row.maxOverdueDays} días de atraso sin disputa`]
        : category === 'upcoming' ? ['Saldo sin disputa aún no vencido: seguimiento preventivo'] : ['Todo el saldo pendiente está en disputa: coordinar revisión con Comercial']
      if (row.disputed > 0n && category !== 'dispute') reasons.push(`${formatAmount(row.disputed)} en disputa: gestionar por separado`)
      return { ...row, rank: index + 1, category, reasons, ...Object.fromEntries(['total', 'overdue', 'collectibleOverdue', 'disputed'].map(key => [key, row[key].toString()])) }
    }),
  }
}

// Cross-check each invoice against its actual credits and allocations. A payment
// covering multiple invoices is shown once, with its explicit allocation breakdown.
export function validCustomerDetail(data) {
  if (!data?.snapshot || !text(data.snapshot.id) || !date(data.snapshot.fecha_corte) || !amount(data.snapshot.saldo_banco)) return false
  const c = data.customer
  if (!c || !text(c.id_cliente) || !text(c.razon_social) || !['id_tributario','segmento','ciudad','contacto_nombre','contacto_email','contacto_telefono','ejecutivo_comercial'].every(key => optional(c[key])) || !Number.isInteger(c.dias_credito) || c.dias_credito < 0 || !amount(c.limite_credito) || BigInt(c.limite_credito) < 0n) return false
  if (![data.invoices, data.credits, data.payments].every(Array.isArray)) return false
  const invoices = new Map(), credits = new Map(), paid = new Map()
  for (const row of data.invoices) {
    if (!row || !text(row.id) || invoices.has(row.id) || !date(row.issued) || row.issued > data.snapshot.fecha_corte || !date(row.due) || row.due < row.issued || typeof row.disputed !== 'boolean' || !optional(row.reference) || !optional(row.observation) || !['total','credits','paid','remaining'].every(key => amount(row[key]))) return false
    if (BigInt(row.total) <= 0n || BigInt(row.credits) > 0n || BigInt(row.paid) < 0n || BigInt(row.remaining) < 0n || BigInt(row.total) + BigInt(row.credits) - BigInt(row.paid) !== BigInt(row.remaining)) return false
    invoices.set(row.id, row)
  }
  let ids = new Set()
  for (const row of data.credits) {
    if (!row || !text(row.id) || ids.has(row.id) || invoices.has(row.id) || !invoices.has(row.invoice) || !date(row.date) || row.date > data.snapshot.fecha_corte || !amount(row.amount) || BigInt(row.amount) >= 0n || !optional(row.observation)) return false
    ids.add(row.id); credits.set(row.invoice, (credits.get(row.invoice) ?? 0n) + BigInt(row.amount))
  }
  ids = new Set()
  for (const row of data.payments) {
    if (!row || !text(row.id) || ids.has(row.id) || !date(row.date) || row.date > data.snapshot.fecha_corte || !optional(row.method) || !amount(row.amount) || BigInt(row.amount) <= 0n || !Array.isArray(row.allocations) || row.allocations.length === 0) return false
    ids.add(row.id)
    let total = 0n
    const allocated = new Set()
    for (const allocation of row.allocations) {
      if (!allocation || !invoices.has(allocation.invoice) || allocated.has(allocation.invoice) || !amount(allocation.amount) || BigInt(allocation.amount) <= 0n) return false
      allocated.add(allocation.invoice); total += BigInt(allocation.amount)
      paid.set(allocation.invoice, (paid.get(allocation.invoice) ?? 0n) + BigInt(allocation.amount))
    }
    if (total !== BigInt(row.amount)) return false
  }
  return [...invoices.values()].every(row => (credits.get(row.id) ?? 0n) === BigInt(row.credits) && (paid.get(row.id) ?? 0n) === BigInt(row.paid) && (!row.reference || invoices.has(row.reference)))
}
