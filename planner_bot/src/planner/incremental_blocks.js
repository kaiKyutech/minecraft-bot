const { Vec3 } = require('vec3')
const { performance } = require('node:perf_hooks')
const sessions = new WeakMap()
const immediate = () => new Promise(resolve => setImmediate(resolve))
function check(options) {
  if (options.signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'CANCELLED' })
  if (options.deadline !== undefined && performance.now() >= options.deadline) throw Object.assign(new Error('Observation budget exceeded'), { code: 'BUDGET_EXCEEDED' })
}
function slicer(options) {
  let until = performance.now() + 2, n = 0
  return () => {
    if (++n % 128 !== 0) return null
    check(options)
    if (performance.now() < until) return null
    return immediate().then(() => { check(options); until = performance.now() + 2 })
  }
}
const inside = (b,x,y,z) => b && x>=b.x0 && x<=b.x1 && y>=b.y0 && y<=b.y1 && z>=b.z0 && z<=b.z1
const columnKey = (x,z) => x+','+z
function session(bot) {
  let s = sessions.get(bot)
  if (s) return s
  s = { columns: new Map(), bounds: null, dirty: new Set(), updates: new Map(), revision: 0, tail: Promise.resolve() }
  const block = (old,next) => {
    const p = next?.position || old?.position
    if (!p || !inside(s.bounds,p.x,p.y,p.z)) return
    s.updates.set(p.x+','+p.y+','+p.z, { x:p.x,y:p.y,z:p.z }); s.revision++
  }
  const chunk = p => {
    // Mineflayer forwards world positions (multiples of 16).
    if (p) s.dirty.add(columnKey(Math.floor(p.x/16),Math.floor(p.z/16)))
    else s.bounds = null
    s.revision++
  }
  const reset = () => { s.bounds=null; s.columns.clear(); s.revision++ }
  const end = () => {
    bot.removeListener?.('blockUpdate',block); bot.removeListener?.('chunkColumnLoad',chunk)
    bot.removeListener?.('chunkColumnUnload',chunk); bot.removeListener?.('respawn',reset)
    sessions.delete(bot)
  }
  bot.on?.('blockUpdate',block); bot.on?.('chunkColumnLoad',chunk); bot.on?.('chunkColumnUnload',chunk)
  bot.on?.('respawn',reset); bot.once?.('end',end)
  sessions.set(bot,s); return s
}
function put(s,bot,x,y,z) {
  const key=columnKey(x,z), name=bot.blockAt(new Vec3(x,y,z),false)?.name
  let col=s.columns.get(key)
  if (name && !name.includes('air')) {
    if (!col) { col={x,z,ys:new Map()}; s.columns.set(key,col) }
    col.ys.set(y,name)
  } else if (col) { col.ys.delete(y); if (!col.ys.size) s.columns.delete(key) }
}
async function box(s,bot,b,options) {
  const tick=slicer(options)
  for(let x=b.x0;x<=b.x1;x++) for(let z=b.z0;z<=b.z1;z++) for(let y=b.y0;y<=b.y1;y++) {
    put(s,bot,x,y,z); { const pause=tick(); if(pause) await pause }
  }
}
function difference(b,a) {
  if (!a || b.x0>a.x1 || b.x1<a.x0 || b.y0>a.y1 || b.y1<a.y0 || b.z0>a.z1 || b.z1<a.z0) return [b]
  const x0=Math.max(b.x0,a.x0),x1=Math.min(b.x1,a.x1), y0=Math.max(b.y0,a.y0),y1=Math.min(b.y1,a.y1)
  return [ {...b,x1:x0-1}, {...b,x0:x1+1}, {...b,x0,x1,y1:y0-1}, {...b,x0,x1,y0:y1+1},
    {...b,x0,x1,y0,y1,z1:Math.max(b.z0,a.z0)-1}, {...b,x0,x1,y0,y1,z0:Math.min(b.z1,a.z1)+1} ]
}
async function synchronize(s,bot,b,options) {
  check(options)
  const old=s.bounds
  // Publish the target bounds before yielding so changes during the scan are tracked.
  s.bounds=b
  try {
    const tick=slicer(options)
    if (!old || Object.keys(b).some(key=>b[key]!==old[key])) for(const [key,col] of s.columns) {
      if(col.x<b.x0||col.x>b.x1||col.z<b.z0||col.z>b.z1) s.columns.delete(key)
      else for(const y of col.ys.keys()) { if(y<b.y0||y>b.y1) col.ys.delete(y); { const pause=tick(); if(pause) await pause } }
      { const pause=tick(); if(pause) await pause }
    }
    for(const part of difference(b,old)) await box(s,bot,part,options)
    while(s.dirty.size || s.updates.size) {
      const dirty=[...s.dirty]; s.dirty.clear()
      for(const key of dirty) {
        const [cx,cz]=key.split(',').map(Number)
        await box(s,bot,{...b,x0:Math.max(b.x0,cx*16),x1:Math.min(b.x1,cx*16+15),z0:Math.max(b.z0,cz*16),z1:Math.min(b.z1,cz*16+15)},options)
      }
      const updates=[...s.updates.values()]; s.updates.clear()
      for(const p of updates) { if(inside(b,p.x,p.y,p.z))put(s,bot,p.x,p.y,p.z); { const pause=tick(); if(pause) await pause } }
      check(options)
    }
  } catch(error) {
    // A budget/cancellation must never mark a partial scan as complete.
    s.bounds=null; s.columns.clear(); throw error
  }
}
function axis(min,max,center) {
  const result=[]
  if(center>=min&&center<=max)result.push(center)
  for(let d=1;d<=Math.max(center-min,max-center);d++) { if(center-d>=min)result.push(center-d); if(center+d<=max)result.push(center+d) }
  return result
}
async function scanIncremental(bot,options) {
  // Keep the existing configured prefix semantics if a finite scan limit is requested.
  if(options.maxChecks>0) return require('../utils/block_scanner').scanBlocks(bot,options)
  if(!bot.entity?.position)throw Error('Bot position is not available for block scanning')
  const s=session(bot),position=bot.entity.position.clone(),base=position.floored(),r=options.range
  const b={x0:Math.ceil(base.x-r),x1:Math.floor(base.x+r),z0:Math.ceil(base.z-r),z1:Math.floor(base.z+r),
    y0:Math.ceil(Math.max(base.y-r,bot.game?.minY??base.y-r)),
    y1:Math.floor(Math.min(base.y+r,typeof bot.game?.height==='number'?(bot.game.minY??base.y-r)+bot.game.height-1:base.y+r))}
  const previous=s.tail
  let release; s.tail=new Promise(resolve=>{release=resolve})
  try {
    await previous; check(options)
    for (;;) {
    await synchronize(s,bot,b,options)
    if (s.bounds !== b) continue
    // The serialized cache cannot mutate during projection. Events are queued for
    // the next synchronization, giving this call a complete snapshot at this point.
    const xs=axis(b.x0,b.x1,base.x),ys=axis(b.y0,b.y1,base.y),zs=axis(b.z0,b.z1,base.z)
    const buckets=Array.from({length:Math.ceil(r)+1},()=>[]),typeCounts={},nearestDistances={},tick=slicer(options)
    for(const x of xs) {
      const columns=zs.map(z=>s.columns.get(columnKey(x,z)))
      for(const y of ys) for(const col of columns) {
        const name=col?.ys.get(y)
        if(name) {
          const dx=x-position.x,dy=y-position.y,dz=col.z-position.z
          const distance=Math.sqrt(dx*dx+dy*dy+dz*dz)
          if(distance<=r) {
            const d=Math.floor(distance)
            buckets[d].push({name,position:{x,y,z:col.z},relativePosition:{x:x-base.x,y:y-base.y,z:col.z-base.z},distance:d})
            typeCounts[name]=(typeCounts[name]||0)+1
            nearestDistances[name]=Math.min(nearestDistances[name]??Infinity,distance)
          }
        }
        const pause=tick(); if(pause)await pause
      }
    }
    const blocks=[]
    for(const bucket of buckets)for(const row of bucket){blocks.push(row);const pause=tick();if(pause)await pause}
    if (s.bounds !== b) continue
    return {blocks,summary:{typeCounts,nearestDistances,scanRange:r,maxChecks:null,limitReached:false,stoppedByCallback:false}}

    }
  } finally { release() }
}
module.exports={scanIncremental}
