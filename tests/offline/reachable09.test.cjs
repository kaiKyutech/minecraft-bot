process.env.LOG_LEVEL = 'error'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { reachable } = require('../../planner_bot/src/planner/reachability')
const { createBotApi } = require('../../planner_bot/api')
const service = require('../../planner_bot/src/planner/planning_service')
const { operationsFor } = require('../../planner_bot/src/executor/operation_manager')
const empty = { inventory: { counts: {} }, nearby: {}, nearby_blocks: {}, equipment: {}, inventory_space: true }
const apiFor = sm => createBotApi({ version: '1.20.1', entity: {}, logLevel: 'error' }, { stateManager: sm || {} })
before(() => service.prepare('1.20.1'))
after(() => service.close())

test('shared closure records ordered sweeps, initial facts, action and computed provenance', () => {
  const {load}=require('../helpers/module'),path=require('node:path')
  const {reachable}=load(path.resolve(__dirname,'../../planner_bot/src/planner/reachability.js'),{'./state_builder':{loadStateSchema:()=>({inventory_states:{has_logs:{computed:true,depends_on_inventory:['oak_log']}}})}})
  const actions = [
    { name: 'finish', preconditions: { mid: true }, effects: { final: true } },
    { name: 'start', preconditions: { seed: 1, forbidden: false }, effects: { mid: 1, deleted: -1 } },
    { name: 'other', preconditions: { seed: 99 }, effects: { mid: 1, 'inventory.oak_log': 1 } }
  ], details = {}, state = { seed: 1, forbidden: true }
  const basic = reachable(actions, state, Infinity), collected = reachable(actions, state, Infinity, null, details)
  assert.deepEqual(collected, basic)
  assert.equal(details.facts.get('seed').round, 0)
  assert.equal(details.facts.get('mid').firstAction, 'start')
  assert.equal(details.facts.get('mid').round, 1)
  assert.equal(details.facts.get('final').round, 2)
  assert.equal(details.facts.get('has_logs').source, 'computed')
  assert.equal(details.facts.get('has_logs').firstAction, 'other')
  assert.equal(collected.has('deleted'), false)
  assert.equal(details.complete, true)
})

test('no inventory, logs, stations and iron retain all fact types and goal semantics', async () => {
  const api = apiFor(), goals = ['inventory.stick:4', 'inventory.iron_ingot:3', 'inventory.category.log:4', 'nearby_workbench:true', 'nearby_workbench:false', 'bad:goal', 'unknown_action']
  const none = await api.reachableFacts({ worldState: empty, goals, maxMs:10000 })
  assert.equal(none.ok, true)
  assert.equal(none.data.goals[0].status, 'unreachable')
  assert.deepEqual(none.data.goals[1].missingKeys, ['inventory.iron_ingot'])
  assert.equal(none.data.goals[4].status, 'possible')
  assert.equal(none.data.goals[5].status, 'invalid')
  assert.equal(none.data.goals[6].status, 'invalid')
  const world = { ...empty, inventory:{counts:{custom_item:1}}, equipment:{mainhand:'custom_item'}, nearby: { oak_log: 2, category: { log: 2 } } }, before = JSON.stringify(world)
  const wood = await api.reachableFacts({ worldState: world, goals: [...goals, 'inventory.custom_item:999'], maxMs:10000 })
  assert.equal(wood.data.goals[0].status, 'possible')
  assert.equal(wood.data.goals[2].status, 'possible')
  assert.equal(wood.data.goals[3].status, 'possible')
  assert.equal(wood.data.goals.at(-1).status, 'possible')
  const map = new Map(wood.data.facts.map(row => [row.key,row]))
  assert.equal(map.get('inventory.custom_item').round, 0)
  assert.equal(map.get('equipment.custom_item').initial, true)
  assert.equal(map.get('nearby.oak_log').initial, true)
  assert.equal(map.get('inventory.stick').initial, false)
  assert.equal(JSON.stringify(world), before)
  wood.data.facts[0].key='tampered'
  const station = await api.reachableFacts({ worldState:{...world,nearby_blocks:{nearby_workbench:true}},maxMs:10000 })
  assert.equal(station.data.facts.find(row=>row.key==='nearby_workbench').round,0)
  assert.equal(station.data.facts.some(row=>row.key==='tampered'),false)
  const iron = await api.reachableFacts({ worldState:{...world,nearby:{...world.nearby,iron_ore:1,stone:10,category:{log:2,basic_stone:10,iron_ore:1}}},goals:['inventory.iron_ingot:3'],maxMs:10000 })
  assert.equal(iron.data.goals[0].status,'possible')
})

