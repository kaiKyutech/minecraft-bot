const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {Vec3}=require('vec3');
const {load}=require('../helpers/module');
function fixture(heights){
  const moves=[];
  const nav=load(path.resolve(__dirname,'../../planner_bot/src/navigation/actions.js'),{'../primitives':{moveTo:async(bot,params)=>moves.push(params)}});
  const bot={entity:{position:new Vec3(0,10,0),yaw:0},systemLog(){},blockAt:pos=>({name:heights.includes(pos.y)?'stone':'air',position:pos})};
  return {nav,bot,moves};
}
for(const [mode,expected]of [['nearest',10],['below',10],['above',15],['surface',15]])test(`direction mode ${mode} chooses observed surface`,async()=>{
  const f=fixture([9,14]);const result=await f.nav.moveInDirection(f.bot,{}, {yaw:90,distance:4,verticalMode:mode});
  assert.deepEqual(result.targetPosition,{x:-4,y:expected,z:-1});assert.equal(f.moves[0].range,3);
});
test('nearest falls back to current y but above/below throw without ground',async()=>{
  const f=fixture([]);assert.equal((await f.nav.moveInDirection(f.bot,{}, {yaw:0,distance:2})).targetPosition.y,10);
  for(const mode of ['above','below'])await assert.rejects(()=>f.nav.moveInDirection(f.bot,{}, {yaw:0,distance:2,verticalMode:mode}));
});
test('navigation directly stops follow and returns previousTarget',async()=>{
  const f=fixture([]);let goal;f.bot.followTarget='Peer';f.bot.pathfinder={setGoal:x=>goal=x};
  assert.equal((await f.nav.stopFollow(f.bot,{},{})).previousTarget,'Peer');assert.equal(goal,null);
});
test('skill placement keeps six candidates in east/west/south/north/diagonal order',async()=>{
  const visited=[];const attempts=[];
  const skill=load(path.resolve(__dirname,'../../planner_bot/src/skills/place_block.js'),{'../primitives':{placeBlock:async(bot,params)=>{attempts.push(params);if(attempts.length<6)throw new Error('blocked');}}});
  const bot={entity:{position:new Vec3(0,1,0)},inventory:{items:()=>[{name:'chest'}]},equip:async()=>{},systemLog(){},blockAt:pos=>{
    if(pos.y===1)visited.push([pos.x,pos.z]);return {name:pos.y===1?'air':'stone',position:pos};}};
  await skill(bot,{blockName:'chest'},{});assert.deepEqual(visited,[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]]);
  assert.equal(attempts.length,6);
});
