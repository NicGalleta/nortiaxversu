import { withAuthorizedUser, databaseError } from '../lib/supabase/authorization.js'
import { HttpError } from '../lib/supabase/action.js'
import { isDashboardPayload } from '../../shared/dashboard-contract.js'

export const getDashboard = withAuthorizedUser(async ({ supabase }) => {
  // One RPC reads a single consistent database snapshot, even during activation.
  const { data, error } = await supabase.rpc('nortia_dashboard_v1')
  if (error) {
    if (error.code === '22000') {
      throw new HttpError(422, 'DATA_INTEGRITY_ERROR', 'La importación activa tiene saldos inconsistentes. Solicita revisar la conciliación antes de usar estos datos.')
    }
    if (error.code === '42501') {
      throw new HttpError(403, 'ACCESS_DENIED', 'No tienes permiso para consultar estos datos.')
    }
    throw databaseError(error)
  }
  if (!isDashboardPayload(data)) {
    throw new HttpError(502, 'INVALID_DATA', 'La consulta devolvió datos inesperados. Contacta al administrador.')
  }
  return Response.json(data)
})
