process.env.LOG_LEVEL = 'error'
const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), YAML = require('yaml'), { Vec3 } = require('vec3')
const builder = require('../../planner_bot/src/planner/state_builder'), goap = require('../../planner_bot/src/planner/goap')
const service = require('../../planner_bot/src/planner/planning_service'), data = require('minecraft-data')('1.21.4')
const variants = require('../../planner_bot/src/planner/craft_variants'), { resolveCraftRecipe } = require('../../planner_bot/src/utils/version_recipes')
const { parseGoalInput } = require('../../planner_bot/src/planner/goals')
const quiet = { debug(){},info(){},warn(){},error(){} }
const world = counts => ({ inventory:{counts}, equipment:{}, nearby:{}, nearby_blocks:{nearby_workbench:true,visible_workbench:true}, inventory_space:true })
before(() => goap.prepareDomain('1.21.4',quiet)); after(() => service.close())

test('all four 1.21.4 generated action arrays match their independent version golden',()=>{
  require('node:child_process').execFileSync(process.execPath,[path.resolve(__dirname,'../study14/generation.cjs')],{encoding:'utf8'})
})

test('every parsed registry recipe has a concrete or validated plank variant with the same consumption and output',()=>{
  const actions=goap.getAllActions().filter(a=>a.params?.craftingRecipe)
  const planks=new Set(builder.loadBlockCategories('1.21.4').item_categories.plank.items)
  for(const action of actions) {
    const spec=action.params.craftingRecipe
    assert.ok(data.itemsByName[spec.result.name])
    for(const name of Object.keys(variants.counts(spec)))assert.ok(name==='category.plank'||data.itemsByName[name],name)
  }
  for(const [id,recipes] of Object.entries(data.recipes))for(const recipe of recipes) {
    const spec=variants.recipeNames(recipe,data);if(!spec)continue
    const concrete=variants.counts(spec);if(!Object.keys(concrete).length)continue
    const kind=spec.inShape?spec.inShape.length<=2&&spec.inShape.every(r=>r.length<=2)?'hand_craft':'workbench_craft':spec.ingredients.length<=4?'hand_craft':'workbench_craft'
    const output=data.items[id].name
    assert.ok(actions.some(action=>{
      if(action.skill!==kind||action.params.recipe!==output||action.params.craftingRecipe.result.count!==(recipe.result.count||1))return false
      const expected={...concrete}
      if(action.params.craftingRecipe.planks)for(const name of Object.keys(expected))if(planks.has(name)) {
        expected['category.plank']=(expected['category.plank']||0)+expected[name];delete expected[name]
      }
      return JSON.stringify(Object.entries(expected).sort())===JSON.stringify(Object.entries(variants.counts(action.params.craftingRecipe)).sort())
    }),output+'/'+JSON.stringify(concrete))
  }
})
test('legacy categories remain exact and 1.21.4 categories include registry log/plank additions only', () => {
  const legacy = YAML.parse(fs.readFileSync(path.resolve(__dirname,'../../planner_bot/config/block_categories.yaml'),'utf8'))
  const old = builder.loadBlockCategories('1.20.1'), current = builder.loadBlockCategories('1.21.4')
  assert.deepEqual(old,legacy); assert.equal(builder.loadBlockCategories('1.20.1'),old)
  assert.equal(builder.loadBlockCategories('1.21.4'),current); assert.notEqual(old,current)
  for (const section of ['categories','item_categories']) {
    const field = section === 'categories' ? 'blocks' : 'items'
    assert.deepEqual(current[section].log[field].slice(old[section].log[field].length),['pale_oak_log','stripped_pale_oak_log'])
    assert.deepEqual(current[section].plank[field].slice(old[section].plank[field].length),['pale_oak_planks'])
  }
  assert.equal(builder.buildState(world({pale_oak_log:2,pale_oak_planks:5}), '1.21.4').inventory.category.log,2)
  assert.equal(builder.buildState(world({pale_oak_log:2,pale_oak_planks:5}), '1.20.1').inventory.category.log,0)
})
test('all equivalent recipes survive regardless of source order and variant action goals are callable', () => {
  const categories=builder.loadBlockCategories('1.21.4'), generic=goap.getAllActions().find(a=>a.name==='auto_hand_craft_planks_from_logs_category')
  const a=variants.generateVariants(data,categories,generic)
  const reversed={...data,recipes:Object.fromEntries(Object.entries(data.recipes).reverse().map(([key,list])=>[key,[...list].reverse()]))}
  const b=variants.generateVariants(reversed,categories,generic);assert.deepEqual(a,b)
  const actions=[...a.hand,...a.workbench];assert.equal(new Set(actions.map(x=>x.name)).size,actions.length)
  for(const action of actions) assert.ok(parseGoalInput(action.name),action.name)
  for(const item of ['stone_pickaxe','furnace']) {
    const found=actions.filter(x=>x.params.recipe===item)
    for(const material of ['cobblestone','blackstone','cobbled_deepslate']) assert.ok(found.some(x=>x.preconditions['inventory.'+material]),item+'/'+material)
  }
  assert.equal(actions.filter(x=>x.params.recipe==='torch').length,2)
  const oakBoat=actions.find(x=>x.params.recipe==='oak_boat');assert.ok(oakBoat.preconditions['inventory.oak_planks']);assert.equal(oakBoat.preconditions['inventory.category.plank'],undefined)
})
test('every log and plank species produces sticks, table and wooden tools; concrete crafting updates count categories', async () => {
  for(const log of builder.loadBlockCategories('1.21.4').item_categories.log.items) {
    const r=await goap.plan('inventory.stick:4',world({[log]:2}),quiet,{version:'1.21.4',worker:false});assert.ok(r.plan,log)
  }
  for(const plank of builder.loadBlockCategories('1.21.4').item_categories.plank.items) for(const goal of ['stick:4','crafting_table:1','wooden_pickaxe:1']) {
    const r=await goap.plan('inventory.'+goal,world({[plank]:8,stick:2}),quiet,{version:'1.21.4',worker:false});assert.ok(r.plan,plank+'/'+goal)
  }
  const plank=goap.getAllActions().find(x=>x.params?.recipe==='pale_oak_planks')
  assert.equal(plank.effects['inventory.category.log'],'-1');assert.equal(plank.effects['inventory.category.plank'],'+4')
})
test('stone/furnace variants and both fuels are plannable from supplied materials', async () => {
  for(const material of ['cobblestone','blackstone','cobbled_deepslate']) for(const goal of ['stone_pickaxe:1','furnace:1']) {
    const r=await goap.plan('inventory.'+goal,world({[material]:8,stick:2}),quiet,{version:'1.21.4',worker:false});assert.equal(r.plan?.length,1,material+'/'+goal)
  }
  for(const fuel of ['coal','charcoal']) {
    const r=await goap.plan('inventory.torch:4',world({[fuel]:1,stick:1}),quiet,{version:'1.21.4',worker:false});assert.equal(r.plan?.length,1,fuel)
  }
})
test('selected recipes resolve to actual inventory including mixed planks; missing ingredients cannot craft', async () => {
  const spec=goap.getAllActions().find(x=>x.params?.recipe==='crafting_table').params.craftingRecipe
  const bot={version:'1.21.4',registry:data,inventory:{items:()=>[{name:'oak_planks',count:2},{name:'pale_oak_planks',count:2}]}}
  const recipe=resolveCraftRecipe(bot,spec,'crafting_table')
  assert.equal(recipe.delta.find(x=>x.id===data.itemsByName.oak_planks.id).count,-2)
  assert.equal(recipe.delta.find(x=>x.id===data.itemsByName.pale_oak_planks.id).count,-2)
  bot.inventory.items=()=>[{name:'oak_planks',count:3}]
  assert.throws(()=>resolveCraftRecipe(bot,spec,'crafting_table'),{code:'ITEM_NOT_FOUND'})
  assert.throws(()=>resolveCraftRecipe(bot,spec,'stick'),{code:'RECIPE_NOT_FOUND'})
})
test('pale oak is consistently observed, costed and reachable through public APIs before/after worker preparation',async()=>{
  const {createBotApi}=require('../../planner_bot/api'),{evaluate}=require('../../planner_bot/src/planner/goal_evaluator')
  const bot={version:'1.21.4',entity:{position:new Vec3(.5,64,.5)},logLevel:'error'},w={...world({pale_oak_log:4}),position:{x:.5,y:64,z:.5},nearby:{pale_oak_log:4,category:{log:4}},blocks:{list:[{name:'pale_oak_log',position:{x:8,y:64,z:0}}]}}
  const api=createBotApi(bot,{stateManager:{}}),goals=['inventory.stick:4']
  const planned=await api.planGoal(goals[0],{worldState:w});assert.equal(planned.ok,true)
  const local=await evaluate(bot,{},goals,{worldState:w,worker:false,maxMs:10000,perGoalMs:10000})
  const worker=await evaluate(bot,{},goals,{worldState:w,maxMs:10000,perGoalMs:10000})
  assert.deepEqual(local.results,worker.results)
  const reachable=await api.reachableFacts({worldState:w,goals,maxMs:10000});assert.equal(reachable.data.goals[0].status,'possible')
  const effort=await require('../../planner_bot/src/planner/gather_cost').gatherEffort(w,{version:bot.version});assert.equal(effort.log[1].distance,effort.pale_oak_log[1].distance)
})
test('version conflicts remain typed and proof of impossibility is distinct from search exhaustion',async()=>{
  await assert.rejects(goap.prepareDomain('1.20.1',quiet),{code:'VERSION_CONFLICT'})
  const r=await goap.plan('inventory.diamond:1',world({}),quiet,{version:'1.21.4',worker:false})
  assert.equal(goap.getPlanFailure(r).provenImpossible,true);assert.equal(goap.getPlanFailure(r).iterations,0)
})
test('1.21.4 artificial chunks expose new vegetation, water, unloaded cells, log/plank counts and light without GPU',async()=>{
  const {EventEmitter}=require('node:events'),Chunk=require('prismarine-chunk')('1.21.4'),bot=new EventEmitter(),columns=new Map()
  Object.assign(bot,{version:'1.21.4',registry:data,logLevel:'error',game:{minY:-64,height:384},entity:{position:new Vec3(.5,3,.5),yaw:0,pitch:0},
    inventory:{items:()=>[],slots:[],emptySlotCount:()=>36},time:{isDay:true},world:{getColumn:(x,z)=>columns.get(x+','+z)}})
  const set=(x,y,z,name)=>{const key=Math.floor(x/16)+','+Math.floor(z/16);let c=columns.get(key);if(!c){c=new Chunk();columns.set(key,c)}c.setBlockStateId(new Vec3(x&15,y,z&15),data.blocksByName[name].defaultState)}
  set(-1,0,-1,'dirt');set(-1,1,-1,'pale_oak_log');set(-1,6,-1,'pale_oak_leaves')
  set(0,0,-1,'grass_block');set(0,1,-1,'short_grass')
  set(1,0,-1,'dirt');set(1,1,-1,'open_eyeblossom')
  set(-1,0,0,'pale_moss_block');set(-1,1,0,'pale_moss_carpet')
  set(0,0,0,'sand');set(0,2,0,'water')
  set(1,0,0,'stone');set(1,1,0,'pale_oak_planks')
  bot.blockAt=p=>{const c=columns.get(Math.floor(p.x/16)+','+Math.floor(p.z/16));if(!c)return null;const id=c.getBlockStateId(new Vec3(p.x&15,Math.floor(p.y),p.z&15));const b=data.blocksByStateId[id];return{...b,position:p.floored(),light:0,skyLight:0}}
  const manager=require('../../planner_bot/src/planner/state_manager')(),api=require('../../planner_bot/api').createBotApi(bot,{stateManager:manager})
  const terrain=await api.observeTerrain({radius:1,maxMs:2000});assert.equal(terrain.ok,true)
  const d=terrain.data,decode=i=>d.cells[i].map((v,n)=>n%2?d.names[v]:v)
  assert.deepEqual(decode(0),[0,'dirt',6,'pale_oak_leaves',null,null])
  assert.deepEqual(decode(1),[0,'grass_block',1,'short_grass',null,null])
  assert.deepEqual(decode(2),[0,'dirt',1,'open_eyeblossom',null,null])
  assert.deepEqual(decode(3),[0,'pale_moss_block',1,'pale_moss_carpet',null,null])
  assert.deepEqual(decode(4),[0,'sand',2,'water',2,'water'])
  const fast=await api.observeFast({range:8,maxMs:2000,maxChecks:20000});assert.equal(fast.ok,true)
  assert.equal(fast.data.categories.log.count,1);assert.equal(fast.data.categories.plank.count,1);assert.equal(fast.data.light.level,0)
  columns.delete('0,0');bot.emit('chunkColumnUnload',new Vec3(0,0,0))
  assert.equal((await api.observeTerrain({radius:0})).data.cells[0],null);bot.emit('end')
})
test('prepared domain manifest records the selected version, category definition and every generated file hash',()=>{
  const crypto=require('node:crypto'),dir=path.resolve(__dirname,'../../.cache/minecraft-bot/actions/1.21.4')
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'))
  assert.equal(manifest.version,'1.21.4');assert.equal(manifest.minecraftDataVersion,require('minecraft-data/package.json').version)
  for(const[name,hash]of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex'),hash)
})
