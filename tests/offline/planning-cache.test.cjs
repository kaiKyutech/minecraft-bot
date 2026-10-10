process.env.LOG_LEVEL='error';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {createStateSerializer,serializeState,applyEffects}=require('../../planner_bot/src/planner/state_operations');
const goap=require('../../planner_bot/src/planner/goap'),quiet={debug(){},info(){},warn(){},error(){}};
test('search serializer preserves nested key order, arrays and immutable shared subobjects',()=>{
 const state={z:[null,undefined,1,{b:2,a:1}],inventory:{oak_log:1},nearby:{log:1},empty:undefined};
 const encode=createStateSerializer(),next=applyEffects({'inventory.oak_log':'+1'},state);
 assert.equal(encode(state),serializeState(state));assert.equal(encode(next),serializeState(next));
 assert.equal(next.nearby,state.nearby);assert.equal(state.inventory.oak_log,1);
 state.inventory.oak_log=5;assert.equal(createStateSerializer()(state),serializeState(state),'new plan must not reuse another plan cache');
});
test('concurrent plans on distinct snapshots match independent sequential geometric plans',async()=>{
 const tasks=[],inputs=[];
 for(const label of ['flat-stocked','natural-empty']){
  const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,`../fixtures/${label}.json.gz`))));
  const expected={};for(const goal of Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname,`../fixtures/${label}-plans.json`),'utf8'))))expected[goal]=await goap.plan(goal,world,quiet);
  inputs.push([world,JSON.stringify(world)]);
  for(const [goal,result]of Object.entries(expected))tasks.push(goap.plan(goal,world,quiet).then(actual=>assert.deepEqual(JSON.parse(JSON.stringify(actual)),result)));
 }
 await Promise.all(tasks);for(const [world,before]of inputs)assert.equal(JSON.stringify(world),before);
});
