export function forecastInput({ invoices = [], obligations = [], profiles = [], bank = '100', cutoff = '2026-09-27' } = {}) {
  const sum = rows => rows.reduce((value, row) => value + BigInt(row.amount ?? row.monto), 0n).toString()
  const near = obligations.filter(row => Date.parse(row.fecha_vencimiento) <= Date.parse(cutoff) + 7 * 86400000)
  return {
    dashboard: {
      snapshot: { id: '00000000-0000-4000-8000-000000000001', fecha_corte: cutoff, saldo_banco: bank },
      summary: { por_cobrar: sum(invoices), vencido: sum(invoices.filter(row => row.due < cutoff)), en_disputa: sum(invoices.filter(row => row.disputed)), facturas_pendientes: invoices.length, facturas_vencidas: invoices.filter(row => row.due < cutoff).length, obligaciones_7_dias: sum(near), saldo_sin_cobros_7_dias: (BigInt(bank) - BigInt(sum(near))).toString() },
      obligations,
    }, invoices, profiles,
  }
}
export const invoice = (options = {}) => ({ id: 'F1', customer: 'C1', segment: 'taller', due: '2026-09-28', amount: '200', disputed: false, ...options })
export const obligation = (options = {}) => ({ id_obligacion: 'O1', tipo: 'proveedor', acreedor: 'Proveedor', descripcion: null, fecha_vencimiento: '2026-09-28', monto: '150', ...options })
export const profile = (options = {}) => ({ scope: 'customer', key: 'C1', samples: 5, p50: 0, p80: 0, ...options })
