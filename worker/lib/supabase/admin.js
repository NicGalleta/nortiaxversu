import { createClient } from '@supabase/supabase-js'
import { HttpError } from './action.js'
import { readSupabaseConfig } from '../../../shared/supabase-config.js'

// Never import this module into src/. This client never receives user cookies.
export function createImportAdminClient(env) {
  const { url } = readSupabaseConfig(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY)
  const key = env.SUPABASE_SECRET_KEY?.trim()
  let legacyServiceKey = false
  try {
    legacyServiceKey = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'
  } catch { /* Modern secret keys are opaque, not JWTs. */ }
  if (!key || key.includes('replace_me') || (!key.startsWith('sb_secret_') && !legacyServiceKey)) {
    throw new HttpError(503, 'IMPORT_NOT_CONFIGURED', 'Falta configurar la clave de importaciones en el servidor. Contacta al administrador.')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init = {}) => fetch(input, {
      ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(45000)].filter(Boolean)),
    }) },
  })
}
