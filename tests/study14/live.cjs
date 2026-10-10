// Only connects to the isolated copy under .cache, on 25569 / RCON 25579.
process.env.LOG_LEVEL = 'error'
process.env.STATE_SCAN_RANGE = '16'
const fs = require('node:fs'),path = require('node:path'),assert = require('node:assert/strict'),{once}=require('node:events')
const {load}=require('../helpers/module'),root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/minecraft-bot/14-study')
const props=path.join(out,'server/server.properties'),wait=ms=>new Promise(r=>setTimeout(r,ms))
const helper=load(path.join(root,'tests/helpers/live.js'),{'node:fs':{...fs,readFileSync:(file,...args)=>fs.readFileSync(String(file).endsWith('server.properties')?props:file,...args)}})
const rcon=(...commands)=>helper.rcon('natural',commands)
const properties=fs.readFileSync(props,'utf8');assert.match(properties,/^server-port=25569\r?$/m);assert.match(properties,/^rcon.port=25579\r?$/m)
const {createAIBot,createBotApi}=require('../../planner_bot/api'),service=require('../../planner_bot/src/planner/planning_service')
const username='Version14',rows=[],supplemental=process.argv[2]==='supplemental'
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v,2)
async function main(){
 if(process.argv[2]==='stop'){await rcon('save-all','stop');return}
 const bot=createAIBot(1,{host:'127.0.0.1',port:25569,username,version:'1.21.4',aiBotCount:1},{autoHandleWhisper:false})
 const api=createBotApi(bot,{logLevel:'error'});bot.on('error',error=>console.error(error.message))
 let timer
 const save=()=>fs.writeFileSync(path.join(out,supplemental?'live-supplemental-results.json':'live-results.json'),json({version:bot.version,port:25569,rconPort:25579,rows})+'\n')
 async function run(name,fn){const start=performance.now();console.log(name,'START');try{const result=await fn();rows.push({name,ok:true,durationMs:performance.now()-start,...result});save();console.log(name,'PASS',Math.round(performance.now()-start)+'ms')}catch(error){rows.push({name,ok:false,durationMs:performance.now()-start,error:{code:error.code,message:error.message},...error.details});save();throw error}}
 try{
  await Promise.race([once(bot,'spawn'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('spawn timeout')),30000)})]);clearTimeout(timer)
  await rcon('time set 6000','gamerule doDaylightCycle false','weather clear','difficulty peaceful','forceload add 990 990 1017 1017',`gamemode survival ${username}`,`clear ${username}`,
    'fill 990 90 990 1017 90 1017 bedrock','fill 990 91 990 1017 106 1017 air',`tp ${username} 1000.5 91 1000.5`,
    'fill 1003 91 997 1003 91 1010 pale_oak_log','fill 1008 91 997 1011 91 1006 stone','fill 1013 91 997 1013 91 1001 coal_ore','fill 1015 91 997 1015 91 1001 iron_ore','setblock 1017 91 1000 diamond_ore')
  await wait(2000)
  if(!supplemental) {
  for(const goal of ['inventory.category.log:8','inventory.category.plank:16','inventory.stick:8','inventory.crafting_table:1','inventory.wooden_pickaxe:1','inventory.cobblestone:12','inventory.stone_pickaxe:1','inventory.furnace:1','inventory.torch:4','inventory.iron_ingot:3','inventory.iron_pickaxe:1','inventory.diamond:1']) {
    await run(goal,async()=>{
      const events=[],before=await api.observe(),planned=await api.planGoal(goal,{worldState:before.data})
      const result=await api.executeGoal(goal,{signal:AbortSignal.timeout(120000),onProgress:e=>events.push(e)})
      await wait(500)
      const after=await api.observe();if(!result.ok)throw Object.assign(new Error(json(result.error)),{details:{planned,result,before:before.data.inventory.counts,after:after.data.inventory.counts,events}});assert.equal(after.ok,true)
      return{planned,result,before:before.data.inventory.counts,after:after.data.inventory.counts,position:after.data.position,events}
    })
  }
  await run('moveToward',async()=>{const result=await api.moveToward({x:1000.5,y:91,z:1000.5},{maxMs:10000});assert.equal(result.ok,true);assert.ok(result.data.reached||result.data.distanceReduced>0);return{result}})
  await run('observeTerrain',async()=>{const result=await api.observeTerrain({radius:8,maxMs:5000});assert.equal(result.ok,true);assert.ok(result.data.known>0);return{result}})
  await run('placeTorch',async()=>{await rcon(`give ${username} torch 1`);await wait(500);const result=await api.placeTorch({radius:3});assert.equal(result.ok,true,json(result.error));return{result}})
  }
  await run('mixed-planks',async()=>{await rcon('fill 990 91 990 1017 106 1017 air',`tp ${username} 1000.5 91 1000.5`,`clear ${username}`,`give ${username} oak_planks 2`,`give ${username} pale_oak_planks 2`);await wait(800);const events=[],result=await api.executeGoal('inventory.crafting_table:1',{signal:AbortSignal.timeout(30000),onProgress:e=>events.push(e)});assert.equal(result.ok,true,json(result.error));await wait(500);const inventory=bot.inventory.items().map(i=>({name:i.name,count:i.count}));assert.ok(inventory.some(i=>i.name==='crafting_table'));assert.ok(!inventory.some(i=>i.name.endsWith('_planks')));assert.ok(events.some(e=>e.type==='step_success'&&e.step.skill==='hand_craft'));return{result,inventory,events}})
  await run('pale-oak-charcoal',async()=>{
    await rcon(`clear ${username}`,`give ${username} pale_oak_log 2`,`tp ${username} 1000.5 91 1000.5`,'setblock 1002 91 1000 furnace');await wait(800)
    const result=await api.executeGoal('inventory.charcoal:1',{signal:AbortSignal.timeout(60000)});assert.equal(result.ok,true,json(result.error));return{result,inventory:bot.inventory.items().map(i=>({name:i.name,count:i.count}))}
  })
 }finally{clearTimeout(timer);await api.stop();await api.stopVision();bot.quit();await service.close();save()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
