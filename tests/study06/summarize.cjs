const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const cache=path.resolve(__dirname,'../../.cache/minecraft-bot/06-study');
const phases=Object.fromEntries(['before','after'].map(phase=>[phase,fs.readdirSync(path.join(cache,phase)).filter(n=>/^\d+\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(path.join(cache,phase,n)))).sort((a,b)=>a.index-b.index)]));
const get=(phase,index)=>phases[phase].find(r=>r.index===index);
const median=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?Math.round((a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2*100)/100:null;};
const air=d=>d.serverChanges.some(c=>c.stateId===0);
const stats=digs=>({attempts:digs.length,nonGrounded:digs.filter(d=>d.onGround===false).length,
  clientCompleted:digs.filter(d=>Number.isFinite(d.clientDoneMs)).length,
  completedWithoutServerAir:digs.filter(d=>Number.isFinite(d.clientDoneMs)&&!air(d)).length,
  predictedMedianMs:median(digs.map(d=>d.predictedMs)),clientDoneMedianMs:median(digs.map(d=>d.clientDoneMs)),
  serverAirMedianMs:median(digs.map(d=>d.serverChanges.find(c=>c.stateId===0)?.ms))});
for(let i=0;i<9;i++)for(const phase of ['before','after']){
  const r=get(phase,i);assert.ok(r);assert.equal(r.initialInventory.length,0);assert.equal(r.thrown,undefined);
  assert.equal(r.confirmedSuccess,Boolean(r.result.ok&&r.quantity>=Number(r.goal.split(':')[1])));
}
for(let i=0;i<9;i++)assert.deepEqual(get('before',i).position,get('after',i).position);
const metrics={node:process.version,mineflayer:require('mineflayer/package.json').version,baseline:'42ac72b',
  goals:[0,3,6].map(first=>({goal:get('before',first).goal,beforeSuccess:[first,first+1,first+2].filter(i=>get('before',i).confirmedSuccess).length,
    afterSuccess:[first,first+1,first+2].filter(i=>get('after',i).confirmedSuccess).length})),
  trials:Array.from({length:9},(_,i)=>({index:i,goal:get('before',i).goal,position:get('before',i).position,
    ...Object.fromEntries(['before','after'].map(phase=>{const r=get(phase,i);return[phase,{ok:r.confirmedSuccess,code:r.result.error?.code||null,ms:r.durationMs,quantity:r.quantity,digs:stats(r.digs),placements:r.placements}];}))})),
  naturalDigStats:Object.fromEntries(['before','after'].map(phase=>[phase,stats(phases[phase].filter(r=>r.index<9).flatMap(r=>r.digs))])),
  downward:Object.fromEntries(['before','after'].map(phase=>[phase,{...stats(get(phase,9).digs),results:get(phase,9).results,digs:get(phase,9).digs}])),
  controlled:[10,11,12,13].map(i=>({index:i,...Object.fromEntries(['before','after'].map(phase=>{const r=get(phase,i);return[phase,{label:r.label,result:r.result,digs:stats(r.digs),serverCheck:r.serverCheck,serverTable:r.serverTable,placements:r.placements}];}))})),
  lostSuccesses:Array.from({length:9},(_,i)=>i).filter(i=>get('before',i).confirmedSuccess&&!get('after',i).confirmedSuccess)};
const matrix=JSON.parse(fs.readFileSync(path.join(cache,'matrix-B.json')));
assert.equal(matrix.cases,270);assert.equal(matrix.error,undefined);
assert.deepEqual(matrix.meta.productionHashes,require('../study05/matrix-B.json').meta.productionHashes);
metrics.planner={cases:270,hashesUnchanged:true};
fs.writeFileSync(path.join(__dirname,'live-results.json'),JSON.stringify(phases,null,2));
fs.writeFileSync(path.join(__dirname,'metrics.json'),JSON.stringify(metrics,null,2));
console.log(JSON.stringify({goals:metrics.goals,naturalDigStats:metrics.naturalDigStats,downward:Object.fromEntries(Object.entries(metrics.downward).map(([p,r])=>[p,{attempts:r.attempts,nonGrounded:r.nonGrounded,predictedMedianMs:r.predictedMedianMs,clientDoneMedianMs:r.clientDoneMedianMs,serverAirMedianMs:r.serverAirMedianMs}])),lostSuccesses:metrics.lostSuccesses},null,2));
