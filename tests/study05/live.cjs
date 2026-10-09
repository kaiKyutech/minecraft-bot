// Each invocation runs one trial; live.ps1 restores the same stopped-world copy first.
process.env.LOG_LEVEL = 'error';
const fs = require('node:fs'), path = require('node:path');
if(process.argv[2]==='before') {
  // Only G changes gather; all other modules are still eab3cca during the paired suite.
  const filename=require.resolve('../../planner_bot/src/skills/gather');
  const module={exports:{}}, real=require('node:module').createRequire(filename);
  require('node:vm').runInThisContext(`(function(require,module,exports){${fs.readFileSync(path.join(__dirname,'fixtures/gather-before.js'),'utf8')}\n})`,{filename})(real,module,module.exports);
  require.cache[filename]={id:filename,filename,loaded:true,exports:module.exports};
}
const { connect, rcon, wait, clean } = require('../helpers/live');
const { createBotApi } = require('../../planner_bot/api');
const starts = [{x:10.5,y:63,z:3.5},{x:30.5,y:71,z:3.5},{x:10.5,y:72,z:-16.5}];
const cases = [
  ...Array.from({length:5}, (_,i)=>({goal:'inventory.category.log:4', position:null, label:`log-${i}`})),
  ...starts.flatMap((position,s)=>['wooden_pickaxe','stone_pickaxe','furnace'].map(name=>({goal:`inventory.${name}:1`,position,label:`start-${s}-${name}`})))
];
const [phase, indexText] = process.argv.slice(2), index = Number(indexText);
const out = path.resolve(__dirname, '../../.cache/minecraft-bot/05-study', phase || 'unknown');
async function main() {
  if(phase==='stop') { await rcon('natural',['save-all','stop']); return; }
  if(!['before','G','AB'].includes(phase) || !cases[index]) throw new Error('usage: live.cjs before|G|AB INDEX, or stop');
  fs.mkdirSync(out,{recursive:true});
  const spec={...cases[index]}, username=`S05${phase}${index}${Date.now().toString(36).slice(-5)}`;
  if(phase!=='before' && !spec.position) spec.position=JSON.parse(fs.readFileSync(path.join(out,'../before',`${index}.json`),'utf8')).initialPosition;
  const bot=await connect('natural',username), api=createBotApi(bot,{logLevel:'info'}),logs=[],events=[];
  bot.logWriter=message=>{if(/GATHER|MOVE|EXECUTION|REACTIVE|path|サブゴール/i.test(message)) logs.push(message)};
  const record={phase,index,...spec,username,at:new Date().toISOString()};
  try {
    await rcon('natural',[`clear ${username}`, ...(spec.position?[`tp ${username} ${spec.position.x} ${spec.position.y} ${spec.position.z}`]:[])]);
    await wait(800); record.initialPosition=clean(bot.entity.position); record.initialInventory=clean(bot.inventory.items());
    const t=performance.now(); record.result=await api.executeGoal(spec.goal,{signal:AbortSignal.timeout(120000),onProgress:e=>events.push(e)}); record.durationMs=performance.now()-t;
    record.inventory=clean(bot.inventory.items());record.finalPosition=clean(bot.entity.position);
  } catch(e) {record.thrown={code:e.code,message:e.message};}
  finally {await api.stop();bot.quit();}
  record.logs=logs;record.events=events;
  const item=spec.goal.split(':')[0].slice('inventory.'.length), required=Number(spec.goal.split(':')[1]);
  const names=item==='category.log'?require('../../planner_bot/src/planner/state_builder').loadBlockCategories().categories.log.blocks:[item];
  record.achievedQuantity=(record.inventory||[]).filter(i=>names.includes(i.name)).reduce((n,i)=>n+i.count,0);
  record.confirmedSuccess=Boolean(record.result?.ok&&record.achievedQuantity>=required);
  fs.writeFileSync(path.join(out,`${index}.json`),JSON.stringify(record,null,2));
  console.log(JSON.stringify({phase,index,label:spec.label,ms:record.durationMs,result:record.result,quantity:record.achievedQuantity,thrown:record.thrown}));
  if(record.result?.ok&&!record.confirmedSuccess) throw new Error(`Execution reported success without required inventory: ${index}; stop for requester judgement`);
  if(phase!=='before') {
    const before=JSON.parse(fs.readFileSync(path.join(out,'../before',`${index}.json`),'utf8'));
    if(before.result?.ok && !record.confirmedSuccess) throw new Error(`Previously successful case regressed: ${index}; stop for requester judgement`);
  }
}
main().then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)});
