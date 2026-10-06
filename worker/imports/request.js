import { IMPORT_FILES, MAX_BODY_BYTES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from '../../shared/import-contract.js'
import { HttpError } from '../lib/supabase/action.js'
import { ImportValidationError } from './parse.js'

export async function readBoundedBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) throw new HttpError(413, 'IMPORT_TOO_LARGE', 'La solicitud supera el tamaño permitido.')
  if (!request.body) throw new HttpError(400, 'INVALID_REQUEST', 'La solicitud no contiene datos.')
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new HttpError(413, 'IMPORT_TOO_LARGE', 'La solicitud supera el tamaño permitido.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return new Blob(chunks)
}

export async function readImportForm(request) {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.startsWith('multipart/form-data;')) throw new HttpError(415, 'INVALID_CONTENT_TYPE', 'Envía los cuatro archivos CSV mediante el formulario.')
  const body = await readBoundedBody(request, MAX_BODY_BYTES)
  let form
  try { form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData() }
  catch { throw new HttpError(400, 'INVALID_REQUEST', 'No pudimos leer los archivos adjuntos.') }
  const expected = [...IMPORT_FILES.map(file => file.key), 'fecha_corte', 'saldo_banco']
  if ([...form.keys()].some(key => !expected.includes(key)) || expected.some(key => form.getAll(key).length !== 1)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Incluye exactamente los cuatro archivos, la fecha de corte y el saldo en banco.')
  }
  let total = 0
  const files = []
  const texts = {}
  for (const spec of IMPORT_FILES) {
    const file = form.get(spec.key)
    if (typeof file === 'string' || !file.name.toLowerCase().endsWith('.csv') || !file.size || file.size > MAX_FILE_BYTES) {
      throw new ImportValidationError([{ file: spec.name, row: null, field: '', message: 'Selecciona un archivo .csv no vacío de hasta 4 MiB.' }])
    }
    total += file.size
    if (total > MAX_TOTAL_BYTES) throw new HttpError(413, 'IMPORT_TOO_LARGE', 'Los cuatro archivos no pueden superar 8 MiB en total.')
    const bytes = await file.arrayBuffer()
    try { texts[spec.key] = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { throw new ImportValidationError([{ file: spec.name, row: null, field: '', message: 'Guarda el CSV con codificación UTF-8.' }]) }
    files.push({ spec, bytes, originalName: file.name.slice(0, 200) })
  }
  if (typeof form.get('fecha_corte') !== 'string' || typeof form.get('saldo_banco') !== 'string') {
    throw new HttpError(400, 'INVALID_REQUEST', 'La fecha y el saldo deben ser campos de texto.')
  }
  return { files, texts, cutoff: form.get('fecha_corte').trim(), bank: form.get('saldo_banco').trim() }
}

export async function sha256(input) {
  const buffer = typeof input === 'string' ? new TextEncoder().encode(input) : input
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), value => value.toString(16).padStart(2, '0')).join('')
}
