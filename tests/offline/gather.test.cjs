process.env.LOG_LEVEL = 'error';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Vec3}=require('vec3'),{load}=require('../helpers/module');
const {withContext}=require('../../planner_bot/src/utils/context');
function fixture({fail=()=>false, size=4, category=false}={}) {
  const positions=Array.from({length:size},(_,i)=>new Vec3(i+1,64,0)),attempts=[],samples=[],dug=[];
  const bot={version:'1.20.1',username:'test',entity:{position:new Vec3(0,64,0)},logLevel:'error',logWriter(){},blockAt(p){return{name:'oak_log',position:p}},async unequip(){}};
  const primitives={async findBlock(){return{position:positions[0]}},async findBestTool(){return null},async findBlocks(bot,p){samples.push(p.count);return positions.slice(0,p.count).map(position=>({position,name:'oak_log'}))},async moveTo(bot,p){attempts.push(p.position.x);assert.ok(Number.isFinite(p.timeout)&&p.timeout<=60000);const error=fail(p.position.x);if(error)throw new Error(error)},async digBlock(bot,p){dug.push(p.position.x)}};
  let categoryScans=0;
  bot.findBlock=()=>({name:'oak_log',position:positions[0]});
  const substitutes={'../primitives':primitives};
  if(category) {
    substitutes['../planner/state_builder']={loadBlockCategories:()=>({categories:{log:{blocks:['oak_log','birch_log']}}})};
    substitutes['../utils/block_scanner']={async scanBlocks(){categoryScans++;return{blocks:[{name:'oak_log',position:positions[0],distance:1}]}}};
  }
  const gather=load(path.resolve(__dirname,'../../planner_bot/src/skills/gather.js'),substitutes);
  const run=(params, targetBot=bot)=>gather(targetBot,{itemName:'oak_log',count:1,collectItem:false,retryDelayMs:0,...params},{});
  return {bot,run,attempts,samples,dug,primitives,get categoryScans(){return categoryScans}};
}
test('gather retains the one-candidate fast path and retries a path decision timeout on another block',async()=>{
  const f=fixture({fail:x=>x===1?'Took to long to decide path to goal!':false});
  await f.run();assert.deepEqual(f.samples,[1,2]);assert.deepEqual(f.attempts,[1,2]);assert.deepEqual(f.dug,[2]);
});
test('failed positions persist between gather calls during GOAP replanning',async()=>{
  const f=fixture({fail:()=> 'Took to long to decide path to goal!'});
  await assert.rejects(f.run({maxAttempts:1}));
  f.primitives.moveTo=async(bot,p)=>f.attempts.push(p.position.x);
  await f.run();assert.equal(f.dug.at(-1),2);assert.deepEqual(f.attempts,[1,2]);
});
test('a pathfinder no-path failure also advances to the next candidate',async()=>{
  const f=fixture({fail:x=>x===1?'No path to the goal!':false});
  await f.run();assert.deepEqual(f.attempts,[1,2]);assert.deepEqual(f.dug,[2]);
});
test('expired avoidance permits the formerly failed nearest target again',async()=>{
  const f=fixture({fail:()=> 'moveTo timeout (30000ms)'});
  await assert.rejects(f.run({maxAttempts:1,avoidTtlMs:1}));
  await new Promise(r=>setTimeout(r,5));f.primitives.moveTo=async()=>{};
  await f.run({avoidTtlMs:1});assert.equal(f.dug.at(-1),1);
});
test('avoidance is bounded and does not leak between bots sharing a name',async()=>{
  const f=fixture({fail:()=> 'Took to long to decide path to goal!',size:10});
  await assert.rejects(f.run({maxAttempts:3,maxAvoidListSize:2,maxCandidates:4}));
  assert.ok(f.samples.every(n=>n<=4));
  f.primitives.moveTo=async()=>{};await f.run({maxAvoidListSize:2});assert.equal(f.dug.at(-1),1);
  const other={...f.bot,entity:{...f.bot.entity}};
  await f.run({},other);assert.equal(f.samples.at(-1),1);
});
test('candidate exhaustion is finite and preserves BLOCK_NOT_FOUND for FailureGuard',async()=>{
  const f=fixture({fail:()=> 'moveTo timeout (30000ms)',size:2});
  await assert.rejects(f.run({maxCandidates:2}),e=>e.code==='BLOCK_NOT_FOUND');assert.deepEqual(f.attempts,[1,2]);
});
test('cancellation neither retries nor adds the interrupted target to avoidance',async()=>{
  const f=fixture(),controller=new AbortController();
  f.primitives.moveTo=async()=>{controller.abort();throw new Error('path was stopped')};
  await assert.rejects(withContext({bot:f.bot,signal:controller.signal},()=>f.run()),e=>e.code==='CANCELLED');
  f.primitives.moveTo=async()=>{};await f.run();assert.equal(f.dug.at(-1),1);
});
test('REPEATED_FAILURE escapes gather without alternate-candidate retries',async()=>{
  const f=fixture();f.primitives.moveTo=async()=>{throw Object.assign(new Error('path was stopped'),{code:'REPEATED_FAILURE'})};
  await assert.rejects(f.run(),e=>e.code==='REPEATED_FAILURE');assert.deepEqual(f.samples,[1]);
});
test('bounded exhaustion still reaches the existing repeated-failure guard across replans',async()=>{
  const {FailureGuard}=require('../../planner_bot/src/executor/failure_guard');
  const f=fixture({fail:()=> 'Took to long to decide path to goal!'}),guard=new FailureGuard();
  const step={action:'gather',params:{itemName:'oak_log'}},world={inventory:{counts:{}}};
  for(let i=0;i<3;i++) {
    let failure;try{await f.run({maxCandidates:1})}catch(e){failure=e}
    assert.equal(failure.code,'BLOCK_NOT_FOUND');
    if(i<2)guard.note('log',step,failure,world,f.bot);
    else assert.throws(()=>guard.note('log',step,failure,world,f.bot),e=>e.code==='REPEATED_FAILURE'&&e.details.attempts===3);
  }
});
test('alternate positions keep the selected category block type and reuse its cache',async()=>{
  const f=fixture({category:true,fail:x=>x===1?'Took to long to decide path to goal!':false});
  const find=f.primitives.findBlocks;
  f.primitives.findBlocks=(bot,p)=>{assert.equal(p.match,'oak_log');return find(bot,p)};
  await f.run({itemName:'log'});await f.run({itemName:'log'});
  assert.equal(f.categoryScans,1);assert.deepEqual(f.dug,[2,2]);
});
test('caller-supplied infinite or oversized limits cannot create unbounded retries',async()=>{
  const f=fixture({size:100,fail:()=> 'Took to long to decide path to goal!'});
  await assert.rejects(f.run({maxAttempts:1000,maxCandidates:1000,maxAvoidListSize:1000,moveTimeoutMs:Infinity}));
  assert.ok(f.attempts.length<=64);assert.ok(f.samples.every(n=>n<=64));
});
