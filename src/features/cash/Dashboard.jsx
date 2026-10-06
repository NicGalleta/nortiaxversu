import { compareAmounts, formatAmount, formatDate } from '../../../shared/format.js'
import Forecast from '../forecast/Forecast.jsx'
import ObligationsTable from './ObligationsTable.jsx'

const buttonClass = 'rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900 disabled:cursor-wait disabled:opacity-50'

function Metric({ label, amount, detail }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <dt className="text-sm text-stone-600">{label}</dt>
      <dd className="mt-3 break-words text-2xl font-semibold tracking-tight tabular-nums">{formatAmount(amount)}</dd>
      <dd className="mt-2 text-xs leading-5 text-stone-500">{detail}</dd>
    </div>
  )
}

export default function Dashboard({ data, onRefresh, refreshing = false, onSessionExpired }) {
  const { snapshot, summary, obligations } = data

  if (!snapshot) {
    return (
      <section aria-labelledby="empty-dashboard-title" className="rounded-xl border border-stone-200 bg-white p-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Caja y cobranza</p>
        <h1 id="empty-dashboard-title" className="mt-3 text-2xl font-semibold tracking-tight">Aún no hay datos activos</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
          Tu acceso está listo. El resumen de caja aparecerá cuando exista una importación validada y activa.
        </p>
        <button className={`${buttonClass} mt-6`} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Actualizando…' : 'Volver a consultar'}
        </button>
      </section>
    )
  }

  const hasShortfall = compareAmounts(summary.saldo_sin_cobros_7_dias, '0') < 0
  const shortfall = hasShortfall ? -BigInt(summary.saldo_sin_cobros_7_dias) : 0n

  return (
    <div className="space-y-7" aria-busy={refreshing}>
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Caja y cobranza</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Resumen de caja</h1>
          <p className="mt-3 text-sm text-stone-600">
            Datos al <time dateTime={snapshot.fecha_corte} className="font-medium text-stone-900">{formatDate(snapshot.fecha_corte)}</time>
            <span aria-hidden="true" className="mx-2">·</span>
            Montos en moneda local
          </p>
        </div>
        <button className={buttonClass} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Actualizando…' : 'Actualizar datos'}
        </button>
      </div>

      <dl className="grid grid-cols-4 gap-4">
        <Metric label="Saldo en banco" amount={snapshot.saldo_banco} detail="Saldo informado a la fecha de corte" />
        <Metric label="Total por cobrar" amount={summary.por_cobrar} detail={`${summary.facturas_pendientes.toLocaleString('es-CL')} facturas con saldo pendiente`} />
        <Metric label="Cobranza vencida" amount={summary.vencido} detail={`${summary.facturas_vencidas.toLocaleString('es-CL')} facturas vencidas al corte`} />
        <Metric label="Obligaciones a 7 días" amount={summary.obligaciones_7_dias} detail="Incluye vencidas y los próximos 7 días" />
      </dl>

      <section
        aria-labelledby="cash-scenario-title"
        className={`flex items-start justify-between gap-8 rounded-xl border p-6 ${hasShortfall ? 'border-amber-200 bg-amber-50' : 'border-stone-200 bg-white'}`}
      >
        <div className="max-w-2xl">
          <h2 id="cash-scenario-title" className="font-semibold">
            {hasShortfall ? 'La caja necesita nuevos cobros' : 'La caja cubre las obligaciones a 7 días'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            {hasShortfall
              ? `Sin nuevos cobros, faltarían ${formatAmount(shortfall)} para cubrir las obligaciones del horizonte.`
              : 'El saldo informado alcanza para cubrir las obligaciones del horizonte, incluso sin nuevos cobros.'}
          </p>
          <p className="mt-2 text-xs leading-5 text-stone-500">
            Saldo en banco menos obligaciones vencidas y de los próximos 7 días desde el corte. No estima futuros ingresos ni egresos nuevos.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-medium text-stone-600">Saldo sin nuevos cobros</p>
          <p className={`mt-2 text-2xl font-semibold tabular-nums ${hasShortfall ? 'text-amber-900' : 'text-stone-900'}`}>
            {formatAmount(summary.saldo_sin_cobros_7_dias)}
          </p>
        </div>
      </section>

      <p className="text-sm leading-6 text-stone-600">
        <span className="font-medium text-stone-900">En disputa: {formatAmount(summary.en_disputa)}.</span>{' '}
        Este saldo está incluido en el total por cobrar y requiere revisión antes de gestionar su cobro.
      </p>

      <Forecast snapshotId={snapshot.id} onSessionExpired={onSessionExpired} onSnapshotChanged={onRefresh} />

      <ObligationsTable obligations={obligations} fechaCorte={snapshot.fecha_corte} />
    </div>
  )
}
