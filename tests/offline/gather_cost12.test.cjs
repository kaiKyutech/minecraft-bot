process.env.LOG_LEVEL='error'
const {test}=require('node:test'), assert=require('node:assert/strict')
const {gatherEffort,costedActions}=require('../../planner_bot/src/planner/gather_cost')
const goap=require('../../planner_bot/src/planner/goap')
const {evaluate}=require('../../planner_bot/src/planner/goal_evaluator')
const quiet={debug(){},info(){},warn(){},error(){}}
const row=(name,x,y=64,z=0)=>({name,position:{x,y,z}})
function world(distance,wall=false,logs=16){
  return {position:{x:0.5,y:64,z:0.5},inventory:{counts:{acacia_log:logs}},equipment:{},inventory_space:true,nearby_blocks:{},
    nearby:{oak_planks:4,category:{plank:4}},blocks:{list:[0,1,2,3].map(i=>row('oak_planks',distance,64+i)).concat(wall?[row('stone',1,65)]:[])}}
}
test('held materials beat distant buried planks, with identical local and worker plans',async()=>{
  const w=world(25,true), original=JSON.stringify(w)
  const local=await goap.plan('inventory.category.plank:4',w,quiet,{version:'1.20.1',worker:false})
  const worker=await goap.plan('inventory.category.plank:4',w,quiet,{version:'1.20.1',worker:true})
  assert.deepEqual(local,worker);assert.deepEqual(local.plan.map(s=>s.skill),['hand_craft']);assert.equal(local.plan[0].cost,10)
  assert.equal(JSON.stringify(w),original)
})
test('all gather targets use distance and shared obstruction cost without changing domain actions',async()=>{
  for(const name of ['oak_log','stone','iron_ore','sand','oak_planks']){
    const w={position:{x:0.5,y:64,z:0.5},blocks:{list:[row(name,5,65),row('dirt',2,65),...[row('dirt',4,65),row('dirt',6,65),row('dirt',5,64),row('dirt',5,66),row('dirt',5,65,-1),row('dirt',5,65,1)]]}}
    const effort=await gatherEffort(w),a={name:'gather',skill:'gather',params:{itemName:name,count:1},cost:3},copy=structuredClone(a)
    assert.ok(effort[name][1].obstructionCount>0,name)
    assert.ok(costedActions([a],effort)[0].cost>3,name);assert.deepEqual(a,copy)
  }
  const w={position:{x:0.5,y:64,z:0.5},blocks:{list:[row('sand',2,65),row('water',1,65)]}}
  assert.equal((await gatherEffort(w)).sand[1].obstructionCount,0)
})
test('near environmental planks remain collectible even with logs, and absent geometry keeps legacy costs',async()=>{
  const result=await goap.plan('inventory.category.plank:4',world(1),quiet,{version:'1.20.1',worker:false})
  assert.ok(result.plan.some(s=>s.skill==='gather'))
  const a={skill:'gather',params:{itemName:'sand',count:1},cost:3};assert.equal(costedActions([a],{})[0],a)
})
test('batch planning cache changes when geometry changes but inventory and nearby counts stay equal',async()=>{
  for(const worker of [false,true]){
    const bot={version:'1.20.1',logLevel:'error'}, options={maxMs:10000,perGoalMs:10000,worker}
    const near=await evaluate(bot,{},['inventory.category.plank:4'],{...options,worldState:world(1)})
    const far=await evaluate(bot,{},['inventory.category.plank:4'],{...options,worldState:world(25)})
    assert.ok(near.results[0].plan.some(s=>s.skill==='gather'))
    assert.deepEqual(far.results[0].plan.map(s=>s.skill),['hand_craft'])
  }
})
test('effort computation respects expired budgets and cancellation',async()=>{
  await assert.rejects(gatherEffort(world(25),{deadline:0}),e=>e.code==='BUDGET_EXCEEDED')
  await assert.rejects(gatherEffort(world(25),{signal:AbortSignal.abort()}),e=>e.code==='CANCELLED')
})
