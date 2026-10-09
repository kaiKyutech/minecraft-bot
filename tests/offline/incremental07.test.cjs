const {test}=require('node:test')
const assert=require('node:assert/strict')
const {EventEmitter}=require('node:events')
const {Vec3}=require('vec3')
const {scanBlocks}=require('../../planner_bot/src/utils/block_scanner')
const {scanIncremental}=require('../../planner_bot/src/planner/incremental_blocks')
const make=()=>{const b=new EventEmitter();b.entity={position:new Vec3(.4,2.8,-.3)};b.game={minY:-3,height:12};b.cells=new Map();b.calls=0;b.blockAt=p=>{b.calls++;return {name:b.cells.get(p.toString())||((p.x*p.y+p.z)%7===0?'stone':'air'),position:p}};return b}
const options={range:5,maxChecks:-1,collectBlocks:true}
async function compare(b){const fresh=await scanBlocks(b,options),cached=await scanIncremental(b,options);assert.deepEqual(cached.blocks,fresh.blocks);assert.deepEqual(cached.summary.typeCounts,fresh.summary.typeCounts)}
test('incremental full list equals full scanner, including fractional sphere and stable ties',async()=>{const b=make();await compare(b);b.calls=0;await scanIncremental(b,options);assert.equal(b.calls,0);b.entity.position=new Vec3(.9,2.1,-.9);await compare(b);b.emit('end');assert.equal(b.listenerCount('blockUpdate'),0)})
test('block changes, boundary movement, teleports, load/unload, and respawn preserve exact contents',async()=>{const b=make();await compare(b);const p=new Vec3(0,2,0);b.cells.set(p.toString(),'oak_log');b.emit('blockUpdate',null,{position:p});await compare(b);b.entity.position=new Vec3(1.1,3.4,-1.3);await compare(b);b.entity.position=new Vec3(-30.2,0.2,33.8);await compare(b);b.cells.set(new Vec3(-30,1,34).toString(),'crafting_table');b.emit('chunkColumnLoad',new Vec3(-32,0,32));await compare(b);b.cells.clear();b.emit('chunkColumnUnload',new Vec3(-32,0,32));await compare(b);b.emit('respawn');await compare(b)})
test('simultaneous observers share scan, return isolated objects and recover after cancelled partial scan',async()=>{const b=make();const [a,c]=await Promise.all([scanIncremental(b,options),scanIncremental(b,options)]);assert.deepEqual(a.blocks,c.blocks);a.blocks[0].name='mutated';assert.notEqual(a.blocks[0].name,c.blocks[0].name);const controller=new AbortController();b.entity.position=new Vec3(100,2,100);setImmediate(()=>controller.abort());await assert.rejects(scanIncremental(b,{...options,range:20,signal:controller.signal}),{code:'CANCELLED'});await compare(b)})
test('changes received during sliced scan are reconciled before publication',async()=>{const b=make(),p=new Vec3(0,2,0);const original=b.blockAt;let triggered=false;b.blockAt=point=>{if(b.calls>1000&&!triggered){triggered=true;b.cells.set(p.toString(),'furnace');b.emit('blockUpdate',null,{position:p})}return original(point)};await scanIncremental(b,{...options,range:15});assert.equal(triggered,true);await compare(b)})
test('finite configured prefix is identical to legacy scanner',async()=>{const b=make(),opts={...options,maxChecks:19};const [a,c]=await Promise.all([scanBlocks(b,opts),scanIncremental(b,opts)]);assert.deepEqual(c,a)})

test('recorded world snapshot preserves complete worldState fields and flags against original manager',async()=>{
 process.env.STATE_SCAN_RANGE='8'
 const fs=require('fs'),zlib=require('zlib'),path=require('path'),sm=require('../../planner_bot/src/planner/state_manager')(),ref=require('../study07/reference.cjs')()
 const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../study04/snapshots/surface-empty.json.gz'))))
 const b=new EventEmitter(),cells=new Map(world.blocks.list.map(row=>[new Vec3(row.position.x,row.position.y,row.position.z).toString(),row.name]))
 Object.assign(b,{entity:{position:new Vec3(world.position.x,world.position.y,world.position.z)},game:{minY:-64,height:384},inventory:{items:()=>[],slots:[],emptySlotCount:()=>1},time:{isDay:world.isDay},blockAt:p=>({name:cells.get(p.toString())||'air',position:p})})
 for(const delta of [0,1,-2]){b.entity.position.x+=delta;const a=await sm.observe(b),c=await ref.observe(b);delete a.timestamp;delete c.timestamp;assert.deepEqual(a,c)}
})

test('fractional configured ranges retain integer scan coordinates',async()=>{const b=make(),opts={...options,range:4.5};const a=await scanBlocks(b,opts),c=await scanIncremental(b,opts);assert.deepEqual(c.blocks,a.blocks);assert.deepEqual(c.summary.typeCounts,a.summary.typeCounts)})
