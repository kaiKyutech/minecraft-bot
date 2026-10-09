process.env.LOG_LEVEL='error'
const fs=require('fs'),path=require('path'),zlib=require('zlib'),assert=require('node:assert/strict')
const {states,goals}=require('../study04/benchmark.cjs'),goap=require('../../planner_bot/src/planner/goap')
const reference=require('../study05/matrix-B.json').rows.filter(row=>row.variant==='production'&&row.repeat===0)
const phase=process.argv[2]||'O2',rows=[]
const clean=value=>JSON.parse(JSON.stringify(value))
async function solve(goal,world,worker){const logs=[],logger={enabled:()=>true,info:s=>logs.push(s),warn:s=>logs.push(s),debug:s=>logs.push(s),error:s=>logs.push(s)};const t=performance.now(),result=await goap.plan(goal,world,logger,{version:'1.20.1',worker});const failure=goap.getPlanFailure(result),match=logs.join('\n').match(/(?:^|\n)\s*イテレーション:\s*(\d+)/u);return {result,failure,iterations:failure?.iterations??Number(match?.[1]??0),durationMs:performance.now()-t}}
async function main(){
 await goap.prepareDomain('1.20.1')
 for(const state of states()){
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(state.file))),unchanged=JSON.stringify(world)
  for(const goal of goals){
   const expected=reference.find(row=>row.state===state.name&&row.goal===goal);assert.ok(expected)
   const sync=await solve(goal,world,false);assert.deepEqual(clean(sync.result.plan),clean(expected.plan));assert.equal(sync.iterations,expected.iterations);assert.deepEqual(sync.failure,expected.planningFailure)
   let threaded
   if(phase==='O2'){threaded=await solve(goal,world,true);assert.deepEqual(clean(threaded.result),clean(sync.result));assert.deepEqual(threaded.failure,sync.failure);assert.equal(threaded.iterations,sync.iterations)}
   rows.push({state:state.name,goal,iterations:sync.iterations,cost:sync.result.plan?.reduce((n,s)=>n+s.cost,0)??null,reason:sync.failure?.reason??'success',mainMs:sync.durationMs,workerMs:threaded?.durationMs})
  }
  assert.equal(JSON.stringify(world),unchanged);console.log(state.name,'checked')
 }
 fs.writeFileSync(path.join(__dirname,'matrix-'+phase+'.json'),JSON.stringify({phase,node:process.version,cases:rows.length,allMatched:true,rows},null,2));console.log(phase+': all 270 plans, costs, iterations and failure metadata matched'+(phase==='O2'?' (including worker diagnoses)':''))
}
main().catch(e=>{console.error(e);process.exitCode=1})
