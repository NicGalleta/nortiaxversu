import { withAuthorizedUser, databaseError } from '../lib/supabase/authorization.js'
import { createImportAdminClient } from '../lib/supabase/admin.js'
import { HttpError } from '../lib/supabase/action.js'
import { IMPORT_BUCKET, UUID_PATTERN } from '../../shared/import-contract.js'
import { prepareImport } from '../imports/parse.js'
import { readBoundedBody, readImportForm, sha256 } from '../imports/request.js'

function importDatabaseError(error) {
  if (error.code === '42501') return new HttpError(403, 'ACCESS_DENIED', 'Tu cuenta ya no tiene permiso para importar datos.')
  if (error.code === '55P03') return new HttpError(409, 'IMPORT_BUSY', 'Estos archivos ya se están procesando. Consulta el historial; una carga interrumpida se puede reintentar después de 15 minutos.')
  if (error.code === '40001' || error.code === '22023') return new HttpError(409, 'IMPORT_CONFLICT', 'La importación o la caja activa cambió. Actualiza el historial y revisa la vista previa antes de continuar.')
  if (error.code === '22000' || error.code?.startsWith('23')) return new HttpError(422, 'IMPORT_REJECTED', 'La base de datos rechazó la conciliación o los datos. La caja activa no cambió; revisa el esquema y los archivos con el administrador.')
  return databaseError(error)
}

export const getImports = withAuthorizedUser(async ({ request, supabase }) => {
  const id = new URL(request.url).searchParams.get('id')
  if (id && !UUID_PATTERN.test(id)) throw new HttpError(400, 'INVALID_REQUEST', 'Identificador de importación inválido.')
  const { data, error } = await supabase.rpc('nortia_listar_cargas_v1', { p_id: id })
  if (error) throw importDatabaseError(error)
  return Response.json(data)
})

export const uploadImport = withAuthorizedUser(async ({ request, env, user }) => {
  const admin = createImportAdminClient(env)
  const input = await readImportForm(request)
  const prepared = prepareImport(input.texts, input.cutoff, input.bank)
  const hashes = await Promise.all(input.files.map(file => sha256(file.bytes)))
  const fingerprint = await sha256(JSON.stringify({ version: 1, cutoff: prepared.cutoff, bank: prepared.bank, files: hashes }))
  const { data: attempt, error: beginError } = await admin.rpc('nortia_iniciar_carga_v1', {
    p_actor: user.id, p_huella: fingerprint, p_fecha: prepared.cutoff, p_saldo: prepared.bank,
  })
  if (beginError) throw importDatabaseError(beginError)
  if (attempt.reutilizada) return Response.json(attempt)

  try {
    const archives = input.files.map((file, index) => ({
      nombre: file.spec.name, nombre_original: file.originalName,
      ruta: `${attempt.id}/${attempt.intento_id}/${file.spec.name}`,
      sha256: hashes[index], bytes: file.bytes.byteLength, filas: prepared.data[file.spec.table].length,
    }))
    // Independent uploads finish before recording a transactional data snapshot.
    const uploads = await Promise.allSettled(input.files.map((file, index) =>
      admin.storage.from(IMPORT_BUCKET).upload(archives[index].ruta, file.bytes, { contentType: 'text/csv', upsert: false }),
    ))
    if (uploads.some(result => result.status === 'rejected' || result.value.error)) {
      throw new HttpError(503, 'ARCHIVE_FAILED', 'No pudimos guardar los archivos originales. Revisa el bucket privado y vuelve a intentar.')
    }
    const { data, error } = await admin.rpc('nortia_preparar_carga_v1', {
      p_actor: user.id, p_id: attempt.id, p_intento: attempt.intento_id, p_datos: prepared.data, p_archivos: archives,
    })
    if (error) throw importDatabaseError(error)
    return Response.json(data, { status: 201 })
  } catch (error) {
    // Conditional failure marking cannot undo a stage whose commit succeeded but
    // whose HTTP response was lost. Retain originals for diagnosis in either case.
    try {
      const result = await admin.rpc('nortia_fallar_carga_v1', {
        p_id: attempt.id, p_intento: attempt.intento_id,
        p_codigo: error instanceof HttpError ? error.code : 'UPLOAD_INTERRUPTED',
      })
      if (result.error) console.error(JSON.stringify({ event: 'import_failure_record_failed', importId: attempt.id }))
    } catch { console.error(JSON.stringify({ event: 'import_failure_record_failed', importId: attempt.id })) }
    throw error
  }
})

export const activateImport = withAuthorizedUser(async ({ request, env, user }) => {
  const id = new URL(request.url).pathname.split('/')[3]
  if (!UUID_PATTERN.test(id)) throw new HttpError(400, 'INVALID_REQUEST', 'Identificador de importación inválido.')
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'INVALID_CONTENT_TYPE', 'Se requiere una solicitud JSON.')
  let body
  try { body = JSON.parse(await (await readBoundedBody(request, 2048)).text()) }
  catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'INVALID_REQUEST', 'La solicitud JSON no es válida.')
  }
  if (!body || !Object.hasOwn(body, 'active_id') || !(body.active_id === null || UUID_PATTERN.test(body.active_id))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Revisa la caja activa antes de activar esta importación.')
  }
  const { data, error } = await createImportAdminClient(env).rpc('nortia_activar_carga_v1', {
    p_actor: user.id, p_id: id, p_activa_esperada: body.active_id,
  })
  if (error) throw importDatabaseError(error)
  return Response.json(data)
})
