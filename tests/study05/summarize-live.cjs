const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'.cache/minecraft-bot/05-study');
const phases=process.argv.slice(2);if(!phases.length)phases.push('before','G');
const result={baselineCommit:'eab3cca',minecraftVersion:'1.20.1',deadlineMs:120000,
  worldBackup:path.resolve(root,'../isg/server-natural/world-05-base'),
  baselineGatherSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/gather-before.js'),'utf8').replace(/\r\n/g,'\n')).digest('hex'),
  phases:{}};
const levelFile=path.join(result.worldBackup,'level.dat');
if(fs.existsSync(levelFile))result.baseLevelDatSha256=crypto.createHash('sha256').update(fs.readFileSync(levelFile)).digest('hex');
for(const phase of phases) {
  const files=fs.readdirSync(path.join(dir,phase)).filter(s=>/^\d+\.json$/.test(s)).sort((a,b)=>parseInt(a)-parseInt(b));
  result.phases[phase]=files.map(file=>{
    const r=JSON.parse(fs.readFileSync(path.join(dir,phase,file),'utf8'));
    return {index:r.index,label:r.label,goal:r.goal,username:r.username,at:r.at,initialPosition:r.initialPosition,initialInventory:r.initialInventory,
      durationMs:r.durationMs,result:r.result,inventory:r.inventory,finalPosition:r.finalPosition,achievedQuantity:r.achievedQuantity,
      confirmedSuccess:r.confirmedSuccess??r.result?.ok,thrown:r.thrown,logs:r.logs,
      events:r.events.filter(e=>['goal_end','step_failure','subgoal_enter'].includes(e.type))};
  });
}
for(const phase of phases.filter(p=>p!=='before'))for(const row of result.phases[phase]) {
  const before=result.phases.before?.find(r=>r.index===row.index);
  if(before && (JSON.stringify(before.initialPosition)!==JSON.stringify(row.initialPosition)||before.initialInventory.length||row.initialInventory.length))throw new Error(`Paired initial conditions differ: ${phase}/${row.index}`);
}
fs.writeFileSync(path.join(__dirname,'live-results.json'),JSON.stringify(result,null,2));
for(const phase of phases)for(const r of result.phases[phase])console.log(`${phase}\t${r.index}\t${r.label}\t${r.confirmedSuccess?'OK':r.result?.error?.code||r.thrown?.code}\t${(r.durationMs/1000).toFixed(2)}s`);
