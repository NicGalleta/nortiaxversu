export const buttonClass = 'rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800'
export function QueryFeedback({ state, onRefresh }) {
  if (state.status === 'loading') return <p role="status" className="rounded-xl border border-stone-200 bg-white p-8 text-stone-600">Cargando cobranza…</p>
  return <div role="alert" className="rounded-xl border border-red-200 bg-white p-8">
    <p>{state.message}</p>{state.requestId && <p className="mt-2 text-xs text-stone-500">Referencia: {state.requestId}</p>}
    <button className={`${buttonClass} mt-4`} onClick={state.code === 'SNAPSHOT_CHANGED' ? onRefresh : state.retry}>{state.code === 'SNAPSHOT_CHANGED' ? 'Actualizar lista de clientes' : 'Volver a intentar'}</button>
  </div>
}
