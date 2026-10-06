import Papa from 'papaparse'
import { IMPORT_FILES, MAX_FILE_ROWS, MAX_TOTAL_ROWS } from '../../shared/import-contract.js'
import { HttpError } from '../lib/supabase/action.js'

export class ImportValidationError extends HttpError {
  constructor(details) {
    super(422, 'INVALID_IMPORT', 'Revisa los errores de los archivos antes de continuar.')
    this.details = details.slice(0, 30)
  }
}

const dateFields = new Set(['fecha_alta', 'fecha_emision', 'fecha_vencimiento', 'fecha_pago'])
const amountFields = new Set(['limite_credito', 'monto_neto', 'impuesto', 'monto_total', 'monto'])
const optional = new Set(['contacto_nombre', 'contacto_email', 'contacto_telefono', 'documento_referencia', 'observacion', 'fecha_pago'])
const pgMax = 9223372036854775807n
const pgMin = -9223372036854775808n

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function integer(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null
  const result = BigInt(value)
  return result >= pgMin && result <= pgMax ? result.toString() : null
}

export function parseCsv(text, spec) {
  const issues = []
  const rows = []
  let header
  let record = 0
  Papa.parse(text.replace(/^\uFEFF/, ''), {
    delimiter: ',',
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    step(result, parser) {
      record++
      const issue = (field, message) => issues.push({ file: spec.name, row: record, field, message })
      if (result.errors.length) issue('', 'CSV mal formado: revisa comillas y separadores.')
      if (!header) {
        header = result.data.map(value => value.trim())
        if (new Set(header).size !== header.length || header.length !== spec.columns.length || spec.columns.some(column => !header.includes(column))) {
          issue('', `Las columnas deben ser: ${spec.columns.join(', ')}.`)
        }
      } else if (rows.length >= MAX_FILE_ROWS) {
        issue('', `Máximo ${MAX_FILE_ROWS} registros por archivo.`)
        parser.abort()
      } else {
        if (result.data.length !== header.length) issue('', 'La cantidad de campos no coincide con el encabezado.')
        const row = {}
        for (let index = 0; index < header.length; index++) {
          const field = header[index]
          const value = (result.data[index] ?? '').trim()
          if (value.length > 4000 || value.includes('\0')) issue(field, 'El campo supera el largo permitido o contiene caracteres inválidos.')
          const optionalDue = field === 'fecha_vencimiento' && spec.table === 'documentos'
          if (!value && !optionalDue && (!optional.has(field) || (field === 'fecha_pago' && spec.table === 'pagos'))) issue(field, 'Este campo es obligatorio.')
          if (dateFields.has(field) && value && !validDate(value)) issue(field, 'Usa una fecha válida AAAA-MM-DD.')
          if (amountFields.has(field)) {
            row[field] = integer(value)
            if (row[field] === null) issue(field, 'Usa un monto entero, sin separadores ni decimales, dentro del rango bigint.')
          } else if (field === 'dias_credito') {
            row[field] = Number(value)
            if (!/^\d+$/.test(value) || !Number.isSafeInteger(row[field]) || row[field] > 2147483647) issue(field, 'Usa una cantidad de días entera y no negativa.')
          } else if (field === 'en_disputa') {
            if (!['si', 'no'].includes(value)) issue(field, 'Usa si o no.')
            row[field] = value === 'si'
          } else {
            row[field] = value || null
          }
        }
        Object.defineProperty(row, '_row', { value: record })
        rows.push(row)
      }
      if (issues.length >= 30 || (record === 1 && issues.length)) parser.abort()
    },
  })
  if (!header) issues.push({ file: spec.name, row: 1, field: '', message: 'El archivo debe incluir el encabezado.' })
  if (issues.length) throw new ImportValidationError(issues)
  return rows
}

