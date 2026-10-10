const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { load } = require('../helpers/module')
const tick = () => new Promise(setImmediate)
function fixture() {
  const bot = Object.assign(new EventEmitter(), { version:'1.20.1', entity:{}, logLevel:'error' })
  let model = { actions:[{ name:'table', skill:'hand_craft', params:{recipe:'crafting_table',count:1}, effects:{'inventory.crafting_table':1} }] }
  const world = { inventory:{counts:{oak_planks:8}}, equipment:{}, nearby:{}, nearby_blocks:{}, inventory_space:true, isDay:true }
  const calls = [], sm = { observe:async()=>structuredClone(world), refresh:async()=>{}, getState:async()=>structuredClone(world),
    extractInventory:()=>structuredClone(world.inventory), extractEquipment:()=>world.equipment }
  const planner = { prepareDomain:async()=>{}, getAllActions:()=>model.actions,
    plan:async(goal)=>{ calls.push(['plan',goal]); return {plan:[{action:'table',skill:'hand_craft',params:{recipe:'crafting_table',count:1}}]} } }
  const runner = async(...args)=>{calls.push(['run',args[2],args[10]]);world.inventory.counts.crafting_table=(world.inventory.counts.crafting_table||0)+1}
  runner.buildPickaxePreparationGoals=async()=>[]
  const prepared = load(path.resolve(__dirname,'../../planner_bot/src/executor/prepared_goals.js'), {
    '../planner/domain':{loadDomain:()=>model}, '../planner/goap':planner, './goal_runner':runner
  })
  const candidate = (goal='inventory.crafting_table:1', plan=[{action:'table',skill:'hand_craft',params:{recipe:'crafting_table',count:1}}])=> {
    const result = prepared.retain(bot,{results:[{goal,status:'plannable',plan}]},world)
    return result.results[0]
  }
  return {bot,world,calls,sm,planner,runner,prepared,candidate,changeDomain:()=>{model=structuredClone(model)},mutateDomain:()=>{model.actions[0].effects['inventory.crafting_table']=2}}
}
test('candidate is copied and reuses a plan without observation or planning',async()=>{
  const f=fixture(),row=f.candidate();row.plan[0].params.count=99
  f.sm.observe=()=>{throw Error('should not observe')}
  const result=await f.prepared.prepare(f.bot,f.sm,row.goal,{candidate:row.candidate})
  assert.equal(result.reused,true)
  const record=f.prepared.consume(f.bot,result.handle)
  assert.equal(record.plan[0].params.count,1)
  assert.deepEqual(f.calls,[])
  assert.throws(()=>f.prepared.consume(f.bot,result.handle),{code:'PREPARED_GOAL_INVALID'})
})
test('wrong version/domain, unknown token, and old evaluation rounds fall back to fresh planning',async()=>{
  for(const kind of ['version','domain','mutation','unknown','round']) {
    const f=fixture(),row=f.candidate()
    if(kind==='version')f.bot.version='1.21.4'
    if(kind==='domain')f.changeDomain()
    if(kind==='mutation')f.mutateDomain()
    if(kind==='round')for(let i=0;i<3;i++)f.candidate()
    const result=await f.prepared.prepare(f.bot,f.sm,row.goal,{candidate:kind==='unknown'?'unknown':row.candidate})
    assert.equal(result.reused,false,kind);assert.equal(f.calls[0][0],'plan',kind)
  }
})
test('A then B then C destroys late preparation, and stop/end/abort cannot resurrect it',async()=>{
  for(const kind of ['C','stop','end','abort']) {
    const f=fixture(),pending=[],controller=new AbortController()
    f.sm.observe=()=>new Promise(resolve=>pending.push(resolve))
    const a=f.prepared.prepare(f.bot,f.sm,'inventory.crafting_table:1').catch(e=>e)
    await tick()
    const b=f.prepared.prepare(f.bot,f.sm,'inventory.crafting_table:1',{signal:controller.signal}).catch(e=>e)
    await tick()
    let c
    if(kind==='C'){c=f.prepared.prepare(f.bot,f.sm,'inventory.crafting_table:1');await tick()}
    if(kind==='stop')f.prepared.invalidate(f.bot)
    if(kind==='end')f.bot.emit('end')
    if(kind==='abort')controller.abort()
    for(const resolve of pending)resolve(structuredClone(f.world))
    assert.equal((await a).code,'CANCELLED');assert.equal((await b).code,'CANCELLED')
    if(c)assert.ok((await c).handle)
  }
})
test('handle is rejected if domain changes or preparation signal aborts before execution',async()=>{
  for(const kind of ['domain','abort']) {
    const f=fixture(),controller=new AbortController(),result=await f.prepared.prepare(f.bot,f.sm,'inventory.crafting_table:1',{signal:controller.signal})
    if(kind==='domain')f.changeDomain();else controller.abort()
    assert.throws(()=>f.prepared.consume(f.bot,result.handle),{code:kind==='domain'?'PREPARED_GOAL_INVALID':'CANCELLED'})
  }
})
test('candidate limits, expired handles, foreign bot tokens, and worker invalidation are enforced',async()=>{
  const f=fixture(),row=f.candidate(),originalNow=Date.now
  try {
    Date.now=()=>originalNow()+60001
    const ready=await f.prepared.prepare(f.bot,f.sm,row.goal,{candidate:row.candidate})
    assert.equal(ready.reused,false)
  } finally {Date.now=originalNow}
  const foreign=Object.assign(new EventEmitter(),{version:'1.20.1',entity:{}})
  assert.equal((await f.prepared.prepare(foreign,f.sm,row.goal,{candidate:row.candidate})).reused,false)
  assert.throws(()=>f.prepared.consume(foreign,'unknown'),{code:'PREPARED_GOAL_INVALID'})
  const rows=Array.from({length:129},()=>({goal:row.goal,status:'plannable',plan:[{action:'table',skill:'hand_craft',params:{recipe:'crafting_table',count:1}}]}))
  f.prepared.retain(f.bot,{results:rows},f.world)
  assert.equal((await f.prepared.prepare(f.bot,f.sm,row.goal,{candidate:rows[0].candidate})).reused,false)
  const ready=await f.prepared.prepare(f.bot,f.sm,row.goal,{candidate:rows[128].candidate}),record=f.prepared.consume(f.bot,ready.handle)
  record.createdAt-=60001
  await assert.rejects(f.prepared.execute(f.bot,f.sm,record),{code:'PREPARED_GOAL_INVALID'})
  const next=await f.prepared.prepare(f.bot,f.sm,row.goal)
  f.prepared.invalidateDomain()
  assert.throws(()=>f.prepared.consume(f.bot,next.handle),{code:'PREPARED_GOAL_INVALID'})
})
test('environmental Boolean preparation observes current facts and does not claim stale achievement',async()=>{
  const f=fixture();f.world.nearby_blocks.nearby_workbench=true
  assert.equal(require('../../planner_bot/src/planner/state_builder').buildState(f.world,f.bot.version).nearby_workbench,true)
  const row=f.candidate('nearby_workbench:true',[])
  f.world.nearby_blocks.nearby_workbench=false
  let observations=0
  f.sm.observe=async()=>{observations++;return structuredClone(f.world)}
  const ready=await f.prepared.prepare(f.bot,f.sm,row.goal,{candidate:row.candidate})
  assert.equal(ready.alreadySatisfied,false);assert.ok(observations>=1);assert.equal(ready.reused,false)
})
test('custom state managers without direct inventory readers use fresh observations',async()=>{
  const f=fixture(),row=f.candidate('inventory.crafting_table:true')
  delete f.sm.extractInventory;delete f.sm.extractEquipment
  f.world.inventory.counts.crafting_table=1
  const ready=await f.prepared.prepare(f.bot,f.sm,row.goal,{candidate:row.candidate})
  assert.equal(ready.alreadySatisfied,true)
  const record=f.prepared.consume(f.bot,ready.handle);delete f.world.inventory.counts.crafting_table
  await f.prepared.execute(f.bot,f.sm,record)
  assert.equal(f.world.inventory.counts.crafting_table,1)
})
test('Boolean achieved after prepare skips stale crafting; numeric target adds to execution inventory',async()=>{
  for(const boolean of [true,false]) {
    const f=fixture(),goal=`inventory.crafting_table:${boolean?'true':'1'}`,row=f.candidate(goal)
    const ready=await f.prepared.prepare(f.bot,f.sm,goal,{candidate:row.candidate}),record=f.prepared.consume(f.bot,ready.handle)
    f.world.inventory.counts.crafting_table=1
    await f.prepared.execute(f.bot,f.sm,record)
    assert.equal(f.world.inventory.counts.crafting_table,boolean?1:2)
    assert.equal(f.calls.filter(x=>x[0]==='run').length,boolean?0:1)
  }
})
test('stale empty plan cannot succeed if the runner produces no result',async()=>{
  const f=fixture();f.world.inventory.counts.crafting_table=1
  const row=f.candidate('inventory.crafting_table:true',[])
  const ready=await f.prepared.prepare(f.bot,f.sm,row.goal,{candidate:row.candidate}),record=f.prepared.consume(f.bot,ready.handle)
  delete f.world.inventory.counts.crafting_table
  // The usual fallback runner repairs the goal. A different goal with no effect fails explicitly.
  await f.prepared.execute(f.bot,f.sm,record)
  assert.equal(f.world.inventory.counts.crafting_table,1)
  const bad=await f.prepared.prepare(f.bot,f.sm,'inventory.stick:4')
  await assert.rejects(f.prepared.execute(f.bot,f.sm,f.prepared.consume(f.bot,bad.handle)),{code:'GOAL_NOT_SATISFIED'})
})
test('tool prefix is planned read-only, executed once, and root resumes fresh',async()=>{
  const f=fixture();f.runner.buildPickaxePreparationGoals=async()=>['inventory.category.pickaxe:true']
  const ready=await f.prepared.prepare(f.bot,f.sm,'inventory.crafting_table:1',{candidate:f.candidate().candidate})
  assert.equal(ready.preparationGoal,'inventory.category.pickaxe:true');assert.equal(ready.reused,false)
  assert.deepEqual(f.calls,[['plan','inventory.category.pickaxe:true']])
  await f.prepared.execute(f.bot,f.sm,f.prepared.consume(f.bot,ready.handle))
  assert.equal(f.calls[1][1],'inventory.category.pickaxe:true');assert.ok(f.calls[1][2].plan)
  assert.equal(f.calls[2][1],'inventory.crafting_table:1');assert.equal(f.calls[2][2],undefined)
})
test('unplannable tool preparation returns failure while preserving the old operation',async()=>{
  const f=fixture();f.bot.currentAbortController=new AbortController()
  f.runner.buildPickaxePreparationGoals=async()=>['inventory.category.pickaxe:true']
  f.planner.plan=async()=>({plan:null,diagnosis:{}})
  await assert.rejects(f.prepared.prepare(f.bot,f.sm,'inventory.crafting_table:1',{candidate:f.candidate().candidate}),{code:'PLAN_NOT_FOUND'})
  assert.equal(f.bot.currentAbortController.signal.aborted,false);assert.equal(f.calls.some(x=>x[0]==='run'),false)
})
test('a pre-aborted new preparation invalidates the previous handle without aborting the old owner',async()=>{
  const f=fixture(),ready=await f.prepared.prepare(f.bot,f.sm,'inventory.crafting_table:1')
  f.bot.currentAbortController=new AbortController()
  const aborted=new AbortController();aborted.abort()
  await assert.rejects(f.prepared.prepare(f.bot,f.sm,'inventory.crafting_table:1',{signal:aborted.signal}),{code:'CANCELLED'})
  assert.throws(()=>f.prepared.consume(f.bot,ready.handle),{code:'PREPARED_GOAL_INVALID'})
  assert.equal(f.bot.currentAbortController.signal.aborted,false)
})
test('default evaluation has no tokens, public prepared path retains progress and ownership',async()=>{
  const fs=require('node:fs'),zlib=require('node:zlib'),{createBotApi}=require('../../planner_bot/src/api'),skills=require('../../planner_bot/src/skills')
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../fixtures/natural-empty.json.gz'))))
  world.inventory.counts={oak_planks:8}
  const bot=Object.assign(new EventEmitter(),{version:'1.20.1',entity:{},systemLog(){},logLevel:'error'})
  const sm={observe:async()=>structuredClone(world),refresh:async()=>{},getState:async()=>structuredClone(world),extractInventory:()=>world.inventory,extractEquipment:()=>world.equipment}
  const api=createBotApi(bot,{stateManager:sm}),goal='inventory.crafting_table:1'
  const plain=await api.evaluateGoals([goal],{worldState:world,maxMs:20000,perGoalMs:20000})
  assert.equal(plain.ok,true);assert.equal(Object.hasOwn(plain.data.results[0],'candidate'),false)
  const evaluated=await api.evaluateGoals([goal],{worldState:world,maxMs:20000,perGoalMs:20000,includePrepared:true})
  const ready=await api.prepareGoal(goal,{candidate:evaluated.data.results[0].candidate})
  assert.equal(ready.ok,true);assert.equal(ready.data.reused,true)
  const original=skills.hand_craft,events=[]
  skills.hand_craft=async()=>{world.inventory.counts.oak_planks-=4;world.inventory.counts.crafting_table=1}
  try {
    const result=await api.executePreparedGoal(ready.data.handle,{onProgress:e=>events.push(e)})
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(events[0].type,'goal_start');assert.equal(events.at(-1).type,'goal_end')
    assert.equal((await api.executePreparedGoal(ready.data.handle)).error.code,'PREPARED_GOAL_INVALID')
    const next=await api.prepareGoal(goal,{candidate:evaluated.data.results[0].candidate});await api.stop()
    assert.equal((await api.executePreparedGoal(next.data.handle)).error.code,'PREPARED_GOAL_INVALID')
  } finally {skills.hand_craft=original;bot.emit('end');await require('../../planner_bot/src/planner/planning_service').close()}
})
test('public preparation leaves old owner running and a newer selection during drain blocks stale execution',async()=>{
  const {createBotApi}=require('../../planner_bot/src/api'),{operationsFor}=require('../../planner_bot/src/executor/operation_manager')
  const fs=require('node:fs'),zlib=require('node:zlib')
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../fixtures/natural-empty.json.gz'))));world.inventory.counts={oak_planks:8}
  const bot=Object.assign(new EventEmitter(),{version:'1.20.1',entity:{},systemLog(){},logLevel:'error'})
  const sm={observe:async()=>structuredClone(world),refresh:async()=>{},getState:async()=>structuredClone(world),extractInventory:()=>world.inventory,extractEquipment:()=>world.equipment}
  const api=createBotApi(bot,{stateManager:sm}),manager=operationsFor(bot),goal='inventory.crafting_table:1'
  const evaluated=await api.evaluateGoals([goal],{worldState:world,maxMs:20000,perGoalMs:20000,includePrepared:true})
  const token=evaluated.data.results[0].candidate
  let finish;const old=manager.run('old',()=>new Promise(resolve=>{finish=resolve})).catch(e=>e)
  await tick();const owner=bot.currentAbortController
  const a=await api.prepareGoal(goal,{candidate:token});assert.equal(a.ok,true);assert.equal(owner.signal.aborted,false)
  const events=[],handoff=api.executePreparedGoal(a.data.handle,{onProgress:e=>events.push(e)})
  await tick();assert.equal(owner.signal.aborted,true)
  const c=await api.prepareGoal(goal,{candidate:token});assert.equal(c.ok,true)
  finish();assert.equal((await old).code,'CANCELLED')
  assert.equal((await handoff).error.code,'PREPARED_GOAL_INVALID')
  assert.equal(events.some(e=>e.type==='step_start'),false)
  await api.stop();bot.emit('end');await require('../../planner_bot/src/planner/planning_service').close()
})
test('public tool preparation reports the parent/subgoal relationship and does not craft the tool twice',async()=>{
  const fs=require('node:fs'),zlib=require('node:zlib'),{createBotApi}=require('../../planner_bot/src/api'),skills=require('../../planner_bot/src/skills')
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../fixtures/natural-empty.json.gz'))))
  world.inventory.counts={oak_planks:16,stick:8,cobblestone:8};world.nearby_blocks.nearby_workbench=true;world.nearby_blocks.visible_workbench=true
  const bot=Object.assign(new EventEmitter(),{version:'1.20.1',entity:{},systemLog(){},logLevel:'error'})
  const sm={observe:async()=>structuredClone(world),refresh:async()=>{},getState:async()=>structuredClone(world),extractInventory:()=>world.inventory,extractEquipment:()=>world.equipment}
  const api=createBotApi(bot,{stateManager:sm}),goal='inventory.furnace:1',events=[],original=skills.workbench_craft
  skills.workbench_craft=async(bot,params)=>{
    world.inventory.counts[params.recipe]=(world.inventory.counts[params.recipe]||0)+1
    if(params.recipe==='wooden_pickaxe'){world.inventory.counts.oak_planks-=3;world.inventory.counts.stick-=2}
    if(params.recipe==='furnace')world.inventory.counts.cobblestone-=8
  }
  try {
    const ready=await api.prepareGoal(goal);assert.equal(ready.ok,true,JSON.stringify(ready))
    assert.equal(ready.data.preparationGoal,'inventory.category.pickaxe:true')
    const result=await api.executePreparedGoal(ready.data.handle,{onProgress:e=>events.push(e)})
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(world.inventory.counts.wooden_pickaxe,1);assert.equal(world.inventory.counts.furnace,1)
    assert.ok(events.some(e=>e.type==='subgoal_enter'&&e.goal==='inventory.category.pickaxe:true'&&e.parentGoal===goal))
    assert.equal(events.at(-1).type,'goal_end')
  } finally {skills.workbench_craft=original;bot.emit('end');await require('../../planner_bot/src/planner/planning_service').close()}
})
