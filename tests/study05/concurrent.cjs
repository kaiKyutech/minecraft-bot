process.env.LOG_LEVEL='error';
const fs=require('node:fs'),path=require('node:path'),{monitorEventLoopDelay}=require('node:perf_hooks');
const {rcon,wait,clean}=require('../helpers/live');
const phase=process.argv[2],dir=path.resolve(__dirname,'../../.cache/minecraft-bot/05-study');
const source=phase==='G'?'da4488c':phase==='A'?process.env.STUDY_RUNTIME_REF:null;
if(phase==='A'&&!source)throw Error('Set STUDY_RUNTIME_REF to the A commit hash');
const {createAIBot,createBotApi}=source?require('./runtime.cjs').sourceRuntime(source):require('../../planner_bot/api');
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`concurrent-${phase}-loaded`),new Date().toISOString());
// Same 20 goals as isg/src/goals.mjs, copied so the test never writes to isg.
const goals=['category.log:4','category.plank:4','stick:4','crafting_table:1','wooden_pickaxe:1','wooden_axe:1','wooden_sword:1','cobblestone:8','stone_pickaxe:1','stone_axe:1','stone_sword:1','furnace:1','chest:1','coal:2','torch:4','raw_iron:3','iron_ingot:3','iron_pickaxe:1','diamond:1','dirt:4'].map(s=>'inventory.'+s);
async function main(){
 const username=`S05C${phase}${Date.now().toString(36).slice(-5)}`,bot=createAIBot(1,{host:'127.0.0.1',port:25567,username,version:'1.20.1',aiBotCount:1},{autoHandleWhisper:false});
 let spawnTimer;
 try{await Promise.race([require('node:events').once(bot,'spawn'),new Promise((_,reject)=>{spawnTimer=setTimeout(()=>reject(Error('spawn timeout')),30000)})])}finally{clearTimeout(spawnTimer)}
 await wait(2000);const api=createBotApi(bot,{logLevel:'error'});
 bot.logWriter=()=>{};
 const position=JSON.parse(fs.readFileSync(path.join(dir,'before/0.json'),'utf8')).initialPosition;
 const record={phase,source:source||'working-tree',username,position,goals,evaluations:[],plans:[],failures:[]};
 try{
  await rcon('natural',[`clear ${username}`,`tp ${username} ${position.x} ${position.y} ${position.z}`]);await wait(800);
  record.initialPosition=clean(bot.entity.position);record.initialInventory=clean(bot.inventory.items());
  const warm=await api.observe();if(!warm.ok)throw Error(warm.error.message);
  record.warm=await api.evaluateGoals(goals,{worldState:warm.data,maxMs:20000,perGoalMs:3000});
  const lag=monitorEventLoopDelay({resolution:10});lag.enable();let running=true;
  const loop=async(interval,fn)=>{while(running){await fn();if(running)await wait(interval)}};
  const side=[loop(3000,async()=>{
   const t=performance.now(),world=await api.observe(),observedAt=performance.now();
   const result=world.ok?await api.evaluateGoals(goals,{worldState:world.data,maxMs:800}):world;
   record.evaluations.push({observeMs:observedAt-t,evaluateMs:performance.now()-observedAt,totalMs:performance.now()-t,result:result.ok?{durationMs:result.data.durationMs,timedOut:result.data.timedOut,results:result.data.results.map(r=>({goal:r.goal,status:r.status,reason:r.reason,plan:r.plan?.map(s=>s.action)}))}:result});
  }),loop(10000,async()=>{const t=performance.now(),result=await api.planGoal('inventory.stick:4');record.plans.push({durationMs:performance.now()-t,ok:result.ok,error:result.error,plan:result.data?.plan?.map(s=>s.action)})})];
  const t=performance.now();record.execution=await api.executeGoal('inventory.category.log:4',{signal:AbortSignal.timeout(120000),onProgress:e=>{if(e.type==='step_failure')record.failures.push(e)}});record.executionMs=performance.now()-t;
  running=false;await Promise.all(side);lag.disable();
  record.eventLoopDelayMs={mean:lag.mean/1e6,p99:lag.percentile(99)/1e6,max:lag.max/1e6};record.inventory=clean(bot.inventory.items());record.finalPosition=clean(bot.entity.position);
  const names=require('../../planner_bot/src/planner/state_builder').loadBlockCategories().categories.log.blocks;
  record.logQuantity=record.inventory.filter(i=>names.includes(i.name)).reduce((n,i)=>n+i.count,0);
  record.confirmedSuccess=Boolean(record.execution?.ok&&record.logQuantity>=4);
 }finally{await api.stop();bot.quit()}
 fs.writeFileSync(path.join(dir,`concurrent-${phase}.json`),JSON.stringify(record,null,2));
 if(record.execution?.ok&&!record.confirmedSuccess)throw Error('Execution succeeded without collecting four logs');
 if(phase==='AB'&&JSON.parse(fs.readFileSync(path.join(dir,'concurrent-A.json'),'utf8')).execution?.ok&&!record.confirmedSuccess)throw Error('Previously successful concurrent execution regressed; stop for requester judgement');
 console.log(JSON.stringify({phase,execution:record.execution,ms:record.executionMs,samples:record.evaluations.length,maxObserveEvaluateMs:Math.max(...record.evaluations.map(r=>r.totalMs)),eventLoopDelayMs:record.eventLoopDelayMs}));
}
main().then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)});
