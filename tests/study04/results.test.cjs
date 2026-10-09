const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const results=require('./results.json');
test('recorded matrix covers nine real states, thirty goals and ten variants with repeated samples',()=>{
 assert.equal(results.meta.states.length,9);assert.equal(results.meta.goals.length,30);assert.equal(Object.keys(results.variants).length,10);assert.equal(results.cases.length,2700);
 assert.ok(results.cases.every(c=>c.sampleCount===2));
 for(const state of results.meta.states){
  const file=state.name.startsWith('flat-')||state.name.startsWith('natural-')?path.resolve(__dirname,'../fixtures',state.name+'.json.gz'):path.resolve(__dirname,'snapshots',state.name+'.json.gz');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),state.sha256);
 }
});
test('every recorded successful plan replays and safe speed prototypes preserve the full matrix',()=>{
 const baseline=results.cases.filter(c=>c.variant==='baseline');
 for(const c of results.cases){
  if(c.reason==='success')assert.equal(c.valid,true,`${c.state} ${c.goal} ${c.variant}`);
  if(c.provedImpossible)assert.notEqual(c.reason,'success');
  if(['indexed','signature','combined'].includes(c.variant)){
   const old=baseline.find(b=>b.state===c.state&&b.goal===c.goal);assert.equal(c.reason,old.reason);assert.equal(c.iterations,old.iterations);assert.equal(c.cost,old.cost);assert.deepEqual(c.plan,old.plan);
  }
 }
});
test('deep trials remain unresolved on budget exhaustion and all successful deeper plans validate',()=>{
 for(const c of results.extended){if(c.reason==='success')assert.equal(c.valid,true);else assert.ok(['BUDGET_EXCEEDED','iteration_limit','frontier_exhausted'].includes(c.reason));}
 assert.equal(results.live.length,9);assert.equal(new Set(results.live.map(c=>c.start)).size,3);
});
