import { useCallback, useEffect, useState } from 'react'
import { tableFeatures, useTable } from '@tanstack/react-table'
import { ApiError, getJson } from '../../lib/api.js'
import { formatAmount, formatDate } from '../../../shared/format.js'

const button = 'rounded-md border border-stone-300 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800'
const features = tableFeatures({})
const columns = [
  { accessorKey: 'week', header: 'Semana', cell: ({ row }) => `${formatDate(row.original.start)} – ${formatDate(row.original.end)}` },
  ...[['opening', 'Saldo inicial'], ['collections', 'Cobros estimados'], ['obligations', 'Obligaciones'], ['closing', 'Saldo final'], ['minimum', 'Mínimo diario']].map(([accessorKey, header]) => ({ accessorKey, header, cell: ({ getValue }) => formatAmount(getValue()) })),
]

function WeeklyTable({ weeks }) {
  const table = useTable({ features, columns, data: weeks, getRowId: row => String(row.week) })
  return <div className="overflow-x-auto">
    <table className="w-full text-right text-sm tabular-nums">
      <caption className="sr-only">Flujo semanal del escenario seleccionado. Mínimo diario incluye el saldo inicial de la semana.</caption>
      <thead className="bg-stone-50 text-xs text-stone-600">
        {table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" className="whitespace-nowrap px-3 py-3 first:text-left"><table.FlexRender header={header} /></th>)}</tr>)}
      </thead>
      <tbody>{table.getRowModel().rows.map(row => <tr key={row.id} className="border-t border-stone-100">
        {row.getAllCells().map(cell => <td key={cell.id} className={`whitespace-nowrap px-3 py-3 first:text-left ${['closing', 'minimum'].includes(cell.column.id) && BigInt(cell.getValue()) < 0n ? 'font-semibold text-red-800' : 'text-stone-700'}`}><table.FlexRender cell={cell} /></td>)}
      </tr>)}</tbody>
    </table>
  </div>
}

function CashChart({ data, selected }) {
  const [point, setPoint] = useState(null)
  const series = Object.fromEntries(['base', 'conservative'].map(key => [key, [data.snapshot.saldo_banco, ...data.scenarios[key].weeks.map(week => week.closing)].map(BigInt)]))
  const values = [0n, ...series.base, ...series.conservative]
  const min = values.reduce((a, b) => a < b ? a : b), max = values.reduce((a, b) => a > b ? a : b)
  const span = max - min || 1n
  const x = index => 155 + index * 57
  // Only pixel positions are approximate; labels and arithmetic retain BigInt.
  const y = value => 30 + Number((max - value) * 18000n / span) / 100
  const labels = ['Al corte', ...Array.from({ length: 13 }, (_, index) => `S${index + 1}`)]
  return <div className="px-6 pb-5">
    <p className="text-xs text-stone-500">Saldo al cierre de cada semana · Base: línea continua · Conservador: línea discontinua</p>
    <svg viewBox="0 0 930 245" role="img" aria-label="Comparación de saldos semanales base y conservador. Los valores completos están en la tabla." className="mt-3 w-full">
      <line x1="155" x2="900" y1={y(0n)} y2={y(0n)} stroke="#a8a29e" />
      {[max, min].map((value, index) => <text key={index} x="145" y={y(value) + 4} textAnchor="end" fontSize="11" fill="#57534e">{formatAmount(value)}</text>)}
      {['base', 'conservative'].map(key => <polyline key={key} points={series[key].map((value, index) => `${x(index)},${y(value)}`).join(' ')} fill="none" stroke={key === 'base' ? '#047857' : '#b45309'} strokeWidth={selected === key ? 3 : 1.5} strokeDasharray={key === 'conservative' ? '6 4' : undefined} />)}
      {series[selected].map((value, index) => <circle key={index} cx={x(index)} cy={y(value)} r={point === index ? 6 : 4} fill={selected === 'base' ? '#047857' : '#b45309'} tabIndex="0" onFocus={() => setPoint(index)} onBlur={() => setPoint(null)} onMouseEnter={() => setPoint(index)} onMouseLeave={() => setPoint(null)} aria-label={`${labels[index]}: ${formatAmount(value)}`}><title>{`${labels[index]}: ${formatAmount(value)}`}</title></circle>)}
      {labels.map((label, index) => <text key={label} x={x(index)} y="238" textAnchor="middle" fontSize="11" fill="#57534e">{label}</text>)}
    </svg>
    <p className="min-h-5 text-xs text-stone-600" aria-live="polite">{point === null ? 'Selecciona un escenario y recorre sus puntos para consultar los saldos.' : `${labels[point]} · ${selected === 'base' ? 'Base' : 'Conservador'}: ${formatAmount(series[selected][point])}`}</p>
  </div>
}

function ForecastResult({ data }) {
  const [selected, setSelected] = useState('base')
  const scenario = data.scenarios[selected]
  return <>
    <div className="flex items-center justify-between gap-4 px-6 pb-5">
      <p className="text-sm text-stone-600">{formatDate(scenario.weeks[0].start)} – {formatDate(scenario.weeks.at(-1).end)}</p>
      <div role="group" aria-label="Escenario de proyección" className="flex gap-2">
        {[['base', 'Base'], ['conservative', 'Conservador']].map(([key, label]) => <button key={key} onClick={() => setSelected(key)} aria-pressed={selected === key} className={`${button} ${selected === key ? 'bg-stone-900 text-white' : 'bg-white text-stone-700'}`}>{label}</button>)}
      </div>
    </div>
    <dl className="mx-6 mb-6 grid grid-cols-3 gap-5 rounded-lg bg-stone-50 p-5" aria-live="polite">
      <div><dt className="text-xs text-stone-600">Primer déficit diario estimado</dt><dd className="mt-2 font-semibold">{scenario.firstDeficit ? formatDate(scenario.firstDeficit) : 'Sin déficit en el horizonte'}</dd></div>
      <div><dt className="text-xs text-stone-600">Faltante máximo estimado</dt><dd className="mt-2 font-semibold">{formatAmount(scenario.shortfall)}</dd></div>
      <div><dt className="text-xs text-stone-600">Saldo al final de las 13 semanas</dt><dd className="mt-2 font-semibold">{formatAmount(scenario.closing)}</dd></div>
    </dl>
    <CashChart data={data} selected={selected} />
    <WeeklyTable weeks={scenario.weeks} />
    <div className="space-y-3 border-t border-stone-200 p-6 text-sm leading-6 text-stone-600">
      <h3 className="font-semibold text-stone-900">Qué supone esta proyección</h3>
      <p>Solo cartera y obligaciones conocidas: no incluye ventas futuras, nuevos gastos ni financiamiento. Sueldos, impuestos y servicios futuros pueden ser estimaciones del ERP. Las fechas de cobro son supuestos, no compromisos del cliente.</p>
      <p>Base: atraso mediano de facturas pagadas. Conservador: percentil 80 y al menos 14 días adicionales respecto del base. Se proyecta el saldo completo en una fecha; no se estiman cuotas futuras ni probabilidades de impago.</p>
      <p>Se usan al menos 5 facturas pagadas del cliente; si faltan, 10 del segmento, luego 10 de la cartera. Sin historia suficiente: 30 días de atraso en base y 60 en conservador. Las facturas vencidas o exigibles al corte se programan como mínimo a 7 / 21 días desde el corte.</p>
      <p>Historia disponible: {data.coverage.historySamples.toLocaleString('es-CL')} facturas pagadas por completo, sin notas de crédito ni disputas; fecha del último pago, sin anticipar cobros antes del vencimiento. Las deudas aún abiertas no entrenan el cálculo, lo que puede subestimar demoras.</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
        {[['customer', 'Historia del cliente'], ['segment', 'Historia del segmento'], ['global', 'Historia de la cartera'], ['default', 'Supuesto sin historia suficiente']].map(([key, label]) => <li key={key}>{label}: <strong>{data.coverage[key].count}</strong> facturas · {formatAmount(data.coverage[key].amount)}</li>)}
      </ul>
      <p><strong>Fuera de los cobros proyectados:</strong> {formatAmount(data.coverage.disputed)} en disputa. Además, {formatAmount(scenario.beyond)} sin disputa se estima después de las 13 semanas en este escenario. Obligaciones posteriores al horizonte: {formatAmount(data.coverage.obligationsBeyond)}.</p>
      <p>Las obligaciones vencidas se pagan el primer día. El déficit se revisa al cierre de cada día, incluso si la semana termina positiva; no modela el orden de movimientos dentro del día. El saldo mínimo incluye el banco al corte. No se interpreta la ausencia de obligaciones cargadas como ausencia de gastos futuros.</p>
    </div>
  </>
}

export default function Forecast({ snapshotId, onSessionExpired, onSnapshotChanged }) {
  const [state, setState] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setState({ status: 'loading' }); setAttempt(value => value + 1) }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await getJson('/api/forecast', controller.signal)
        if (controller.signal.aborted) return
        if (!data.snapshot || data.snapshot.id !== snapshotId) setState({ status: 'changed' })
        else if (data.methodVersion !== 1 || !data.scenarios?.base || !data.scenarios?.conservative) throw new Error('Invalid forecast')
        else setState({ status: 'ready', data })
      } catch (error) {
        if (controller.signal.aborted) return
        if (error.status === 401) { onSessionExpired(); return }
        setState({ status: 'error', message: error instanceof ApiError ? error.message : 'No pudimos cargar la proyección. Intenta nuevamente.', requestId: error.requestId })
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt, snapshotId, onSessionExpired])
  return <section className="overflow-hidden rounded-xl border border-stone-200 bg-white" aria-labelledby="forecast-title">
    <div className="p-6"><h2 id="forecast-title" className="text-lg font-semibold">Proyección de caja · 13 semanas</h2><p className="mt-2 text-sm text-stone-600">Cuándo podría faltar caja, según los cobros estimados y los pagos conocidos.</p></div>
    {state.status === 'loading' && <p role="status" className="px-6 pb-8 text-sm text-stone-600">Calculando escenarios…</p>}
    {state.status === 'error' && <div role="alert" className="px-6 pb-6"><p className="text-sm text-red-800">{state.message}</p>{state.requestId && <p className="mt-2 text-xs text-stone-500">Referencia: {state.requestId}</p>}<button className={`${button} mt-4`} onClick={retry}>Reintentar proyección</button></div>}
    {state.status === 'changed' && <div role="status" className="px-6 pb-6"><p className="text-sm text-stone-600">Cambió la importación activa. Actualiza la caja para ver todos los datos del mismo corte.</p><button className={`${button} mt-4`} onClick={onSnapshotChanged}>Actualizar toda la caja</button></div>}
    {state.status === 'ready' && <ForecastResult data={state.data} />}
  </section>
}
