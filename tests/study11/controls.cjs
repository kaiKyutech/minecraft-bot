process.env.LOG_LEVEL = 'error'
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module'), { execFileSync } = require('node:child_process'), { once } = require('node:events')
const { createAIBot, createBotApi } = require('../../planner_bot/api')
const filename = path.resolve('planner_bot/src/navigation/move_toward.js'), final = require(filename)
const baseline = { exports: {} }, rows = []
const source = execFileSync('git', ['show', '876cbe6:planner_bot/src/navigation/move_toward.js']).toString()
vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(createRequire(filename), baseline, baseline.exports)
const wait = ms => new Promise(r => setTimeout(r, ms))
const rcon = (...commands) => execFileSync(process.execPath, [path.resolve('../minecraft-agent-jev/tools/rcon.mjs'), ...commands], {env:{...process.env,RCON_PROPERTIES:path.resolve('.cache/minecraft-bot/11-server/server.properties')},stdio:'pipe'})
async function main() {
 const bot = createAIBot(1,{host:'127.0.0.1',port:25570,username:'ControlsMove11',version:'1.20.1',aiBotCount:1});bot.logLevel='error'
 const api = createBotApi(bot)
 try {
  await once(bot,'spawn'); await wait(2000)
  rcon('fill 128 100 128 160 100 134 dirt','fill 128 101 128 160 106 134 air',
   'fill 128 100 140 132 104 144 bedrock','fill 129 101 141 131 103 143 air')
  for (const [phase, implementation] of [['before',baseline.exports],['after',final]]) {
   require.cache[filename].exports = implementation
   for (const kind of ['open-ground','sealed-no-path','frozen-controller']) for (let sample=0;sample<(kind==='open-ground'?3:1);sample++) {
    rcon(`tp ControlsMove11 ${kind==='sealed-no-path'?'130.5 101 142.5':'129.5 101 130.5'}`); await wait(1500)
    const t=performance.now(), physicsEnabled=bot.physicsEnabled
    if(kind==='frozen-controller')bot.physicsEnabled=false
    let result
    try { result=await api.moveToward(kind==='sealed-no-path'?{x:140,y:101,z:142}:{x:151.5,y:101,z:130.5},{maxMs:kind==='frozen-controller'?6000:10000,range:3}) }
    finally { bot.physicsEnabled=physicsEnabled }
    rows.push({phase,kind,sample,ms:performance.now()-t,result})
    fs.writeFileSync('tests/study11/controls.json',JSON.stringify(rows,null,2))
    console.log(phase,kind,sample,Math.round(performance.now()-t),result.data?.reason,result.data?.distanceReduced)
   }
  }
 } finally {require.cache[filename].exports=final;await api.stop();bot.quit()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
