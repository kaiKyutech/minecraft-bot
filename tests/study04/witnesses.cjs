process.env.LOG_LEVEL='error';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {states}=require('./benchmark.cjs'),{replay,estimate}=require('./harness.cjs');
const goap=require('../../planner_bot/src/planner/goap');
async function main(){
 const dir=path.resolve(__dirname,'../../.cache/minecraft-bot/04-study'),bench=JSON.parse(fs.readFileSync(path.join(dir,'benchmark.json'))),extended=JSON.parse(fs.readFileSync(path.join(dir,'extended.json')));
 const donors=[...bench.rows.filter(r=>r.repeat===0&&r.result?.plan),...extended.filter(r=>r.result?.plan)],witnesses=[];
 await goap.prepareDomain('1.20.1');
 for(const item of states()){
  const failed=bench.rows.filter(r=>r.state===item.name&&r.variant==='baseline'&&r.repeat===0&&!r.result?.plan&&!r.provedImpossible);
  if(!failed.length)continue;const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(item.file)));
  for(const original of failed){let best;
   for(const donor of donors.filter(d=>d.goal===original.goal)){
    if(!replay(original.goal,world,donor.result.plan).valid)continue;
    const ms=estimate(donor.result.plan,world).estimatedMs;
    if(!best||ms<best.estimatedMs)best={state:item.name,goal:original.goal,donorState:donor.state,donorVariant:donor.variant,valid:true,estimatedMs:ms,plan:donor.result.plan};
   }
   witnesses.push(best||{state:item.name,goal:original.goal,valid:false});
  }
 }
 fs.writeFileSync(path.join(dir,'witnesses.json'),JSON.stringify(witnesses,null,2));console.log('Known valid witnesses',witnesses.filter(x=>x.valid).length,'/',witnesses.length);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
