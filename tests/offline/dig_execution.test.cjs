const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { digBlock } = require('../../planner_bot/src/primitives');
const { withContext } = require('../../planner_bot/src/utils/context');
const wait = ms => new Promise(r => setTimeout(r, ms));
function botFixture(onGround) {
  const bot = new EventEmitter();
  Object.assign(bot, { version:'1.20.1', _client:new EventEmitter(), supportFeature:()=>true,
    entity: { onGround }, blockAt: p => ({ name: 'stone', stateId:1, position: p }),
    canDigBlock: () => true, digTime: () => bot.entity.onGround ? 1150 : 5650,
    logWriter: () => {}, calls: [], async dig(block) { bot.calls.push({onGround: bot.entity.onGround, predictedMs: bot.digTime()});bot._client.emit('block_change',{location:block.position,type:0}); } });
  return bot;
}
test('D1 starts after a short fall, with the grounded dig time', async () => {
  const bot = botFixture(false);setTimeout(() => {bot.entity.onGround=true;}, 80);
  await digBlock(bot, {position:new Vec3(0,10,0)});
  assert.deepEqual(bot.calls, [{onGround:true,predictedMs:1150}]);
});
test('D2 optimistic local air is insufficient; retries after restoring last known state', async () => {
  const bot=botFixture(true),p=new Vec3(-11,65,24);let state=1,attempts=0;
  bot.blockAt=()=>({name:state===0?'air':'stone',stateId:state,position:p});
  bot._updateBlockState=(pos,id)=>{state=id;};
  bot.dig=async()=>{attempts++;state=0;bot.emit('blockUpdate',{name:'stone'},{name:'air'});
    if(attempts===2)bot._client.emit('block_change',{location:p,type:0});};
  await digBlock(bot,{position:p});assert.equal(attempts,2);assert.equal(state,0);
  assert.equal(bot._client.listenerCount('block_change'),0);assert.equal(bot.listenerCount('diggingAborted'),0);
});
test('D2 persistent server rejection stops after three attempts, restoring the solid block', async () => {
  const bot=botFixture(true),p=new Vec3(0,10,0);let state=1,attempts=0;
  bot.blockAt=()=>({name:state===0?'air':'stone',stateId:state,position:p});bot._updateBlockState=(pos,id)=>{state=id;};
  bot.dig=async()=>{attempts++;state=0;};
  await assert.rejects(digBlock(bot,{position:p}),{code:'BLOCK_NOT_FOUND'});
  assert.equal(attempts,3);assert.equal(state,1);assert.equal(bot._client.listenerCount('multi_block_change'),0);
});
test('D2 packed server section updates support negative coordinates and unrelated blocks', async () => {
  const bot=botFixture(true),p=new Vec3(-11,65,24);
  bot.dig=async()=>{bot._client.emit('multi_block_change',{chunkCoordinates:{x:-1,y:4,z:1},records:[(5<<8)|(8<<4)|1]});};
  await digBlock(bot,{position:p});assert.equal(bot._client.listenerCount('multi_block_change'),0);
});
test('D2 cancellation during server confirmation drains listeners and prevents a retry', async () => {
  const bot=botFixture(true),controller=new AbortController();let attempts=0;
  bot.dig=async()=>{attempts++;controller.abort();};
  await assert.rejects(withContext({bot,signal:controller.signal},()=>digBlock(bot,{position:new Vec3(0,10,0)})),{code:'CANCELLED'});
  assert.equal(attempts,1);assert.equal(bot._client.listenerCount('block_change'),0);
});
test('D2 direct pathfinder dig captures the physical owner signal outside async context', async () => {
  const {installDigExecution,drainDigging}=require('../../planner_bot/src/utils/dig_execution');
  const bot=botFixture(false),controller=new AbortController();bot.currentAbortController=controller;
  installDigExecution(bot);const work=bot.dig(bot.blockAt(new Vec3(0,10,0)));controller.abort();
  await assert.rejects(work,{code:'CANCELLED'});await drainDigging(bot);assert.equal(bot.calls.length,0);
});
test('D2 cancellation after optimistic air restores the block before ownership is released', async () => {
  const bot=botFixture(true),controller=new AbortController(),p=new Vec3(0,10,0);let state=1;
  bot.blockAt=()=>({name:state===0?'air':'stone',stateId:state,position:p});bot._updateBlockState=(pos,id)=>{state=id;};
  bot.dig=async()=>{state=0;controller.abort();};
  await assert.rejects(withContext({bot,signal:controller.signal},()=>digBlock(bot,{position:p})),{code:'CANCELLED'});
  assert.equal(state,1);assert.equal(bot._client.listenerCount('block_change'),0);
});
test('D2 a movement timeout cancels a pending landing wait before a later dig can start', async()=>{
  const {diggingScope}=require('../../planner_bot/src/utils/dig_execution'),bot=botFixture(false);
  const close=diggingScope(bot),work=bot.dig(bot.blockAt(new Vec3(0,10,0)));
  const rejected=assert.rejects(work,{code:'CANCELLED'});await close();await rejected;
  await wait(50);assert.equal(bot.calls.length,0);assert.equal(bot._client.listenerCount('block_change'),0);
});
test('D2 late server air between attempts is accepted without digging an air block',async()=>{
  const bot=botFixture(true),p=new Vec3(0,10,0);let state=1,attempts=0;
  bot.blockAt=()=>({name:state===0?'air':'stone',stateId:state,position:p});bot._updateBlockState=(pos,id)=>{state=id;};bot.canDigBlock=b=>b.name==='stone';
  bot.dig=async()=>{attempts++;state=0;bot.entity.onGround=false;
    setTimeout(()=>{state=0;bot._client.emit('block_change',{location:p,type:0});},1100);
    setTimeout(()=>{bot.entity.onGround=true;},1200);};
  await digBlock(bot,{position:p});assert.equal(attempts,1);assert.equal(bot._client.listenerCount('block_change'),0);
});
test('D1 sustained non-grounded mining is bounded and retains mineflayer timing', async () => {
  const bot = botFixture(false), t=Date.now();await digBlock(bot, {position:new Vec3(0,10,0)});
  assert.ok(Date.now()-t>=1000&&Date.now()-t<1600);assert.deepEqual(bot.calls,[{onGround:false,predictedMs:5650}]);
});
test('D1 cancellation while waiting cannot start digging later', async () => {
  const bot=botFixture(false),controller=new AbortController();setTimeout(()=>controller.abort(),50);
  await assert.rejects(withContext({bot,signal:controller.signal},()=>digBlock(bot,{position:new Vec3(0,10,0)})),{code:'CANCELLED'});
  await wait(80);assert.equal(bot.calls.length,0);
});
