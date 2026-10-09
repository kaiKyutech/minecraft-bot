const { performance } = require('node:perf_hooks')
const { Vec3 } = require('vec3')
const { failure } = require('../utils/result')
const { loadBlockCategories } = require('./state_builder')
const { lightInfo, lightOptions } = require('../utils/light_info')
const sessions=new WeakMap()
const AIR=new Set(['air','cave_air','void_air'])
const axis=r=>[0,...Array.from({length:r},(_,i)=>[i+1,-i-1]).flat()]
function session(bot){
  if(sessions.has(bot))return sessions.get(bot)
  const state={cache:null}
  const invalidate=(old,next)=>{const p=next?.position||old?.position;if(!p||!state.cache||p.distanceTo(state.cache.base)<=state.cache.range+2)state.cache=null}
  const chunk=()=>{state.cache=null}
  bot.on?.('blockUpdate',invalidate);bot.on?.('chunkColumnLoad',chunk);bot.on?.('chunkColumnUnload',chunk)
  bot.once?.('end',()=>{bot.removeListener('blockUpdate',invalidate);bot.removeListener('chunkColumnLoad',chunk);bot.removeListener('chunkColumnUnload',chunk);sessions.delete(bot)})
  sessions.set(bot,state);return state
}
async function observeFast(bot,stateManager,options={}){
  const start=performance.now(),range=options.range??16,maxMs=options.maxMs??50,maxChecks=options.maxChecks??12000
  if(!Number.isInteger(range)||range<1||range>64||!Number.isFinite(maxMs)||maxMs<0||!Number.isInteger(maxChecks)||maxChecks<0)throw failure('INVALID_ARGUMENT','range must be 1..64; budgets must be non-negative')
  lightOptions(options)
  const position=bot.entity.position.clone(),base=position.floored(),state=session(bot),key=`${position.x},${position.y},${position.z},${range}`
  if(state.cache?.key!==key)state.cache={key,base,range,axis:axis(range),cursor:0,resources:{},missing:0,checks:0,observedAt:Date.now()}
  const cache=state.cache,n=cache.axis.length,total=n*n*n,deadline=start+maxMs;let checksUsed=0
  while(cache.cursor<total&&checksUsed<maxChecks&&performance.now()<deadline){
    const i=cache.cursor++,dx=cache.axis[Math.floor(i/(n*n))],dy=cache.axis[Math.floor(i/n)%n],dz=cache.axis[i%n]
    if(dx*dx+dy*dy+dz*dz>range*range)continue
    const point=base.offset(dx,dy,dz)
    if(point.y<(bot.game?.minY??-64)||point.y>=(bot.game?.minY??-64)+(bot.game?.height??384))continue
    checksUsed++;cache.checks++;const block=bot.blockAt(point)
    if(!block){cache.missing++;continue}if(AIR.has(block.name))continue
    const distance=point.distanceTo(position),row=cache.resources[block.name]||(cache.resources[block.name]={count:0,nearestPosition:null,nearestDistance:Infinity})
    row.count++;if(distance<row.nearestDistance){row.nearestPosition={x:point.x,y:point.y,z:point.z};row.nearestDistance=distance}
  }
  const resources=structuredClone(cache.resources)
  for(const row of Object.values(resources))if(row.nearestPosition)row.nearestDistance=Math.hypot(row.nearestPosition.x-position.x,row.nearestPosition.y-position.y,row.nearestPosition.z-position.z)
  const categories={}
  for(const [name,category]of Object.entries(loadBlockCategories().categories||{})){
    const rows=(category.blocks||[]).map(b=>resources[b]).filter(Boolean)
    const nearest=rows.reduce((a,b)=>!a||b.nearestDistance<a.nearestDistance?b:a,null)
    categories[name]={count:rows.reduce((s,r)=>s+r.count,0),nearestPosition:nearest?.nearestPosition||null,nearestDistance:nearest?.nearestDistance??null}
  }
  // Sky visibility is a vertical column observation, not a guessed terrain height.
  let skyVisible=true
  const top=(bot.game?.minY??-64)+(bot.game?.height??384)
  for(let y=base.y+2;y<top;y++){
    if(performance.now()>=deadline){skyVisible=null;break}
    const b=bot.blockAt(new Vec3(base.x,y,base.z));if(!b){skyVisible=null;break}
    if(!b.transparent&&!AIR.has(b.name)){skyVisible=false;break}
  }
  const nearby=Object.values(bot.entities||{}).filter(e=>e?.position&&e.id!==bot.entity.id&&e.position.distanceTo(position)<=range)
  return {kind:'fast_observation',timestamp:Date.now(),position:{x:position.x,y:position.y,z:position.z},
    yaw:bot.entity.yaw*180/Math.PI,pitch:bot.entity.pitch*180/Math.PI,health:bot.health??null,food:bot.food??null,time:bot.time?{...bot.time}:null,
    inventory:stateManager.extractInventory(bot),equipment:stateManager.extractEquipment(bot),resources,categories,
    players:nearby.filter(e=>e.type==='player'||e.username).map(e=>({username:e.username,position: {...e.position},distance:e.position.distanceTo(position)})),
    drops:nearby.filter(e=>e.name==='item').map(e=>({id:e.id,position:{...e.position},distance:e.position.distanceTo(position),item:e.getDroppedItem?.()||null})),
    skyVisible,location:skyVisible===null?'unknown':skyVisible?'surface':'underground',light:lightInfo(bot,options),
    range,complete:cache.cursor===total&&cache.missing===0,scanComplete:cache.cursor===total,unloadedChecks:cache.missing,checksUsed,totalChecks:cache.checks,
    observedAt:cache.observedAt,ageMs:Date.now()-cache.observedAt,durationMs:performance.now()-start}
}
module.exports={observeFast}
