process.env.LOG_LEVEL='error'
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict')
const {performance,monitorEventLoopDelay}=require('node:perf_hooks'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3')
const {states,goals}=require('../study04/benchmark.cjs'),{createBotApi}=require('../../planner_bot/api')
const {evaluate}=require('../../planner_bot/src/planner/goal_evaluator'),goap=require('../../planner_bot/src/planner/goap'),service=require('../../planner_bot/src/planner/planning_service')
const output=path.resolve(__dirname,'../../.cache/minecraft-bot/09-study/verification.json')
const summary={node:process.version,base:'04abbea',cases:0,plannable:0,relaxedUnreachable:0,unevaluated:0,states:[],observation:[]}
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)]
async function main(){
 await service.prepare('1.20.1');await goap.prepareDomain('1.20.1')
 const allStates=states();assert.equal(allStates.length,9);assert.equal(goals.length,30)
 for(const snapshot of allStates){
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(snapshot.file))),before=JSON.stringify(world)
  const bot={version:'1.20.1',entity:{},logLevel:'error'},api=createBotApi(bot,{stateManager:{}})
  const closure=await api.reachableFacts({worldState:world,goals,maxMs:10000});assert.equal(closure.ok,true);assert.equal(closure.data.complete,true)
  const batch=await evaluate(bot,null,goals,{worldState:world,maxMs:120000,perGoalMs:10000,worker:false})
  for(const [i,row]of batch.results.entries()){
   const r=closure.data.goals[i];assert.equal(r.goal,row.goal)
   if(row.status==='plannable'){assert.equal(r.status,'possible',snapshot.name+'/'+row.goal);summary.plannable++}
   else if(row.reason==='relaxed_unreachable'){assert.equal(r.status,'unreachable',snapshot.name+'/'+row.goal);assert.ok(r.missingKeys.length);summary.relaxedUnreachable++}
   else{assert.equal(r.status,'possible');summary.unevaluated++}
   summary.cases++
  }
  const timings=[],closureTimings=[],delay=monitorEventLoopDelay({resolution:1});delay.enable();await new Promise(r=>setTimeout(r,10))
  for(let i=0;i<20;i++){const r=await api.reachableFacts({worldState:world,maxMs:10000});assert.equal(r.data.complete,true);timings.push(r.data.durationMs);closureTimings.push(r.data.closureMs)}
  await new Promise(r=>setTimeout(r,10));delay.disable()
  assert.equal(JSON.stringify(world),before)
  summary.states.push({name:snapshot.name,count:closure.data.facts.length,rounds:closure.data.rounds,actionCount:closure.data.actionCount,closureMedianMs:median(closureTimings),durationMedianMs:median(timings),maxEventLoopDelayMs:delay.max/1e6,examples:closure.data.facts.filter(r=>['inventory.category.log','inventory.stick','inventory.iron_ingot','nearby_workbench','inventory.diamond_pickaxe'].includes(r.key)),timings,closureTimings})
  console.log(snapshot.name,closure.data.facts.length,'facts, parity checked')
 }
 // Run the real observe() against recorded block cells. This measures CPU and
 // cache behavior, not a live server or Mineflayer network timing.
 const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(allStates.find(s=>s.name==='surface-empty').file)))
 const cells=new Map(world.blocks.list.map(row=>[new Vec3(row.position.x,row.position.y,row.position.z).toString(),row.name]))
 for(const mode of ['observe','observe+reachable']){
  const bot=new EventEmitter(),sm=require('../../planner_bot/src/planner/state_manager')()
  Object.assign(bot,{version:'1.20.1',logLevel:'error',entity:{position:new Vec3(world.position.x,world.position.y,world.position.z)},game:{minY:-64,height:384},inventory:{items:()=>[],slots:[],emptySlotCount:()=>1},time:{isDay:world.isDay},blockAt:p=>({name:cells.get(p.toString())||'air',position:p})})
  const api=createBotApi(bot,{stateManager:sm})
  for(let i=0;i<4;i++){
   if(i===2)bot.entity.position.x++
   const delay=monitorEventLoopDelay({resolution:1});delay.enable();await new Promise(r=>setTimeout(r,10));delay.reset()
   const start=performance.now(),r=mode==='observe'?await api.observe():await api.reachableFacts({maxMs:10000,goals})
   const durationMs=performance.now()-start;assert.equal(r.ok,true)
   if(mode!=='observe'){assert.equal(r.data.observationComplete,true);assert.equal(r.data.complete,true)}
   await new Promise(r=>setTimeout(r,10));delay.disable()
   summary.observation.push({mode,phase:['cold','warm','move','warmAfterMove'][i],durationMs,observationMs:r.data.observationMs??durationMs,closureMs:r.data.closureMs??0,count:r.data.facts?.length??null,maxEventLoopDelayMs:delay.max/1e6})
  }
  bot.emit('end')
 }
 assert.equal(summary.cases,270);assert.equal(summary.plannable,130);assert.equal(summary.relaxedUnreachable,101);assert.equal(summary.unevaluated,39)
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(summary,null,2));console.log('All 270 cases agree:',summary.plannable,'plannable,',summary.relaxedUnreachable,'proven unreachable,',summary.unevaluated,'unresolved');console.log(output)
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>service.close())
