const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Vec3}=require('vec3');const {load}=require('../helpers/module');
const {withContext}=require('../../planner_bot/src/utils/context');
function fixture(place, fallback=false){
  const world=new Map(),calls=[];let inventory=[{name:'crafting_table'}];
  const bot={entity:{position:new Vec3(.5,10,.5)},logWriter(){},inventory:{items:()=>inventory},equip:async()=>{},blockAt:p=>({position:p,name:world.get(p.toString())||(p.y===9?'stone':'air'),boundingBox:p.y===9?'block':'empty'})};
  const candidate={position:new Vec3(1,10,0),adjacentBlock:{position:new Vec3(1,9,0)},face:new Vec3(0,1,0)};
  const deps={'../primitives':{async placeBlock(bot,p){calls.push(p);await place({bot,p,world,consume:()=>{inventory=[];}});}}};
  if(fallback)deps['../navigation/placement_search']={skillCandidates:()=>[],goapFallbackCandidates:()=>[candidate],canPlaceBlockAt:()=>({canPlace:false})};
  return{bot,calls,world,skill:load(path.resolve(__dirname,'../../planner_bot/src/skills/place_block.js'),deps)};
}
for(const fallback of [false,true])test(`P1 actual table survives a placement exception (${fallback?'fallback':'six candidates'})`,async()=>{
  const f=fixture(async({p,world,consume})=>{world.set(p.reference.plus(new Vec3(p.face.x,p.face.y,p.face.z)).toString(),'crafting_table');consume();throw Error('blockUpdate timeout');},fallback);
  await f.skill(f.bot,{blockName:'crafting_table'},{});assert.equal(f.calls.length,1);assert.equal(f.bot.inventory.items().length,0);
});
test('P1 resolved placement without the requested block is still a failure',async()=>{
  const f=fixture(async()=>{},true);await assert.rejects(f.skill(f.bot,{blockName:'crafting_table'},{}),{code:'PLACEMENT_FAILED'});
});
test('P1 a different block at the destination is not a successful table',async()=>{
  const f=fixture(async({p,world})=>{world.set(p.reference.offset(0,1,0).toString(),'stone');throw Error('denied');},true);
  await assert.rejects(f.skill(f.bot,{blockName:'crafting_table'},{}),{code:'PLACEMENT_FAILED'});
});
test('P1 cancellation has priority even when the physical table exists',async()=>{
  const controller=new AbortController(),f=fixture(async({p,world})=>{world.set(p.reference.offset(0,1,0).toString(),'crafting_table');controller.abort();},true);
  await assert.rejects(withContext({bot:f.bot,signal:controller.signal},()=>f.skill(f.bot,{blockName:'crafting_table'},{})),{code:'CANCELLED'});assert.equal(f.calls.length,1);
});
