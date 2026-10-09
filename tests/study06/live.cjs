// One restored-world trial. No isg loop, vision, or concurrent benchmark.
process.env.LOG_LEVEL = 'error';
const fs = require('node:fs'), path = require('node:path');
const { once } = require('node:events');
const { wait, clean, rcon } = require('../helpers/live');
const { sourceRuntime } = require('../study05/runtime.cjs');
const [phase, indexText] = process.argv.slice(2), index = Number(indexText);
const runtime = phase === 'before' ? sourceRuntime('42ac72b') : require('../../planner_bot/api');
const starts = [{x:-12.5,y:67,z:24.5},{x:30.5,y:71,z:3.5},{x:-4.5,y:69,z:16.5}];
const cases = ['inventory.category.log:4','inventory.cobblestone:8','inventory.stone_pickaxe:1']
  .flatMap(goal => starts.map(position => ({goal,position})));
const out = path.resolve(__dirname,'../../.cache/minecraft-bot/06-study',phase || 'unknown');

function instrument(bot, record) {
  record.digs=[]; record.placements=[]; const active=new Map();
  const original=bot.dig.bind(bot);
  bot.dig=async(block,...rest)=>{
    const t0=performance.now(), p=bot.entity.position;
    const entry={position:clean(block.position),block:block.name,startedAt:Date.now(),t0,
      predictedMs:bot.digTime(block),onGround:bot.entity.onGround,inWater:bot.entity.isInWater,
      botPosition:clean(p),held:bot.heldItem?.name,serverChanges:[]};
    record.digs.push(entry);active.set(block.position.toString(),entry);
    try { const result=await original(block,...rest);entry.clientDoneMs=performance.now()-t0;entry.clientDoneAt=Date.now();return result; }
    catch(e){entry.error=e.message;entry.errorMs=performance.now()-t0;throw e;}
  };
  const change=(pos,stateId,packet)=>{
    const entry=active.get(pos.toString());
    if(entry)entry.serverChanges.push({ms:performance.now()-entry.t0,at:Date.now(),stateId,packet});
  };
  bot._client.on('block_change',p=>change(new (require('vec3').Vec3)(p.location.x,p.location.y,p.location.z),p.type,'block_change'));
  bot._client.on('multi_block_change',p=>{for(const r of p.records){const v=BigInt(r),c=p.chunkCoordinates;
    change(new (require('vec3').Vec3)(c.x*16+Number((v>>8n)&15n),c.y*16+Number(v&15n),c.z*16+Number((v>>4n)&15n)),Number(v>>12n),'multi_block_change');}});
  const place=bot.placeBlock.bind(bot);
  bot.placeBlock=async(ref,face)=>{
    const dest=ref.position.plus(face),t=performance.now(),entry={position:clean(dest),held:bot.heldItem?.name,startedAt:Date.now(),botPosition:clean(bot.entity.position)};
    record.placements.push(entry);
    try {return await place(ref,face);}catch(e){entry.error=e.message;throw e;}
    finally {entry.ms=performance.now()-t;entry.actualName=bot.blockAt(dest)?.name;}
  };
}
async function main(){
  if(phase==='stop'){await rcon('natural',['save-all','stop']);return;}
  if(!['before','D1','D2','P1','after'].includes(phase)||(!cases[index]&&index!==9&&index!==10&&index!==11))throw Error('Invalid trial');
  fs.mkdirSync(out,{recursive:true});
  const username=`S06${phase}${index}${Date.now().toString(36).slice(-5)}`;
  const bot=runtime.createAIBot(1,{host:'127.0.0.1',port:25567,username,version:'1.20.1',aiBotCount:1},{autoHandleWhisper:false});
  await Promise.race([once(bot,'spawn'),wait(30000).then(()=>{throw Error('spawn timeout');})]);
  await wait(1500);
  const api=runtime.createBotApi(bot,{logLevel:'info'}),record={phase,index,username,at:new Date().toISOString(),...cases[index]},events=[],logs=[];
  bot.logWriter=message=>{if(/DIG|PLACE|GATHER|地面|landing/i.test(message))logs.push(message);};instrument(bot,record);
  try{
    if(index<9){
      const p=record.position;await rcon('natural',[`clear ${username}`,`tp ${username} ${p.x} ${p.y} ${p.z}`]);await wait(800);
      record.initialInventory=clean(bot.inventory.items());record.initialPosition=clean(bot.entity.position);
      const t=performance.now();record.result=await api.executeGoal(record.goal,{signal:AbortSignal.timeout(180000),onProgress:e=>events.push(e)});record.durationMs=performance.now()-t;
    } else {
      // Supplemental controlled dig/place reproductions, distinct from empty-inventory goals.
      await rcon('natural',['fill 99 74 99 103 85 103 air','fill 100 74 100 100 79 100 stone',`clear ${username}`,`give ${username} wooden_pickaxe`, `tp ${username} 100.5 80 100.5`]);await wait(800);
      await api.executePrimitive('equipItem',{itemName:'wooden_pickaxe'});
      if(index===9){record.label='six blocks straight down';record.results=[];for(let y=79;y>=74;y--)record.results.push(await api.executePrimitive('digBlock',{position:{x:100,y,z:100}}));}
      if(index===10){
        record.label='server rejection: suppress first FINISH packet';
        const write=bot._client.write.bind(bot._client);let suppressed=false;
        bot._client.write=(name,p)=>{if(!suppressed&&name==='block_dig'&&p.status===2){suppressed=true;return;}return write(name,p);};
        record.result=await api.executePrimitive('digBlock',{position:{x:100,y:79,z:100}});record.suppressed=suppressed;
        bot._client.write=write;record.serverCheck=await rcon('natural',['execute if block 100 79 100 air run say S06_CONFIRMED_AIR']);
      }
      if(index===11){
        record.label='successful physical placement followed by missing-event exception';
        await rcon('natural',['fill 99 79 99 103 79 103 stone',`give ${username} crafting_table`,`tp ${username} 100.5 80 100.5`]);await wait(500);
        const place=bot.placeBlock.bind(bot);bot.placeBlock=async(...args)=>{await place(...args);throw Error('Injected blockUpdate timeout after actual placement');};
        record.result=await api.executeSkill('place_block',{blockName:'crafting_table'});
      }
    }
    await wait(300);record.inventory=clean(bot.inventory.items());record.finalPosition=clean(bot.entity.position);
    if(index<9){const item=record.goal.split(':')[0].slice(10),names=item==='category.log'?require('../../planner_bot/src/planner/state_builder').loadBlockCategories().categories.log.blocks:[item];
      record.quantity=record.inventory.filter(i=>names.includes(i.name)).reduce((n,i)=>n+i.count,0);record.confirmedSuccess=Boolean(record.result?.ok&&record.quantity>=Number(record.goal.split(':')[1]));}
  }catch(e){record.thrown={code:e.code,message:e.message};}
  finally{await api.stop();bot.quit();}
  record.events=events;record.logs=logs;fs.writeFileSync(path.join(out,`${index}.json`),JSON.stringify(record,null,2));
  console.log(JSON.stringify({phase,index,goal:record.goal,label:record.label,ms:record.durationMs,result:record.result,results:record.results,quantity:record.quantity,digs:record.digs.length,thrown:record.thrown}));
  if(record.thrown)throw Error(record.thrown.message);
  if(index<9&&record.result?.ok&&!record.confirmedSuccess)throw Error('Success without required inventory');
}
main().then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1);});
