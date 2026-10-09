const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {connect,rcon,wait}=require('../helpers/live');const {createBotApi}=require('../../planner_bot/api');const goap=require('../../planner_bot/src/planner/goap');
process.env.LOG_LEVEL='error';
const goals=['oak_planks:4','stick:4','crafting_table:1','wooden_pickaxe:1','wooden_axe:1','stone_pickaxe:1','furnace:1','torch:4','iron_ingot:1','iron_pickaxe:1','diamond_pickaxe:1','bread:1','cake:1','chest:1','wooden_sword:1','stone_axe:1','dirt:1','cobblestone:1','coal:1','iron_ore:1'].map(x=>'inventory.'+x);
test('03 live: batch evaluation, fast observations, bounded exploration and progress',{timeout:150000},async()=>{
 const results={observations:{},evaluations:[],moves:[],progress:[]};let bot,api;
 try{
  for(const world of ['flat','natural']){
   bot=await connect(world,world==='flat'?'Fast03Flat':'Fast03Natural');api=createBotApi(bot,{logLevel:'error'});
   const observations=[];
   for(let i=0;i<12;i++){const start=performance.now(),r=await api.observeFast();assert.equal(r.ok,true);observations.push({durationMs:performance.now()-start,complete:r.data.complete,checks:r.data.checksUsed,sky:r.data.skyVisible,resources:r.data.resources});await wait(20)}
   results.observations[world]=observations;
   if(world==='natural'){
    const observed=await api.observe();assert.equal(observed.ok,true);await goap.prepareDomain(bot.version);
    for(let i=0;i<3;i++){
     const result=await api.evaluateGoals(goals,{worldState:observed.data,maxMs:1000});assert.equal(result.ok,true);
     results.evaluations.push(result.data);assert.ok(result.data.durationMs<=1100,`deadline overshoot ${result.data.durationMs}`);
     assert.ok(result.data.results.some(r=>r.status==='plannable'),'Must evaluate useful options, not only report timeouts');
    }
    const baseline=await api.planGoal('inventory.stick:4',{worldState:observed.data});const cached=await api.evaluateGoals(['inventory.stick:4'],{worldState:observed.data});if(baseline.ok)assert.deepEqual(cached.data.results[0].plan,baseline.data.plan);
   }
   await api.stop();bot.quit();bot=null
  }
  bot=await connect('flat','Move03');api=createBotApi(bot,{logLevel:'error'});
  await rcon('flat',['tp Move03 1000 -60 1000']);await wait(1400);
  await rcon('flat',['fill 992 -61 992 1015 -61 1015 stone','fill 992 -60 992 1015 -54 1015 air','clear Move03','give Move03 oak_log']);await wait(400);
  const start=bot.entity.position.clone();
  const moving=api.moveToward({x:start.x+35,z:start.z},{maxMs:1200});await wait(50);
  const owner=bot.currentAbortController;
  const [fast,evals]=await Promise.all([api.observeFast({range:8}),api.evaluateGoals(['inventory.stick:4'],{worldState:(await api.observe()).data,maxMs:500})]);
  assert.equal(fast.ok,true);assert.equal(evals.ok,true);assert.equal(bot.currentAbortController,owner);
  const partial=await moving;assert.equal(partial.ok,true);assert.ok(['timeout','no_path','arrived'].includes(partial.data.reason));results.moves.push(partial.data);assert.equal(bot.pathfinder.goal,null);
  for(const target of [{x:100000,z:100000},{x:1000,y:400,z:1000}]){
   const t=performance.now(),r=await api.moveToward(target,{maxMs:500});assert.equal(r.ok,true);assert.ok(['timeout','no_path'].includes(r.data.reason));assert.ok(performance.now()-t<1500);results.moves.push(r.data);assert.equal(bot.pathfinder.goal,null)
  }
  const arrived=await api.moveToward({x:bot.entity.position.x,z:bot.entity.position.z});assert.equal(arrived.data.reached,true);
  const controller=new AbortController(),cancelled=api.moveToward({x:2000,z:2000},{maxMs:10000,signal:controller.signal});await wait(100);controller.abort();assert.equal((await cancelled).error.code,'CANCELLED');assert.equal(bot.pathfinder.goal,null);
  const execution=await api.executeGoal('inventory.stick:4',{onProgress:e=>results.progress.push(e)});assert.equal(execution.ok,true,JSON.stringify(execution));
  assert.ok(results.progress.some(e=>e.type==='plan'));assert.ok(results.progress.some(e=>e.type==='step_start'));assert.equal(results.progress.at(-1).type,'goal_end');
 }finally{if(bot){await api.stop();bot.quit()}fs.mkdirSync('.cache/minecraft-bot/02-03-results',{recursive:true});fs.writeFileSync('.cache/minecraft-bot/02-03-results/03-live.json',JSON.stringify(results,null,2))}
});
test('03 blocked: a bedrock enclosure returns no_path and clears its goal',{timeout:30000},async()=>{
 const bot=await connect('flat','Blocked03'),api=createBotApi(bot,{logLevel:'error'});
 try{
  await rcon('flat',['tp Blocked03 1100 -60 1100']);await wait(1200);
  await rcon('flat',['fill 1098 -61 1098 1102 -57 1102 bedrock','fill 1100 -60 1100 1100 -59 1100 air','tp Blocked03 1100.5 -60 1100.5']);await wait(400);
  const start=performance.now(),result=await api.moveToward({x:1110,z:1110},{maxMs:5000});
  assert.equal(result.ok,true);assert.equal(result.data.reason,'no_path');assert.equal(result.data.reached,false);assert.equal(bot.pathfinder.goal,null);
  fs.writeFileSync('.cache/minecraft-bot/02-03-results/03-no-path.json',JSON.stringify({durationMs:performance.now()-start,result},null,2));
 }finally{await api.stop();bot.quit()}
});
