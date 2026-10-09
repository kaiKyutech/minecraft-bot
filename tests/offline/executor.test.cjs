const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {load}=require('../helpers/module');
function fixture({skills={},plan,analyse}={}){
  const calls=[];const world={inventory:{counts:{}}};const sm={refresh:async()=>calls.push('refresh'),getState:async()=>world};
  const bot={systemLog(){},shouldLogCommand:()=>true,pathfinder:{setGoal:x=>calls.push(['setGoal',x])},stopDigging:()=>calls.push('stopDigging')};
  const planner={plan:async(goal,state)=>{calls.push(['plan',goal]);return plan?plan(goal,state):{plan:[]};}};
  const checker={analyseStepPreconditions:async(bot,step)=>analyse?analyse(step):{satisfied:true,missing:[],goapState:{},worldState:world},getStateValue:(state,key)=>key.split('.').reduce((a,k)=>a?.[k],state)};
  const api=load(path.resolve(__dirname,'../../planner_bot/src/executor/goap_executor.js'),{
    '../planner/goap':planner,'../skills':skills,'./precondition_checker':checker,
    '../planner/diagnosis':{checkCompositeState:()=>null,buildStructuredDiagnosis:x=>x},
    '../utils/logger':{createLogger:()=>({info(){},warn(){},error(){}})}
  });
  return {calls,world,sm,bot,execute:async(steps,signal)=>api.executePlanWithReplanning(bot,'inventory.target:1',steps,sm,signal)};
}
test('executor refreshes once before each skill; terminal actions skip execution',async()=>{
  const invoked=[];const f=fixture({skills:{s:async(bot,params)=>invoked.push(params)}});
  await f.execute([{action:'a',skill:'s',params:{count:2}},{action:'done'}]);assert.deepEqual(f.calls,['refresh']);assert.deepEqual(invoked,[{count:2}]);
});
test('executor rejects an already aborted signal before refreshing',async()=>{
  const f=fixture();const c=new AbortController();c.abort();await assert.rejects(()=>f.execute([{action:'a',skill:'s'}],c.signal),{name:'AbortError',message:'Cancelled'});assert.deepEqual(f.calls,[]);
});
test('abort during refresh prevents precondition evaluation and skill execution',async()=>{
  const controller=new AbortController();let checked=false,ran=false;
  const f=fixture({analyse:()=>{checked=true;return {satisfied:true}},skills:{s:async()=>{ran=true}}});
  f.sm.refresh=async()=>{controller.abort()};
  await assert.rejects(f.execute([{action:'a',skill:'s'}],controller.signal),{code:'CANCELLED'});
  assert.equal(checked,false);assert.equal(ran,false);
});
test('skill abort listener stops movement and digging, then is removed',async()=>{
  const c=new AbortController();const f=fixture({skills:{s:async()=>{c.abort();const e=new Error('cancel');e.name='AbortError';throw e;}}});
  await assert.rejects(()=>f.execute([{action:'a',skill:'s'}],c.signal),{name:'AbortError'});
  assert.deepEqual(f.calls,['refresh',['setGoal',null],'stopDigging']);
});
test('completed skill removes abort listener',async()=>{
  const c=new AbortController();const f=fixture({skills:{s:async()=>{}}});await f.execute([{action:'a',skill:'s'}],c.signal);c.abort();assert.deepEqual(f.calls,['refresh']);
});
test('inverted false boolean precondition skips rather than replans',async()=>{
  let ran=false;const f=fixture({skills:{s:async()=>ran=true},analyse:()=>({satisfied:false,missing:[{condition:false,currentValue:true}]})});
  await f.execute([{action:'a',skill:'s'}]);assert.equal(ran,false);assert.deepEqual(f.calls,['refresh']);
});
test('failed skill replans original goal and runs replacement',async()=>{
  const executed=[];const f=fixture({skills:{bad:async()=>{throw new Error('dig failed');},good:async()=>executed.push('good')},plan:()=>({plan:[{action:'replacement',skill:'good'}]})});
  await f.execute([{action:'a',skill:'bad'}]);assert.deepEqual(executed,['good']);assert.ok(f.calls.some(x=>Array.isArray(x)&&x[1]==='inventory.target:1'));
});
test('missing numeric precondition generates only the deficit subgoal',async()=>{
  let satisfied=false;const f=fixture({skills:{prepare:async()=>satisfied=true,target:async()=>{}},
    plan:goal=>({plan:[{action:'prep',skill:'prepare'}]}),
    analyse:step=>step.action==='target'&&!satisfied?{satisfied:false,missing:[{key:'inventory.stick',condition:'>= 4',currentValue:2}],goapState:{inventory:{stick:2}},worldState:{inventory:{counts:{stick:2}}}}:{satisfied:true,missing:[]}});
  await f.execute([{action:'target',skill:'target'}]);assert.ok(f.calls.some(x=>Array.isArray(x)&&x[1]==='inventory.stick:2'));
});
test('replan accepts legacy plan-array result',async()=>{
  const f=fixture({skills:{s:async()=>{throw new Error('failure');}},plan:()=>[]});await f.execute([{action:'a',skill:'s'}]);
});
test('unchanged placement failures stop after three attempts with structured details',async()=>{
  let attempts=0;const steps=[{action:'place_furnace',skill:'bad',params:{blockName:'furnace'}}];
  const f=fixture({skills:{bad:async()=>{attempts++;if(attempts>4)throw Object.assign(new Error('safety sentinel'),{name:'AbortError'});throw Object.assign(new Error('No placement'),{code:'PLACEMENT_FAILED'});}},plan:()=>({plan:steps})});
  await assert.rejects(f.execute(steps),error=>error.code==='REPEATED_FAILURE'&&error.details.attempts===3&&error.details.action==='place_furnace');
  assert.equal(attempts,3);
});
test('successful auxiliary plans that do not repair a precondition are bounded',async()=>{
  let checks=0;const steps=[{action:'target',skill:'target'}];
  const f=fixture({skills:{prepare:async()=>{},target:async()=>{}},plan:()=>({plan:[{action:'prepare',skill:'prepare'}]}),analyse:step=>{
    if(step.action!=='target')return {satisfied:true,missing:[]};
    if(++checks>4)throw Object.assign(new Error('safety sentinel'),{name:'AbortError'});
    return {satisfied:false,missing:[{key:'inventory.stick',condition:'>= 4',currentValue:0}],goapState:{inventory:{stick:0}},worldState:{inventory:{counts:{}}}};
  }});
  await assert.rejects(f.execute(steps),{code:'REPEATED_FAILURE'});assert.equal(checks,3);
});
test('progress reports failed steps and the replacement plan with a new identity',async()=>{
 const {Progress}=require('../../planner_bot/src/executor/progress'),{withContext}=require('../../planner_bot/src/utils/context'),events=[];
 const f=fixture({skills:{bad:async()=>{throw new Error('blocked')},good:async()=>{}},plan:()=>({plan:[{action:'replacement',skill:'good'}]})});
 const progress=new Progress(f.bot,event=>events.push(event));
 await withContext({bot:f.bot,progress},()=>f.execute([{action:'original',skill:'bad'}]));
 assert.deepEqual(events.map(e=>e.type),['plan','step_start','step_failure','replan','step_start','step_success']);
 assert.notEqual(events[0].planId,events[3].planId);assert.equal(events[4].planId,events[3].planId);
});
