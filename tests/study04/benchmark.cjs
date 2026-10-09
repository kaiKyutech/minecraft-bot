process.env.LOG_LEVEL = 'error';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), os = require('node:os');
const crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const { root, makePlanner, replay, estimate, targetFor } = require('./harness.cjs');
const goap = require('../../planner_bot/src/planner/goap');
const { buildState } = require('../../planner_bot/src/planner/state_builder');
const { analyzeRelevantVariables, isActionRelevant } = require('../../planner_bot/src/planner/relevance');
const { reachable, needsPresence } = require('../../planner_bot/src/planner/reachability');
const output = path.join(root, '.cache/minecraft-bot/04-study');
const oldDir = path.join(root, 'tests/fixtures'), snapshotDir = path.join(__dirname, 'snapshots');
const baseGoals = Object.keys(JSON.parse(fs.readFileSync(path.join(oldDir, 'natural-empty-plans.json'))));
const goals = [...new Set([...baseGoals, ...['iron_pickaxe','iron_axe','golden_pickaxe','diamond_pickaxe','diamond_axe','iron_ingot:3','gold_ingot','charcoal','glass','cooked_beef','bucket','shears','iron_block','anvil','raw_iron:3','inventory.category.plank:12','inventory.category.basic_stone:8','inventory.category.log:4','inventory.category.basic_stone:2'].map(x => x.includes('inventory.') ? x : 'inventory.' + (x.includes(':') ? x : x + ':1'))])];
const variants = [
  ['baseline', {}], ['indexed', { indexed:true }], ['signature', { cachedSignature:true }],
  ['combined', { indexed:true,cachedSignature:true }],
  ['precheck', { indexed:true,cachedSignature:true,precheck:true }],
  ['stale', { indexed:true,cachedSignature:true,stale:true }],
  ['max-preconditions', { indexed:true,cachedSignature:true,maxPreconditions:true }],
  ['weighted3', { indexed:true,cachedSignature:true,weight:3 }],
  ['guided', { indexed:true,cachedSignature:true,precheck:true,weight:3 }],
  ['time-cost', { indexed:true,cachedSignature:true,timeCost:true }],
];
function loadGzip(file) {return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));}
function states() {
  const list = ['flat-empty','flat-stocked','flat-underground','natural-empty','natural-stocked'].map(name => ({name,source:'01 real snapshot',file:path.join(oldDir,name+'.json.gz')}));
  if(fs.existsSync(path.join(snapshotDir,'manifest.json'))) for(const item of JSON.parse(fs.readFileSync(path.join(snapshotDir,'manifest.json'))).snapshots) list.push({name:item.name,source:'04 live snapshot',file:path.join(snapshotDir,item.name+'.json.gz')});
  // All nine execution starts cover terrain changes caused by earlier runs.
  const execDir=path.join(output,'execution-snapshots');
  if(process.env.STUDY_INCLUDE_EXEC==='1'&&fs.existsSync(execDir)) for(const file of fs.readdirSync(execDir).filter(x=>x.startsWith('exec-')&&x.endsWith('.gz'))) list.push({name:file.replace('.json.gz',''),source:'04 live execution start',file:path.join(execDir,file)});
  return process.env.STUDY_STATES ? list.filter(x=>process.env.STUDY_STATES.split(',').includes(x.name)) : list;
}
async function main() {
  fs.mkdirSync(output,{recursive:true});const prep=performance.now();await goap.prepareDomain('1.20.1');const preparationMs=performance.now()-prep;
  const actions=goap.getAllActions(), allStates=states(), rows=[], solvers=new Map(variants.map(([name,options])=>[name,makePlanner(options)]));
  const meta={base:'bfa1a1b',measuredCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,cpu:os.cpus()[0].model,version:'1.20.1',preparationMs,actions:actions.length,
    sourceHashes:Object.fromEntries(fs.readdirSync(path.join(root,'planner_bot/src/planner')).filter(x=>x.endsWith('.js')).map(x=>[x,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'planner_bot/src/planner',x))).digest('hex')])),
    states:allStates.map(({name,source,file})=>({name,source,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))};
  const repeats=Number(process.env.STUDY_REPEATS||2);
  const allowed=process.env.STUDY_VARIANTS?.split(',');
  // Warm V8 and module caches before measured samples, without reusing plan results.
  { const warmWorld=loadGzip(allStates[0].file);for(const [,solver] of solvers) await solver.run('inventory.stick:4',warmWorld); }
  for(const state of allStates) {
    state.world=loadGzip(state.file);const before=JSON.stringify(state.world);
    const facts=buildState(state.world), start=performance.now(), possible=reachable(actions,facts,Infinity), closureMs=performance.now()-start;
    for(const goal of goals) {
      const target=targetFor(goal,state.world), vars=analyzeRelevantVariables(target,actions,facts), relevant=actions.filter(a=>isActionRelevant(a,vars));
      const provedImpossible=Object.entries(target).some(([key,value])=>needsPresence(value)&&!possible.has(key));
      for(let repeat=0;repeat<repeats;repeat++) for(const [variant,options] of (repeat%2 ? [...variants].reverse() : variants)) {
        if(allowed&&!allowed.includes(variant))continue;
        const sample=await solvers.get(variant).run(goal,state.world,options.precheck?{possibleFacts:possible}:{});
        const plan=sample.result?.plan, validation=replay(goal,state.world,plan), estimated=estimate(plan,state.world);
        let heuristicAudit;
        if(variant==='baseline'&&repeat===0&&plan){
          const h=require('../../planner_bot/src/planner/heuristic'),ops=require('../../planner_bot/src/planner/state_operations'),context=h.buildHeuristicContext(target,null,relevant),byName=new Map(actions.map(a=>[a.name,a]));
          let node=buildState(state.world),remaining=plan.reduce((n,s)=>n+s.cost,0);const witnesses=[];
          const initialH=h.calculateHeuristic(node,context);
          for(const [i,step]of plan.entries()){
            const beforeH=h.calculateHeuristic(node,context),next=ops.applyEffects(byName.get(step.action).effects,node),afterH=h.calculateHeuristic(next,context);
            if(beforeH>remaining+1e-9||beforeH>step.cost+afterH+1e-9)witnesses.push({i,action:step.action,h:beforeH,knownValidRemainingCost:remaining,stepCost:step.cost,nextH:afterH});
            remaining-=step.cost;node=next;
          }
          heuristicAudit={initialH,witnesses};
        }
        rows.push({state:state.name,goal,variant,repeat,provedImpossible,closureMs,relevantActions:relevant.length,...sample,stepCount:plan?.length??null,cost:plan?plan.reduce((n,s)=>n+s.cost,0):null,estimatedMs:estimated?.estimatedMs??null,validation,heuristicAudit});
      }
    }
    console.log(state.name,'completed',rows.length);
    if(JSON.stringify(state.world)!==before)throw new Error('Study planner mutated worldState');
    delete state.world;
    fs.writeFileSync(path.join(output,'benchmark.json'),JSON.stringify({meta:{...meta,repeats,goals},rows},null,2));
  }
  // Search deeper only for unresolved, relaxed-reachable 200-pop cases.
  const extended=[];
  if(!process.env.STUDY_SKIP_EXTENDED) for(const state of allStates.filter(x=>!x.name.startsWith('exec-'))) for(const goal of ['inventory.iron_ingot:3','inventory.iron_pickaxe:1','inventory.golden_pickaxe:1','inventory.diamond_pickaxe:1']) {
    const baseline=rows.find(x=>x.variant==='baseline'&&x.repeat===0&&x.state===state.name&&x.goal===goal);
    if(!baseline||baseline.reason!=='iteration_limit'||baseline.provedImpossible)continue;
    const world=loadGzip(state.file);
    for(const variant of ['combined','weighted3']) {
      const options={...Object.fromEntries(variants)[variant],limit:5000};const solver=makePlanner(options);
      const sample=await solver.run(goal,world,{deadline:performance.now()+5000});
      extended.push({state:state.name,goal,variant,limit:5000,deadlineMs:5000,...sample,validation:replay(goal,world,sample.result?.plan),estimatedMs:estimate(sample.result?.plan,world)?.estimatedMs??null});
    }
  }
  fs.writeFileSync(path.join(output,'extended.json'),JSON.stringify(extended,null,2));
  const groups={};for(const a of actions){const k=a.skill||'symbolic';groups[k]=(groups[k]||0)+1;}
  fs.writeFileSync(path.join(output,'domain.json'),JSON.stringify({preparationMs,actionCount:actions.length,skills:groups,gatherCounts:actions.filter(a=>a.skill==='gather').reduce((o,a)=>(o[a.params.count]=(o[a.params.count]||0)+1,o),{}),duplicateTransitions:actions.length-new Set(actions.map(a=>JSON.stringify([a.preconditions,a.effects,a.cost,a.skill,a.params]))).size},null,2));
  console.log('saved',output);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={states,goals,variants};
