import { useCallback, useEffect, useState } from 'react'
import { ApiError, getJson } from '../../lib/api.js'
import { isDashboardPayload } from '../../../shared/dashboard-contract.js'

export function useDashboard(onSessionExpired) {
  const [state, setState] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await getJson('/api/dashboard', controller.signal)
        if (!isDashboardPayload(data)) {
          throw new ApiError(502, 'INVALID_DATA', 'Los datos recibidos no son válidos. Contacta al administrador.')
        }
        if (!controller.signal.aborted) setState({ status: 'ready', data })
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) {
          onSessionExpired()
          return
        }
        setState({
          status: error.status === 403 ? 'forbidden' : 'error',
          message: error instanceof ApiError ? error.message : 'No pudimos cargar los datos. Revisa tu conexión e intenta nuevamente.',
          requestId: error.requestId,
        })
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt, onSessionExpired])

  return { ...state, retry }
}
