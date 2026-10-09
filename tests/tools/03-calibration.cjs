const fs=require('node:fs');const {connect,rcon,wait}=require('../helpers/live');const {createBotApi}=require('../../planner_bot/api');
process.env.LOG_LEVEL='error';
(async()=>{
 const bot=await connect('natural','Calibrate03'),api=createBotApi(bot,{logLevel:'error'}),rows=[];
 try{
  await rcon('natural',['tp Calibrate03 1300 80 1300']);await wait(1700);
  for(const item of ['wooden_pickaxe','stone_pickaxe','furnace']){
   await rcon('natural',['fill 1290 79 1290 1318 79 1318 dirt','fill 1290 80 1290 1318 86 1318 air','fill 1297 80 1302 1299 80 1304 cobblestone','fill 1295 80 1298 1295 80 1302 oak_log','setblock 1302 80 1300 crafting_table','clear Calibrate03','tp Calibrate03 1300 80 1300']);await wait(700);
   const world=await api.observe(),goal=`inventory.${item}:1`,estimated=await api.evaluateGoals([goal],{worldState:world.data,maxMs:10000,perGoalMs:10000}),events=[],start=performance.now();
   const result=await api.executeGoal(goal,{signal:AbortSignal.timeout(65000),onProgress:e=>events.push({...e,position:{...bot.entity.position}})});
   rows.push({goal,estimated:estimated.data?.results[0],durationMs:performance.now()-start,result,events});console.log(goal,rows.at(-1).durationMs,result.ok);
  }
 }finally{await api.stop();bot.quit();fs.mkdirSync('.cache/minecraft-bot/02-03-results',{recursive:true});fs.writeFileSync('.cache/minecraft-bot/02-03-results/03-calibration.json',JSON.stringify(rows,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
