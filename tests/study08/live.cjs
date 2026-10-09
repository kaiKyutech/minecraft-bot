// Only the isolated 08 server; never connects to 25567/25568.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict')
const { execFileSync }=require('node:child_process')
const { once }=require('node:events')
const { createAIBot, createBotApi }=require('../../planner_bot/api')
const root=path.resolve(__dirname,'../..'), server=path.join(root,'.cache/minecraft-bot/08-study/server')
const props=path.join(server,'server.properties'), wait=ms=>new Promise(r=>setTimeout(r,ms))
const json=(value,space)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,space)
function rcon(...commands) {
  return execFileSync(process.execPath,[path.resolve(root,'../minecraft-agent-jev/tools/rcon.mjs'),...commands],
    {env:{...process.env,RCON_PROPERTIES:props},encoding:'utf8',timeout:30000})
}
async function main() {
  if(process.argv[2]==='stop'){rcon('save-all','stop');return}
  const username='Light08'+Date.now().toString(36).slice(-6)
  const bot=createAIBot(1,{host:'127.0.0.1',port:25569,username,version:'1.20.1',aiBotCount:1},{autoHandleWhisper:false})
  const api=createBotApi(bot,{logLevel:'error'}), results=[]
  let timer
  try {
    await Promise.race([once(bot,'spawn'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('spawn timeout')),30000)})]);clearTimeout(timer)
    await wait(2000)
    rcon('time set 6000','gamerule doDaylightCycle false','weather clear','forceload add 196 196 254 254')
    await wait(1500)
    for(const [index,placement] of ['floor','wall','exception'].entries()) {
      const x=200+index*20
      rcon(`tp ${username} ${x+.5} 80 200.5 0 0`)
      await wait(1500)
      rcon(`fill ${x-4} 39 196 ${x+4} 45 204 stone`, `fill ${x-3} 41 197 ${x+3} 43 203 air`,
        `tp ${username} ${x+.5} 41 200.5 0 0`,`clear ${username}`)
      await wait(800)
      const missing=await api.placeTorch()
      assert.equal(missing.error.code,'ITEM_NOT_FOUND')
      rcon(`give ${username} torch 4`);await wait(300)
      const before=await api.observeFast({range:5})
      assert.equal(before.ok,true);assert.equal(before.data.light.dark,true,json({case:placement,position:before.data.position,light:before.data.light}));assert.equal(before.data.light.torchNearby,false)
      const cancelled=await api.placeTorch({signal:AbortSignal.abort()})
      assert.equal(cancelled.error.code,'CANCELLED')
      const native=bot.placeBlock
      if(placement==='exception')bot.placeBlock=async(...args)=>{await native(...args);throw new Error('08 controlled exception after actual placement')}
      const view={yaw:bot.entity.yaw,pitch:bot.entity.pitch}
      let placed
      try {placed=await api.placeTorch({placement:placement==='exception'?'floor':placement})}
      finally {bot.placeBlock=native}
      assert.equal(placed.ok,true,json({error:placed.error,position:bot.entity.position}))
      assert.equal(placed.data.placement,placement==='exception'?'floor':placement)
      assert.equal(placed.data.afterLight.dark,false);assert.equal(placed.data.afterLight.torchNearby,true)
      const after=await api.observeFast({range:5,maxChecks:0,maxMs:0})
      assert.equal(after.data.light.dark,false);assert.equal(after.data.light.torchNearby,true)
      const p=placed.data.position, marker=`08_${placement}_${Date.now()}`
      rcon(`execute if block ${p.x} ${p.y} ${p.z} minecraft:${placed.data.block} run say ${marker}`)
      await wait(100)
      assert.ok(fs.readFileSync(path.join(server,'logs/latest.log'),'utf8').includes(`[Rcon] ${marker}`),'server block confirmation missing')
      const count=bot.inventory.items().filter(i=>i.name==='torch').reduce((s,i)=>s+i.count,0)
      assert.equal(count,3)
      assert.ok(Math.abs(bot.entity.yaw-view.yaw)<.002 && Math.abs(bot.entity.pitch-view.pitch)<.002,'view not restored')
      results.push({case:placement,position:before.data.position,beforeLight:before.data.light,placed:placed.data,
        afterLight:after.data.light,serverConfirmed:true,remainingTorches:count,viewBefore:view,viewAfter:{yaw:bot.entity.yaw,pitch:bot.entity.pitch},missing:missing.error.code,cancelled:cancelled.error.code})
      console.log(JSON.stringify(results.at(-1)))
    }
    rcon('fill 246 99 246 254 99 254 stone','fill 246 100 246 254 120 254 air',`tp ${username} 250.5 100 250.5 0 0`)
    await wait(800)
    const surface=await api.observeFast({range:5})
    assert.equal(surface.data.light.dark,false)
    assert.equal(surface.data.light.torchNearby,false)
    assert.equal(surface.data.light.sky,15)
    results.push({case:'surface-day',position:surface.data.position,light:surface.data.light,time:surface.data.time})
    fs.writeFileSync(path.join(__dirname,'live-results.json'),json({version:bot.version,port:25569,rconPort:25579,results},2)+'\n')
    console.log(json(results.at(-1)))
  } finally {
    clearTimeout(timer);await api.stop();const ended=once(bot,'end');bot.quit();await ended
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1})
