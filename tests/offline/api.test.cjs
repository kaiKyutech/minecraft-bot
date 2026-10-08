const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createBotApi}=require('../../planner_bot/src/api');
const skills=require('../../planner_bot/src/skills');
const {operationsFor}=require('../../planner_bot/src/executor/operation_manager');
const tick=()=>new Promise(setImmediate);
test('package import in CommonJS and ESM performs no connection or viewer startup',()=>{
  for(const script of ["const api=require('.');console.log(Object.keys(api).sort().join(','))", "import('./planner_bot/api.js').then(m=>console.log(typeof m.createBotApi))"]){
    const result=spawnSync(process.execPath,['-e',script],{cwd:require('node:path').resolve(__dirname,'../..'),encoding:'utf8',timeout:10000});
    assert.equal(result.status,0);assert.doesNotMatch(result.stderr,/circular dependency/);assert.match(result.stdout,/createAIBot,createBotApi|function/);
  }
});
test('observe and planning may finish while a bot owns an execution, without replacing it',async()=>{
  const state=JSON.parse(require('node:zlib').gunzipSync(require('node:fs').readFileSync(require('node:path').join(__dirname,'../fixtures/natural-empty.json.gz'))));
  const bot={version:'1.20.1',entity:{},systemLog(){},logLevel:'error'};
  const sm={cache:{sentinel:true},observe:async()=>structuredClone(state)};
  const api=createBotApi(bot,{stateManager:sm}),manager=operationsFor(bot);let finish;
  const running=manager.run('goal',()=>new Promise(resolve=>{finish=resolve}));await tick();const owner=bot.currentAbortController;
  const [observation,plan]=await Promise.all([api.observe(),api.planGoal('inventory.wooden_pickaxe:1')]);
  assert.equal(observation.ok,true);assert.equal(plan.ok,true);assert.ok(plan.data.plan.length);assert.deepEqual(sm.cache,{sentinel:true});
  assert.equal(bot.currentAbortController,owner);assert.equal(owner.signal.aborted,false);finish();await running;
});
test('invalid functions and parameters are typed failures and do not cancel existing work',async()=>{
  const bot={},api=createBotApi(bot,{stateManager:{}}),manager=operationsFor(bot);let finish;
  const running=manager.run('goal',()=>new Promise(resolve=>{finish=resolve}));await tick();
  assert.equal((await api.executeSkill('constructor')).error.code,'UNKNOWN_SKILL');
  assert.equal((await api.executePrimitive('absent')).error.code,'UNKNOWN_PRIMITIVE');
  assert.equal((await api.navigate('absent')).error.code,'UNKNOWN_ACTION');
  assert.equal((await api.planGoal('inventory.stick:1')).error.code,'BOT_NOT_READY');
  assert.equal(bot.currentAbortController.signal.aborted,false);finish();await running;
});
test('abort during initial refresh prevents skill execution and preserves its cancellation code',async()=>{
  const bot={},controller=new AbortController();let finish,called=false;
  skills.testCancellation=async()=>{called=true};
  try{
    const api=createBotApi(bot,{stateManager:{refresh:()=>new Promise(resolve=>{finish=resolve})}});
    const running=api.executeSkill('testCancellation',{}, {signal:controller.signal});await tick();controller.abort();finish();
    const result=await running;assert.equal(result.error.code,'CANCELLED');assert.equal(called,false);assert.equal(bot.currentAbortController,null);
  }finally{delete skills.testCancellation}
});
test('directional vision conflicts with an execution before opening a renderer',async()=>{
  const bot={followTarget:'Peer'},api=createBotApi(bot,{stateManager:{}});
  assert.equal((await api.info('vision',{yaw:90})).error.code,'OPERATION_CONFLICT');assert.equal(bot.viewer,undefined);
});
