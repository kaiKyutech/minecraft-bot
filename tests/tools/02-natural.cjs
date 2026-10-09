const fs=require('node:fs');const {connect,rcon,wait,clean}=require('../helpers/live');const {createBotApi}=require('../../planner_bot/api');
process.env.LOG_LEVEL='error';
(async()=>{
 const username=process.env.NATURAL_NAME||'Natural02';const bot=await connect('natural',username);const api=createBotApi(bot,{logLevel:'info'});const results=[];
 bot.logWriter=()=>{};
 try{
  // Original spawn terrain; never add resources here.
  const origin=bot.entity.position.clone();
  for(const name of (process.env.NATURAL_GOALS||'wooden_pickaxe,stone_pickaxe,furnace').split(',')){
   await rcon('natural',[`tp ${username} ${origin.x} ${origin.y} ${origin.z}`,`clear ${username}`]);await wait(600);
   const logs=[];bot.logLevel='info';bot.logWriter=message=>{if(/EXECUTION|REACTIVE|PLACE_BLOCK|MOVE|サブゴール/.test(message))logs.push(message)};
   const observed=await api.observe();const start=Date.now();
   const result=await api.executeGoal(`inventory.${name}:1`,{signal:AbortSignal.timeout(120000)});
   results.push({goal:name,start:clean(origin),durationMs:Date.now()-start,result,inventory:clean(bot.inventory.items()),initial:observed.data,logs});
   console.log(name,Date.now()-start,JSON.stringify(result));
  }
 }finally{await api.stop();bot.quit();fs.mkdirSync('.cache/minecraft-bot/02-03-results',{recursive:true});fs.writeFileSync(`.cache/minecraft-bot/02-03-results/02-natural-${username}.json`,JSON.stringify(results,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
