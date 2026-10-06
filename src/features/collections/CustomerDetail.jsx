import { useEffect, useRef, useState } from 'react'
import { formatAmount, formatDate } from '../../../shared/format.js'
import { useCollectionsQuery } from './use-collections-query.js'
import { buttonClass, QueryFeedback } from './feedback.jsx'
import VirtualTable from './VirtualTable.jsx'

const money = key => ({ accessorKey: key, header: key, cell: ({ getValue }) => <span className="tabular-nums">{formatAmount(getValue())}</span> })
const invoiceColumns = [
  { accessorKey: 'id', header: 'Factura / referencia', size: '20%', cell: ({ row, getValue }) => <div><p className="truncate font-medium" title={getValue()}>{getValue()}</p>{row.original.reference && <p className="truncate text-xs text-stone-500" title={row.original.reference}>Reemplaza / ref.: {row.original.reference}</p>}</div> },
  { accessorKey: 'due', header: 'Vencimiento', size: '12%', cell: ({ getValue }) => formatDate(getValue()) },
  { ...money('total'), header: 'Original', size: '13%' },
  { ...money('credits'), header: 'Notas de crédito', size: '13%' },
  { ...money('paid'), header: 'Pagado', size: '13%' },
  { ...money('remaining'), header: 'Saldo', size: '13%' },
  { accessorKey: 'disputed', header: 'Estado / observación', size: '16%', cell: ({ row }) => <div><p className={row.original.disputed ? 'font-medium text-amber-800' : 'text-stone-600'}>{BigInt(row.original.remaining) === 0n ? 'Saldada' : row.original.disputed ? 'En disputa' : 'Sin disputa'}</p><p className="truncate text-xs text-stone-500" title={row.original.observation ?? ''}>{row.original.observation || 'Sin observación'}</p></div> },
]
const creditColumns = [
  { accessorKey: 'id', header: 'Nota de crédito', size: '20%' },
  { accessorKey: 'date', header: 'Emisión', size: '15%', cell: ({ getValue }) => formatDate(getValue()) },
  { accessorKey: 'invoice', header: 'Factura corregida', size: '20%' },
  { ...money('amount'), header: 'Monto', size: '15%' },
  { accessorKey: 'observation', header: 'Observación', size: '30%', cell: ({ getValue }) => <p className="truncate" title={getValue() ?? ''}>{getValue() || 'Sin observación'}</p> },
]
const paymentColumns = [
  { accessorKey: 'id', header: 'Pago', size: '20%' },
  { accessorKey: 'date', header: 'Fecha', size: '15%', cell: ({ getValue }) => formatDate(getValue()) },
  { accessorKey: 'method', header: 'Medio', size: '15%' },
  { ...money('amount'), header: 'Total recibido', size: '20%' },
  { accessorKey: 'allocations', header: 'Aplicación por factura', size: '30%', cell: ({ getValue }) => <div className="max-h-14 overflow-y-auto text-xs leading-5">{getValue().map(item => <p key={item.invoice}>{item.invoice}: {formatAmount(item.amount)}</p>)}</div> },
]

