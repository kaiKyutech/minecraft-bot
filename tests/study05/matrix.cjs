process.env.LOG_LEVEL='error';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {states,goals}=require('../study04/benchmark.cjs');
const {makePlanner,replay}=require('../study04/harness.cjs');
const goap=require('../../planner_bot/src/planner/goap');
const reference=require('../study04/results.json').cases.filter(r=>r.variant==='baseline');
const phase=process.argv[2]||'A',rows=[];
const output=process.argv[3]?path.resolve(process.argv[3]):path.join(__dirname,`matrix-${phase}.json`);
const crypto=require('node:crypto');
const meta={node:process.version,baselineCommit:'eab3cca',productionHashes:Object.fromEntries(['goap','heuristic','relevance','state_operations'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,`../../planner_bot/src/planner/${name}.js`))).digest('hex')]))};
async function main(){
 await goap.prepareDomain('1.20.1');
 const solvers={baseline:makePlanner(),production:makePlanner({production:true})};
 const first=JSON.parse(zlib.gunzipSync(fs.readFileSync(states()[0].file)));
 for(const solver of Object.values(solvers))await solver.run('inventory.stick:4',first);
 for(const state of states()){
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(state.file))),before=JSON.stringify(world);
  for(const goal of goals){
   const old=reference.find(r=>r.state===state.name&&r.goal===goal);assert.ok(old);
   for(let repeat=0;repeat<2;repeat++)for(const variant of repeat?['production','baseline']:['baseline','production']){
    const r=await solvers[variant].run(goal,world),plan=r.result?.plan,cost=plan?.reduce((n,s)=>n+s.cost,0)??null;
    assert.equal(r.thrown,undefined,`${state.name}/${goal}/${variant}`);
    if(variant==='baseline'||phase==='A'||old.reason==='success'){
     assert.deepEqual(plan?.map(s=>s.action)??null,old.plan,`${state.name}/${goal}/${variant} plan changed`);
     assert.equal(cost,old.cost);assert.equal(r.metrics.iterations,old.iterations);
    }
    if(plan)assert.equal(replay(goal,world,plan).valid,true);
    if(phase==='B'&&variant==='production'&&!plan){
     assert.equal(r.planningFailure.provenImpossible,old.provedImpossible);
     assert.equal(r.metrics.iterations,old.provedImpossible?0:old.iterations);
     assert.equal(r.reason,old.provedImpossible?'relaxed_unreachable':old.reason);
    }
    const paired=rows.find(row=>row.state===state.name&&row.goal===goal&&row.repeat===repeat&&row.variant!==variant);
    if(paired)assert.deepEqual(plan,paired.plan,`${state.name}/${goal} full plan changed`);
    rows.push({state:state.name,goal,variant,repeat,durationMs:r.durationMs,iterations:r.metrics.iterations,reason:r.reason,planningFailure:r.planningFailure,plan,cost,provedImpossible:old.provedImpossible});
   }
  }
  assert.equal(JSON.stringify(world),before,'planner mutated input');
  console.log(state.name,'checked');fs.writeFileSync(output,JSON.stringify({phase,meta,cases:270,repeats:2,rows},null,2));
 }
 console.log(`${phase}: all 270 cases verified, including 130 successes; paired full plans identical`);
}
main().catch(e=>{fs.writeFileSync(output,JSON.stringify({phase,rows,error:e.stack},null,2));console.error(e);process.exitCode=1});
