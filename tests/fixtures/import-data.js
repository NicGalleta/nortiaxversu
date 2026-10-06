import Papa from 'papaparse'
import { IMPORT_FILES } from '../../shared/import-contract.js'

export function sourceRows() {
  return {
    clientes: [{ id_cliente: 'C1', razon_social: 'Cliente, Uno', id_tributario: '123-4', segmento: 'Taller', ciudad: 'Santiago', contacto_nombre: '', contacto_email: '', contacto_telefono: '', dias_credito: '30', ejecutivo_comercial: 'Equipo', fecha_alta: '2025-01-01', limite_credito: '10000' }],
    documentos: [
      { id_documento: 'F1', tipo: 'factura', id_cliente: 'C1', fecha_emision: '2026-09-01', fecha_vencimiento: '2026-09-15', monto_neto: '1000', impuesto: '0', monto_total: '1000', documento_referencia: '', en_disputa: 'si', observacion: 'Detalle con coma, y\nsegunda línea' },
      { id_documento: 'F2', tipo: 'factura', id_cliente: 'C1', fecha_emision: '2026-09-02', fecha_vencimiento: '2026-09-27', monto_neto: '2000', impuesto: '0', monto_total: '2000', documento_referencia: 'F1', en_disputa: 'no', observacion: '' },
      { id_documento: 'NC1', tipo: 'nota_credito', id_cliente: 'C1', fecha_emision: '2026-09-03', fecha_vencimiento: '', monto_neto: '-100', impuesto: '0', monto_total: '-100', documento_referencia: 'F1', en_disputa: 'no', observacion: '' },
    ],
    pagos: [
      { id_pago: 'P1', id_cliente: 'C1', fecha_pago: '2026-09-04', monto: '100', medio_pago: 'transferencia', facturas_referencia: 'F1' },
      { id_pago: 'P2', id_cliente: 'C1', fecha_pago: '2026-09-05', monto: '2800', medio_pago: 'transferencia', facturas_referencia: 'F1, F2' },
    ],
    obligaciones: [{ id_obligacion: 'O1', tipo: 'proveedor', acreedor: 'Proveedor Uno', descripcion: 'Materiales', fecha_vencimiento: '2026-09-28', monto: '1200', estado: 'pendiente', fecha_pago: '' }],
  }
}
export function sourceCsv(rows = sourceRows()) {
  return Object.fromEntries(IMPORT_FILES.map(spec => [spec.key, Papa.unparse({ fields: spec.columns, data: rows[spec.table].map(row => spec.columns.map(field => row[field] ?? '')) })]))
}
export function importForm(rows = sourceRows()) {
  const csv = sourceCsv(rows)
  const form = new FormData()
  for (const spec of IMPORT_FILES) form.append(spec.key, new File([csv[spec.key]], spec.name, { type: 'text/csv' }))
  form.append('fecha_corte', '2026-09-27')
  form.append('saldo_banco', '1000')
  return form
}
