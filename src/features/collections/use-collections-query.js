import { useCallback, useEffect, useState } from 'react'
import { getJson, ApiError } from '../../lib/api.js'

export function useCollectionsQuery(path, onSessionExpired) {
  const [state, setState] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setState({ status: 'loading' }); setAttempt(value => value + 1) }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await getJson(path, controller.signal)
        if (!controller.signal.aborted) setState({ status: 'ready', data })
      } catch (error) {
        if (controller.signal.aborted) return
        if (error.status === 401) { onSessionExpired(); return }
        setState({ status: 'error', message: error instanceof ApiError ? error.message : 'No pudimos cargar los datos. Revisa la conexión.', requestId: error.requestId, code: error.code })
      }
    }
    void load()
    return () => controller.abort()
  }, [path, attempt, onSessionExpired])
  return { ...state, retry }
}
