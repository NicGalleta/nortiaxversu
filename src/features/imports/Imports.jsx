import { useCallback, useEffect, useRef, useState } from 'react'
import { IMPORT_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from '../../../shared/import-contract.js'
import { formatAmount, formatDate } from '../../../shared/format.js'
import { ApiError, getJson, requestJson } from '../../lib/api.js'

const button = 'rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:opacity-50'
const primary = 'rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:opacity-50'
const input = 'mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-stone-700 disabled:bg-stone-100'
const statuses = { cargando: 'Procesando', validada: 'Validada', fallida: 'Fallida' }

function ErrorNotice({ error }) {
  if (!error) return null
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900">
    <p>{error.message}</p>
    {error.requestId && <p className="mt-2 text-xs">Referencia: {error.requestId}</p>}
    {error.details?.length > 0 && <ul className="mt-3 max-h-64 list-disc space-y-1 overflow-auto pl-5">
      {error.details.map((detail, index) => <li key={index}>
        {detail.file}{detail.row ? ` · registro ${detail.row}` : ''}{detail.field ? ` · ${detail.field}` : ''}: {detail.message}
      </li>)}
    </ul>}
  </div>
}

export default function Imports({ onActivated, onSessionExpired }) {
  const [history, setHistory] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const [notice, setNotice] = useState('')
  const controller = useRef(null)
  const uploadController = useRef(null)

  const load = useCallback(async id => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    try {
      const data = await getJson(`/api/importaciones${id ? `?id=${encodeURIComponent(id)}` : ''}`, current.signal)
      if (current.signal.aborted) return
      if (!data || !Array.isArray(data.imports)) throw new Error('Invalid history')
      setHistoryError(null)
      setHistory(data)
      setSelected(data.selected ?? null)
    } catch (failure) {
      if (current.signal.aborted) return
      if (failure.status === 401) onSessionExpired()
      else setHistoryError({ message: failure instanceof ApiError ? failure.message : 'No pudimos cargar el historial. Intenta nuevamente.', requestId: failure.requestId })
    } finally { if (!current.signal.aborted) setLoading(false) }
  }, [onSessionExpired])

  function reload(id) {
    setLoading(true)
    setHistoryError(null)
    void load(id)
  }

  useEffect(() => {
    let mounted = true
    queueMicrotask(() => { if (mounted) void load() })
    return () => { mounted = false; controller.current?.abort(); uploadController.current?.abort() }
  }, [load])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setNotice('')
    const form = new FormData(event.currentTarget)
    const files = IMPORT_FILES.map(spec => form.get(spec.key))
    if (files.some(file => !file?.size || file.size > MAX_FILE_BYTES) || files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      setError({ message: 'Selecciona los cuatro CSV: hasta 4 MiB por archivo y 8 MiB en total.' })
      return
    }
    const current = new AbortController()
    uploadController.current = current
    setBusy('upload')
    setSelected(null)
    try {
      const result = await requestJson('/api/importaciones', { method: 'POST', body: form, timeout: 120000, signal: current.signal })
      if (current.signal.aborted) return
      setNotice(result.reutilizada ? 'Estos archivos ya estaban registrados. Revisa la importación existente.' : 'Archivos conciliados y guardados. Revisa la vista previa antes de activar.')
      await load(result.id)
    } catch (failure) {
      if (current.signal.aborted) return
      if (failure.status === 401) onSessionExpired()
      else {
        setError(failure instanceof ApiError ? failure : { message: 'La carga se interrumpió. Actualiza el historial antes de reintentar: puede haberse completado.' })
        await load()
      }
    } finally { if (!current.signal.aborted) setBusy('') }
  }

  async function activate() {
    if (busy || loading || !selected || historyError) return
    const current = new AbortController()
    uploadController.current = current
    setBusy('activate')
    setError(null)
    try {
      await requestJson(`/api/importaciones/${selected.id}/activar`, {
        method: 'POST', body: JSON.stringify({ active_id: history.active?.id ?? null }),
        headers: { 'Content-Type': 'application/json' }, timeout: 90000, signal: current.signal,
      })
      if (!current.signal.aborted) onActivated()
    } catch (failure) {
      if (current.signal.aborted) return
      if (failure.status === 401) onSessionExpired()
      else {
        setError(failure instanceof ApiError ? failure : { message: 'No recibimos la confirmación. Consulta el historial para comprobar si la importación quedó activa.' })
        setSelected(null)
        await load()
      }
    } finally { if (!current.signal.aborted) setBusy('') }
  }

  const report = selected?.resumen_validacion
  const older = selected && history?.active && selected.fecha_corte < history.active.fecha_corte

  return <div className="space-y-7">
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Datos del ERP</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Importaciones</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">Carga los cuatro archivos del mismo corte. Primero podrás revisar los resultados; la caja cambiará cuando actives la importación.</p>
    </div>
    <ErrorNotice error={error} />
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
    <form onSubmit={submit} className="rounded-xl border border-stone-200 bg-white p-7" aria-busy={Boolean(busy)}>
      <h2 className="font-semibold">1. Cargar archivos</h2>
      <fieldset disabled={Boolean(busy)} className="mt-5 space-y-5">
        <legend className="sr-only">Archivos y datos del corte</legend>
        <div className="grid grid-cols-2 gap-5">
          {IMPORT_FILES.map(spec => <label key={spec.key} className="text-sm font-medium">
            {spec.name}
            <input name={spec.key} type="file" accept=".csv,text/csv" required className={`${input} file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-stone-700`} />
          </label>)}
          <label className="text-sm font-medium">Fecha de corte
            <input name="fecha_corte" type="date" required className={input} />
          </label>
          <label className="text-sm font-medium">Saldo en banco al corte
            <input name="saldo_banco" type="text" inputMode="numeric" pattern="-?[0-9]+" required placeholder="270000000" className={input} />
          </label>
        </div>
        <p className="text-xs leading-5 text-stone-500">Moneda local, sin separadores ni decimales. Para los archivos iniciales: corte 27-09-2026 y saldo 270000000. Usa los valores de cada nuevo corte.</p>
        <p className="text-xs text-stone-500">CSV UTF-8 separado por comas. Máximo 4 MiB y 25.000 registros por archivo; 8 MiB y 50.000 registros en total.</p>
        <button className={primary} type="submit">{busy === 'upload' ? 'Validando y preparando…' : 'Validar y ver resumen'}</button>
      </fieldset>
      {busy === 'upload' && <p role="status" className="mt-4 text-sm text-stone-600">Estamos conciliando los archivos y guardando los originales. La caja activa se mantiene mientras revisas esta carga.</p>}
    </form>
    <ErrorNotice error={historyError} />
    {selected && report?.version === 1 && report.summary && <section className="rounded-xl border border-stone-200 bg-white p-7" aria-label="Vista previa de importación">
      <h2 className="font-semibold">2. Revisar y activar</h2>
      <p className="mt-2 text-sm text-stone-600">Corte {formatDate(selected.fecha_corte)} · {selected.activa ? 'Esta importación ya está activa.' : 'Validada, todavía no activa.'}</p>
      <dl className="mt-5 grid grid-cols-4 gap-5">
        {[
          ['Saldo en banco', selected.saldo_banco], ['Total por cobrar', report.summary.por_cobrar],
          ['Cobranza vencida', report.summary.vencido], ['Obligaciones a 7 días', report.summary.obligaciones_7_dias],
        ].map(([label, amount]) => <div key={label}><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{formatAmount(amount)}</dd></div>)}
      </dl>
      <p className="mt-5 text-sm text-stone-600">{report.counts.clientes} clientes · {report.counts.documentos} documentos · {report.counts.pagos} pagos · {report.counts.obligaciones} obligaciones</p>
      <p className="mt-2 text-xs text-stone-500">Los documentos incluyen notas de crédito. Las obligaciones a 7 días incluyen las ya vencidas. Saldo en disputa: {formatAmount(report.summary.en_disputa)}.</p>
      {history.active ? <div className="mt-5 border-t border-stone-100 pt-5 text-sm text-stone-600">
        <p>Caja actual: corte {formatDate(history.active.fecha_corte)}, saldo {formatAmount(history.active.saldo_banco)}.</p>
        <p className="mt-1">Cambio en saldo bancario: {formatAmount(BigInt(selected.saldo_banco) - BigInt(history.active.saldo_banco))}.</p>
        {history.active.resumen_validacion?.summary && <p className="mt-1">Cambio en total por cobrar: {formatAmount(BigInt(report.summary.por_cobrar) - BigInt(history.active.resumen_validacion.summary.por_cobrar))}.</p>}
      </div> : <p className="mt-5 text-sm text-stone-600">Será la primera importación activa.</p>}
      {older && <p className="mt-4 text-sm text-amber-800">Este corte es anterior al activo. No se puede activar.</p>}
      {!selected.activa && <button className={`${primary} mt-5`} disabled={Boolean(busy) || loading || Boolean(historyError) || Boolean(older)} onClick={activate}>
        {busy === 'activate' ? 'Activando…' : 'Activar esta importación'}
      </button>}
    </section>}
    <section className="rounded-xl border border-stone-200 bg-white p-7" aria-busy={loading}>
      <div className="flex items-center justify-between"><h2 className="font-semibold">Últimas 20 importaciones</h2><button className={button} disabled={Boolean(busy) || loading} onClick={() => reload()}>Actualizar historial</button></div>
      {loading && <p role="status" className="mt-5 text-sm text-stone-600">Consultando importaciones…</p>}
      {!loading && history?.imports.length === 0 && <p className="mt-5 text-sm text-stone-600">Todavía no hay importaciones registradas.</p>}
      {history?.imports.length > 0 && <table className="mt-5 w-full text-left text-sm">
        <caption className="sr-only">Historial de importaciones</caption>
        <thead><tr>{['Corte', 'Saldo en banco', 'Estado', 'Acción'].map(label => <th key={label} scope="col" className="border-b border-stone-200 py-3 font-medium text-stone-500">{label}</th>)}</tr></thead>
        <tbody>{history.imports.map(item => <tr key={item.id}>
          <td className="border-b border-stone-100 py-3">{formatDate(item.fecha_corte)}</td>
          <td className="border-b border-stone-100 py-3 tabular-nums">{formatAmount(item.saldo_banco)}</td>
          <td className="border-b border-stone-100 py-3">{item.activa ? 'Activa' : statuses[item.estado] ?? item.estado}</td>
          <td className="border-b border-stone-100 py-3">{item.estado === 'validada' && item.resumen_validacion?.version === 1
            ? <button className={button} disabled={Boolean(busy) || loading} onClick={() => reload(item.id)}>Revisar</button>
            : <span className="text-xs text-stone-500">{item.estado === 'fallida' ? 'Vuelve a cargar los archivos para reintentar.' : item.estado === 'cargando' ? 'Si se interrumpió, reintenta después de 15 min.' : 'Importación anterior'}</span>}</td>
        </tr>)}</tbody>
      </table>}
    </section>
  </div>
}
