import { HttpError, withAuthenticatedUser } from './action.js'

const schemaErrors = new Set(['42P01', '42703', '42883', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'])

export function databaseError(error) {
  if (schemaErrors.has(error.code)) {
    return new HttpError(503, 'DATABASE_NOT_READY', 'La base de datos necesita la configuración de esta fase. Contacta al administrador.')
  }
  return new HttpError(503, 'DATA_UNAVAILABLE', 'No pudimos consultar los datos. Intenta nuevamente.')
}

export function withAuthorizedUser(handler) {
  return withAuthenticatedUser(async context => {
    const { data, error } = await context.supabase
      .from('usuarios_autorizados')
      .select('user_id')
      .eq('user_id', context.user.id)
      .maybeSingle()

    if (error) throw databaseError(error)
    if (!data) {
      throw new HttpError(403, 'ACCESS_DENIED', 'Tu cuenta no tiene acceso a Nortia. Solicita autorización al administrador.')
    }
    return handler(context)
  })
}
