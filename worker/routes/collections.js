import { withAuthorizedUser, databaseError } from '../lib/supabase/authorization.js'
import { HttpError } from '../lib/supabase/action.js'
import { UUID_PATTERN } from '../../shared/import-contract.js'
import { prepareCollections, validCustomerDetail } from '../collections/prepare.js'

function checkError(error) {
  if (!error) return
  if (error.code === '42501') throw new HttpError(403, 'ACCESS_DENIED', 'No tienes permiso para consultar estos datos.')
  if (error.code === '40001') throw new HttpError(409, 'SNAPSHOT_CHANGED', 'Cambió la importación activa. Actualiza la lista de clientes.')
  if (error.code === 'P0002') throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'No encontramos este cliente en la importación activa.')
  if (error.code === '22000') throw new HttpError(422, 'DATA_INTEGRITY_ERROR', 'Los saldos de la importación necesitan revisión.')
  throw databaseError(error)
}
const invalidData = () => new HttpError(502, 'INVALID_DATA', 'Los datos de cobranza no cuadran. Contacta al administrador.')

export const getCollections = withAuthorizedUser(async ({ supabase }) => {
  const { data, error } = await supabase.rpc('nortia_cobranza_v1')
  checkError(error)
  let result
  try { result = prepareCollections(data) } catch { throw invalidData() }
  return Response.json(result)
})
export const getCustomer = withAuthorizedUser(async ({ supabase, request }) => {
  const params = new URL(request.url).searchParams
  const customer = params.get('customer'), snapshot = params.get('snapshot')
  if (!customer || customer.length > 4000 || !UUID_PATTERN.test(snapshot ?? '') || params.getAll('customer').length !== 1 || params.getAll('snapshot').length !== 1) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Selecciona un cliente y una importación válidos.')
  }
  const { data, error } = await supabase.rpc('nortia_cliente_v1', { p_importacion: snapshot, p_cliente: customer })
  checkError(error)
  if (!validCustomerDetail(data) || data.customer.id_cliente !== customer || data.snapshot.id !== snapshot) throw invalidData()
  return Response.json(data)
})
