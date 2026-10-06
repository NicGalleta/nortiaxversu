import { isAuthSessionMissingError } from '@supabase/supabase-js'
import { SupabaseConfigurationError } from '../../../shared/supabase-config.js'
import { createSupabaseServerClient } from './server.js'

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Plain React/Vite has no Next.js Server Actions. This wraps Worker handlers.
// It verifies identity; financial handlers must also enforce app authorization/RLS.
export function withAuthenticatedUser(handler) {
  return async function authenticatedHandler(request, env) {
    let context
    const requestId = crypto.randomUUID()
    let response

    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          request.headers.get('Origin') !== new URL(request.url).origin) {
        throw new HttpError(403, 'INVALID_ORIGIN', 'El origen de la solicitud no está permitido.')
      }
      context = createSupabaseServerClient(request, env)
      const { data, error } = await context.supabase.auth.getUser()

      if (error) {
        if (isAuthSessionMissingError(error) || [400, 401, 403].includes(error.status)) {
          throw new HttpError(401, 'UNAUTHENTICATED', 'No hay una sesión válida. Inicia sesión para continuar.')
        }
        throw new HttpError(503, 'AUTH_UNAVAILABLE', 'No pudimos verificar la sesión. Intenta nuevamente.')
      }
      if (!data.user) {
        throw new HttpError(401, 'UNAUTHENTICATED', 'No hay una sesión activa.')
      }

      response = await handler({ request, env, requestId, supabase: context.supabase, user: data.user })
    } catch (error) {
      const configurationError = error instanceof SupabaseConfigurationError
      const status = error instanceof HttpError ? error.status : configurationError ? 503 : 500
      const code = error instanceof HttpError ? error.code : configurationError ? 'SUPABASE_NOT_CONFIGURED' : 'INTERNAL_ERROR'
      const message = error instanceof HttpError ? error.message : configurationError
        ? 'Falta configurar Supabase en el servidor.'
        : 'Ocurrió un error inesperado. Intenta nuevamente.'

      // No tokens, cookie contents, API keys, or provider error payloads in logs.
      if (status >= 500) console.error(JSON.stringify({ event: 'api_error', requestId, code, status }))
      response = Response.json({ error: { code, message, requestId,
        ...(error instanceof HttpError && error.details ? { details: error.details } : {}),
      } }, { status })
    }

    // Redirects and upstream fetch responses may have immutable headers.
    // Clone first, preserving refreshed/cleared cookies even on error responses.
    response = context ? context.finalizeResponse(response) : new Response(response.body, response)
    response.headers.set('X-Request-Id', requestId)
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    return response
  }
}
