const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Vec3}=require('vec3'),{load}=require('../helpers/module');
const {withContext}=require('../../planner_bot/src/utils/context');
function fixture(move){
  const world=new Map([['(0, 9, 0)','acacia_log'],['(2, 5, 0)','stone']]),moves=[];
  const bot={entity:{position:new Vec3(.5,10,.5)},logWriter(){},blockAt:p=>({position:p,name:world.get(p.toString())||'air',boundingBox:world.has(p.toString())?'block':'empty'})};
  const ground=load(path.resolve(__dirname,'../../planner_bot/src/navigation/placement_ground.js'),{'../primitives':{async moveTo(bot,p){moves.push(p);if(move)await move(bot,p);else bot.entity.position=p.position.offset(.5,0,.5);}}});
  return{world,moves,bot,ground};
}
test('P2 tree footing descends to loaded solid ground with two free body blocks',async()=>{
  const f=fixture();assert.equal(f.ground.treeFooting(f.bot),true);await f.ground.descendForPlacement(f.bot);
  assert.equal(f.moves.length,1);assert.equal(f.moves[0].position.toString(),'(2, 6, 0)');assert.equal(f.ground.treeFooting(f.bot),false);
});
test('P2 partial solid ground under the body does not force a descent',async()=>{
  const f=fixture();f.bot.entity.position.x=.9;f.world.set('(1, 9, 0)','stone');await f.ground.descendForPlacement(f.bot);assert.equal(f.moves.length,0);
});
test('P2 leaves/logs, unloaded blocks and obstructed headroom are not ground destinations',()=>{
  const f=fixture();f.world.set('(2, 7, 0)','stone');f.world.set('(1, 5, 0)','acacia_leaves');
  const blockAt=f.bot.blockAt;f.bot.blockAt=p=>p.x===3?null:blockAt(p);
  const positions=f.ground.groundCandidates(f.bot).map(c=>c.position.toString());
  assert.ok(!positions.includes('(2, 6, 0)'));assert.ok(!positions.includes('(1, 6, 0)'));
  assert.ok(positions.every(p=>!p.startsWith('(3,')));assert.ok(positions.includes('(2, 8, 0)'));
});
test('P2 absent or unreachable ground retains a finite fallback to current placement',async()=>{
  const f=fixture(async()=>{throw Object.assign(Error('No path to the goal'),{name:'NoPath'});});
  for(let x=1;x<=5;x++)f.world.set(`(${x}, 5, 0)`,'stone');
  await f.ground.descendForPlacement(f.bot);assert.equal(f.moves.length,3);assert.ok(f.moves.every(m=>m.timeout>0&&m.timeout<=8000));
});
test('P2 cancellation prevents later descent attempts',async()=>{
  const controller=new AbortController(),f=fixture(async()=>{controller.abort();});
  await assert.rejects(withContext({bot:f.bot,signal:controller.signal},()=>f.ground.descendForPlacement(f.bot)),{code:'CANCELLED'});assert.equal(f.moves.length,1);
});
