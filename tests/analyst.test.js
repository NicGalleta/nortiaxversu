import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analystContext, calculateAnalysis, validateSpec } from '../worker/analyst/calculate.js'
import { projectForecast } from '../worker/forecast/project.js'
import { forecastInput, invoice, obligation, profile } from './fixtures/forecast-data.js'

export function sourceWith(options={}) {
  const source = forecastInput(options)
  return {...source,customers:[...new Set(source.invoices.map(i=>i.customer))].map(id=>({id,name:`Cliente ${id}`,taxId:null,segment:'taller'}))}
}
export const specFor = (source, changes={}) => ({snapshotId:source.dashboard.snapshot.id,task:'compare',baseline:'base',selection:{type:'top',count:1},delays:[7,14],...changes})
const total = scenario => scenario.weeks.reduce((sum,w)=>sum+BigInt(w.collections),0n)+BigInt(scenario.beyond)

test('Analista preserves every Caja baseline field for both histories with exact large integers',()=>{
  const source = sourceWith({bank:'9007199254740993',invoices:[invoice({amount:'9007199254740995'}),invoice({id:'D',disputed:true,amount:'13'})],obligations:[obligation({monto:'18014398509481989'})],profiles:[profile()]})
  const forecast=projectForecast(source)
  for(const baseline of ['base','conservative']) {
    const result=calculateAnalysis(source,specFor(source,{baseline}))
    for(const [key,value] of Object.entries(forecast.scenarios[baseline])) assert.deepEqual(result.scenarios[0][key],value,key)
    assert.equal(result.affected.length,1)
    for(const scenario of result.scenarios) assert.equal(total(scenario),9007199254740995n)
    assert.equal(result.coverage.disputed,'13')
  }
})
test('day 91 is included; delay crossing it is counted exactly once outside horizon',()=>{
  const source=sourceWith({invoices:[invoice({due:'2026-12-26'}),invoice({id:'F2',due:'2026-12-27',amount:'300'}),invoice({id:'F3',due:'2026-12-28',amount:'400'})],profiles:[profile()]})
  const result=calculateAnalysis(source,specFor(source,{delays:[1,2]}))
  assert.equal(result.scenarios[0].weeks.at(-1).collections,'500')
  assert.equal(result.scenarios[0].beyond,'400')
  assert.equal(result.scenarios[1].weeks.at(-1).collections,'200')
  assert.equal(result.scenarios[1].beyond,'700')
  assert.equal(result.scenarios[2].beyond,'900')
  for(const scenario of result.scenarios) assert.equal(total(scenario),900n)
})
test('larger delays never improve daily cumulative cash; equal alternatives match',()=>{
  const source=sourceWith({bank:'-1',invoices:Array.from({length:40},(_,i)=>invoice({id:`F${i}`,customer:`C${i%3}`,due:`2026-10-${String(i%28+1).padStart(2,'0')}`,amount:String(i*919+1)})),obligations:[obligation()],profiles:[profile()]})
  for(const baseline of ['base','conservative']) {
    const result=calculateAnalysis(source,specFor(source,{baseline,selection:{type:'top',count:3},delays:[1,60]}))
    for(let d=0;d<91;d++) assert.ok(BigInt(result.scenarios[0].daily[d].closing)>=BigInt(result.scenarios[1].daily[d].closing) && BigInt(result.scenarios[1].daily[d].closing)>=BigInt(result.scenarios[2].daily[d].closing))
    const same=calculateAnalysis(source,specFor(source,{baseline,delays:[7,7]}))
    assert.deepEqual(same.scenarios[1].daily,same.scenarios[2].daily)
    assert.equal(result.scenarios[0].firstDeficit,source.dashboard.snapshot.fecha_corte)
  }
})
test('all selected invoices move once; unselected and disputed invoices do not move',()=>{
  const source=sourceWith({invoices:[invoice(),invoice({id:'F2',amount:'30'}),invoice({id:'F3',customer:'C2',amount:'40'}),invoice({id:'F4',disputed:true,amount:'5000'})],profiles:[profile(),profile({key:'C2'})]})
  const result=calculateAnalysis(source,specFor(source,{selection:{type:'customers',ids:['C1']}}))
  assert.equal(result.scenarios[0].daily[0].collections,'270')
  assert.equal(result.scenarios[1].daily[0].collections,'40')
  assert.equal(result.scenarios[1].daily[7].collections,'230')
  assert.deepEqual(result.affected.map(i=>i.id),['F1','F2'])
})
test('top ranking excludes disputes and uses customer ID tie-breaker',()=>{
  const source=sourceWith({invoices:[invoice({customer:'C2'}),invoice({id:'F2',customer:'C1'}),invoice({id:'F3',customer:'C3',disputed:true,amount:'99999'})]})
  assert.deepEqual(analystContext(source).customers.map(c=>c.id),['C1','C2'])
})
test('outside-horizon customers yield explicit no-effect evidence; no deficit explains minimum',()=>{
  const source=sourceWith({invoices:[invoice({due:'2027-01-01'})],profiles:[profile()]})
  const result=calculateAnalysis(source,specFor(source))
  assert.equal(result.scenarios[1].noImpact,true)
  assert.match(result.facts.find(f=>f.id==='a-change').text,/Sin impacto/)
  assert.equal(result.scenarios[0].minimum,'100')
  assert.equal(result.scenarios[0].minimumDate,source.dashboard.snapshot.fecha_corte)
  assert.equal(result.drivers.date,source.dashboard.snapshot.fecha_corte)
})
test('server rejects stale, fabricated, duplicate, fractional and out-of-scope specifications',()=>{
  const source=sourceWith({invoices:[invoice()]})
  const context=analystContext(source)
  for(const changes of [{snapshotId:'other'},{baseline:'optimistic'},{bank:'999999'},{delays:[0,7]},{delays:[1,61]},{delays:[1.5,2]},{delays:[7,14,21]},{selection:{type:'top',count:6}},{selection:{type:'top',count:2}},{selection:{type:'customers',ids:['FAKE']}},{selection:{type:'customers',ids:['C1','C1']}},{task:'financing'},{selection:{type:'top',count:1,amount:'500'}},{task:'explain',selection:null,delays:[7]}]) assert.throws(()=>validateSpec(specFor(source,changes),context))
  assert.equal(calculateAnalysis(source,specFor(source,{task:'explain',selection:null,delays:[]})).scenarios.length,1)
})
