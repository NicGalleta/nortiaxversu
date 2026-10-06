export class SupabaseConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SupabaseConfigurationError'
  }
}

// Shared validation only. Never import Worker modules into the frontend.
export function readSupabaseConfig(urlValue, keyValue) {
  const url = urlValue?.trim()
  const key = keyValue?.trim()

  if (!url || !key || url.includes('your-project') || key.includes('replace_me')) {
    throw new SupabaseConfigurationError('Falta configurar la URL y la clave pública de Supabase.')
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new SupabaseConfigurationError('La URL de Supabase no es válida.')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (
    !(parsed.protocol === 'https:' || (local && parsed.protocol === 'http:')) ||
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new SupabaseConfigurationError('Usa la URL base HTTPS de Supabase (HTTP solo en localhost).')
  }

  let isAnonKey = false
  try {
    const payload = key.split('.')[1]
    if (payload) {
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
      isAnonKey = JSON.parse(atob(base64)).role === 'anon'
    }
  } catch {
    // Not a legacy anon JWT. Validate the publishable-key format below.
  }
  if (!key.startsWith('sb_publishable_') && !isAnonKey) {
    throw new SupabaseConfigurationError('Usa una clave publishable o anon; nunca una clave secreta o service_role.')
  }

  return { url: parsed.origin, key }
}
