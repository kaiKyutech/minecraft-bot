// Original natural terrain. No fill/setblock or resource placement.
process.env.LOG_LEVEL = 'error';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { connect, rcon, wait, clean } = require('../helpers/live');
const { createBotApi } = require('../../planner_bot/api');
const out = path.resolve(__dirname, 'snapshots');
const resultDir = path.resolve(__dirname, '../../.cache/minecraft-bot/04-study');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(resultDir, { recursive: true });
const saveSnapshot = (name, state) => fs.writeFileSync(path.join(out, name + '.json.gz'), zlib.gzipSync(JSON.stringify(state)));
async function main() {
  const run = Date.now().toString(36).slice(-6), records = [], snapshots = [];
  const probe = await connect('natural', 'S04P' + run); const api = createBotApi(probe, { logLevel: 'error' }); probe.logWriter = () => {};
  let starts;
  try {
    const spawn = clean(probe.entity.position);
    // Select safe surface blocks from actual loaded terrain, separated by >=16 blocks.
    starts = [spawn];
    for (const [dx,dz] of [[20,0],[0,20],[-20,0],[0,-20]]) {
      const x = Math.floor(spawn.x)+dx, z = Math.floor(spawn.z)+dz;
      for (let y = 100; y >= 50; y--) {
        const b = probe.blockAt(new (require('vec3').Vec3)(x,y,z));
        const above = probe.blockAt(new (require('vec3').Vec3)(x,y+1,z));
        const above2 = probe.blockAt(new (require('vec3').Vec3)(x,y+2,z));
        if (b && ['grass_block','dirt','stone','sand'].includes(b.name) && above?.name==='air' && above2?.name==='air') { starts.push({x:x+0.5,y:y+1,z:z+0.5}); break; }
      }
      if (starts.length===3) break;
    }
    if(starts.length<3) throw new Error('Could not identify three safe natural starts');
    // Inventory variants are genuine snapshots taken after give, never modify nearby facts.
    for (const [label, position, items] of [
      ['surface-empty', starts[0], []],
      ['surface-stone', starts[1], ['stone_pickaxe 1']],
      ['surface-iron', starts[2], ['iron_pickaxe 1','iron_ingot 3','stick 2']],
    ]) {
      await rcon('natural', [`tp ${probe.username} ${position.x} ${position.y} ${position.z}`, `clear ${probe.username}`, ...items.map(i=>`give ${probe.username} minecraft:${i}`)]); await wait(1200);
      const observed = await api.observe(); if (!observed.ok) throw new Error(observed.error.message);
      saveSnapshot(label, observed.data); snapshots.push({name:label,position:clean(probe.entity.position),items});
    }
    // Locate a real loaded two-block cave opening, without excavating it.
    let cave;
    const Vec3 = require('vec3').Vec3;
    outer: for (let y=40;y>=0;y--) for(let x=Math.floor(spawn.x)-12;x<=spawn.x+12;x+=2) for(let z=Math.floor(spawn.z)-12;z<=spawn.z+12;z+=2) {
      const floor=probe.blockAt(new Vec3(x,y-1,z)), a=probe.blockAt(new Vec3(x,y,z)), b=probe.blockAt(new Vec3(x,y+1,z));
      if(floor?.boundingBox==='block' && /^(cave_air|air)$/.test(a?.name) && /^(cave_air|air)$/.test(b?.name)){cave={x:x+0.5,y,z:z+0.5};break outer;}
    }
    if(cave) {
      await rcon('natural',[`tp ${probe.username} ${cave.x} ${cave.y} ${cave.z}`,`clear ${probe.username}`,`give ${probe.username} minecraft:stone_pickaxe 1`]);await wait(1200);
      const observed=await api.observe();if(!observed.ok)throw new Error(observed.error.message);saveSnapshot('underground-stone',observed.data);snapshots.push({name:'underground-stone',position:cave,items:['stone_pickaxe 1']});
    }
  } finally { await api.stop(); probe.quit(); }
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({base:'bfa1a1b',version:'1.20.1',capturedAt:new Date().toISOString(),starts,snapshots},null,2));
  for (let s=0;s<starts.length;s++) for(const [g,name] of ['wooden_pickaxe','stone_pickaxe','furnace'].entries()) {
    const username=`S04${s}${g}${run}`, bot=await connect('natural',username), api=createBotApi(bot,{logLevel:'info'}), events=[],logs=[];
    bot.logWriter=message=>{ if(/GATHER|MOVE|REACTIVE|EXECUTION|PLACE_BLOCK|サブゴール|path/i.test(message)) logs.push(message); };
    const position=starts[s];let record={startIndex:s,username,goal:`inventory.${name}:1`,requestedPosition:position};
    try {
      await rcon('natural',[`tp ${username} ${position.x} ${position.y} ${position.z}`,`clear ${username}`]);await wait(800);
      const observed=await api.observe();if(!observed.ok)throw new Error(observed.error.message);
      record.initialPosition=clean(bot.entity.position);
      fs.mkdirSync(path.join(resultDir,'execution-snapshots'),{recursive:true});
      fs.writeFileSync(path.join(resultDir,'execution-snapshots',`exec-${s}-${name}.json.gz`),zlib.gzipSync(JSON.stringify(observed.data)));
      const t=performance.now();record.result=await api.executeGoal(record.goal,{signal:AbortSignal.timeout(120000),onProgress:e=>events.push(e)});record.durationMs=performance.now()-t;
      record.inventory=clean(bot.inventory.items());record.finalPosition=clean(bot.entity.position);record.events=events;record.logs=logs;
    } catch(e){record.thrown={code:e.code,message:e.message};} finally {await api.stop();bot.quit();}
    records.push(record);fs.writeFileSync(path.join(resultDir,'live.json'),JSON.stringify(records,null,2));console.log(JSON.stringify({start:s,goal:name,ms:record.durationMs,result:record.result,thrown:record.thrown}));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
