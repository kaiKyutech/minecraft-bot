const {test}=require('node:test');const assert=require('node:assert/strict');const {Vec3}=require('vec3');
const {canPlaceBlockAt,findNearestPlaceablePosition,skillCandidates}=require('../../planner_bot/src/navigation/placement_search');
const key=p=>[p.x,p.y,p.z].join(',');
const fixture=solids=>({entity:{position:new Vec3(0.8,10.7,0.2)},blockAt:p=>({name:solids.has(key(p))?'stone':'air',position:p})});
test('skill candidates retain the six positions and their original order',()=>{
  assert.deepEqual(skillCandidates(fixture(new Set())).map(key),['1,10,0','-1,10,0','0,10,1','0,10,-1','1,10,1','-1,10,-1']);
});
test('creative accepts a side reference while skill requires one below',()=>{
  const bot=fixture(new Set(['2,10,0'])),pos=new Vec3(1,10,0);
  assert.equal(canPlaceBlockAt(bot,pos,'skill').canPlace,false);const creative=canPlaceBlockAt(bot,pos);
  assert.equal(creative.canPlace,true);assert.equal(key(creative.face),'1,0,0');
});
test('creative distance ties retain dx/dy/dz order and skip own column by default',()=>{
  const bot=fixture(new Set(['-1,9,0','1,9,0','0,9,0']));
  assert.equal(key(findNearestPlaceablePosition(bot).position),'-1,10,0');
  assert.equal(key(findNearestPlaceablePosition(bot,5,true).position),'0,10,0');
});
test('creative search preserves three dimensional positions outside the skill candidates',()=>{
  const bot=fixture(new Set(['0,12,2']));const found=findNearestPlaceablePosition(bot);
  assert.ok(found);assert.equal(skillCandidates(bot).some(p=>key(p)===key(found.position)),false);
  assert.equal(found.distance<=5,true);
});
