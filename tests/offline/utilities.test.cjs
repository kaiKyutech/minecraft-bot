const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Vec3 } = require('vec3');
const { scanBlocks } = require('../../planner_bot/src/utils/block_scanner');
const recipes=require('../../planner_bot/src/utils/recipe_utils');
const { createLogger }=require('../../planner_bot/src/utils/logger');
function grid() {
  return {entity:{position:new Vec3(0,0,0),yaw:0},game:{minY:-64,height:384},registry:{blocksByName:{stone:{},oak_log:{}}},
    blockAt:pos=>({name:pos.y===-1?'stone':pos.x===-2&&pos.y===0&&pos.z===0?'oak_log':'air',position:pos})};
}
test('scanner west cone, filtering, sorting, and relative positions',async()=> {
  const result=await scanBlocks(grid(),{range:4,types:['oak_log'],yaw:90,coneAngle:30,maxChecks:-1});
  assert.deepEqual(result.blocks,[{name:'oak_log',position:{x:-2,y:0,z:0},relativePosition:{x:-2,y:0,z:0},distance:2}]);
  assert.equal(result.summary.totalBlocks,1);assert.equal(result.summary.limitReached,false);
});
test('unknown scanner type silently becomes unfiltered',async()=> {
  const result=await scanBlocks(grid(),{range:2,types:['absent'],maxChecks:-1});assert.ok(result.blocks.some(b=>b.name==='stone'));
});
test('scanner respects maxChecks, callback stop and collectBlocks false',async()=> {
  const result=await scanBlocks(grid(),{range:4,maxChecks:3,includeAir:true});assert.equal(result.summary.checksUsed,3);assert.equal(result.summary.limitReached,true);
  const stopped=await scanBlocks(grid(),{range:4,maxChecks:-1,includeAir:true,collectBlocks:false,onBlock:()=>true});
  assert.equal(stopped.summary.stoppedByCallback,true);assert.equal(stopped.summary.totalBlocks,1);assert.deepEqual(stopped.blocks,[]);
});
test('scanner rejects missing position and inverted y range',async()=> {
  await assert.rejects(()=>scanBlocks({},{}),/position/);await assert.rejects(()=>scanBlocks(grid(),{minYOffset:3,maxYOffset:1}),/maxYOffset/);
});
const transcript=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname,'../fixtures/flat-observations.json.gz'))));
for(const entry of transcript.filter(x=>x.input.startsWith('!info recipes')&&!x.thrown))test(`recipe exact live baseline: ${entry.input}`,()=> {
  const params=JSON.parse(entry.input.slice(entry.input.indexOf('{')));
  const actual=entry.input.includes('recipesFor')?recipes.listRecipesFor({version:'1.20.1'},params.item,params.count):recipes.listRecipesUsing({version:'1.20.1'},params.ingredients||params.ingredient,params.mode||'and');
  assert.deepEqual(actual,entry.returned.data);
});
test('recipe validation requires version, known ingredients and item',()=> {
  assert.throws(()=>recipes.listRecipesFor({},'stick'),/version/);assert.throws(()=>recipes.listRecipesUsing({version:'1.20.1'},[]),/ingredients/);
  assert.throws(()=>recipes.listRecipesFor({version:'1.20.1'},'absent'),/見つかりません/);
});
test('logger levels and exact category filter',()=> {
  const saved={LOG_LEVEL:process.env.LOG_LEVEL,LOG_COMMANDS:process.env.LOG_COMMANDS,LOG_CATEGORIES:process.env.LOG_CATEGORIES};
  try {
    process.env.LOG_LEVEL='warn';process.env.LOG_CATEGORIES='goap';process.env.LOG_COMMANDS='goal';const output=[];
    const logger=createLogger({category:'goap',commandName:'goal',bot:{systemLog:x=>output.push(x)}});
    logger.info('hidden');logger.warn('warn');logger.error('error');assert.deepEqual(output,['warn','error']);
    createLogger({category:'goap.exec',commandName:'goal',bot:{systemLog:x=>output.push(x)}}).error('hidden child');assert.equal(output.length,2);
  } finally {for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
