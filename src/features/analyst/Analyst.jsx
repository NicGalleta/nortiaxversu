import { useEffect, useRef, useState } from 'react'
import { getJson, requestJson } from '../../lib/api.js'
import { DEFAULT_ANALYST_FORM, TASK_LABELS } from '../../../shared/analyst-contract.js'
import { formatAmount, formatDate } from '../../../shared/format.js'
import AnalysisResult from './AnalysisResult.jsx'

const button = 'rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed'
const input = 'mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm'
export default function Analyst({ active, importVersion, onSessionExpired }) {
  const [context, setContext] = useState(null), [form, setForm] = useState(DEFAULT_ANALYST_FORM)
  const [result, setResult] = useState(null), [text, setText] = useState(''), [notice, setNotice] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(''), [loading, setLoading] = useState(false)
  const [invalidated, setInvalidated] = useState(false), [attempt, setAttempt] = useState(0)
  const [interpreted, setInterpreted] = useState(false), [interpretUsed, setInterpretUsed] = useState(false), [explainUsed, setExplainUsed] = useState(false)
  const [search, setSearch] = useState('')
  const operation = useRef(null), previousSnapshot = useRef(null)
  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError('')
      try {
        const data = await getJson('/api/analyst/context', controller.signal)
        if (controller.signal.aborted) return
        if (previousSnapshot.current && previousSnapshot.current !== data.snapshot?.id) {
          operation.current?.abort(); setBusy(''); setResult(null); setForm({...DEFAULT_ANALYST_FORM,selection:{type:'customers',ids:[]}})
          setInvalidated(true); setInterpreted(false); setInterpretUsed(false); setExplainUsed(false)
          setNotice('Cambió la importación. Se descartó el escenario anterior. Selecciona y revisa los clientes nuevamente.')
        }
        previousSnapshot.current = data.snapshot?.id ?? null
        setContext(data)
      } catch (e) {
        if (controller.signal.aborted) return
        if (e.status === 401) { onSessionExpired(); return }
        setError(e.message || 'No pudimos cargar Analista.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [active, importVersion, attempt, onSessionExpired])
  function edit(next) { setForm(next); setInvalidated(false); setError('') }
  const spec = context?.snapshot ? {snapshotId:context.snapshot.id,task:form.task,baseline:form.baseline,selection:form.task==='explain'?null:form.selection,delays:form.task==='explain'?[]:form.delays.slice(0,form.task==='simulate'?1:2)} : null
  const ready = spec && !invalidated && (form.task==='explain' || (form.selection.type==='top' ? Number.isInteger(form.selection.count) && form.selection.count>=1 && form.selection.count<=Math.min(5,context.customers.length) : form.selection.ids.length>=1 && form.selection.ids.length<=5)) && spec.delays.every(n=>Number.isInteger(n)&&n>=1&&n<=60)
  function fail(e) {
    if (e.status===401) {onSessionExpired();return}
    if (e.status===409) {setResult(null);setInvalidated(true);setForm({...DEFAULT_ANALYST_FORM,selection:{type:'customers',ids:[]}});setNotice('Cambió la importación. Actualiza los clientes y revisa los supuestos.');setContext(null)}
    setError(e.message || 'No pudimos completar la solicitud. El último resultado calculado se conserva.')
  }
  async function post(path, body, signal) { return requestJson(`/api/analyst/${path}`, {method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'},signal,timeout:45000}) }
  async function execute(kind) {
    if (busy || loading) return
    const controller = new AbortController(); operation.current = controller
    setBusy(kind);setError('')
    try {
      if (kind==='interpret') {
        setInterpretUsed(true)
        const data = await post('interpret',{snapshotId:context.snapshot.id,text},controller.signal)
        if (controller.signal.aborted) return
        setContext(c=>({...c,ai:data.ai}));setNotice(data.message)
        if (data.status==='supported') {setForm({...data.spec,delays:data.spec.delays.length ? data.spec.delays : [7,14],selection:data.spec.selection ?? DEFAULT_ANALYST_FORM.selection});setInvalidated(false);setInterpreted(true);setExplainUsed(false)}
      } else {
        let data
        if(kind==='run') {
          data = await post('run',spec,controller.signal)
          if(controller.signal.aborted)return
          setResult(data);setNotice('Escenario calculado con los supuestos revisados.')
          if(!interpreted) setExplainUsed(false)
        }
        if(kind==='explain' || (kind==='run' && interpreted && !explainUsed && context.ai.available)) {
          setExplainUsed(true);setBusy('explain')
          data = await post('explain',kind==='explain'?result.spec:spec,controller.signal)
          if(controller.signal.aborted)return
          setResult(data);setContext(c=>({...c,ai:data.ai}))
        }
      }
    } catch(e) {if(!controller.signal.aborted)fail(e)}
    finally {if(!controller.signal.aborted)setBusy('')}
  }
  function newText(value) {setText(value);setInterpretUsed(false);setInterpreted(false);setNotice('')}
  const matches = context?.customers.filter(c=>`${c.id} ${c.name}`.toLowerCase().includes(search.toLowerCase())) ?? []
  return <div hidden={!active}>
    <div className="mb-5 flex items-start justify-between"><div><h1 className="text-2xl font-semibold">Analista</h1><p className="mt-2 text-sm text-stone-600">Explica caja y compara demoras de cobro en las próximas 13 semanas.</p></div><button className={button} disabled={!!busy||loading} onClick={()=>setAttempt(n=>n+1)}>Actualizar clientes</button></div>
    {loading && <p role="status" className="mb-4 text-sm">Comprobando importación y clientes…</p>}
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {context && !context.snapshot && <p role="status" className="rounded-lg border border-stone-200 bg-white p-8">No hay una importación activa. Activa una en Importaciones para empezar.</p>}
    {context?.snapshot && <>
      <fieldset disabled={!!busy||loading} className="rounded-xl border border-stone-200 bg-white p-5 disabled:opacity-70">
        <legend className="px-2 text-sm font-semibold">Supuestos · corte {formatDate(context.snapshot.fecha_corte)}</legend>
        <div className="grid grid-cols-[1fr_1fr] gap-6">
          <div><label className="text-sm font-medium" htmlFor="analyst-request">Describe una solicitud (opcional)</label><textarea id="analyst-request" className={`${input} h-20 resize-none`} maxLength={1000} value={text} onChange={e=>newText(e.target.value)} placeholder="Compara 7 y 14 días de demora para los 3 mayores clientes" /><div className="mt-2 flex items-center justify-between"><span className="text-xs text-stone-500">Español / English · {text.length}/1.000</span><button type="button" className={button} disabled={!context.ai.available||!text.trim()||interpretUsed} onClick={()=>execute('interpret')}>Interpretar supuestos</button></div><p className="mt-2 text-xs text-stone-500">{context.ai.message} La interpretación requiere tu revisión antes de calcular.</p></div>
          <div className="grid grid-cols-2 gap-3"><label className="text-sm">Tarea<select className={input} value={form.task} onChange={e=>edit({...form,task:e.target.value,delays:form.delays.length===2?form.delays:[form.delays[0]??7,14]})}>{Object.entries(TASK_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm">Proyección original<select className={input} value={form.baseline} onChange={e=>edit({...form,baseline:e.target.value})}><option value="base">Base</option><option value="conservative">Conservadora</option></select></label>{form.task!=='explain' && form.delays.slice(0,form.task==='compare'?2:1).map((n,i)=><label className="text-sm" key={i}>Demora {i?'B':'A'} · días calendario<input className={input} type="number" min="1" max="60" step="1" value={Number.isNaN(n)?'':n} onChange={e=>edit({...form,delays:form.delays.map((value,j)=>j===i?e.target.valueAsNumber:value)})}/></label>)}</div>
        </div>
        {form.task!=='explain' && <div className="mt-4 border-t border-stone-100 pt-4"><div className="flex items-center gap-4"><label className="text-sm">Clientes<select className={`${input} w-64`} value={form.selection.type} onChange={e=>edit({...form,selection:e.target.value==='top'?{type:'top',count:3}:{type:'customers',ids:[]}})}><option value="top">Mayores saldos sin disputa</option><option value="customers">Selección manual</option></select></label>{form.selection.type==='top' ? <label className="text-sm">Cantidad (1–5)<input className={`${input} w-24`} type="number" min="1" max={Math.min(5,context.customers.length)} value={Number.isNaN(form.selection.count)?'':form.selection.count} onChange={e=>edit({...form,selection:{type:'top',count:e.target.valueAsNumber}})}/></label> : <label className="text-sm">Buscar cliente<input className={`${input} w-72`} value={search} onChange={e=>setSearch(e.target.value)}/></label>}<p className="ml-auto max-w-xs text-xs text-stone-500">Mismos clientes en A y B. Todas sus facturas pendientes sin disputa. Desempate por ID.</p></div>
          {form.selection.type==='customers' ? <><div className="mt-3 grid max-h-36 grid-cols-2 gap-2 overflow-auto rounded-md border border-stone-200 p-3">{matches.map(c=><label key={c.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.selection.ids.includes(c.id)} disabled={!form.selection.ids.includes(c.id)&&form.selection.ids.length>=5} onChange={e=>edit({...form,selection:{type:'customers',ids:e.target.checked?[...form.selection.ids,c.id]:form.selection.ids.filter(id=>id!==c.id)}})}/><span>{c.name} · {c.id} · {formatAmount(c.amount)}</span></label>)}{!matches.length && <p className="text-sm">No hay clientes elegibles que coincidan.</p>}</div><p className="mt-2 text-xs">Seleccionados: {context.customers.filter(c=>form.selection.ids.includes(c.id)).map(c=>`${c.name} (${c.id})`).join(', ')||'Ninguno'}</p></> : <p className="mt-3 text-xs text-stone-600">{context.customers.slice(0,Number.isInteger(form.selection.count)&&form.selection.count>0?Math.min(form.selection.count,5):0).map(c=>`${c.name} (${c.id}): ${formatAmount(c.amount)}`).join(' · ')||'Sin clientes elegibles'}</p>}
        </div>}
        <div className="mt-4 flex items-center justify-between gap-6"><p className="max-w-2xl text-xs text-stone-500">Solo demoras adicionales de 1–60 días. No reprograma pagos, financia, acelera cobros ni resuelve disputas. Los escenarios no se guardan.</p><button type="button" className={`${button} border-stone-900 font-semibold`} disabled={!ready} onClick={()=>execute('run')}>Calcular con estos supuestos</button></div>
      </fieldset>
      {!!busy && <p role="status" className="mt-3 text-sm">{busy==='interpret'?'Interpretando…':busy==='explain'?'Priorizando la explicación… El cálculo ya está disponible.':'Calculando escenarios…'}</p>}
      {notice && <p role="status" className="mt-3 rounded-md bg-stone-100 p-3 text-sm">{notice}</p>}
      {result && <>{JSON.stringify(result.spec)!==JSON.stringify(spec) && <p className="mt-4 text-sm text-amber-800">Los controles cambiaron. El resultado conserva los supuestos del último cálculo.</p>}<AnalysisResult result={result} busy={!!busy||loading} canExplain={context.ai.available&&!explainUsed} onExplain={()=>execute('explain')}/></>}
      {!result && !busy && <p className="mt-5 text-sm text-stone-500">Revisa los supuestos y calcula para ver la comparación y su evidencia.</p>}
    </>}
  </div>
}
