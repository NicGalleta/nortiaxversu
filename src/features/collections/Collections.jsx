import { useMemo, useState } from 'react'
import { compareAmounts, formatAmount, formatDate } from '../../../shared/format.js'
import { useCollectionsQuery } from './use-collections-query.js'
import { buttonClass, QueryFeedback } from './feedback.jsx'
import VirtualTable from './VirtualTable.jsx'
import CustomerDetail from './CustomerDetail.jsx'

const input = 'mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-stone-700'
const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-CL')

export function CustomerList({ data, onSelect }) {
  const [search, setSearch] = useState(''), [segment, setSegment] = useState(''), [filter, setFilter] = useState('all'), [sort, setSort] = useState('priority')
  const segments = [...new Set(data.customers.map(row => row.segment).filter(Boolean))].sort()
  const rows = useMemo(() => {
    const query = normalize(search.trim())
    const result = data.customers.filter(row => (!segment || row.segment === segment) && (!query || [row.id, row.name, row.taxId].some(value => normalize(value).includes(query))) &&
      (filter === 'all' || (filter === 'overdue' && BigInt(row.collectibleOverdue) > 0n) || (filter === 'dispute' && BigInt(row.disputed) > 0n) || (filter === 'upcoming' && row.category === 'upcoming')))
    if (sort === 'amount') result.sort((a, b) => compareAmounts(b.total, a.total) || a.rank - b.rank)
    if (sort === 'age') result.sort((a, b) => b.maxOverdueDays - a.maxOverdueDays || a.rank - b.rank)
    return result
  }, [data.customers, search, segment, filter, sort])
  const columns = [
    { accessorKey: 'rank', header: 'Orden', size: '6%' },
    { accessorKey: 'name', header: 'Cliente / motivo', size: '30%', cell: ({ row }) => <div><button className="block max-w-full truncate text-left font-semibold underline decoration-stone-300 underline-offset-4 focus-visible:outline-2 focus-visible:outline-stone-800" onClick={() => onSelect(row.original)} title={row.original.name}>{row.original.name}</button><p className="mt-1 truncate text-xs text-stone-500" title={row.original.reasons.join(' · ')}>{row.original.reasons[0]}</p><p className="truncate text-xs text-stone-500">{row.original.segment || 'Sin segmento'} · {row.original.id}</p></div> },
    ...[['total', 'Saldo total', '14%'], ['collectibleOverdue', 'Vencido sin disputa', '15%'], ['disputed', 'En disputa', '12%']].map(([accessorKey, header, size]) => ({ accessorKey, header, size, cell: ({ getValue }) => <span className="tabular-nums">{formatAmount(getValue())}</span> })),
    { accessorKey: 'maxOverdueDays', header: 'Atraso sin disputa', size: '10%', cell: ({ getValue }) => `${getValue()} días` },
    { accessorKey: 'history', header: 'Atraso histórico', size: '13%', cell: ({ getValue }) => <div className="text-xs"><p>{getValue().samples >= 5 ? `Mediana: ${getValue().medianDelay} días` : 'Historia insuficiente'}</p><p className="mt-1 text-stone-500">{getValue().samples} facturas pagadas</p></div> },
  ]
  return <div className="space-y-5">
    <dl className="grid grid-cols-4 gap-4">{[['Clientes con saldo', String(data.summary.count), false], ['Total por cobrar', data.summary.total, true], ['Vencido sin disputa', data.summary.collectibleOverdue, true], ['En disputa', data.summary.disputed, true]].map(([label, value, monetary]) => <div key={label} className="rounded-xl border border-stone-200 bg-white p-5"><dt className="text-xs text-stone-600">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{monetary ? formatAmount(value) : value}</dd></div>)}</dl>
    <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 text-xs font-medium text-stone-600">
      <label>Buscar cliente<input className={input} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, identificación o código" /></label>
      <label>Segmento<select className={input} value={segment} onChange={event => setSegment(event.target.value)}><option value="">Todos</option>{segments.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Situación<select className={input} value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos</option><option value="overdue">Vencido sin disputa</option><option value="upcoming">Seguimiento preventivo</option><option value="dispute">Con disputas</option></select></label>
      <label>Ordenar por<select className={input} value={sort} onChange={event => setSort(event.target.value)}><option value="priority">Prioridad sugerida</option><option value="amount">Mayor saldo total</option><option value="age">Mayor atraso sin disputa</option></select></label>
    </div>
    <div className="flex items-center justify-between text-xs text-stone-500"><p role="status">{rows.length} de {data.customers.length} clientes · Los totales superiores corresponden a toda la cartera.</p><button onClick={() => { setSearch(''); setSegment(''); setFilter('all'); setSort('priority') }} className="rounded px-2 py-1 underline focus-visible:outline-2">Limpiar filtros</button></div>
    <VirtualTable key={`${search}-${segment}-${filter}-${sort}`} rows={rows} columns={columns} label="Clientes priorizados para cobranza" getRowId={row => row.id} rowHeight={84} />
    <details className="rounded-lg border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-600"><summary className="cursor-pointer font-medium text-stone-800">Cómo se ordena la lista</summary><p className="mt-3">Primero saldo vencido sin disputa, de mayor a menor monto; en empate, mayor atraso, mayor saldo sin disputa y código de cliente. Luego seguimiento preventivo y finalmente cuentas cuyo saldo está totalmente en disputa. El número de orden conserva la prioridad original al filtrar u ordenar por otra columna.</p><p className="mt-2">La historia muestra la mediana del atraso hasta el pago final de facturas saldadas, sin notas de crédito ni disputas, con un mínimo de 5 observaciones. Es contexto, no una probabilidad de recuperación ni un factor del ranking. No hay registros de llamadas o recordatorios para inferir respuesta a contactos.</p></details>
  </div>
}

export default function Collections({ onSessionExpired }) {
  const state = useCollectionsQuery('/api/collections', onSessionExpired)
  const [selected, setSelected] = useState(null)
  function refresh() { setSelected(null); state.retry() }
  return <div>
    <div hidden={selected !== null} className="space-y-6">
      <div className="flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Gestión de cartera</p><h1 className="mt-2 text-3xl font-semibold">Cobranza</h1><p className="mt-2 text-sm text-stone-600">A quién contactar primero y qué revisar antes de hacerlo.{state.data?.snapshot && ` Corte ${formatDate(state.data.snapshot.fecha_corte)}.`}</p></div><button className={buttonClass} onClick={refresh}>Actualizar clientes</button></div>
      {state.status !== 'ready' ? <QueryFeedback state={state} onRefresh={refresh} /> : !state.data.snapshot ? <p role="status" className="rounded-xl border border-stone-200 bg-white p-10">Aún no hay una importación activa. Carga y activa los archivos en Importaciones.</p> : state.data.customers.length === 0 ? <p role="status" className="rounded-xl border border-stone-200 bg-white p-10">No hay clientes con saldo pendiente en este corte.</p> : <CustomerList data={state.data} onSelect={setSelected} />}
    </div>
    {selected && state.status === 'ready' && <CustomerDetail key={`${state.data.snapshot.id}-${selected.id}`} snapshot={state.data.snapshot} customer={selected} onBack={() => setSelected(null)} onRefresh={refresh} onSessionExpired={onSessionExpired} />}
  </div>
}
