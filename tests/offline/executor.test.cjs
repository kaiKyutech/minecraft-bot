const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {load}=require('../helpers/module');
function fixture({skills={},plan,analyse}={}){
  const calls=[];const world={inventory:{counts:{}}};const sm={refresh:async()=>calls.push('refresh'),getState:async()=>world};
  const bot={systemLog(){},shouldLogCommand:()=>true,pathfinder:{setGoal:x=>calls.push(['setGoal',x])},stopDigging:()=>calls.push('stopDigging')};
  const planner={plan:async(goal,state)=>{calls.push(['plan',goal]);return plan?plan(goal,state):{plan:[]};}};
  const checker={analyseStepPreconditions:async(bot,step)=>analyse?analyse(step):{satisfied:true,missing:[],goapState:{},worldState:world},getStateValue:(state,key)=>key.split('.').reduce((a,k)=>a?.[k],state)};
  const api=load(path.resolve(__dirname,'../../planner_bot/src/executor/goap_executor.js'),{
    '../planner/goap':planner,'../skills':skills,'./precondition_checker':checker,
    '../commands/goal_command':{checkCompositeState:()=>null,buildStructuredDiagnosis:x=>x},
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
