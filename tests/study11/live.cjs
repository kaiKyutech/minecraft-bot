process.env.LOG_LEVEL = 'error'
const fs = require('node:fs'), path = require('node:path'), { once } = require('node:events')
const { execFileSync } = require('node:child_process')
const { createAIBot, createBotApi } = require('../../planner_bot/api')
const { Vec3 } = require('vec3')
const phase = process.argv[2] || 'after', rows = []
if (process.env.MOVE_BASELINE) {
 const filename = path.resolve('planner_bot/src/navigation/move_toward.js'), module = {exports:{}}
 const source = execFileSync('git', ['show','876cbe6:planner_bot/src/navigation/move_toward.js']).toString()
 require('node:vm').runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(require('node:module').createRequire(filename),module,module.exports)
 require.cache[filename] = {id:filename,filename,loaded:true,exports:module.exports}
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const rcon = (...commands) => execFileSync(process.execPath, [path.resolve('../minecraft-agent-jev/tools/rcon.mjs'), ...commands], {env:{...process.env,RCON_PROPERTIES:path.resolve('.cache/minecraft-bot/11-server/server.properties')},stdio:'pipe'}).toString()
const cases = [
 {name:'north-3s-x10',target:{x:8,y:76,z:-28},maxMs:3000,repeats:10},
 {name:'north-30s',target:{x:8,y:76,z:-28},maxMs:30000},
 {name:'dirt-north-3s-x10',target:{x:8,y:76,z:-28},maxMs:3000,repeats:10,dirt:true},
 {name:'dirt-north-30s',target:{x:8,y:76,z:-28},maxMs:30000,dirt:true},
 {name:'north-no-y',target:{x:8,z:-28},maxMs:20000},
 {name:'lake-10',target:{x:14,z:-8},maxMs:20000},
 {name:'south-10',target:{x:14,z:12},maxMs:20000},
 {name:'northeast-peak',target:{x:40,y:98,z:-28},maxMs:20000},
 {name:'slope-west',start:[32,78,-14],target:{x:-14,y:63,z:-1},maxMs:20000}
]
async function main(){
 const bot=createAIBot(1,{host:'127.0.0.1',port:25570,username:'MoveStudy11',version:'1.20.1',aiBotCount:1})
 bot.logLevel='error'; const api=createBotApi(bot)
 try{
  await once(bot,'spawn'); await wait(2500)
  rcon('time set day','weather clear','gamerule doMobSpawning false')
  for(const c of cases.filter(c=>!process.env.MOVE_CASE||c.name===process.env.MOVE_CASE)){
   rcon('clear MoveStudy11',`tp MoveStudy11 ${(process.env.MOVE_START?JSON.parse(process.env.MOVE_START):(c.start||[14,68,2])).join(' ')}`,...(c.dirt?['give MoveStudy11 dirt 64']:[]));await wait(1200)
   for(let i=0;i<(c.repeats||1);i++){
    const events=[],samples=[],t=performance.now()
    const update=r=>events.push({ms:performance.now()-t,status:r.status,nodes:r.visitedNodes,path:r.path.slice(0,5).map(p=>({x:p.x,y:p.y,z:p.z,toBreak:structuredClone(p.toBreak),toPlace:structuredClone(p.toPlace)})),length:r.path.length})
    const reset=r=>events.push({ms:performance.now()-t,reset:r})
    bot.on('path_update',update);bot.on('path_reset',reset)
    const timer=setInterval(()=>samples.push({ms:performance.now()-t,p:{...bot.entity.position},onGround:bot.entity.onGround,water:bot.entity.isInWater,controls:Object.fromEntries(Object.getOwnPropertyNames(bot.controlState).map(k=>[k,bot.controlState[k]]))}),500)
    let result
    try{result=await api.moveToward(c.target,{maxMs:process.env.MOVE_MS?Number(process.env.MOVE_MS):c.maxMs,range:3})}finally{clearInterval(timer);bot.removeListener('path_update',update);bot.removeListener('path_reset',reset)}
    const row={name:c.name,repeat:i+1,ms:performance.now()-t,result,events,samples};rows.push(row)
    fs.writeFileSync(path.resolve(`tests/study11/${phase}.json`),JSON.stringify(rows,null,2))
    console.log(c.name,i+1,Math.round(row.ms),result.data?.reason,result.data?.distanceReduced,result.error)
   }
  }
 }finally{await api.stop();bot.quit()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
