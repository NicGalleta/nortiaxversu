import { useState } from 'react'
import { formatAmount, formatDate } from '../../../shared/format.js'
import VirtualTable from '../collections/VirtualTable.jsx'

const colors = ['#047857', '#b45309', '#4338ca']
const button = 'rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50'
const idOf = row => row.id
export function ComparisonChart({ result }) {
  const [point, setPoint] = useState(null)
  const series = result.scenarios.map(s => [result.snapshot.saldo_banco, ...s.daily.map(d => d.closing)].map(BigInt))
  const values = [0n, ...series.flat()], min = values.reduce((a,b) => a < b ? a : b), max = values.reduce((a,b) => a > b ? a : b)
  const span = max - min || 1n, x = i => 150 + i * 8, y = v => 20 + Number((max - v) * 16000n / span) / 100
  const pointDate = i => i === 0 ? result.snapshot.fecha_corte : result.scenarios[0].daily[i-1].date
  return <div>
    <div className="flex gap-5 text-xs">{result.scenarios.map((s,i) => <span key={s.id} style={{color: colors[i]}}>{s.label} {i === 0 ? '(continua)' : i === 1 ? '(guiones)' : '(puntos)'}</span>)}</div>
    <svg viewBox="0 0 920 220" role="img" aria-label="Comparación de saldo diario: original y alternativas. Consulta valores exactos en la tabla semanal y en cada punto." className="mt-2 w-full">
      <line x1="150" x2="878" y1={y(0n)} y2={y(0n)} stroke="#a8a29e" />
      {[max,min].map((v,i) => <text key={i} x="140" y={y(v)+4} fontSize="11" fill="#57534e" textAnchor="end">{formatAmount(v)}</text>)}
      {series.map((values,i) => <polyline data-series={result.scenarios[i].id} key={i} fill="none" stroke={colors[i]} strokeWidth="2" strokeDasharray={[undefined,'7 4','2 4'][i]} points={values.map((v,j) => `${x(j)},${y(v)}`).join(' ')} />)}
      {Array.from({length:14}, (_,i) => <g key={i}><text x={x(i*7)} y="208" textAnchor="middle" fontSize="11">{i ? `S${i}` : 'Corte'}</text><circle cx={x(i*7)} cy={y(series[0][i*7])} r="4" fill={colors[0]} tabIndex="0" onFocus={()=>setPoint(i*7)} onBlur={()=>setPoint(null)} onMouseEnter={()=>setPoint(i*7)} onMouseLeave={()=>setPoint(null)} aria-label={`${formatDate(pointDate(i*7))}: ${series.map((v,j)=>`${result.scenarios[j].label}: ${formatAmount(v[i*7])}`).join('; ')}`} /></g>)}
    </svg>
    <p className="min-h-8 text-xs text-stone-600" aria-live="polite">{point === null ? 'Saldo al cierre de cada día. Recorre los puntos semanales para comparar valores.' : `${formatDate(pointDate(point))} · ${series.map((s,i)=>`${result.scenarios[i].label}: ${formatAmount(s[point])}`).join(' · ')}`}</p>
  </div>
}
export default function AnalysisResult({ result, onExplain, busy, canExplain }) {
  const [tab, setTab] = useState('summary')
  const horizonEnd = result.scenarios[0].weeks.at(-1).end
  const weeks = result.scenarios[0].weeks.map((w,i) => ({ id: String(w.week), ...w, values: result.scenarios.map(s => s.weeks[i]) }))
  const weeklyColumns = [{ id:'dates', header:'Semana', size:150, cell:({row})=>`${formatDate(row.original.start)} – ${formatDate(row.original.end)}` },
    ...result.scenarios.map((s,i)=>({ id:s.id, header:s.label, size:240, cell:({row})=><div className="tabular-nums"><strong>{formatAmount(row.original.values[i].closing)}</strong><p className="text-xs text-stone-500">Cobros {formatAmount(row.original.values[i].collections)} · Δ {formatAmount(BigInt(row.original.values[i].closing)-BigInt(row.original.values[0].closing))}</p></div> })),
    {accessorKey:'obligations',header:'Obligaciones',size:160,cell:({getValue})=>formatAmount(getValue())}]
  const invoiceColumns = [
    {accessorKey:'id',header:'Factura / Cliente',size:260,cell:({row})=><div><strong>{row.original.id}</strong><p className="truncate" title={row.original.name}>{row.original.name} · {row.original.customer}</p></div>},
    {accessorKey:'amount',header:'Saldo sin disputa',size:170,cell:({getValue})=>formatAmount(getValue())},
    {accessorKey:'original',header:'Fecha original',size:175,cell:({getValue})=><>{formatDate(getValue())}{getValue()>horizonEnd && <p className="text-xs">Fuera del horizonte</p>}</>},
    ...result.spec.delays.map((n,i)=>({id:`delay-${i}`,header:`${i?'B':'A'} · +${n} días`,size:180,cell:({row})=><>{formatDate(row.original.alternatives[i])}{row.original.alternatives[i]>horizonEnd && <p className="text-xs text-amber-800">Fuera del horizonte</p>}</>})),
  ]
  const facts = new Map(result.facts.map(f => [f.id,f]))
  return <section aria-label="Resultado calculado" className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
    <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Resultado · corte {formatDate(result.snapshot.fecha_corte)}</h2><p className="mt-1 text-xs text-stone-500">{result.spec.baseline === 'base' ? 'Base' : 'Conservador'} · {result.selected.map(c=>c.name).join(', ') || 'Cartera completa'} · {result.affected.length} facturas afectadas · {formatAmount(result.affected.reduce((sum,i)=>sum+BigInt(i.amount),0n))}</p></div><button className={button} disabled={busy || !canExplain} onClick={onExplain}>Priorizar explicación con IA</button></div>
    <div role="tablist" aria-label="Detalle del análisis" className="mb-5 flex gap-2">{[['summary','Resumen'],['weekly','Comparación semanal'],['evidence','Evidencia']].map(([key,label])=><button role="tab" aria-selected={tab===key} aria-controls={`analyst-${key}`} id={`analyst-tab-${key}`} key={key} onClick={()=>setTab(key)} className={`${button} ${tab===key?'bg-stone-900 text-white':''}`}>{label}</button>)}</div>
    <div role="tabpanel" id={`analyst-${tab}`} aria-labelledby={`analyst-tab-${tab}`}>
      {tab==='summary' && <>
        <div className="mb-5 grid grid-cols-3 gap-4">{result.scenarios.map((s,i)=><article key={s.id} className="rounded-lg bg-stone-50 p-4"><h3 className="text-sm font-semibold" style={{color:colors[i]}}>{s.label}</h3><dl className="mt-3 space-y-2 text-sm"><div><dt className="text-xs text-stone-500">Primer déficit</dt><dd>{s.firstDeficit?formatDate(s.firstDeficit):'Sin déficit'}</dd>{i>0 && <dd className="text-xs text-stone-500">{s.deficitChange}</dd>}</div><div><dt className="text-xs text-stone-500">Faltante máximo</dt><dd>{formatAmount(s.shortfall)}{i>0 && <span className="ml-2 text-xs">Δ {formatAmount(s.deltaShortfall)}</span>}</dd></div><div><dt className="text-xs text-stone-500">Saldo final</dt><dd>{formatAmount(s.closing)}{i>0 && <span className="ml-2 text-xs">Δ {formatAmount(s.deltaClosing)}</span>}</dd></div><div><dt className="text-xs text-stone-500">Cobros fuera de 13 semanas</dt><dd>{formatAmount(s.beyond)}</dd></div></dl>{i>0 && s.noImpact && <p className="mt-3 text-xs font-medium text-amber-800">Sin impacto dentro del horizonte: los cobros seleccionados ya estaban fuera de las 13 semanas.</p>}</article>)}</div>
        <ComparisonChart result={result} />
        <div className="max-h-52 overflow-auto rounded-lg border border-stone-200 p-4"><p className="mb-2 text-xs text-stone-500">{result.explanation.message}</p><ul className="space-y-2 text-sm leading-6">{result.explanation.factIds.map(id=>facts.has(id) && <li key={id}>{facts.get(id).text} <span className="text-xs text-stone-400">[{id}]</span></li>)}</ul></div>
      </>}
      {tab==='weekly' && <><p className="mb-3 text-xs text-stone-500">Saldo final y cobros por semana; Δ compara el saldo con el original. Las obligaciones son iguales en las alternativas.</p><VirtualTable rows={weeks} columns={weeklyColumns} label="Comparación semanal de escenarios" getRowId={idOf} /></>}
      {tab==='evidence' && <div className="max-h-[540px] space-y-4 overflow-auto">
        <details open><summary className="mb-3 cursor-pointer text-sm font-semibold">Facturas afectadas ({result.affected.length})</summary><VirtualTable rows={result.affected} columns={invoiceColumns} label="Fechas originales y demoradas de facturas" getRowId={idOf} /></details>
        <details><summary className="cursor-pointer text-sm font-semibold">Mayores movimientos hasta el primer déficit / mínimo</summary><p className="my-3 text-xs text-stone-500">Hasta {formatDate(result.drivers.date)}. Contribuciones calculadas; no explican intenciones del cliente.</p><ul className="space-y-2 text-sm">{[...result.drivers.obligations,...result.drivers.collections].map((item,i)=><li key={i}>{item.id} · {item.name} · {formatAmount(item.amount)} · {formatDate(item.date)}</li>)}</ul>{!result.drivers.obligations.length && !result.drivers.collections.length && <p className="text-sm">No hay movimientos anteriores a esta fecha; el saldo inicial determina el mínimo.</p>}</details>
        <details><summary className="cursor-pointer text-sm font-semibold">Supuestos y cobertura</summary><p className="mt-3 text-sm leading-6">Se mantienen banco, obligaciones e historia del escenario seleccionado. Cada saldo sin disputa se mueve una sola vez. Se excluyen {formatAmount(result.coverage.disputed)} en disputa. No se incluyen ventas futuras ni gastos no cargados. El mínimo incluye el banco al corte. Los cobros posteriores al día 91 se informan fuera del horizonte, sin sumarse al saldo final.</p></details>
      </div>}
    </div>
  </section>
}
