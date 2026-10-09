process.env.LOG_LEVEL='error';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {makePlanner,estimate,replay}=require('./harness.cjs');
const goap=require('../../planner_bot/src/planner/goap');
async function main(){
 const dir=path.resolve(__dirname,'../../.cache/minecraft-bot/04-study'),live=JSON.parse(fs.readFileSync(path.join(dir,'live.json'))),solver=makePlanner(),rows=[];
 await goap.prepareDomain('1.20.1');
 for(const r of live){
  const name=r.goal.match(/^inventory\.(\w+):/)[1],file=path.join(dir,'execution-snapshots',`exec-${r.startIndex}-${name}.json.gz`);
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(file))),sample=await solver.run(r.goal,world),predicted=estimate(sample.result?.plan,world);
  rows.push({start:r.startIndex,goal:r.goal,reason:sample.reason,initialEstimatedMs:predicted?.estimatedMs??null,validation:replay(r.goal,world,sample.result?.plan),actualMs:r.durationMs,ok:r.result.ok});
 }
 fs.writeFileSync(path.join(dir,'live-audit.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
