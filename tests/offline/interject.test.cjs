process.env.LOG_LEVEL = 'error'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const { load } = require('../helpers/module')
const { operationsFor } = require('../../planner_bot/src/executor/operation_manager')
const { withContext } = require('../../planner_bot/src/utils/context')
const { Progress } = require('../../planner_bot/src/executor/progress')
const tick = () => new Promise(setImmediate)
const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve }), release: () => release() } }
function fixture({ skills = {}, analyse = () => ({ satisfied: true }), replacement = [] } = {}) {
  const calls = [], events = [], world = { inventory: { counts: {} } }
  const bot = Object.assign(new EventEmitter(), { version: '1.20.1', entity: { position: new Vec3(0,64,0) }, logLevel:'error', systemLog(){},
    inventory: { items: () => [{ type: 1, name:'pickaxe', count:1 }] }, heldItem:{type:1},
    equip: async item => { bot.heldItem=item; calls.push('restore') }, unequip: async () => { bot.heldItem=null },
    pathfinder: { setGoal: () => calls.push('stopPath') }, stopDigging: () => calls.push('stopDig') })
  const sm = { refresh: async () => calls.push('refresh'), getState: async () => world }
  const planner = { plan: async () => { calls.push('replan'); return { plan:replacement } } }
  const executor = load(path.resolve(__dirname,'../../planner_bot/src/executor/goap_executor.js'), {
    '../skills': skills, '../planner/goap':planner,
    './precondition_checker': { analyseStepPreconditions: async (bot,step) => analyse(step), getStateValue: () => 0 }
  })
  const manager=operationsFor(bot), reporter=new Progress(bot,e=>events.push(e))
  const execute=(steps,options={}) => manager.run('goal',signal=>withContext({progress:reporter},()=>executor.executePlanWithReplanning(bot,'inventory.log:3',steps,sm,signal)),options)
  return {bot,sm,world,calls,events,manager,execute}
}
for (const kind of ['walk','dig','craft']) test(`interjection during ${kind} waits for issued skill, retains owner and same remaining plan`,async()=>{
  const issued=gate(),order=[]
  const f=fixture({skills:{first:async()=>{order.push(kind);await issued.promise;order.push('issued_done')},next:async()=>order.push('next')}})
  const goal=f.execute([{action:kind,skill:'first'},{action:'next',skill:'next'}]);await tick()
  const owner=f.manager.active, controller=f.bot.currentAbortController
  const insertion=f.manager.interject('placeTorch',async()=>{assert.equal(f.manager.active,owner);order.push('torch');f.bot.heldItem={type:2};return {placed:true}})
  await tick();assert.deepEqual(order,[kind]);assert.equal(controller.signal.aborted,false)
  issued.release();assert.deepEqual(await insertion,{placed:true});await goal
  assert.deepEqual(order,[kind,'issued_done','torch','next']);assert.equal(f.bot.heldItem.type,1)
  assert.equal(f.calls.includes('replan'),false);assert.equal(f.events.filter(e=>e.type==='plan').length,1)
  assert.equal(f.events.find(e=>e.type==='interject_resume').mode,'same_plan')
  assert.deepEqual(f.events.filter(e=>e.type==='step_start').map(e=>e.stepIndex),[0,1])
})
test('failed interjection returns its error and continues the original goal',async()=>{
  const issued=gate();let continued=false
  const f=fixture({skills:{first:()=>issued.promise,next:async()=>{continued=true}}})
  const goal=f.execute([{skill:'first'},{skill:'next'}]);await tick()
  const insertion=f.manager.interject('placeTorch',async()=>{throw Object.assign(Error('no face'),{code:'PLACEMENT_FAILED'})}).catch(e=>e)
  issued.release();assert.equal((await insertion).code,'PLACEMENT_FAILED');await goal
  assert.equal(continued,true);assert.equal(f.calls.includes('replan'),false)
  assert.equal(f.events.find(e=>e.type==='interject_end').result.error.code,'PLACEMENT_FAILED')
})
for(const kind of ['stop','goal_abort','interject_abort','end']) test(`${kind} during interjection drains issued action and stops the whole goal`,async()=>{
  const action=gate(),issued=gate(),controller=new AbortController(),insertionController=new AbortController();let continued=false
  const f=fixture({skills:{first:()=>issued.promise,next:async()=>{continued=true}}})
  const goal=f.execute([{skill:'first'},{skill:'next'}],{signal:controller.signal}).catch(e=>e);await tick()
  const insertion=f.manager.interject('placeTorch',()=>action.promise,{signal:insertionController.signal}).catch(e=>e)
  issued.release();for(let i=0;i<10&&!f.events.some(e=>e.type==='interject_start');i++)await tick()
  assert.equal(f.events.at(-1).type,'interject_start')
  await assert.rejects(f.manager.interject('placeTorch',async()=>{}),{code:'INTERJECT_BUSY'})
  let stopped
  if(kind==='stop')stopped=f.manager.stop()
  if(kind==='goal_abort')controller.abort()
  if(kind==='interject_abort')insertionController.abort()
  if(kind==='end')f.bot.emit('end')
  await tick();assert.equal(f.manager.active.kind,'goal');assert.equal(continued,false)
  action.release();assert.equal((await insertion).code,'CANCELLED');assert.equal((await goal).code,'CANCELLED');if(stopped)await stopped
  assert.equal(continued,false);assert.equal(f.manager.active,null)
})
test('overlap and pre-aborted requests do not replace the owner',async()=>{
  const issued=gate();const f=fixture({skills:{first:()=>issued.promise}})
  const goal=f.execute([{skill:'first'}]);await tick();const owner=f.manager.active
  const insertion=f.manager.interject('placeTorch',async()=>({}));await assert.rejects(f.manager.interject('placeTorch',async()=>{}),{code:'INTERJECT_BUSY'})
  const c=new AbortController();c.abort();await assert.rejects(f.manager.interject('placeTorch',async()=>{},{signal:c.signal}),{code:'CANCELLED'})
  assert.equal(owner.controller.signal.aborted,false);issued.release();await insertion;await goal
})
test('pending insertion is cancelled when its goal stops before reaching a safe boundary',async()=>{
  const issued=gate(),f=fixture({skills:{first:()=>issued.promise}})
  const goal=f.execute([{skill:'first'}]).catch(e=>e);await tick()
  const insertion=f.manager.interject('placeTorch',async()=>{throw Error('must not execute')}).catch(e=>e)
  const stop=f.manager.stop();issued.release()
  assert.equal((await goal).code,'CANCELLED');assert.equal((await insertion).code,'CANCELLED');await stop
  assert.equal(f.events.some(e=>e.type==='interject_start'),false)
})
test('torch consumption conflicting with next precondition invokes existing replan only on opt-in path',async()=>{
  const issued=gate();let torches=1,oldStep=false,replacement=false
  const f=fixture({skills:{first:()=>issued.promise,old:async()=>{oldStep=true},replacement:async()=>{replacement=true}},
    analyse:step=>({satisfied:step.skill!=='old'||torches>0,missing:[{key:'inventory.torch',condition:1,currentValue:torches}]}),replacement:[{skill:'replacement'}]})
  const goal=f.execute([{skill:'first'},{skill:'old'}]);await tick()
  const insertion=f.manager.interject('placeTorch',async()=>{torches--;return {}})
  issued.release();await insertion;await goal
  assert.equal(oldStep,false);assert.equal(replacement,true);assert.equal(f.calls.filter(c=>c==='replan').length,1)
  assert.equal(f.events.find(e=>e.type==='interject_resume').mode,'replan')
  assert.notEqual(f.events.find(e=>e.type==='plan').planId,f.events.find(e=>e.type==='replan').planId)
})
test('an already fulfilled false precondition keeps the existing skip after interjection',async()=>{
  const issued=gate();let skippedRan=false
  const f=fixture({skills:{first:()=>issued.promise,old:async()=>{skippedRan=true}},
    analyse:step=>step.skill==='old'?{satisfied:false,missing:[{condition:false,currentValue:true}]}:{satisfied:true}})
  const goal=f.execute([{skill:'first'},{skill:'old'}]);await tick()
  const insertion=f.manager.interject('placeTorch',async()=>({}));issued.release();await insertion;await goal
  assert.equal(skippedRan,false);assert.equal(f.calls.includes('replan'),false)
  assert.equal(f.events.some(e=>e.type==='step_skipped'),true)
})
test('gather interjects between individual digs and preserves the partial count inside the same skill',async()=>{
  const issued=gate(),positions=[1,2,3].map(x=>new Vec3(x,64,0));let digs=0
  const f=fixture();f.world.inventory.counts.log=5
  f.bot.blockAt=position=>({name:'oak_log',position})
  const gather=load(path.resolve(__dirname,'../../planner_bot/src/skills/gather.js'),{'../primitives':{
    findBlock:async()=>({position:positions[0]}),findBestTool:async()=>null,
    findBlocks:async()=>positions.slice(digs).map(position=>({name:'oak_log',position})),moveTo:async()=>{},
    digBlock:async()=>{if(digs===0)await issued.promise;digs++;f.world.inventory.counts.log++}
  }})
  const executor=load(path.resolve(__dirname,'../../planner_bot/src/executor/goap_executor.js'),{'../skills':{gather},
    './precondition_checker':{analyseStepPreconditions:async()=>({satisfied:true})}})
  const goal=f.manager.run('goal',signal=>withContext({progress:new Progress(f.bot,e=>f.events.push(e))},()=>executor.executePlanWithReplanning(f.bot,'inventory.log:3',[{skill:'gather',params:{itemName:'oak_log',count:3,collectItem:false}}],f.sm,signal)))
  await new Promise(resolve=>setTimeout(resolve,100))
  const insertion=f.manager.interject('placeTorch',async()=>{assert.equal(digs,1);return {}})
  issued.release();await insertion;await goal
  assert.equal(digs,3);assert.equal(f.world.inventory.counts.log,8)
  assert.equal(f.events.filter(e=>e.type==='step_start').length,1);assert.equal(f.events.some(e=>e.type==='replan'),false)
  assert.equal(f.events.find(e=>e.type==='interject_start').boundary,'gather_block')
})
test('public whitelist, idle fallback, Result and prepared execution use the same interjection queue',async()=>{
  const issued=gate(),f=fixture({skills:{first:()=>issued.promise,next:async()=>{}}});let placements=0
  const run=async(bot,user,goal,sm,signal)=>{
    const executor=load(path.resolve(__dirname,'../../planner_bot/src/executor/goap_executor.js'),{'../skills':{first:()=>issued.promise,next:async()=>{}},'./precondition_checker':{analyseStepPreconditions:async()=>({satisfied:true})}})
    await executor.executePlanWithReplanning(bot,goal,[{skill:'first'},{skill:'next'}],sm,signal)
  }
  const {createBotApi}=load(path.resolve(__dirname,'../../planner_bot/src/api.js'),{
    './executor/goal_runner':run,'./executor/prepared_goals':{consume:()=>({goal:'inventory.log:3'}),execute:(bot,sm,record,signal)=>run(bot,'api',record.goal,sm,signal)},
    './navigation/torch_placement':{torchOptions:x=>x,placeTorch:async()=>{placements++;return {placed:true}}}
  })
  const api=createBotApi(f.bot,{stateManager:f.sm})
  assert.deepEqual((await api.interject('placeTorch')).data,{placed:true})
  const goal=api.executePreparedGoal('handle',{onProgress:e=>f.events.push(e)});await tick();const owner=f.manager.active
  assert.equal((await api.interject('executeGoal')).error.code,'INTERJECT_NOT_ALLOWED')
  const insertion=api.interject('placeTorch');await tick();assert.equal(f.manager.active,owner);assert.equal(owner.controller.signal.aborted,false)
  issued.release();assert.equal((await insertion).ok,true);assert.equal((await goal).ok,true)
  assert.equal(placements,2);assert.equal(f.events.some(e=>e.type==='replan'),false)
})
test('real prepared execution survives interjection while an unexecuted handle is invalidated',async()=>{
  const fs=require('node:fs'),zlib=require('node:zlib'),skills=require('../../planner_bot/src/skills')
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../fixtures/natural-empty.json.gz'))));world.inventory.counts={oak_planks:8}
  const f=fixture(),issued=gate(),original=skills.hand_craft
  const sm={observe:async()=>structuredClone(world),refresh:async()=>{},getState:async()=>structuredClone(world),extractInventory:()=>world.inventory,extractEquipment:()=>world.equipment}
  const {createBotApi}=load(path.resolve(__dirname,'../../planner_bot/src/api.js'),{'./navigation/torch_placement':{torchOptions:x=>x,placeTorch:async()=>({placed:true})}})
  const api=createBotApi(f.bot,{stateManager:sm}),goalName='inventory.crafting_table:1'
  skills.hand_craft=async()=>{await issued.promise;world.inventory.counts.oak_planks-=4;world.inventory.counts.crafting_table=1}
  try {
    const ready=await api.prepareGoal(goalName);assert.equal(ready.ok,true)
    let earlyResult
    const goal=api.executePreparedGoal(ready.data.handle,{onProgress:e=>f.events.push(e)}).then(result=>{earlyResult=result;return result})
    const deadline=Date.now()+10000
    while(!earlyResult&&!f.events.some(e=>e.type==='step_start')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10))
    assert.equal(f.events.some(e=>e.type==='step_start'),true,JSON.stringify(earlyResult))
    const pending=await api.prepareGoal(goalName);assert.equal(pending.ok,true)
    assert.equal((await api.interject('dig')).error.code,'INTERJECT_NOT_ALLOWED')
    const insertion=api.interject('placeTorch');issued.release()
    assert.equal((await insertion).ok,true);assert.equal((await goal).ok,true)
    assert.equal((await api.executePreparedGoal(pending.data.handle)).error.code,'PREPARED_GOAL_INVALID')
    assert.equal(world.inventory.counts.crafting_table,1);assert.equal(f.events.some(e=>e.type==='replan'),false)
  } finally {issued.release();skills.hand_craft=original;await api.stop();f.bot.emit('end');await require('../../planner_bot/src/planner/planning_service').close()}
})
