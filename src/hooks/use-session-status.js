import { useCallback, useEffect, useState } from 'react'
import { SupabaseConfigurationError } from '../../shared/supabase-config.js'
import { getSupabaseBrowserClient } from '../lib/supabase/browser.js'

export function useSessionStatus() {
  const [state, setState] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let subscription

    async function checkSession() {
      try {
        const supabase = getSupabaseBrowserClient()
        subscription = supabase.auth.onAuthStateChange(event => {
          if (event !== 'INITIAL_SESSION') retry()
        }).data.subscription

        const response = await fetch('/api/session', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        })
        const body = await response.json()
        if (controller.signal.aborted) return

        if (response.status === 401) {
          setState({ status: 'empty' })
        } else if (!response.ok) {
          setState({
            status: body.error?.code === 'SUPABASE_NOT_CONFIGURED' ? 'configuration' : 'error',
            message: body.error?.message ?? 'No pudimos verificar la sesión.',
            requestId: body.error?.requestId,
          })
        } else if (typeof body.user?.id === 'string') {
          setState({ status: 'ready', user: body.user })
        } else {
          setState({ status: 'error', message: 'El servidor devolvió una respuesta inesperada.' })
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          status: error instanceof SupabaseConfigurationError ? 'configuration' : 'error',
          message: error instanceof SupabaseConfigurationError
            ? error.message
            : 'No pudimos conectar con el servidor. Revisa la conexión e intenta nuevamente.',
        })
      }
    }

    void checkSession()
    return () => {
      controller.abort()
      subscription?.unsubscribe()
    }
  }, [attempt, retry])

  return { ...state, retry }
}
