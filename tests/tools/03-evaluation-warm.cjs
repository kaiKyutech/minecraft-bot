const fs=require('node:fs');const {connect}=require('../helpers/live');const {createBotApi}=require('../../planner_bot/api');const goap=require('../../planner_bot/src/planner/goap');
process.env.LOG_LEVEL='error';
(async()=>{
 const goals=JSON.parse(fs.readFileSync('.cache/minecraft-bot/02-03-results/03-live.json')).evaluations[0].results.map(r=>r.goal);
 const bot=await connect('natural','EvalWarm03'),api=createBotApi(bot,{logLevel:'error'}),rows=[];
 try{
  const world=await api.observe();await goap.prepareDomain(bot.version);
  for(const options of [{maxMs:1000},{maxMs:20000,perGoalMs:3000},{maxMs:1000},{maxMs:1000},{maxMs:1000}]){
   const result=await api.evaluateGoals(goals,{...options,worldState:world.data});if(!result.ok)throw new Error(result.error.message);
   rows.push({options,...result.data});console.log(JSON.stringify({options,ms:result.data.durationMs,status:result.data.results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})}));
  }
 }finally{await api.stop();bot.quit();fs.writeFileSync('.cache/minecraft-bot/02-03-results/03-evaluation-warm.json',JSON.stringify(rows,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
