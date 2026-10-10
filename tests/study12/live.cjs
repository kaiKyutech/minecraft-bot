process.env.LOG_LEVEL = 'error'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict')
const { once } = require('node:events')
const { load } = require('../helpers/module')
const root = path.resolve(__dirname,'../..'), server = path.join(root,'.cache/minecraft-bot/12-study/server')
const helper = load(path.join(root,'tests/helpers/live.js'), { 'node:fs': { ...fs, readFileSync: (file,...args) => fs.readFileSync(String(file).endsWith('server.properties') ? path.join(server,'server.properties') : file,...args) } })
const { createAIBot, createBotApi } = require('../../planner_bot/api')
const { gatherEffort } = require('../../planner_bot/src/planner/gather_cost')
const old = load(path.join(root,'planner_bot/src/planner/goap.js'), { './gather_cost': { gatherEffort: async()=>({}), costedActions:a=>a } })
const quiet = { debug(){},info(){},warn(){},error(){} }
async function main() {
  if (process.argv[2] === 'stop') { await helper.rcon('natural',['save-all','stop']); return }
  const bot = createAIBot(1,{host:'127.0.0.1',port:25569,username:'GatherCost12',version:'1.20.1',aiBotCount:1},{autoHandleWhisper:false})
  const api = createBotApi(bot,{logLevel:'error'}), rows=[]
  try {
    await once(bot,'spawn'); await helper.wait(2000)
    const setup = async commands => { await helper.rcon('natural',['clear GatherCost12','tp GatherCost12 139 69 217',...commands]); await helper.wait(1500) }
    await setup(['give GatherCost12 acacia_log 16'])
    const observed=await api.observe(); assert.equal(observed.ok,true)
    fs.writeFileSync(path.join(__dirname,'repro.json.gz'),zlib.gzipSync(JSON.stringify(observed.data)))
    const world=observed.data
    const before=await old.plan('inventory.category.plank:4',world,quiet,{version:'1.20.1',worker:false})
    const after=await api.planGoal('inventory.category.plank:4',{worldState:world})
    assert.equal(after.ok,true); assert.ok(after.data.plan.every(s=>s.skill==='hand_craft'))
    const events=[],start=performance.now(), minY={value:bot.entity.position.y}
    const track=()=>{minY.value=Math.min(minY.value,bot.entity.position.y)};bot.on('physicsTick',track)
    const executed=await api.executeGoal('inventory.category.plank:4',{signal:AbortSignal.timeout(60000),onProgress:event=>events.push(event)})
    bot.removeListener('physicsTick',track); assert.equal(executed.ok,true)
    const end=await api.observe()
    const effort=await gatherEffort(world)
    rows.push({case:'snapshot-logs16-planks4',before:before.plan,after:after.data.plan,effort:{plank:effort.plank,log:effort.log},execution:executed,durationMs:performance.now()-start,minY:minY.value,finalPosition:end.data.position,inventory:end.data.inventory.counts,events})
    await setup([])
    const noLogs=await api.observe(), planned=await api.planGoal('inventory.category.plank:4',{worldState:noLogs.data})
    assert.equal(planned.ok,true);assert.ok(planned.data.plan.some(s=>s.skill==='gather'&&s.params.itemName==='log'))
    const gathered=await api.executeGoal('inventory.category.plank:4',{signal:AbortSignal.timeout(90000)})
    assert.equal(gathered.ok,true)
    rows.push({case:'snapshot-no-logs-planks4',plan:planned.data.plan,execution:gathered,finalPosition:{...bot.entity.position},inventory:(await api.observe()).data.inventory.counts})
    for (const [name,commands,goals] of [
      ['surface-empty',[],['inventory.stone_pickaxe:1','inventory.furnace:1','inventory.torch:4','inventory.iron_pickaxe:1','inventory.diamond:1']],
      ['surface-equipped',['give GatherCost12 iron_pickaxe 1','give GatherCost12 acacia_log 16','give GatherCost12 coal 8'],['inventory.stone_pickaxe:1','inventory.furnace:1','inventory.torch:4','inventory.iron_pickaxe:1','inventory.diamond:1']]
    ]) {
      await setup(commands);const observation=await api.observe()
      for (const goal of goals) {
        const logs=[],logger={...quiet,debug:message=>logs.push(message)},t=performance.now()
        const before=await old.plan(goal,observation.data,logger,{version:'1.20.1',worker:false}),beforeMs=performance.now()-t
        const t2=performance.now(),after=await require('../../planner_bot/src/planner/goap').plan(goal,observation.data,logger,{version:'1.20.1',worker:false})
        rows.push({case:name,goal,before,after,beforeMs,afterMs:performance.now()-t2,logs})
      }
    }
    // Controlled near exposed planks still remain valid environmental resources.
    await setup(['give GatherCost12 acacia_log 16','fill 140 69 217 141 69 218 oak_planks','fill 138 70 216 142 72 219 air'])
    const close=await api.observe(),near=await api.planGoal('inventory.category.plank:4',{worldState:close.data})
    assert.equal(near.ok,true); assert.ok(near.data.plan.some(s=>s.skill==='gather'&&s.params.itemName==='plank'))
    rows.push({case:'near-exposed-planks',plan:near.data.plan})
  } finally {
    fs.writeFileSync(path.join(__dirname,'live-results.json'),JSON.stringify(rows,null,2))
    await api.stop();bot.quit();await require('../../planner_bot/src/planner/planning_service').close()
    await helper.rcon('natural',['save-all','stop'])
  }
  console.log('Live cases passed:',rows.length)
}
main().catch(e=>{console.error(e);process.exitCode=1})
