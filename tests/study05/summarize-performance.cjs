const fs=require('node:fs'),path=require('node:path');
const median=a=>{a=a.slice().sort((x,y)=>x-y);return(a[(a.length-1)>>1]+a[a.length>>1])/2};
const stats=a=>({samples:a.length,medianMs:median(a),p95Ms:a.slice().sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1],maxMs:Math.max(...a)});
const result={matrix:{},concurrent:{}};
for(const phase of ['A','B']){
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,`matrix-${phase}.json`),'utf8'));
 if(data.rows.length!==1080||data.error)throw Error(`${phase} matrix is incomplete`);
 const variants={};
 for(const variant of ['baseline','production']){
  const groups=new Map();for(const r of data.rows.filter(r=>r.variant===variant)){const key=r.state+'\0'+r.goal;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
  const rows=[...groups.values()],times=rows.map(a=>median(a.map(r=>r.durationMs)));
  variants[variant]={...stats(times),totalMs:times.reduce((a,b)=>a+b,0),success:rows.filter(a=>a[0].plan).length,
   reasons:rows.reduce((o,a)=>(o[a[0].reason]=(o[a[0].reason]||0)+1,o),{}),totalIterations:rows.reduce((n,a)=>n+a[0].iterations,0)};
 }
 result.matrix[phase]={meta:data.meta,variants};
}
for(const phase of ['G','A','AB']){
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,`../../.cache/minecraft-bot/05-study/concurrent-${phase}.json`),'utf8'));
 const names=require('../../planner_bot/src/planner/state_builder').loadBlockCategories().categories.log.blocks;
 const logQuantity=data.inventory.filter(i=>names.includes(i.name)).reduce((n,i)=>n+i.count,0);
 if(!data.execution?.ok||logQuantity<4)throw Error(`Concurrent execution failed: ${phase}`);
 result.concurrent[phase]={source:data.source,position:data.position,executionMs:data.executionMs,logQuantity,
  observeEvaluate:stats(data.evaluations.map(r=>r.totalMs)),observe:stats(data.evaluations.map(r=>r.observeMs)),evaluate:stats(data.evaluations.map(r=>r.evaluateMs)),
  planGoal:stats(data.plans.map(r=>r.durationMs)),eventLoopDelayMs:data.eventLoopDelayMs,
  statuses:data.evaluations.flatMap(r=>r.result.results||[]).reduce((o,r)=>(o[r.status]=(o[r.status]||0)+1,o),{})};
 const out=path.join(__dirname,`concurrent-${phase}.json`);fs.writeFileSync(out,JSON.stringify(data,null,2));
}
fs.writeFileSync(path.join(__dirname,'performance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
