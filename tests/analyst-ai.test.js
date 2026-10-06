import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aiAvailability, callModel, resolveInterpretation, validateExplanation, MODEL, modelInput } from '../worker/analyst/ai.js'
import { analystContext, calculateAnalysis } from '../worker/analyst/calculate.js'
import { collectionsSource } from './fixtures/collections-data.js'
const source=collectionsSource(),context=analystContext(source),snapshotId=context.snapshot.id
const supported={status:'supported',task:'simulate',baseline:'base',selection:{type:'top',count:1,names:[]},delays:[7]}
const response = value => ({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:300,output_tokens:50,total_tokens:350}})
const envFor = run => ({AI_ENABLED:'true',AI_GATEWAY_ID:'nortia-analista',AI_DEMO_END:'2099-01-01T00:00:00Z',AI:{run}})

test('inference requires every configuration item and a nonexpired fixed UTC cutoff',()=>{
  const env=envFor(()=>{})
  assert.equal(aiAvailability(env).available,true)
  for(const key of ['AI_ENABLED','AI_GATEWAY_ID','AI_DEMO_END','AI']) {const copy={...env};delete copy[key];assert.equal(aiAvailability(copy).available,false)}
  assert.equal(aiAvailability({...env,AI_DEMO_END:'2020-01-01T00:00:00Z'}).code,'expired')
  assert.equal(aiAvailability({...env,AI_DEMO_END:'tomorrow'}).code,'configuration')
  assert.equal(aiAvailability(env,Date.parse(env.AI_DEMO_END)).code,'expired')
})
test('one gateway-only call enforces low reasoning, output budget, no logging/cache, and logs metadata only',async t=>{
  const logs=[];t.mock.method(console,'info',s=>logs.push(JSON.parse(s)))
  let calls=0
  const env=envFor(async(model,input,options)=>{
    calls++;assert.equal(model,MODEL);assert.equal(input.max_output_tokens,2048);assert.deepEqual(input.reasoning,{effort:'low'})
    assert.equal(options.gateway.id,'nortia-analista');assert.equal(options.gateway.collectLog,false);assert.equal(options.gateway.skipCache,true)
    assert.equal(options.gateway.metadata.requestId,'test-id');return response(supported)
  })
  const result=await callModel(env,'interpret',{request:'private text'},'test-id',o=>resolveInterpretation(o,context,snapshotId,'top 1 delay 7 days'))
  assert.equal(calls,1);assert.equal(result.value.status,'supported');assert.equal(logs[0].usage.total_tokens,350)
  assert.ok(!JSON.stringify(logs).includes('private text'))
  assert.ok(new TextEncoder().encode(JSON.stringify(modelInput('interpret',{request:'á'.repeat(1000)}))).byteLength<16384)
})
test('missing configuration and oversized serialized evidence never call provider',async()=>{
  let calls=0;const env=envFor(()=>{calls++})
  assert.equal((await callModel({...env,AI_ENABLED:'false'},'interpret',{},'x',o=>o)).ai.code,'disabled')
  assert.equal((await callModel(env,'explain',{facts:'x'.repeat(17000)},'x',o=>o)).ai.code,'input_limit')
  assert.equal(calls,0)
})
test('invalid JSON, invented references, gateway denial and unavailable model produce safe fallback without retries',async t=>{
  t.mock.method(console,'info',()=>{})
  const scenario={snapshotId,task:'compare',baseline:'base',selection:{type:'top',count:1},delays:[7,14]}
  const result=calculateAnalysis(source,scenario)
  for(const [run,code] of [[async()=>({output:[]}), 'invalid'],[async()=>response({factIds:['fabricated']}),'invalid'],[async()=>{throw Object.assign(new Error('private body'),{status:429})},'limited'],[async()=>{throw new Error('model unavailable private body')},'unavailable']]) {
    let calls=0
    const output=await callModel(envFor(async()=>{calls++;return run()}),'explain',{facts:result.facts},'id',o=>validateExplanation(o,result))
    assert.equal(calls,1);assert.equal(output.ai.code,code);assert.equal(output.value,undefined)
    assert.ok(!output.ai.message.includes('private body'))
    assert.ok(result.explanation.factIds.length>0)
  }
})
test('application deadline returns fallback at 30 seconds with no retry',async t=>{
  t.mock.method(console,'info',()=>{});t.mock.timers.enable({apis:['setTimeout']})
  let calls=0
  const pending=callModel(envFor(()=>{calls++;return new Promise(()=>{})}),'interpret',{},'timeout',o=>o)
  t.mock.timers.tick(30000)
  assert.equal((await pending).ai.code,'timeout');assert.equal(calls,1)
})
test('named selections use actual eligible records, never guessed or ambiguous identities',()=>{
  const interpret=(names,text,customers=context.customers)=>resolveInterpretation({...supported,selection:{type:'names',count:null,names}},{...context,customers},snapshotId,text)
  assert.deepEqual(interpret(['Cliente de prueba'],'Demora Cliente de prueba 7 días').spec.selection,{type:'customers',ids:['C1']})
  assert.deepEqual(interpret(['C1'],'Delay C1 7 days').spec.selection,{type:'customers',ids:['C1']})
  assert.equal(interpret(['Cliente'],'Demora Cliente 7 días',[...context.customers,{id:'C2',name:'Cliente secundario',amount:'1'}]).status,'needs_input')
  assert.equal(interpret(['Fantasma'],'Delay Fantasma 7 days').status,'needs_input')
  assert.throws(()=>interpret(['C1'],'Delay the largest customer'))
})
test('out-of-range and malformed interpretations cannot become executable assumptions',()=>{
  for(const output of [{...supported,delays:[61]},{...supported,selection:{type:'top',count:6,names:[]}},{...supported,selection:{type:'top',count:2,names:[]}}]) assert.equal(resolveInterpretation(output,context,snapshotId,'request').status,'needs_input')
  for(const output of [{...supported,amount:'999'},{...supported,task:'financing'},{...supported,selection:{type:'all',count:null,names:[]}},{...supported,delays:['7']}]) assert.throws(()=>resolveInterpretation(output,context,snapshotId,'request'))
  for(const status of ['unsupported','needs_input']) assert.equal(resolveInterpretation({...supported,status},context,snapshotId,'request').status,status)
})
test('explanations accept only supplied evidence, with mandatory scenario coverage and no generated prose',()=>{
  const result=calculateAnalysis(source,{snapshotId,task:'simulate',baseline:'base',selection:{type:'top',count:1},delays:[7]})
  assert.equal(validateExplanation({factIds:result.facts.map(f=>f.id)},result).status,'ai')
  for(const output of [{factIds:['baseline']},{factIds:['baseline','a','a-change','invented']},{factIds:['baseline','a','a-change'],text:'cash is 999'},{factIds:['baseline','a','a-change','a']},{factIds:['__proto__']}]) assert.throws(()=>validateExplanation(output,result))
})
