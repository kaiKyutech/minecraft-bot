process.env.LOG_LEVEL='error'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),zlib=require('zlib')
const goap=require('../../planner_bot/src/planner/goap'),service=require('../../planner_bot/src/planner/planning_service'),{evaluate}=require('../../planner_bot/src/planner/goal_evaluator')
const quiet={enabled:()=>false,info(){},warn(){},error(){},debug(){}}
const row=require('../study05/matrix-B.json').rows.filter(r=>r.variant==='production'&&r.reason==='iteration_limit').sort((a,b)=>b.durationMs-a.durationMs)[0]
const state=require('../study04/benchmark.cjs').states().find(s=>s.name===row.state),world=JSON.parse(zlib.gunzipSync(fs.readFileSync(state.file)))
before(()=>goap.prepareDomain('1.20.1',quiet));after(()=>service.close())
test('worker search keeps main-thread timers running and acknowledges mid-search cancellation',async()=>{
 let ticks=0;const timer=setInterval(()=>ticks++,5),controller=new AbortController(),abort=setTimeout(()=>controller.abort(),30)
 try{await assert.rejects(goap.plan(row.goal,world,quiet,{version:'1.20.1',worker:true,signal:controller.signal}),{code:'CANCELLED'});assert.ok(ticks>=2)}finally{clearInterval(timer);clearTimeout(abort)}
 const next=await goap.plan('inventory.dirt:1',world,quiet,{worker:true});assert.ok(next.plan)
})
test('expired worker budgets and signals retain typed failures before dispatch',async()=>{
 await assert.rejects(goap.plan(row.goal,world,quiet,{worker:true,deadline:0}),{code:'BUDGET_EXCEEDED'})
 await assert.rejects(goap.plan(row.goal,world,quiet,{worker:true,signal:AbortSignal.abort()}),{code:'CANCELLED'})
 await assert.rejects(goap.plan(row.goal,world,quiet,{worker:true,version:'1.19.4'}),{code:'VERSION_CONFLICT'})
 assert.ok((await goap.plan('inventory.dirt:1',world,quiet,{worker:true,deadline:Infinity})).plan)
})
test('whole evaluation budget includes queueing; a timed-out job cannot poison the next result',async()=>{
 let finished=false;const blocker=goap.plan(row.goal,world,quiet,{worker:true}).then(result=>{finished=true;return result}),bot={version:'1.20.1'}
 const batch=await evaluate(bot,{},[row.goal],{worldState:{...world,blocks:{list:[]}},maxMs:25,perGoalMs:25});assert.equal(batch.results[0].reason,'budget_exceeded');assert.equal(finished,false,'expired queued evaluation must return before the long search');await blocker
 const full=await evaluate(bot,{},[row.goal],{worldState:world,maxMs:10000,perGoalMs:10000});assert.equal(full.results[0].reason,'iteration_limit');assert.equal(full.timedOut,false)
})
test('non-data objects outside buildState fields are not sent to the worker',async()=>{
 const input={inventory:{counts:{oak_log:1},raw:[{method(){}}]},position:{x:0,y:1,z:0},nearby:{},nearby_blocks:{},equipment:{},inventory_space:true,ignored(){}}
 const main=await goap.plan('inventory.stick:4',input,quiet,{worker:false}),threaded=await goap.plan('inventory.stick:4',input,quiet,{worker:true});assert.deepEqual(threaded,main)
})
test('worker resource estimates match the full-list estimator including ties and input isolation',async()=>{
 const input={inventory:{counts:{}},nearby:{oak_log:2,category:{log:2}},nearby_blocks:{},equipment:{},inventory_space:true,position:{x:.5,y:1,z:.5},blocks:{list:[{name:'oak_log',position:{x:1,y:1,z:0}},{name:'oak_log',position:{x:0,y:1,z:1}}]}}
 const bot={version:'1.20.1'},main=await evaluate(bot,{},['inventory.category.log:4'],{worldState:input,maxMs:5000,worker:false}),threaded=await evaluate(bot,{},['inventory.category.log:4'],{worldState:input,maxMs:5000})
 assert.deepEqual(threaded.results,main.results);if(threaded.results[0].resources[0])threaded.results[0].resources[0].nearestPosition.x=999;assert.equal(input.blocks.list[0].position.x,1)
})
test('unexpected worker exit rejects the active search and a later call prepares a new worker',async()=>{
 // Precompute projection so the exit happens during a dispatched search,
 // rather than while the main thread is still preparing geometric input.
 const projected={...world,_gatherEffort:await require('../../planner_bot/src/planner/gather_cost').gatherEffort(world)}
 const task=goap.plan(row.goal,projected,quiet,{worker:true});await new Promise(resolve=>setTimeout(resolve,20));const rejection=assert.rejects(task,{code:'PLANNER_WORKER_FAILED'});await service.close();await rejection
 const result=await goap.plan('inventory.dirt:1',world,quiet,{worker:true});assert.ok(result.plan)
})

test('cancellation arriving during response delivery wins over a completed plan',async()=>{
 const controller=new AbortController(),logger={...quiet,enabled:()=>true,debug:()=>controller.abort()}
 await assert.rejects(goap.plan('inventory.dirt:1',world,logger,{worker:true,signal:controller.signal}),{code:'CANCELLED'})
})