export function CustomerContent({ data, summary }) {
  const [tab, setTab] = useState('invoices')
  const [pending, setPending] = useState(true)
  const c = data.customer
  const rows = tab === 'invoices' ? data.invoices.filter(row => !pending || BigInt(row.remaining) > 0n) : data[tab]
  const columns = tab === 'invoices' ? invoiceColumns : tab === 'payments' ? paymentColumns : creditColumns
  return <div className="space-y-5">
    <div className="grid grid-cols-3 gap-5 rounded-xl border border-stone-200 bg-white p-5 text-sm leading-6">
      <div><h2 className="font-semibold">Contacto</h2><p>{c.contacto_nombre || 'Sin nombre de contacto'}</p><p className="break-all">{c.contacto_email || 'Sin correo registrado'}</p><p>{c.contacto_telefono || 'Sin teléfono registrado'}</p></div>
      <div><h2 className="font-semibold">Cuenta</h2><p>{c.id_tributario || 'Sin identificación tributaria'} · {c.ciudad || 'Sin ciudad'}</p><p>{c.segmento || 'Sin segmento'}</p><p>Ejecutivo: {c.ejecutivo_comercial || 'Sin asignar'}</p><p>Crédito: {c.dias_credito} días · Límite: {formatAmount(c.limite_credito)}</p></div>
      <div><h2 className="font-semibold">Por qué aparece aquí</h2>{summary.reasons.map(reason => <p key={reason}>{reason}</p>)}<p className="mt-1 text-xs text-stone-500">{summary.history.samples >= 5 ? `Atraso mediano histórico: ${summary.history.medianDelay} días (${summary.history.samples} facturas).` : `Historia insuficiente: ${summary.history.samples} facturas saldadas sin ajustes; mínimo 5.`}</p></div>
    </div>
    {BigInt(summary.disputed) > 0n && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Revisar con Comercial antes de cobrar las facturas en disputa. Su saldo de {formatAmount(summary.disputed)} está excluido del monto vencido priorizado.</p>}
    <dl className="grid grid-cols-4 gap-4">{[['Saldo pendiente', summary.total], ['Vencido sin disputa', summary.collectibleOverdue], ['En disputa', summary.disputed]].map(([label, value]) => <div key={label} className="rounded-lg border border-stone-200 bg-white p-4"><dt className="text-xs text-stone-600">{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{formatAmount(value)}</dd></div>)}<div className="rounded-lg border border-stone-200 bg-white p-4"><dt className="text-xs text-stone-600">Vencimiento más antiguo pendiente</dt><dd className="mt-2 font-semibold">{formatDate(summary.oldestDue)}</dd><dd className="mt-1 text-xs text-stone-500">Incluye facturas en disputa</dd></div></dl>
    <div className="flex items-center justify-between">
      <div role="group" aria-label="Información del cliente" className="flex gap-2">{[['invoices', 'Facturas'], ['payments', 'Pagos'], ['credits', 'Notas de crédito']].map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)} className={`${buttonClass} ${tab === key ? 'border-stone-900 bg-stone-100' : ''}`}>{label} ({data[key].length})</button>)}</div>
      {tab === 'invoices' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pending} onChange={event => setPending(event.target.checked)} />Solo con saldo pendiente</label>}
    </div>
    <VirtualTable key={`${tab}-${pending}`} rows={rows} columns={columns} getRowId={row => row.id} label={tab === 'invoices' ? 'Facturas del cliente' : tab === 'payments' ? 'Pagos recibidos y aplicaciones' : 'Notas de crédito del cliente'} />
    <p className="text-xs leading-5 text-stone-500">Datos al {formatDate(data.snapshot.fecha_corte)}. Saldo = original + notas de crédito − pagos aplicados. Cada pago aparece una sola vez, incluso si cubre varias facturas. No se envían mensajes ni se modifican datos desde esta pantalla.</p>
  </div>
}

export default function CustomerDetail({ snapshot, customer, onBack, onRefresh, onSessionExpired }) {
  const state = useCollectionsQuery(`/api/collections/customer?${new URLSearchParams({ customer: customer.id, snapshot: snapshot.id })}`, onSessionExpired)
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus() }, [])
  // The server verifies the snapshot; also avoid showing a mismatched customer
  // if a stale response or a faulty intermediary ever returns a different one.
  const matches = state.status === 'ready' && state.data.snapshot.id === snapshot.id && state.data.customer.id_cliente === customer.id && state.data.invoices.reduce((sum, row) => sum + BigInt(row.remaining), 0n) === BigInt(customer.total)
  return <div className="space-y-5">
    <button onClick={onBack} className={buttonClass}>← Volver a clientes</button>
    <div><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{customer.name}</h1><p className="mt-1 text-sm text-stone-500">{customer.id} · Corte {formatDate(snapshot.fecha_corte)}</p></div>
    {state.status !== 'ready' ? <QueryFeedback state={state} onRefresh={onRefresh} /> : matches ? <CustomerContent data={state.data} summary={customer} /> : <div role="alert"><p>Los datos del cliente cambiaron. Actualiza la lista para continuar.</p><button className={`${buttonClass} mt-3`} onClick={onRefresh}>Actualizar lista</button></div>}
  </div>
}