// Complete-snapshot reconciliation. All money remains decimal strings/BigInt.
export function prepareImport(texts, cutoff, bankValue) {
  if (!validDate(cutoff) || integer(bankValue) === null) {
    throw new ImportValidationError([{ file: '', row: null, field: 'fecha_corte / saldo_banco', message: 'Indica una fecha válida y un saldo entero sin separadores.' }])
  }
  const data = Object.fromEntries(IMPORT_FILES.map(spec => [spec.table, parseCsv(texts[spec.key], spec)]))
  if (Object.values(data).reduce((sum, rows) => sum + rows.length, 0) > MAX_TOTAL_ROWS) {
    throw new ImportValidationError([{ file: '', row: null, field: '', message: `Máximo ${MAX_TOTAL_ROWS} registros en total.` }])
  }
  const issues = []
  const issue = (file, row, field, message) => {
    if (issues.length < 30) issues.push({ file, row: row._row, field, message })
  }
  const stop = () => { if (issues.length) throw new ImportValidationError(issues) }
  const maps = {}
  for (const spec of IMPORT_FILES) {
    maps[spec.table] = new Map()
    for (const row of data[spec.table]) {
      if (maps[spec.table].has(row[spec.id])) issue(spec.name, row, spec.id, 'Identificador duplicado.')
      maps[spec.table].set(row[spec.id], row)
    }
  }
  stop()
  for (const row of data.clientes) {
    if (BigInt(row.limite_credito) < 0n) issue('clientes.csv', row, 'limite_credito', 'El límite no puede ser negativo.')
    if (row.fecha_alta > cutoff) issue('clientes.csv', row, 'fecha_alta', 'La fecha es posterior al corte.')
  }
  const balances = new Map()
  for (const row of data.documentos) {
    const problem = (field, message) => issue('facturas.csv', row, field, message)
    if (!maps.clientes.has(row.id_cliente)) problem('id_cliente', 'El cliente no existe en clientes.csv.')
    if (!['factura', 'nota_credito'].includes(row.tipo)) problem('tipo', 'Usa factura o nota_credito.')
    if (row.fecha_emision > cutoff) problem('fecha_emision', 'La fecha es posterior al corte.')
    if (row.fecha_vencimiento < row.fecha_emision) problem('fecha_vencimiento', 'El vencimiento es anterior a la emisión.')
    if (BigInt(row.monto_neto) + BigInt(row.impuesto) !== BigInt(row.monto_total)) problem('monto_total', 'Debe ser igual a monto_neto + impuesto.')
    if (row.tipo === 'factura') {
      if (!row.fecha_vencimiento) problem('fecha_vencimiento', 'Las facturas requieren fecha de vencimiento.')
      if (BigInt(row.monto_total) <= 0n || BigInt(row.monto_neto) < 0n || BigInt(row.impuesto) < 0n) problem('monto_total', 'La factura debe tener monto positivo y componentes no negativos.')
      balances.set(row.id_documento, BigInt(row.monto_total))
    } else if (BigInt(row.monto_total) >= 0n || BigInt(row.monto_neto) > 0n || BigInt(row.impuesto) > 0n) {
      problem('monto_total', 'La nota de crédito debe tener monto negativo y componentes no positivos.')
    }
    if (row.tipo === 'nota_credito' && !row.documento_referencia) problem('documento_referencia', 'La nota de crédito debe referenciar una factura.')
    if (row.documento_referencia) {
      const target = maps.documentos.get(row.documento_referencia)
      if (!target || target.tipo !== 'factura' || target.id_cliente !== row.id_cliente || target.id_documento === row.id_documento) {
        problem('documento_referencia', 'Debe referenciar otra factura del mismo cliente.')
      } else if (target.fecha_emision > row.fecha_emision) {
        problem('documento_referencia', 'El documento referenciado se emitió después de este documento.')
      }
    }
  }
  stop()
  const visited = new Set()
  for (const row of data.documentos) {
    const path = new Set()
    let current = row
    while (current && !visited.has(current.id_documento)) {
      if (path.has(current.id_documento)) { issue('facturas.csv', row, 'documento_referencia', 'Las referencias forman un ciclo.'); break }
      path.add(current.id_documento)
      current = maps.documentos.get(current.documento_referencia)
    }
    for (const id of path) visited.add(id)
    if (row.tipo === 'nota_credito') balances.set(row.documento_referencia, balances.get(row.documento_referencia) + BigInt(row.monto_total))
  }
  stop()
  data.aplicaciones_pago = []
  for (const row of [...data.pagos].sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago) || a.id_pago.localeCompare(b.id_pago))) {
    const problem = (field, message) => issue('pagos.csv', row, field, message)
    const refs = row.facturas_referencia.split(',').map(value => value.trim())
    if (!maps.clientes.has(row.id_cliente)) problem('id_cliente', 'El cliente no existe en clientes.csv.')
    if (row.fecha_pago > cutoff) problem('fecha_pago', 'La fecha es posterior al corte.')
    if (BigInt(row.monto) <= 0n) problem('monto', 'El pago debe ser positivo.')
    if (new Set(refs).size !== refs.length) problem('facturas_referencia', 'Una factura aparece más de una vez en el mismo pago.')
    const validRefs = refs.every(id => {
      const invoice = maps.documentos.get(id)
      return invoice?.tipo === 'factura' && invoice.id_cliente === row.id_cliente && invoice.fecha_emision <= row.fecha_pago
    })
    if (!validRefs) { problem('facturas_referencia', 'Cada referencia debe ser una factura emitida del mismo cliente.'); continue }
    if (refs.length > 1 && (refs.some(id => balances.get(id) <= 0n) || refs.reduce((sum, id) => sum + balances.get(id), 0n) !== BigInt(row.monto))) {
      problem('monto', 'El pago de varias facturas debe cubrir exactamente todos sus saldos pendientes.'); continue
    }
    for (const id of refs) {
      const amount = refs.length === 1 ? BigInt(row.monto) : balances.get(id)
      balances.set(id, balances.get(id) - amount)
      data.aplicaciones_pago.push({ id_pago: row.id_pago, id_documento: id, id_cliente: row.id_cliente, monto_aplicado: amount.toString() })
    }
  }
  for (const [id, amount] of balances) {
    if (amount < 0n) issue('facturas.csv', maps.documentos.get(id), 'monto_total', 'Los pagos y notas de crédito superan el monto de la factura.')
  }
  for (const row of data.obligaciones) {
    const problem = (field, message) => issue('obligaciones.csv', row, field, message)
    if (!['proveedor', 'sueldos', 'arriendo', 'impuestos', 'servicios', 'credito_bancario'].includes(row.tipo)) problem('tipo', 'Tipo de obligación no reconocido.')
    if (!['pagada', 'pendiente'].includes(row.estado)) problem('estado', 'Usa pagada o pendiente.')
    if (BigInt(row.monto) <= 0n) problem('monto', 'La obligación debe ser positiva.')
    if (row.estado === 'pagada' && (!row.fecha_pago || row.fecha_pago > cutoff)) problem('fecha_pago', 'Las obligaciones pagadas requieren una fecha de pago no posterior al corte.')
    if (row.estado === 'pendiente' && row.fecha_pago) problem('fecha_pago', 'Las obligaciones pendientes no deben tener fecha de pago.')
  }
  stop()
  return { data, cutoff, bank: integer(bankValue) }
}
