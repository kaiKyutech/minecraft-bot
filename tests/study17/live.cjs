process.env.LOG_LEVEL='error'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{once}=require('node:events')
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/minecraft-bot/17-study')
const version=process.argv[2]||'1.21.4',mode=process.argv[3]||'all'
assert.ok(['1.20.1','1.21.4'].includes(version))
const props=path.join(out,`server-${version}/server.properties`),properties=fs.readFileSync(props,'utf8')
assert.ok(/^server-port=25569\r?$/m.test(properties)&&/^rcon.port=25579\r?$/m.test(properties),'Dedicated port verification failed')
const {load}=require('../helpers/module')
const helper=load(path.join(root,'tests/helpers/live.js'),{'node:fs':{...fs,readFileSync:(file,...args)=>fs.readFileSync(String(file).endsWith('server.properties')?props:file,...args)}})
const rcon=(...commands)=>helper.rcon('natural',commands),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const {createAIBot,createBotApi}=require('../../planner_bot/api'),service=require('../../planner_bot/src/planner/planning_service')
const username='Interject17',rows=[]
let bot,api
const clean=value=>JSON.parse(JSON.stringify(value)),now=()=>performance.now()
const save=()=>fs.writeFileSync(path.join(out,`live-${version}.json`),JSON.stringify({version,rows},null,2))
async function arena(torch=true) {
  await api.stop()
  await rcon('time set 18000','gamerule doDaylightCycle false','gamerule randomTickSpeed 0','weather clear','difficulty peaceful',`gamemode survival ${username}`,`clear ${username}`,
    'forceload add 1980 1980 2040 2040','fill 1980 20 1980 2040 20 2040 bedrock','fill 1980 21 1980 2040 28 2040 air',
    'fill 1980 25 1980 2040 25 2040 bedrock',`tp ${username} 2000.5 21 2000.5`,
    'fill 2003 21 1996 2003 21 2015 oak_log',`give ${username} oak_log 2`,...(torch?[`give ${username} torch 4`]:[]))
  await wait(2000)
}
async function measured(route,count,torch=true) {
  await arena(torch)
  const goal=`inventory.category.log:${count}`,events=[],digs=[],original=bot.dig,originalPlace=bot.placeBlock
  let placedAt
  bot.placeBlock=async function(reference,face,...args) {
    const result=await originalPlace.call(this,reference,face,...args)
    if(['torch','wall_torch'].includes(bot.blockAt(reference.position.plus(face))?.name))placedAt=now()
    return result
  }
  let requestAt,insertion,startedAt=now(),controller,ownerAtRequest,ownerAtEnd
  bot.dig=async function(...args) {
    const row={start:now(),held:bot.heldItem?.name??null};digs.push(row)
    if(!insertion)setTimeout(()=>{
      requestAt=now();const owner=require('../../planner_bot/src/executor/operation_manager').operationsFor(bot).active
      controller=owner.controller;ownerAtRequest=owner.kind
      insertion=api.interject('placeTorch',{placement:'floor'}).then(result=>{
        ownerAtEnd=require('../../planner_bot/src/executor/operation_manager').operationsFor(bot).active===owner
        return result
      })
    },100)
    try{return await original.apply(this,args)}finally{row.end=now()}
  }
  try {
    let prepared
    if(route==='prepared'){prepared=await api.prepareGoal(goal);assert.equal(prepared.ok,true)}
    startedAt=now()
    const options={signal:AbortSignal.timeout(120000),onProgress:event=>events.push({...event,at:now()})}
    const result=route==='prepared'?await api.executePreparedGoal(prepared.data.handle,options):await api.executeGoal(goal,options)
    assert.ok(insertion,'request made during a real dig')
    const interjection=await insertion,finishedAt=now();await wait(750)
    const end=events.find(e=>e.type==='interject_end'),start=events.find(e=>e.type==='interject_start')
    const nextDig=digs.find(d=>d.start>(end?.at??Infinity)),nextStep=events.find(e=>e.type==='step_start'&&e.at>(end?.at??Infinity))
    const actual=interjection.ok?bot.blockAt(new (require('vec3').Vec3)(...Object.values(interjection.data.position)))?.name:null
    const row={route,goal,requestAt,startedAt,finishedAt,durationMs:finishedAt-startedAt,result,interjection,actual,
      requestToStartMs:start?.at-requestAt,requestToConfirmedTorchMs:placedAt===undefined?null:placedAt-requestAt,requestToPlacedResultMs:end?.at-requestAt,
      resumeToNextDigMs:nextDig?nextDig.start-end.at:null,resumeToNextStepMs:nextStep?nextStep.at-end.at:null,
      ownerAtRequest,ownerAtEnd,controllerAborted:controller.signal.aborted,replans:events.filter(e=>e.type==='replan').length,
      final:clean(bot.stateManager.extractInventory(bot).counts),events,digs}
    rows.push(row);save()
    console.log(JSON.stringify({route,goal,ok:result.ok,interject:interjection.ok?'ok':interjection.error.code,requestMs:row.requestToPlacedResultMs,confirmedMs:row.requestToConfirmedTorchMs,resumeMs:row.resumeToNextDigMs,replans:row.replans,logs:row.final.oak_log,durationMs:row.durationMs}))
    assert.equal(result.ok,true,JSON.stringify(result));assert.ok(row.final.oak_log>=2+count)
    assert.equal(row.replans,0);assert.equal(ownerAtEnd,true);assert.equal(controller.signal.aborted,false)
    if(torch){assert.equal(interjection.ok,true,JSON.stringify(interjection));assert.equal(actual,'torch');assert.equal(row.final.torch,3)}
    if(torch)assert.equal(interjection.data.beforeLight.dark,true,'underground arena must be dark before placement')
    else assert.equal(interjection.error.code,'ITEM_NOT_FOUND')
  } finally {bot.dig=original;bot.placeBlock=originalPlace}
}
async function main() {
  if(mode==='stop'){await rcon('save-all','stop');return}
  bot=createAIBot(1,{host:'127.0.0.1',port:25569,username,version,aiBotCount:1},{autoHandleWhisper:false})
  api=createBotApi(bot,{logLevel:'error'})
  let timer
  try {
    await Promise.race([once(bot,'spawn'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Spawn timeout')),30000))]);clearTimeout(timer)
    await measured('legacy',8)
    await measured('prepared',4)
    await measured('legacy',2,false)
  } finally {clearTimeout(timer);if(api)await api.stop();bot?.quit();await service.close();save()}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1})
