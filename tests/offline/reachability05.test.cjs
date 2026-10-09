process.env.LOG_LEVEL='error';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const goap=require('../../planner_bot/src/planner/goap'),{evaluate}=require('../../planner_bot/src/planner/goal_evaluator');
const {createBotApi}=require('../../planner_bot/api'),{load}=require('../helpers/module');
const empty={inventory:{counts:{}},nearby:{},nearby_blocks:{},equipment:{},inventory_space:true};
const quiet={debug(){},info(){},warn(){},error(){}};
test('normal planning proves missing presence without entering A* and keeps the result shape',async()=>{
 const logs=[],logger={...quiet,debug:s=>logs.push(s)};
 const result=await goap.plan('inventory.oak_log:1',empty,logger,{version:'1.20.1'});
 assert.equal(result.plan,null);assert.deepEqual(Object.keys(result).sort(),['diagnosis','plan']);
 assert.deepEqual(goap.getPlanFailure(result),{reason:'relaxed_unreachable',provenImpossible:true,iterations:0,maxIterations:200});
 assert.equal(logs.some(s=>s.includes('[GOAP Iter')),false);
 const api=createBotApi({version:'1.20.1',entity:{},logLevel:'error'},{stateManager:{}});
 const response=await api.planGoal('inventory.oak_log:1',{worldState:empty});
 assert.equal(response.error.code,'PLAN_NOT_FOUND');assert.equal(response.error.details.provenImpossible,true);assert.equal(response.error.details.reason,'relaxed_unreachable');
});
test('search cutoff is not proof of impossibility, including cached batch results',async()=>{
 const row=require('../study04/results.json').cases.find(r=>r.variant==='baseline'&&r.reason==='iteration_limit'&&!r.provedImpossible);
 const dir=row.state.startsWith('surface')||row.state.startsWith('underground')?'study04/snapshots':'fixtures';
 const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,`../${dir}/${row.state}.json.gz`))));
 const result=await goap.plan(row.goal,world,quiet,{version:'1.20.1'}),reason=goap.getPlanFailure(result);
 assert.equal(result.plan,null);assert.equal(reason.reason,'iteration_limit');assert.equal(reason.provenImpossible,false);assert.equal(reason.iterations,200);
 const bot={version:'1.20.1',logLevel:'error'};
 for(let i=0;i<2;i++){
  const batch=await evaluate(bot,{},[row.goal],{worldState:world,maxMs:10000,perGoalMs:10000}),candidate=batch.results[0];
  assert.equal(candidate.status,'unevaluated');assert.equal(candidate.reason,'iteration_limit');assert.equal(batch.timedOut,false);
  assert.deepEqual(candidate.diagnosis,result.diagnosis);
  if(candidate.diagnosis.missingRequirements[0])candidate.diagnosis.missingRequirements[0].key='tampered';
 }
});
test('a positive initial fact absent from action keys is not incorrectly declared unreachable',async()=>{
 const world={...empty,inventory:{counts:{custom_item:1}}};
 const result=await goap.plan('inventory.custom_item:1',world,quiet,{version:'1.20.1'});
 assert.equal(result.plan,null);assert.equal(goap.getPlanFailure(result).reason,'frontier_exhausted');assert.equal(goap.getPlanFailure(result).provenImpossible,false);
});
test('runner keeps the proven outcome and skips futile quantity retries',async()=>{
 const calls=[],world=structuredClone(empty),diagnosis={missingRequirements:[],suggestions:[]};
 const run=load(path.resolve(__dirname,'../../planner_bot/src/executor/goal_runner.js'),{
  '../planner/goap':{prepareDomain:async()=>{},getAllActions:()=>[],plan:async goal=>{calls.push(goal);return{plan:null,diagnosis}},getPlanFailure:()=>({reason:'relaxed_unreachable',provenImpossible:true,iterations:0,maxIterations:200})},
  '../executor/goap_executor':{executePlanWithReplanning:async()=>{throw Error('must not execute')}}
 });
 const bot={version:'1.20.1',systemLog(){},logLevel:'error'},sm={refresh:async()=>{},getState:async()=>world},missing=[];
 await assert.rejects(run(bot,'api','inventory.oak_log:3',sm,null,0,10,missing,null,false),e=>e.code==='PLAN_NOT_FOUND'&&e.details.reason==='relaxed_unreachable'&&e.missingPreconditions===missing);
 assert.deepEqual(missing,['inventory.oak_log:3']);
 assert.deepEqual(calls,['inventory.oak_log:3']);
});
test('precheck observes planning budgets and cancellation before producing a proof',async()=>{
 await assert.rejects(goap.plan('inventory.oak_log:1',empty,quiet,{deadline:0}),e=>e.code==='BUDGET_EXCEEDED');
 await assert.rejects(goap.plan('inventory.oak_log:1',empty,quiet,{signal:AbortSignal.abort()}),e=>e.code==='CANCELLED');
 const batch=await evaluate({version:'1.20.1'}, {}, ['inventory.oak_log:1'],{worldState:empty,maxMs:0});
 assert.equal(batch.results[0].reason,'budget_exceeded');assert.equal(batch.timedOut,true);
});
test('execution replanning preserves proof details and stops without helper retries',async()=>{
 let planned=0,attempts=0;
 const execute=load(path.resolve(__dirname,'../../planner_bot/src/executor/goap_executor.js'),{
  '../planner/goap':{plan:async()=>{planned++;return{plan:null,diagnosis:{missingRequirements:[],suggestions:[]}}},getPlanFailure:()=>({reason:'relaxed_unreachable',provenImpossible:true,iterations:0,maxIterations:200})},
  '../skills':{bad:async()=>{attempts++;throw Error('blocked')}},
  './precondition_checker':{analyseStepPreconditions:async()=>({satisfied:true}),getStateValue:()=>undefined},
  '../utils/logger':{createLogger:()=>quiet}
 }).executePlanWithReplanning;
 const bot={logLevel:'error'},sm={refresh:async()=>{},getState:async()=>empty};
 await assert.rejects(execute(bot,'inventory.oak_log:1',[{action:'gather',skill:'bad'}],sm),e=>e.code==='REPLAN_FAILED'&&e.details.provenImpossible===true&&e.details.iterations===0);
 assert.equal(planned,1);assert.equal(attempts,1);
});
