import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import { readSupabaseConfig } from '../../../shared/supabase-config.js'

// One client per HTTP request. Sharing a client can leak sessions between users.
export function createSupabaseServerClient(request, env) {
  const { url, key } = readSupabaseConfig(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY)
  const cookies = new Map(parseCookieHeader(request.headers.get('Cookie') ?? '').map(
    ({ name, value }) => [name, value ?? ''],
  ))
  const pendingCookies = new Map()
  const authHeaders = new Headers({ 'Cache-Control': 'private, no-store' })

  const supabase = createServerClient(url, key, {
    cookieOptions: { path: '/', sameSite: 'lax', secure: new URL(request.url).protocol === 'https:' },
    global: {
      fetch: (input, init = {}) => fetch(input, {
        ...init,
        signal: AbortSignal.any([init.signal, request.signal, AbortSignal.timeout(8000)].filter(Boolean)),
      }),
    },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll(cookiesToSet, cacheHeaders) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value)
          pendingCookies.set(name, serializeCookieHeader(name, value, options))
        }
        // Newer @supabase/ssr versions supply cache headers on token refresh.
        for (const [name, value] of Object.entries(cacheHeaders ?? {})) {
          authHeaders.set(name, value)
        }
      },
    },
  })

  function finalizeResponse(response) {
    const headers = new Headers(response.headers)
    for (const [name, value] of authHeaders) headers.set(name, value)
    for (const cookie of pendingCookies.values()) headers.append('Set-Cookie', cookie)
    headers.set('Cache-Control', 'private, no-store')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }

  return { supabase, finalizeResponse }
}
