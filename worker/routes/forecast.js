import { withAuthorizedUser, databaseError } from '../lib/supabase/authorization.js'
import { HttpError } from '../lib/supabase/action.js'
import { projectForecast, validForecastInput } from '../forecast/project.js'

export const getForecast = withAuthorizedUser(async ({ supabase }) => {
  const { data, error } = await supabase.rpc('nortia_forecast_v1')
  if (error?.code === '42501') throw new HttpError(403, 'ACCESS_DENIED', 'No tienes permiso para consultar estos datos.')
  if (error?.code === '22000') throw new HttpError(422, 'DATA_INTEGRITY_ERROR', 'La importación activa tiene saldos inconsistentes. Revisa la conciliación.')
  if (error) throw databaseError(error)
  if (!validForecastInput(data)) throw new HttpError(502, 'INVALID_DATA', 'Los datos de la proyección no cuadran con la caja. Contacta al administrador.')
  return Response.json(projectForecast(data))
})
