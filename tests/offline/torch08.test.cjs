const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { createBotApi } = require('../../planner_bot/src/api')
const { operationsFor } = require('../../planner_bot/src/executor/operation_manager')
const { torchOptions, torchCandidates } = require('../../planner_bot/src/navigation/torch_placement')
const tick = () => new Promise(setImmediate)

function fixture() {
  const blocks=new Map(), item={name:'torch',count:4}, calls=[]
  const bot={version:'1.20.1',logLevel:'error',entity:{position:new Vec3(.5,10,.5),yaw:0,pitch:.2},
    inventory:{items:()=>item.count>0?[item]:[]},
    blockAt: p => blocks.get(p.floored().toString()) ?? {name:'air',position:p.floored(),boundingBox:'empty',light:0,skyLight:0},
    equip:async()=>{}, look:async(yaw,pitch)=>{calls.push(['look',yaw,pitch])},
    placeBlock:async(ref,face)=>{const position=ref.position.plus(face);blocks.set(position.toString(),{name:face.y===1?'torch':'wall_torch',position});item.count--;calls.push(['place',position])},
    pathfinder:{setGoal:()=>{}},stateManager:{}}
  const put=(x,y,z,name='stone',shapes=[[0,0,0,1,1,1]])=>blocks.set(new Vec3(x,y,z).toString(),{name,position:new Vec3(x,y,z),boundingBox:'block',shapes})
  const floor=()=>{for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)put(x,9,z)}
  return {bot,item,calls,put,floor,api:createBotApi(bot),blocks}
}
test('torch candidates protect fractional body and the forward corridor for all four yaw directions',()=>{
  const f=fixture();f.floor();f.bot.entity.position.x=.05
  for(const yaw of [0,Math.PI/2,Math.PI,3*Math.PI/2]) {
    f.bot.entity.yaw=yaw
    const rows=torchCandidates(f.bot,torchOptions({}))
    assert.ok(rows.length)
    for(const row of rows) {
      const p=f.bot.entity.position,q=row.position
      assert.ok(!(q.x+1>p.x-.3 && q.x<p.x+.3 && q.z+1>p.z-.3 && q.z<p.z+.3 && q.y+1>p.y && q.y<p.y+1.8))
      const vx=q.x+.5-p.x,vz=q.z+.5-p.z, ahead=-vx*Math.sin(yaw)-vz*Math.cos(yaw)
      const lateral=Math.abs(-vx*Math.cos(yaw)+vz*Math.sin(yaw))
      assert.ok(!(ahead>0 && ahead<=2.5 && lateral<.8))
    }
    const first=rows[0].position
    assert.ok(-(first.x+.5-f.bot.entity.position.x)*Math.sin(yaw)-(first.z+.5-.5)*Math.cos(yaw)<=0)
  }
})
test('wall/floor modes use full supporting faces, never ceiling, plants or existing blocks',()=>{
  const f=fixture();f.put(0,10,2);f.put(0,11,2);f.put(1,9,0,'stone_slab',[[0,0,0,1,.5,1]])
  assert.equal(torchCandidates(f.bot,torchOptions({placement:'floor'})).length,0)
  const rows=torchCandidates(f.bot,torchOptions({placement:'wall'}))
  assert.ok(rows.length)
  assert.ok(rows.every(r=>r.kind==='wall' && r.face.y===0))
  f.put(0,9,1,'oak_leaves')
  assert.equal(torchCandidates(f.bot,torchOptions({placement:'floor'})).length,0)
  f.bot.blockAt=()=>null
  assert.equal(torchCandidates(f.bot,torchOptions({})).length,0)
})
for(const placement of ['floor','wall']) test(`public placeTorch confirms one ${placement} torch, returns light and restores view`,async()=>{
  const f=fixture();if(placement==='floor')f.floor();else f.put(0,10,2)
  const result=await f.api.placeTorch({placement})
  assert.equal(result.ok,true);assert.equal(result.data.placement,placement)
  assert.equal(result.data.beforeLight.dark,true)
  assert.equal(result.data.afterLight.dark,false);assert.equal(result.data.afterLight.torchNearby,true)
  assert.equal(f.item.count,3);assert.equal(f.calls.filter(c=>c[0]==='place').length,1)
  assert.equal(result.data.viewRestored,true);assert.deepEqual(f.calls.at(-1),['look',0,.2])
})
test('actual torch wins over a native exception, while wrong block and optimistic completion fail',async()=>{
  const f=fixture();f.floor();const native=f.bot.placeBlock
  f.bot.placeBlock=async(...args)=>{await native(...args);throw new Error('missed update')}
  assert.equal((await f.api.placeTorch()).ok,true)
  const bad=fixture();bad.floor();bad.bot.placeBlock=async(ref,face)=>bad.put(...Object.values(ref.position.plus(face)),'dirt')
  assert.equal((await bad.api.placeTorch()).error.code,'PLACEMENT_FAILED')
  const empty=fixture();empty.floor();empty.bot.placeBlock=async()=>{}
  const result=await empty.api.placeTorch()
  assert.equal(result.error.code,'PLACEMENT_FAILED');assert.equal(result.error.details.attempts,8)
})
test('no inventory and no viable space are typed failures without crafting or moving',async()=>{
  const f=fixture();f.item.count=0
  assert.equal((await f.api.placeTorch()).error.code,'ITEM_NOT_FOUND')
  f.item.count=1
  assert.equal((await f.api.placeTorch()).error.code,'PLACEMENT_FAILED')
  assert.equal(f.calls.some(c=>c[0]==='place'),false)
})
test('invalid or pre-aborted torch requests do not replace a current owner',async()=>{
  const f=fixture(), manager=operationsFor(f.bot);let finish
  const running=manager.run('goal',()=>new Promise(resolve=>{finish=resolve}));await tick()
  const owner=f.bot.currentAbortController
  for(const args of [null,{radius:0},{placement:'ceiling'},{torchRadius:9}])
    assert.equal((await f.api.placeTorch(args)).error.code,'INVALID_ARGUMENT')
  assert.equal((await f.api.placeTorch({signal:AbortSignal.abort()})).error.code,'CANCELLED')
  assert.equal(owner.signal.aborted,false);finish();await running
})
test('abort while equipping prevents placement and stop awaits the issued equip',async()=>{
  const f=fixture();f.floor();let finish
  f.bot.equip=()=>new Promise(resolve=>{finish=resolve})
  const running=f.api.placeTorch();await tick();let stopped=false
  const stopping=f.api.stop().then(result=>{stopped=true;return result});await tick()
  assert.equal(stopped,false);finish()
  assert.equal((await running).error.code,'CANCELLED');assert.equal((await stopping).ok,true)
  assert.equal(f.calls.length,0)
})
test('replacement waits for in-flight placement and cancellation takes priority over a late actual torch',async()=>{
  const f=fixture();f.floor();let finish, newerStarted=false
  const native=f.bot.placeBlock
  f.bot.placeBlock=(...args)=>new Promise(resolve=>{finish=async()=>{await native(...args);resolve()}})
  const first=f.api.placeTorch();await tick()
  const next=operationsFor(f.bot).run('goal',()=>{newerStarted=true});await tick()
  assert.equal(newerStarted,false);await finish()
  assert.equal((await first).error.code,'CANCELLED');await next
  assert.equal(newerStarted,true);assert.equal(f.calls.filter(c=>c[0]==='look').length,0)
})
