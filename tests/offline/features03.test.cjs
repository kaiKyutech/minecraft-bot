const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {EventEmitter}=require('node:events');const {Vec3}=require('vec3');const {evaluate}=require('../../planner_bot/src/planner/goal_evaluator');
const {observeFast}=require('../../planner_bot/src/planner/fast_observation');const {Progress}=require('../../planner_bot/src/executor/progress');
const {load}=require('../helpers/module');
test('evaluation preserves all 70 fixture plans/diagnoses and cache cannot be mutated through results',async()=>{
 const bot={version:'1.20.1',logLevel:'error'};
 for(const filename of fs.readdirSync(path.join(__dirname,'../fixtures')).filter(n=>n.endsWith('-plans.json'))){
  const label=filename.replace('-plans.json',''),world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,`../fixtures/${label}.json.gz`))));
  const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures',filename))),goals=Object.keys(expected);
  const result=await evaluate(bot,{},goals,{worldState:world,maxMs:15000,perGoalMs:15000});
  for(const row of result.results){assert.notEqual(row.reason,'budget_exceeded');if(row.status==='unevaluated')assert.ok(['iteration_limit','frontier_exhausted'].includes(row.reason));assert.deepEqual({plan:row.plan,diagnosis:row.diagnosis},expected[row.goal])}
  const row=result.results.find(r=>r.plan?.length);if(row){const saved=structuredClone(row.plan);row.plan[0].action='tampered';const repeated=await evaluate(bot,{},[row.goal],{worldState:world,maxMs:15000,perGoalMs:15000});assert.deepEqual(repeated.results[0].plan,saved)}
 }
});
test('budget expiry is unevaluated and aborted evaluation is cancelled; lightweight input is rejected',async()=>{
 const bot={version:'1.20.1'};
 const result=await evaluate(bot,{},['inventory.stick:1','inventory.cake:1'],{maxMs:0});assert.equal(result.results.every(r=>r.status==='unevaluated'),true);
 await assert.rejects(evaluate(bot,{},['inventory.stick:1'],{signal:AbortSignal.abort()}),{code:'CANCELLED'});
 await assert.rejects(evaluate(bot,{},['inventory.stick:1'],{worldState:{kind:'fast_observation'}}),{code:'INVALID_ARGUMENT'});
});
test('cached evaluations follow content changes and returned resources cannot mutate the input',async()=>{
 const bot={version:'1.20.1'},world={inventory:{counts:{oak_log:1}},equipment:{},nearby:{oak_log:1,category:{log:1}},nearby_blocks:{},inventory_space:true,position:{x:0,y:10,z:0},blocks:{list:[{name:'oak_log',position:{x:1,y:10,z:0}}]}};
 const first=await evaluate(bot,{},['inventory.oak_log:1'],{worldState:world,maxMs:3000,perGoalMs:3000});assert.equal(first.results[0].status,'plannable');
 first.results[0].resources[0].nearestPosition.x=999;assert.equal(world.blocks.list[0].position.x,1);
 world.nearby={};world.inventory.counts={};world.blocks.list=[];
 const next=await evaluate(bot,{},['inventory.oak_log:1'],{worldState:world,maxMs:3000,perGoalMs:3000});assert.equal(next.results[0].status,'unplannable');
});
test('presence precheck retains crafting chains, ignores negative constraints and cannot certify a plan',()=>{
 const {reachable}=require('../../planner_bot/src/planner/reachability');
 const actions=[{preconditions:{'nearby.log':'>= 3'},effects:{'inventory.log':'+3'}},{preconditions:{'inventory.log':'>= 99',nearby_table:false},effects:{'inventory.plank':'+4'}},{preconditions:{'inventory.plank':'>= 4'},effects:{'inventory.table':'+1'}}];
 const possible=reachable(actions,{nearby:{log:1}},performance.now()+1000);assert.ok(possible.has('inventory.table'));assert.equal(possible.has('inventory.iron'),false);
});
test('vision parameter validation does not start a viewer',async()=>{
 const persistent=require('../../planner_bot/src/vision/persistent'),bot=new EventEmitter();
 await assert.rejects(persistent.start(bot,{width:0}),{code:'INVALID_ARGUMENT'});
 await assert.rejects(persistent.start(bot,{renderWait:-1}),{code:'INVALID_ARGUMENT'});assert.equal(bot.viewer,undefined);
});
test('fast observation exposes partial scans, summaries, unloaded sky and releases listeners',async()=>{
 const bot=new EventEmitter();Object.assign(bot,{entity:{position:new Vec3(0,10,0),yaw:0,pitch:0,id:1},entities:{},game:{minY:0,height:20},inventory:{},blockAt:p=>p.y>=20?null:{name:p.x===1&&p.y===10&&p.z===0?'oak_log':'air',position:p,transparent:p.y!==21,light:7,skyLight:15}});
 const sm={extractInventory:()=>({counts:{}}),extractEquipment:()=>({})};
 const partial=await observeFast(bot,sm,{range:2,maxChecks:1});assert.equal(partial.complete,false);
 const full=await observeFast(bot,sm,{range:2,maxChecks:1000,maxMs:100});assert.equal(full.complete,true);assert.equal(full.resources.oak_log.count,1);assert.equal(full.resources.oak_log.nearestDistance,1);assert.equal(full.categories.log.count,1);assert.equal(full.skyVisible,true);
 bot.emit('blockUpdate',null,{position:new Vec3(1,10,0)});assert.equal((await observeFast(bot,sm,{range:2,maxChecks:0})).complete,false);
 bot.emit('end');assert.equal(bot.listenerCount('blockUpdate'),0);
});
test('progress callbacks cannot mutate plans or break execution by throwing or rejecting',async()=>{
 const bot={logLevel:'error'},events=[],plan=[{action:'a',skill:'s'}];
 const p=new Progress(bot,event=>{events.push(event);if(event.plan)event.plan[0].action='tampered';if(event.type==='step_start')throw new Error('consumer');return Promise.reject(new Error('consumer'))});
 p.plan('g',plan);p.emit('step_start',{stepIndex:0});p.emit('goal_end',{ok:true});await new Promise(setImmediate);
 assert.equal(plan[0].action,'a');assert.deepEqual(events.map(e=>e.sequence),[1,2,3]);assert.equal(new Set(events.map(e=>e.operationId)).size,1);
});
function mover(kind){
 let finish;const bot={entity:{position:new Vec3(0,10,0)},registry:{},pathfinder:{setMovements(){},goto(goal){if(kind==='no_path')return Promise.reject(Object.assign(new Error('blocked'),{name:'NoPath'}));if(kind==='arrived'){bot.entity.position=new Vec3(10,11,0);return Promise.resolve()}return new Promise((resolve,reject)=>{finish=()=>reject(Object.assign(new Error('stopped'),{name:'GoalChanged'}))})},setGoal(goal){this.goal=goal;if(goal===null)finish?.()}}};
 const fn=load(path.resolve(__dirname,'../../planner_bot/src/navigation/move_toward.js'),{'mineflayer-pathfinder':{...require('mineflayer-pathfinder'),Movements:class{}}}).moveToward;
 return {bot,run:(controller=new AbortController())=>fn(bot,{x:10,z:0},{range:2,deadline:performance.now()+10},controller.signal)};
}
test('moveToward distinguishes arrived, no path, time budget and cancellation with distance details',async()=>{
 const arrived=mover('arrived');assert.equal((await arrived.run()).reached,true);
 const blocked=mover('no_path');assert.equal((await blocked.run()).reason,'no_path');assert.equal(blocked.bot.pathfinder.goal,null);
 const timeout=mover('pending');assert.equal((await timeout.run()).reason,'timeout');assert.equal(timeout.bot.pathfinder.goal,null);
 const cancel=mover('pending'),controller=new AbortController(),running=cancel.run(controller);controller.abort();await assert.rejects(running,e=>e.code==='CANCELLED'&&e.details.reason==='cancelled');
});
