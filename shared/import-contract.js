export const IMPORT_FILES = [
  { key: 'clientes', name: 'clientes.csv', table: 'clientes', id: 'id_cliente', columns: ['id_cliente', 'razon_social', 'id_tributario', 'segmento', 'ciudad', 'contacto_nombre', 'contacto_email', 'contacto_telefono', 'dias_credito', 'ejecutivo_comercial', 'fecha_alta', 'limite_credito'] },
  { key: 'facturas', name: 'facturas.csv', table: 'documentos', id: 'id_documento', columns: ['id_documento', 'tipo', 'id_cliente', 'fecha_emision', 'fecha_vencimiento', 'monto_neto', 'impuesto', 'monto_total', 'documento_referencia', 'en_disputa', 'observacion'] },
  { key: 'pagos', name: 'pagos.csv', table: 'pagos', id: 'id_pago', columns: ['id_pago', 'id_cliente', 'fecha_pago', 'monto', 'medio_pago', 'facturas_referencia'] },
  { key: 'obligaciones', name: 'obligaciones.csv', table: 'obligaciones', id: 'id_obligacion', columns: ['id_obligacion', 'tipo', 'acreedor', 'descripcion', 'fecha_vencimiento', 'monto', 'estado', 'fecha_pago'] },
]

export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024
export const MAX_BODY_BYTES = MAX_TOTAL_BYTES + 64 * 1024
export const MAX_FILE_ROWS = 25000
export const MAX_TOTAL_ROWS = 50000
export const IMPORT_BUCKET = 'nortia-importaciones'
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
