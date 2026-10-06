import { createBrowserClient } from '@supabase/ssr'
import { readSupabaseConfig } from '../../../shared/supabase-config.js'

let client

export function getSupabaseBrowserClient() {
  if (!client) {
    const { url, key } = readSupabaseConfig(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    )
    client = createBrowserClient(url, key, {
      cookieOptions: { path: '/', sameSite: 'lax', secure: window.location.protocol === 'https:' },
      global: {
        fetch: (input, init = {}) => fetch(input, {
          ...init,
          signal: AbortSignal.any([init.signal, AbortSignal.timeout(10000)].filter(Boolean)),
        }),
      },
    })
  }
  return client
}
