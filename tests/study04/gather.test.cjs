process.env.LOG_LEVEL='error';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');const {Vec3}=require('vec3');const {replace}=require('./harness.cjs');
const filename=path.resolve(__dirname,'../../planner_bot/src/skills/gather.js');
async function scenario(adaptive, pathDecisionTimeout=false) {
 const positions=[new Vec3(1,64,0),new Vec3(2,64,0)], attempts=[],samples=[],dug=[];
 const bot={version:'1.20.1',username:'study',entity:{position:new Vec3(0,64,0)},logLevel:'error',logWriter(){},blockAt(p){return{name:'oak_log',position:p}},async unequip(){}};
 const primitives={async findBlock(){return {position:positions[0]}},async findBestTool(){return null},async findBlocks(bot,p){samples.push(p.count);return positions.slice(0,p.count).map(position=>({position,name:'oak_log'}))},async moveTo(bot,p){attempts.push(p.position.x);if(p.position.x===1)throw new Error(pathDecisionTimeout?'Took to long to decide path to goal!':'moveTo timeout (30000ms)')},async digBlock(bot,p){dug.push(p.position.x)}};
 let source=fs.readFileSync(filename,'utf8');if(adaptive){
  source=replace(source,'count: searchSampleSize,','count: Math.min(32, Math.max(searchSampleSize, avoidedPositionKeys.size + 1)),');
  source=replace(source,"message.includes('path was stopped') ||","message.includes('took to long to decide path to goal') || message.includes('path was stopped') ||");
 }
 const real=createRequire(filename),module={exports:{}};
 vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(key=>key==='../primitives'?primitives:real(key),module,module.exports);
 let error;const start=performance.now();try{await module.exports(bot,{itemName:'oak_log',count:1,collectItem:false,retryDelayMs:0},{})}catch(e){error={code:e.code,message:e.message}}
 return{attempts,samples,dug,error,durationMs:performance.now()-start};
}
test('current one-candidate retry revisits avoided nearest; bounded adaptive research copy reaches second candidate',async()=>{
 const baseline=await scenario(false),prototype=await scenario(true);
 assert.equal(baseline.error.code,'BLOCK_NOT_FOUND');assert.deepEqual(baseline.samples,[1,1]);assert.deepEqual(baseline.dug,[]);
 assert.equal(prototype.error,undefined);assert.deepEqual(prototype.samples,[1,2]);assert.deepEqual(prototype.attempts,[1,2]);assert.deepEqual(prototype.dug,[2]);
});
test('path decision timeout currently exits gather; research copy treats it as a bounded alternate-candidate retry',async()=>{
 const baseline=await scenario(false,true),prototype=await scenario(true,true);
 assert.equal(baseline.error.code,'EXECUTION_FAILED');assert.deepEqual(baseline.attempts,[1]);assert.equal(prototype.error,undefined);assert.deepEqual(prototype.dug,[2]);
});
module.exports={scenario};
