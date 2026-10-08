const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { handleChatCommand } = require('../../planner_bot/src/commands');
function fixture() {
  const logs=[], spoken=[];
  const bot={username:'TestBot',entity:{position:new Vec3(0,0,0),yaw:0,pitch:0},players:{},systemLog:x=>logs.push(x),shouldLogCommand:()=>true,
    getConversationHistory:()=>[],conversationSequence:0,speak:async(...args)=>spoken.push(args)};
  return {bot,logs,spoken,run:msg=>handleChatCommand(bot,'Peer',msg,{})};
}
for(const input of ['!unknown','!goal','!idle','!look','!creative'])test(`unmatched command ${input} returns a typed failure`,async()=> {
  const f=fixture();assert.equal((await f.run(input)).ok,false);assert.equal(f.bot.currentCommandName,null);
});
for(const input of ['!skill','!skill absent','!skill gather {','!primitive','!primitive absent','!primitive move_to {'])test(`${input} logs usage and returns a typed failure`,async()=> {
  const f=fixture();assert.equal((await f.run(input)).ok,false);assert.equal(f.bot.currentCommandName,null);
});
for(const input of ['!navigation','!navigation absent','!navigation gotoCoords {','!info','!info absent','!info all {','!info recipesFor {}'])test(`${input} returns a typed failure and clears command marker`,async()=> {
  const f=fixture();assert.equal((await f.run(input)).ok,false);assert.equal(f.bot.currentCommandName,null);
});
test('stop reports all held operation types and clears bot references',async()=> {
  const f=fixture(); const controller=new AbortController();let closed=false,stopped=false;
  Object.assign(f.bot,{currentAbortController:controller,currentChest:{close:()=>closed=true},followTarget:'Peer',
    pathfinder:{setGoal:()=>stopped=true},idleInterval:setInterval(()=>{},10000),lookWatchInterval:setInterval(()=>{},10000)});
  const result=await f.run('!stop');
  assert.deepEqual(result.data.stoppedActions,['GOAP task','chest','follow (Peer)','idle','look_watch']);
  assert.equal(controller.signal.aborted,true);assert.equal(closed,true);assert.equal(stopped,true);
  assert.equal(f.bot.currentAbortController,null);assert.equal(f.bot.followTarget,null);
});
test('stop without operations is a successful no-op',async()=>assert.deepEqual(await fixture().run('!stop'),{ok:true,data:{stoppedActions:[],message:'停止する操作がありませんでした'},error:null}));
test('chat failure is returned rather than thrown',async()=> {
  const f=fixture();const missing=await f.run('!chat Missing hello');assert.equal(missing.error.code,'PLAYER_NOT_FOUND');assert.equal(missing.error.details.targetUsername,'Missing');
  assert.equal((await f.run('!chat {')).error.code,'INVALID_ARGUMENT');
});
test('chat distance boundary, floor reporting, upper cap, and echo recipient',async()=> {
  const f=fixture(); f.bot.players.Peer={entity:{position:new Vec3(15,0,0)}};
  assert.equal((await f.run('!chat Peer hello')).ok,true);
  f.bot.players.Peer.entity.position.x=15.9;
  const far=await f.run('!chat Peer hello');assert.equal(far.error.code,'OUT_OF_RANGE');assert.equal(far.error.details.distance,15);assert.equal(far.error.details.maxDistance,15);
  const result=await f.run('!chat {"username":"Peer","message":"json","maxDistance":200}');
  assert.equal(result.data.maxDistance,100);
  assert.deepEqual(await f.run('!echo hello'),{ok:true,data:{message:'hello'},error:null});
  assert.deepEqual(f.spoken,[['Peer','hello'],['Peer','json'],['Peer','hello']]);
});
test('history passes single and multiple username filters',async()=> {
  const f=fixture();let options;f.bot.getConversationHistory=x=>{options=x;return [];};
  await f.run('!history A');assert.deepEqual(options,{username:'A'});
  await f.run('!history A, B');assert.deepEqual(options,{usernames:['A','B']});
});
