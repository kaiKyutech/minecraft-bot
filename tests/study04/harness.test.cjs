process.env.LOG_LEVEL='error';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {makePlanner,replay,root,replace,indexedHeuristic}=require('./harness.cjs');
const goap=require('../../planner_bot/src/planner/goap');
const {buildState}=require('../../planner_bot/src/planner/state_builder');
const h=require('../../planner_bot/src/planner/heuristic');
const dir=path.join(root,'tests/fixtures'),quiet={debug(){},info(){},warn(){},error(){}};
test('VM baseline, indexing, and immutable signatures preserve all 70 historical results',async()=>{
 await goap.prepareDomain('1.20.1');const baseline=makePlanner(),combined=makePlanner({indexed:true,cachedSignature:true});let cases=0;
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('-plans.json'))){
  const name=file.replace('-plans.json',''),world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,name+'.json.gz')))),before=structuredClone(world),golden=JSON.parse(fs.readFileSync(path.join(dir,file)));
  for(const [goal,expected]of Object.entries(golden)){
   // Task 12 changes geometric costs. This historical speed-study comparison
   // still verifies the original cost domain with count-only observations.
   const original=await goap.plan(goal,{...world,blocks:{list:[]}},quiet),a=await baseline.run(goal,world),b=await combined.run(goal,world);
   assert.deepEqual(JSON.parse(JSON.stringify(original)),expected);assert.deepEqual(a.result,original);assert.deepEqual(b.result,original);assert.equal(a.metrics.iterations,b.metrics.iterations);
   if(original.plan)assert.equal(replay(goal,world,original.plan).valid,true,`${name} ${goal}`);
   cases++;
  }assert.deepEqual(world,before);
 }assert.equal(cases,70);
});
test('replay rejects missing prerequisites and incomplete additive targets',async()=>{
 await goap.prepareDomain('1.20.1');const world={inventory:{counts:{oak_planks:4}},nearby:{},equipment:{},inventory_space:true};
 assert.equal(replay('inventory.oak_planks:4',world,[]).valid,false);
 assert.equal(replay('inventory.wooden_pickaxe:1',world,[{action:'auto_workbench_craft_wooden_pickaxe'}]).valid,false);
});
test('instrumentation refuses source drift and distinguishes a budget from iteration cutoff',async()=>{
 assert.throws(()=>replace('aa','a','b'),/anchor changed/);await goap.prepareDomain('1.20.1');
 const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,'natural-empty.json.gz'))));
 const cutoff=await makePlanner({limit:1}).run('inventory.wooden_pickaxe:1',world);assert.equal(cutoff.reason,'iteration_limit');assert.equal(cutoff.metrics.iterations,1);
 const timed=await makePlanner().run('inventory.wooden_pickaxe:1',world,{deadline:0});assert.equal(timed.reason,'BUDGET_EXCEEDED');
});
test('shared prerequisite heuristic overestimates a known valid path (counterexample)',()=>{
 const actions=[{name:'shared',preconditions:{},effects:{'inventory.a':'+1','inventory.b':'+1'},cost:1},{name:'finish',preconditions:{'inventory.a':'>= 1','inventory.b':'>= 1'},effects:{'inventory.c':'+1'},cost:1}];
 const state={inventory:{a:0,b:0,c:0}},context=h.buildHeuristicContext({'inventory.c':1},null,actions);
 assert.equal(h.calculateHeuristic(state,context),3); // Valid shared -> finish costs only 2.
 assert.equal(indexedHeuristic(true).calculateHeuristic(state,context),2);
});