test('invalid input, observation timeout, pre-abort and mid-observation abort use Result', async () => {
  const api=apiFor({observe:async()=>{throw Object.assign(Error('Budget'),{code:'BUDGET_EXCEEDED'})}})
  for(const options of [null,{maxMs:-1},{maxMs:Infinity},{goals:'bad'},{goals:[null]},{worldState:[]},{worldState:{kind:'fast_observation'}},{worldState:{complete:false}}])assert.equal((await api.reachableFacts(options)).error.code,'INVALID_ARGUMENT')
  assert.equal((await api.reachableFacts({signal:AbortSignal.abort()})).error.code,'CANCELLED')
  const timed = await api.reachableFacts({goals:['inventory.stick:1']})
  assert.equal(timed.data.timedOut,true);assert.equal(timed.data.observationComplete,false)
  assert.equal(timed.data.goals[0].status,'unknown');assert.equal(timed.data.goals[0].provenImpossible,false)
  const zero = await api.reachableFacts({worldState:empty,goals:['inventory.stick:1'],maxMs:0})
  assert.equal(zero.data.complete,false);assert.equal(zero.data.observationComplete,true)
  const controller = new AbortController()
  const pending = apiFor({observe:async(_bot,{signal})=>{await new Promise(resolve=>setImmediate(resolve));assert.equal(signal,controller.signal);controller.abort();throw Object.assign(Error('Cancelled'),{code:'CANCELLED'})}}).reachableFacts({signal:controller.signal})
  assert.equal((await pending).error.code,'CANCELLED')
})

test('a closure stopped mid-sweep retains partial facts without an impossibility proof', () => {
  const actions=Array.from({length:20},(_,i)=>({name:'step'+i,effects:{['item'+i]:1}})), details={}
  let checks=0
  // Deterministic deadline: expire after one effect, without timing thresholds.
  const old=performance.now
  Object.defineProperty(performance,'now',{configurable:true,value:()=>++checks<3?0:10})
  try { assert.equal(reachable(actions,{},5,null,details),null) }
  finally { Object.defineProperty(performance,'now',{configurable:true,value:old}) }
  assert.equal(details.complete,false);assert.equal(details.timedOut,true);assert.equal(details.facts.size,1)
  const {load}=require('../helpers/module'),path=require('node:path')
  const {compute}=load(path.resolve(__dirname,'../../planner_bot/src/planner/reachable_facts.js'),{
    './state_builder':{buildState:world=>world},
    './goap':{getAllActions:()=>[{name:'first',effects:{'inventory.first':1}},{name:'second',effects:{'inventory.second':1}}]}
  })
  checks=0
  Object.defineProperty(performance,'now',{configurable:true,value:()=>++checks<4?0:10})
  let partial
  try {partial=compute({inventory:{}},['inventory.first:1','inventory.second:1'],5)}
  finally {Object.defineProperty(performance,'now',{configurable:true,value:old})}
  assert.equal(partial.timedOut,true)
  assert.equal(partial.goals[0].status,'possible')
  assert.equal(partial.goals[1].status,'unknown')
  assert.equal(partial.goals[1].provenImpossible,false)
  assert.deepEqual(partial.goals[1].missingKeys,['inventory.second'])
  let signalChecks=0
  assert.throws(()=>reachable(actions,{},Infinity,{get aborted(){return ++signalChecks>2}}),{code:'CANCELLED'})
})

test('queued deadlines and cancellation do not interrupt the current GOAP owner', async () => {
  const goap=require('../../planner_bot/src/planner/goap'),{states}=require('../study04/benchmark.cjs'),fs=require('node:fs'),zlib=require('node:zlib')
  const row=require('../study05/matrix-B.json').rows.find(row=>row.variant==='production'&&row.reason==='iteration_limit')
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(states().find(state=>state.name===row.state).file)))
  const bot={version:'1.20.1',entity:{},logLevel:'error'},api=createBotApi(bot,{stateManager:{}}),operations=operationsFor(bot)
  let release;const running=operations.run('goal',()=>new Promise(resolve=>{release=resolve}))
  await new Promise(resolve=>setImmediate(resolve));const owner=operations.active
  const projected={...world,_gatherEffort:await require('../../planner_bot/src/planner/gather_cost').gatherEffort(world)}
  const blocker=goap.plan(row.goal,projected,null,{worker:true,version:'1.20.1'})
  await new Promise(resolve=>setImmediate(resolve)) // Let the async projection dispatch before queueing the closure.
  let ticks=0;const timer=setInterval(()=>ticks++,2)
  try {
    const timeout=await api.reachableFacts({worldState:empty,goals:['inventory.stick:1'],maxMs:10})
    assert.equal(timeout.ok,true);assert.equal(timeout.data.timedOut,true)
    assert.equal(timeout.data.goals[0].status,'unknown')
    const controller=new AbortController(),abort=setTimeout(()=>controller.abort(),5)
    try {assert.equal((await api.reachableFacts({worldState:empty,signal:controller.signal,maxMs:10000})).error.code,'CANCELLED')}
    finally {clearTimeout(abort)}
    await blocker
    assert.ok((await api.reachableFacts({worldState:empty,maxMs:10000})).data.complete)
    assert.ok(ticks>0);assert.equal(operations.active,owner);assert.equal(owner.controller.signal.aborted,false)
  } finally {clearInterval(timer);release();await running}
})
