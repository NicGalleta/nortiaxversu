const isText = value => typeof value === 'string' && value.length > 0
const isAmount = value => typeof value === 'string' && /^-?\d+$/.test(value)
const isNonnegativeAmount = value => isAmount(value) && BigInt(value) >= 0n
const isCount = value => Number.isSafeInteger(value) && value >= 0
const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isDashboardPayload(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.obligations)) return false
  if (value.snapshot === null) return value.summary === null && value.obligations.length === 0
  const { snapshot, summary } = value
  if (!snapshot || !summary) return false
  if (!isText(snapshot.id) || !isDate(snapshot.fecha_corte) || !isAmount(snapshot.saldo_banco)) return false
  if (!['por_cobrar', 'vencido', 'en_disputa', 'obligaciones_7_dias'].every(key => isNonnegativeAmount(summary[key]))) return false
  if (!isAmount(summary.saldo_sin_cobros_7_dias) || !isCount(summary.facturas_pendientes) || !isCount(summary.facturas_vencidas)) return false
  if (BigInt(snapshot.saldo_banco) - BigInt(summary.obligaciones_7_dias) !== BigInt(summary.saldo_sin_cobros_7_dias)) return false
  if (BigInt(summary.vencido) > BigInt(summary.por_cobrar) || BigInt(summary.en_disputa) > BigInt(summary.por_cobrar)) return false
  if (summary.facturas_vencidas > summary.facturas_pendientes) return false
  const ids = new Set()
  return value.obligations.every(row => {
    if (!row || !isText(row.id_obligacion) || ids.has(row.id_obligacion)) return false
    ids.add(row.id_obligacion)
    return isText(row.tipo) && isText(row.acreedor) &&
      (row.descripcion === null || typeof row.descripcion === 'string') &&
      isDate(row.fecha_vencimiento) && isNonnegativeAmount(row.monto) && BigInt(row.monto) > 0n
  })
}
