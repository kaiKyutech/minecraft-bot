process.env.LOG_LEVEL='error';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {states,goals}=require('./benchmark.cjs'),{targetFor}=require('./harness.cjs');
const goap=require('../../planner_bot/src/planner/goap'),{buildState}=require('../../planner_bot/src/planner/state_builder');
const {analyzeRelevantVariables,isActionRelevant}=require('../../planner_bot/src/planner/relevance');
const h=require('../../planner_bot/src/planner/heuristic');
async function main(){
 await goap.prepareDomain('1.20.1');const actions=goap.getAllActions(),rows=[];
 for(const item of states()){
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(item.file))),facts=buildState(world);
  for(const goal of goals){const target=targetFor(goal,world),vars=analyzeRelevantVariables(target,actions,facts),filtered=actions.filter(a=>isActionRelevant(a,vars));
   rows.push({state:item.name,goal,initialH:h.calculateHeuristic(facts,h.buildHeuristicContext(target,null,filtered)),filtered:filtered.length});
  }
 }
 const dir=path.resolve(__dirname,'../../.cache/minecraft-bot/04-study');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'heuristic.json'),JSON.stringify(rows,null,2));
 console.log('initial h=400',rows.filter(r=>r.initialH===400).length,'/',rows.length);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
