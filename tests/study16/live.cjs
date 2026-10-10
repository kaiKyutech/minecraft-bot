process.env.LOG_LEVEL='error'
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{once}=require('node:events')
const profile=require('./profile.cjs'),{root,absolute,spans,requests}=profile
const version=process.argv[2],mode=process.argv[3]||'all',out=path.join(root,'.cache/minecraft-bot/16-study')
assert.ok(['1.20.1','1.21.4'].includes(version))
const props=path.join(out,`server-${version}/server.properties`),properties=fs.readFileSync(props,'utf8')
assert.ok(/^server-port=25569\r?$/m.test(properties)&&/^rcon.port=25579\r?$/m.test(properties),'Dedicated port verification failed')
const {load}=require('../helpers/module')
const helper=load(path.join(root,'tests/helpers/live.js'),{'node:fs':{...fs,readFileSync:(file,...args)=>fs.readFileSync(String(file).endsWith('server.properties')?props:file,...args)}})
const rcon=(...commands)=>helper.rcon('natural',commands),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const {createAIBot,createBotApi}=require('../../planner_bot/api'),service=require('../../planner_bot/src/planner/planning_service')
const username='Prepared16',rows=[],goals=['inventory.category.log:1','inventory.category.plank:4','inventory.crafting_table:1','inventory.wooden_pickaxe:1','inventory.stone_pickaxe:1','inventory.cobblestone:1','inventory.furnace:1','inventory.torch:4','inventory.iron_ingot:1']
const allGoals=require('../study04/benchmark.cjs').goals
const supplies=[[],[['oak_log',4]],[['oak_planks',16]],[['oak_planks',16],['stick',8]],[['cobblestone',16],['stick',8]],[['stone_pickaxe',1]],[['cobblestone',16]],[['coal',8],['stick',8]],[['raw_iron',4],['coal',8]]]
let bot,api,queueWorld
const clean=value=>JSON.parse(JSON.stringify(value))
const save=()=>fs.writeFileSync(path.join(out,`${mode==='all'?'live':mode}-${version}.json`),JSON.stringify({version,mode,goals,rows},null,2))
async function arena(items=[],stations=false) {
  await api.stop()
  await rcon('time set 6000','gamerule doDaylightCycle false','gamerule randomTickSpeed 0','weather clear','difficulty peaceful',`gamemode survival ${username}`,`clear ${username}`,
    'forceload add 1980 1980 2040 2040','fill 1980 200 1980 2040 200 2040 bedrock','fill 1980 201 1980 2040 208 2040 air',`tp ${username} 2000.5 201 2000.5`,
    'fill 2003 201 1988 2003 201 2019 oak_log','fill 2008 201 1996 2011 201 2006 stone',
    ...(stations?['setblock 2001 201 2002 crafting_table','setblock 2002 201 2002 furnace']:[]),...items.map(([name,n])=>`give ${username} ${name} ${n}`))
  await wait(700)
}
async function candidate(goal) {
  const observed=await api.observe();assert.equal(observed.ok,true)
  const evaluated=await api.evaluateGoals([goal],{worldState:observed.data,includePrepared:true,maxMs:20000,perGoalMs:20000})
  assert.equal(evaluated.ok,true,JSON.stringify(evaluated));const row=evaluated.data.results[0]
  assert.equal(row.status,'plannable',goal);assert.equal(typeof row.candidate,'string')
  return row
}
async function compete() {
  const begin=requests.length,promise=api.evaluateGoals(allGoals,{worldState:queueWorld,maxMs:3000,perGoalMs:400})
  const deadline=absolute()+4000
  while(!requests.slice(begin).some(r=>r.method==='evaluate')&&absolute()<deadline)await wait(5)
  return {promise,begin}
}
async function measured(goal,candidateId,extra={}) {
  const events=[],si=spans.length,selectedAt=absolute(),p0=clean(bot.entity.position),i0=clean(bot.stateManager.extractInventory(bot).counts)
  const prepared=await api.prepareGoal(goal,{candidate:candidateId,signal:AbortSignal.timeout(45000)})
  const preparedAt=absolute(),p1=clean(bot.entity.position),i1=clean(bot.stateManager.extractInventory(bot).counts)
  const owner=require('../../planner_bot/src/executor/operation_manager').operationsFor(bot).active
  const oldActiveAtPrepared=owner?.kind||null,oldOwnerAbortedAtPrepared=owner?.controller.signal.aborted??null
  assert.equal(prepared.ok,true,JSON.stringify(prepared))
  const result=await api.executePreparedGoal(prepared.data.handle,{signal:AbortSignal.timeout(60000),onProgress:event=>events.push({...event,at:absolute()})})
  const captured=clean(spans.slice(si)),firstStep=events.find(e=>e.type==='step_start')?.at,firstSkill=captured.find(s=>s.label.startsWith('skill.'))?.start
  const row={goal,...extra,selectedAt,preparedAt,finishedAt:absolute(),prepareMs:preparedAt-selectedAt,prepared:prepared.data,result,
    firstStepMs:firstStep===undefined?null:firstStep-selectedAt,firstSkillMs:firstSkill===undefined?null:firstSkill-selectedAt,
    handoffSkillMs:firstSkill===undefined?null:firstSkill-preparedAt,oldActiveAtPrepared,oldOwnerAbortedAtPrepared,
    p0,p1,i0,i1,events,spans:captured,final:clean(bot.stateManager.extractInventory(bot).counts)}
  rows.push(row);save();console.log(version,extra.kind||'',goal,prepared.data.reused?'reused':'fresh',Math.round(row.firstSkillMs??-1),result.ok?'ok':result.error?.code)
  assert.equal(result.ok,true,JSON.stringify(result))
  return row
}
async function switchCases(activity) {
  for(let index=0;index<goals.length;index++) {
    const goal=goals[index]
    await arena([...supplies[index],...(activity==='goap'?[['diamond_axe',1]]:[])],index>=3)
    const saved=await candidate(goal)
    let old
    if(activity==='walk')old=api.moveToward({x:2038.5,y:201,z:2000.5},{maxMs:20000,range:.5})
    else {
      const baseline=bot.stateManager.extractInventory(bot).counts.oak_log||0
      old=api.executeGoal('inventory.category.log:32',{signal:AbortSignal.timeout(60000)})
      const limit=absolute()+20000
      while((bot.stateManager.extractInventory(bot).counts.oak_log||0)<=baseline&&absolute()<limit)await wait(50)
      assert.ok((bot.stateManager.extractInventory(bot).counts.oak_log||0)>baseline,'old GOAP must gather')
    }
    // The candidate ages while the old owner continues, as in the 15 experiment.
    const beforeAge=clean(bot.entity.position),inventoryBeforeAge=clean(bot.stateManager.extractInventory(bot).counts)
    await wait(2000)
    const afterAge=clean(bot.entity.position),inventoryAfterAge=clean(bot.stateManager.extractInventory(bot).counts)
    const background=await compete()
    const row=await measured(goal,saved.candidate,{kind:activity,beforeAge,afterAge,inventoryBeforeAge,inventoryAfterAge})
    row.oldResult=await old;row.background=await background.promise;row.competingRequests=clean(requests.slice(background.begin));save()
  }
}
async function freshSwitches() {
  for(const activity of ['walk','goap']) {
    await arena([['oak_planks',8],['diamond_axe',1]])
    let old
    if(activity==='walk')old=api.moveToward({x:2038.5,y:201,z:2000.5},{maxMs:20000,range:.5})
    else {
      old=api.executeGoal('inventory.category.log:32',{signal:AbortSignal.timeout(60000)})
      const deadline=absolute()+20000
      while(!(bot.stateManager.extractInventory(bot).counts.oak_log>0)&&absolute()<deadline)await wait(50)
      assert.ok(bot.stateManager.extractInventory(bot).counts.oak_log>0)
    }
    const background=await compete(),row=await measured('inventory.crafting_table:1',undefined,{kind:'fresh-'+activity})
    row.oldResult=await old;row.background=await background.promise;row.competingRequests=clean(requests.slice(background.begin));save()
  }
}
async function comparisonCases() {
  const goal='inventory.crafting_table:1'
  for(let repeat=0;repeat<3;repeat++)for(const activity of ['walk','goap'])for(const reuse of [true,false]) {
    await arena([['oak_planks',8],['diamond_axe',1]])
    const saved=reuse?await candidate(goal):null
    let old
    if(activity==='walk')old=api.moveToward({x:2038.5,y:201,z:2000.5},{maxMs:20000,range:.5})
    else {
      old=api.executeGoal('inventory.category.log:32',{signal:AbortSignal.timeout(60000)})
      const deadline=absolute()+20000
      while(!(bot.stateManager.extractInventory(bot).counts.oak_log>0)&&absolute()<deadline)await wait(50)
      assert.ok(bot.stateManager.extractInventory(bot).counts.oak_log>0)
    }
    await wait(2000)
    const background=await compete(),row=await measured(goal,saved?.candidate,{kind:`compare-${activity}-${reuse?'reused':'fresh'}`,repeat})
    assert.ok(row.oldActiveAtPrepared);assert.equal(row.oldOwnerAbortedAtPrepared,false)
    row.oldResult=await old;row.background=await background.promise;row.competingRequests=clean(requests.slice(background.begin));save()
  }
}
async function legacyCases() {
  const goal='inventory.crafting_table:1'
  for(let repeat=0;repeat<3;repeat++)for(const activity of ['walk','goap']) {
    await arena([['oak_planks',8],['diamond_axe',1]])
    let old
    if(activity==='walk')old=api.moveToward({x:2038.5,y:201,z:2000.5},{maxMs:20000,range:.5})
    else {
      old=api.executeGoal('inventory.category.log:32',{signal:AbortSignal.timeout(60000)})
      const deadline=absolute()+20000
      while(!(bot.stateManager.extractInventory(bot).counts.oak_log>0)&&absolute()<deadline)await wait(50)
      assert.ok(bot.stateManager.extractInventory(bot).counts.oak_log>0)
    }
    await wait(2000)
    const background=await compete(),events=[],si=spans.length,selectedAt=absolute(),p0=clean(bot.entity.position),i0=clean(bot.stateManager.extractInventory(bot).counts)
    let p1,i1
    profile.setBeforeHook(()=>{if(!p1){p1=clean(bot.entity.position);i1=clean(bot.stateManager.extractInventory(bot).counts)}})
    let result
    try {result=await api.executeGoal(goal,{signal:AbortSignal.timeout(60000),onProgress:e=>events.push({...e,at:absolute()})})}
    finally {profile.setBeforeHook(null)}
    const captured=clean(spans.slice(si)),firstStep=events.find(e=>e.type==='step_start')?.at,firstSkill=captured.find(s=>s.label.startsWith('skill.'))?.start
    const row={kind:`legacy-${activity}`,repeat,goal,result,selectedAt,firstStepMs:firstStep-selectedAt,firstSkillMs:firstSkill-selectedAt,p0,p1,i0,i1,events,spans:captured,
      oldResult:await old,background:await background.promise,competingRequests:clean(requests.slice(background.begin)),final:clean(bot.stateManager.extractInventory(bot).counts)}
    rows.push(row);save();console.log(version,row.kind,Math.round(row.firstSkillMs),result.ok?'ok':result.error?.code);assert.equal(result.ok,true)
  }
}
async function edges() {
  for(const kind of ['material-lost','boolean-gained','numeric-gained','empty-lost','tool-prefix']) {
    const goal=kind==='tool-prefix'?'inventory.furnace:1':`inventory.crafting_table:${['boolean-gained','empty-lost'].includes(kind)?'true':'1'}`
    await arena(kind==='empty-lost'?[['oak_planks',8],['crafting_table',1]]:kind==='tool-prefix'?[['oak_planks',16],['stick',8],['cobblestone',8]]:[['oak_planks',8]],kind==='tool-prefix')
    const row=await candidate(goal)
    if(kind==='material-lost')await rcon(`clear ${username} oak_planks`)
    if(kind==='boolean-gained'||kind==='numeric-gained')await rcon(`give ${username} crafting_table 1`)
    // Lose the item after preparing the empty handle, exercising the execution check.
    if(kind==='empty-lost') {
      const prepared=await api.prepareGoal(goal,{candidate:row.candidate});assert.equal(prepared.ok,true)
      assert.equal(prepared.data.alreadySatisfied,true)
      await rcon(`clear ${username} crafting_table`);await wait(500)
      const events=[],result=await api.executePreparedGoal(prepared.data.handle,{signal:AbortSignal.timeout(60000),onProgress:e=>events.push(e)})
      rows.push({kind,goal,prepared:prepared.data,result,events,final:clean(bot.stateManager.extractInventory(bot).counts)});save();assert.equal(result.ok,true,JSON.stringify(result))
    } else {
      await wait(500);const result=await measured(goal,row.candidate,{kind})
      if(kind==='boolean-gained'){assert.equal(result.final.crafting_table,1);assert.equal(result.firstSkillMs,null)}
      if(kind==='numeric-gained')assert.equal(result.final.crafting_table,2)
      if(kind==='tool-prefix')assert.ok(result.prepared.preparationGoal)
    }
  }
}
async function miningCheck() {
  const goal='inventory.raw_iron:1',digs=[],original=bot.dig
  bot.dig=async function(block,...args){digs.push({block:block?.name,held:bot.heldItem?.name||null,at:absolute()});return original.call(this,block,...args)}
  try {
    for(const route of ['legacy','prepared']) {
      await arena([['oak_planks',16],['stick',8],['cobblestone',8]],true)
      await rcon('setblock 2006 201 2000 iron_ore');await wait(500)
      const events=[],begin=digs.length
      let result,prepared
      if(route==='legacy')result=await api.executeGoal(goal,{signal:AbortSignal.timeout(60000),onProgress:e=>events.push(e)})
      else {
        const saved=await candidate(goal);prepared=await api.prepareGoal(goal,{candidate:saved.candidate});assert.equal(prepared.ok,true)
        result=await api.executePreparedGoal(prepared.data.handle,{signal:AbortSignal.timeout(60000),onProgress:e=>events.push(e)})
      }
      await wait(1000)
      const final=clean(bot.stateManager.extractInventory(bot).counts)
      rows.push({kind:'mining-'+route,goal,result,prepared:prepared?.data,digs:digs.slice(begin),events,final});save()
      if(route==='prepared') {
        if(result.ok)assert.ok(final.raw_iron>=1)
        else {assert.equal(result.error.code,'GOAL_NOT_SATISFIED');assert.equal(final.raw_iron||0,0)}
      }
      console.log(version,'mining',route,result.ok?'ok':result.error.code,'raw_iron',final.raw_iron||0)
    }
  } finally {bot.dig=original}
}
async function main() {
  if(mode==='stop'){await rcon('save-all','stop');return}
  bot=createAIBot(1,{host:'127.0.0.1',port:25569,username,version,aiBotCount:1},{autoHandleWhisper:false})
  api=createBotApi(bot,{logLevel:'error'});bot.on('error',error=>console.error(error.message))
  let timer
  try {
    await Promise.race([once(bot,'spawn'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Spawn timeout')),30000))]);clearTimeout(timer)
    for(const key of ['observe','refresh','getState'])profile.wrap(bot.stateManager,key,key)
    profile.wrap(require('../../planner_bot/src/executor/operation_manager').operationsFor(bot),'cleanup','cleanup')
    const naturalFile=path.join(out,`natural-${version}.json.gz`)
    if(mode!=='all'&&fs.existsSync(naturalFile)) {
      // Subsequent comparisons use the exact same full live snapshot as the first run.
      queueWorld=JSON.parse(zlib.gunzipSync(fs.readFileSync(naturalFile)));await wait(1000)
    } else {
      await rcon('difficulty peaceful',`gamemode survival ${username}`,`tp ${username} -4.5 69 16.5`,`clear ${username}`);await wait(2500)
      queueWorld=(await api.observe()).data
      for(let retry=0;queueWorld.blocks.list.length<10000&&retry<30;retry++){await wait(500);queueWorld=(await api.observe()).data}
      assert.ok(queueWorld.blocks.list.length>10000,'natural background observation must load')
      fs.writeFileSync(naturalFile,zlib.gzipSync(JSON.stringify(queueWorld)))
    }
    if(mode==='all'){await switchCases('walk');await switchCases('goap');await freshSwitches();await edges()}
    else if(mode==='edges')await edges()
    else if(mode==='compare')await comparisonCases()
    else if(mode==='mining')await miningCheck()
    else if(mode==='legacy')await legacyCases()
    else await switchCases(mode)
  } finally {clearTimeout(timer);if(api)await api.stop();bot?.quit();await service.close();save()}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1})
