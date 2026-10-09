process.env.LOG_LEVEL='error'
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),vm=require('node:vm'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process')
const crypto=require('node:crypto')
const {monitorEventLoopDelay,PerformanceObserver}=require('node:perf_hooks'),{once}=require('node:events')
const {rcon,wait,clean}=require('./helpers.cjs')
const phase=process.argv[2],interval=Number(process.argv[3]??3000),goal=process.argv[4]??'inventory.category.log:4'
const out=path.resolve(__dirname,'../../.cache/minecraft-bot/07-study');fs.mkdirSync(out,{recursive:true})
const goals=['category.log:4','category.plank:4','stick:4','crafting_table:1','wooden_pickaxe:1','wooden_axe:1','wooden_sword:1','cobblestone:8','stone_pickaxe:1','stone_axe:1','stone_sword:1','furnace:1','chest:1','coal:2','torch:4','raw_iron:3','iron_ingot:3','iron_pickaxe:1','diamond:1','dirt:4'].map(g=>'inventory.'+g)
const referenceManager=require('./reference.cjs')

async function main(){
 if(phase==='stop'){await rcon('natural',['save-all','stop']);return}
 const {createAIBot,createBotApi}=phase==='baseline'?require('../study05/runtime.cjs').sourceRuntime('42ac72b'):require('../../planner_bot/api')
 const username='S07'+Date.now().toString(36).slice(-7),bot=createAIBot(1,{host:'127.0.0.1',port:25569,username,version:'1.20.1',aiBotCount:1},{autoHandleWhisper:false})
 let timer;try{await Promise.race([once(bot,'spawn'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('spawn timeout')),30000)})])}finally{clearTimeout(timer)}
 bot.logWriter=()=>{};await wait(2000);const api=createBotApi(bot,{logLevel:'error'})
 const record={phase,interval,goal,username,node:process.version,sourceHashes:Object.fromEntries(['state_manager','incremental_blocks','goap','domain','goal_evaluator','planning_service','planning_worker'].filter(name=>fs.existsSync(path.join(__dirname,'../../planner_bot/src/planner/'+name+'.js'))).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../../planner_bot/src/planner/'+name+'.js'))).digest('hex')])),goals,evaluations:[],fast:[],failures:[],equivalence:[]}
 try{
  await rcon('natural',['clear '+username,'tp '+username+' -4.5 69 16.5']);await wait(1000)
  // Freeze physics for same-position, same-world full-scanner comparisons; no execution is active yet.
  bot.physicsEnabled=false
  const tickReply=await rcon('natural',['gamerule randomTickSpeed']),tickMatch=tickReply[0].response.match(/(\d+)\s*$/)
  if(!tickMatch)throw Error('Cannot read original randomTickSpeed')
  const randomTickSpeed=Number(tickMatch[1]);await rcon('natural',['gamerule randomTickSpeed 0']);record.comparisonRandomTickSpeed=randomTickSpeed
  let updates=0;const changed=()=>updates++;for(const event of ['blockUpdate','chunkColumnLoad','chunkColumnUnload'])bot.on(event,changed)
  const before=referenceManager()
  for(const commands of [[],['setblock -5 69 17 oak_log'],['setblock -5 69 17 air'],['tp '+username+' -3.5 69 16.5']]) {
   if(commands.length)await rcon('natural',commands);await wait(300)
   let a,b,stable=false
   for(let attempt=0;attempt<5;attempt++){const revision=updates;a=await api.observe();b=await before.observe(bot);if(revision===updates){stable=true;break}}
   assert.equal(stable,true,'World kept changing during full-scanner comparison');assert.equal(a.ok,true)
   for(const key of ['nearby_blocks','nearby','blocks','equipment','inventory_space','isDay'])assert.deepEqual(clean(a.data[key]),clean(b[key]),key)
   assert.deepEqual(clean(a.data.inventory.counts),clean(b.inventory.counts));record.equivalence.push({commands,blocks:a.data.blocks.list.length,position:clean(bot.entity.position)})
  }
  for(const event of ['blockUpdate','chunkColumnLoad','chunkColumnUnload'])bot.removeListener(event,changed)
  await rcon('natural',['gamerule randomTickSpeed '+randomTickSpeed,'tp '+username+' -4.5 69 16.5']);await wait(500);bot.physicsEnabled=true;await wait(800)
  const warm=await api.observe();if(!warm.ok)throw Error(warm.error.message)
  record.warm=await api.evaluateGoals(goals,{worldState:warm.data,maxMs:20000,perGoalMs:3000})
  const syncOperations=[];for(const [owner,key]of [[bot,'findBlocks'],[bot.pathfinder,'getPathTo']]){const original=owner?.[key];if(typeof original==='function')owner[key]=function(...args){const begin=performance.now();try{return original.apply(this,args)}finally{syncOperations.push({method:key,durationMs:performance.now()-begin,at:begin})}}}record.syncOperations=syncOperations
  const gc=[];const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({durationMs:e.duration,kind:e.detail?.kind})});observer.observe({entryTypes:['gc']});const lag=monitorEventLoopDelay({resolution:10});lag.enable();let running=true
  const evaluationLoop=(async()=>{while(running){const t=performance.now(),world=await api.observe(),observed=performance.now(),result=world.ok?await api.evaluateGoals(goals,{worldState:world.data,maxMs:800}):world;record.evaluations.push({observeMs:observed-t,evaluateMs:performance.now()-observed,totalMs:performance.now()-t,result:result.ok?{timedOut:result.data.timedOut,results:result.data.results.map(r=>({goal:r.goal,status:r.status,reason:r.reason,plan:r.plan?.map(s=>s.action)}))}:result});if(running&&interval)await wait(interval)}})()
  let fastPending=Promise.resolve();const fastTimer=setInterval(()=>{fastPending=fastPending.then(async()=>{if(running){const t=performance.now(),r=await api.observeFast();record.fast.push({ms:performance.now()-t,ok:r.ok,complete:r.data?.complete})}})},15000)
  const t=performance.now();record.execution=await api.executeGoal(goal,{signal:AbortSignal.timeout(120000),onProgress:e=>{if(e.type==='step_failure')record.failures.push(e)}});record.executionMs=performance.now()-t
  running=false;clearInterval(fastTimer);await evaluationLoop;await fastPending;await new Promise(setImmediate);lag.disable();observer.disconnect();record.garbageCollection={count:gc.length,maxMs:Math.max(0,...gc.map(e=>e.durationMs)),totalMs:gc.reduce((n,e)=>n+e.durationMs,0),events:gc}
  record.eventLoopDelayMs={mean:lag.mean/1e6,p99:lag.percentile(99)/1e6,max:lag.max/1e6};record.inventory=clean(bot.inventory.items());record.position=clean(bot.entity.position)
 }finally{await api.stop();bot.quit()}
 const name='concurrent-'+phase+'-'+interval+'-'+goal.replace(/[^a-z0-9]/gi,'_')+'.json';fs.writeFileSync(path.join(__dirname,name),JSON.stringify(record,null,2));console.log(JSON.stringify({name,execution:record.execution,ms:record.executionMs,samples:record.evaluations.length,eventLoopDelayMs:record.eventLoopDelayMs,equivalence:record.equivalence.length}))
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)})
