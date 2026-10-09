const { Vec3 } = require('vec3')
const { checkpoint, interruptible, currentContext } = require('../utils/context')
const { failure } = require('../utils/result')
const { lightInfo, lightOptions, TORCHES } = require('../utils/light_info')

const AIR = new Set(['air', 'cave_air', 'void_air'])
const FACES = [[0,1,0], [1,0,0], [-1,0,0], [0,0,1], [0,0,-1]]

function torchOptions(options) {
  const radius = options.radius ?? 3, placement = options.placement ?? 'auto'
  if (!Number.isInteger(radius) || radius < 1 || radius > 4 || !['auto','floor','wall'].includes(placement)) {
    throw failure('INVALID_ARGUMENT', 'radius must be 1..4; placement must be auto, floor or wall')
  }
  return { ...lightOptions(options), radius, placement }
}

function fullSupport(block) {
  if (!block || block.boundingBox !== 'block' || /_leaves$/.test(block.name)) return false
  // Partial cubes (slabs, stairs, fences, chests) are not reliable torch faces.
  return !block.shapes || block.shapes.some(s => s.length === 6 && s.every((v,i) => v === (i < 3 ? 0 : 1)))
}

function torchCandidates(bot, options) {
  const { radius, placement } = options, p = bot.entity.position, base = p.floored()
  const eye = p.offset(0,1.62,0), yaw = bot.entity.yaw
  const forward = new Vec3(-Math.sin(yaw),0,-Math.cos(yaw)), candidates = []
  for (let dx=-radius; dx<=radius; dx++) for (let dz=-radius; dz<=radius; dz++) for (let dy=-1; dy<=1; dy++) {
    if (dx*dx+dz*dz+dy*dy > radius*radius || (dx===0 && dz===0)) continue
    const position = base.offset(dx,dy,dz), center = position.offset(.5,.5,.5)
    if (position.x+1>p.x-.3 && position.x<p.x+.3 && position.z+1>p.z-.3 && position.z<p.z+.3 && position.y+1>p.y && position.y<p.y+1.8) continue
    const vx=center.x-p.x, vz=center.z-p.z
    const ahead=vx*forward.x+vz*forward.z, lateral=Math.abs(vx*forward.z-vz*forward.x)
    // Reserve the first two cells of the forward corridor for walking/digging.
    if (ahead>0 && ahead<=2.5 && lateral<.8) continue
    const target=bot.blockAt(position)
    if (!target || !AIR.has(target.name)) continue
    for (const [x,y,z] of FACES) {
      const kind=y===1?'floor':'wall'
      if (placement!=='auto' && placement!==kind) continue
      const face=new Vec3(x,y,z), reference=bot.blockAt(position.minus(face))
      if (!fullSupport(reference)) continue
      const faceCenter=reference.position.offset(.5+x*.5,.5+y*.5,.5+z*.5)
      if (eye.distanceTo(faceCenter)>4.5) continue
      // Prefer behind/sides, then low placements and proximity. Keep ordering deterministic.
      const score=(ahead>0?20:0)+(dy>0?10:0)+center.distanceTo(p)+(kind==='wall'?-.1:0)
      candidates.push({position,reference,face,kind,score})
    }
  }
  return candidates.sort((a,b)=>a.score-b.score)
}

async function placeTorch(bot, options) {
  checkpoint(bot)
  const item=bot.inventory.items().find(i=>i.name==='torch' && i.count>0)
  if (!item) throw failure('ITEM_NOT_FOUND','No torch in inventory')
  const beforeLight=lightInfo(bot,options), yaw=bot.entity.yaw, pitch=bot.entity.pitch
  let placed=null, attempts=0, viewRestored=false
  try {
    await interruptible(bot,()=>bot.equip(item,'hand'))
    const candidates=torchCandidates(bot,options)
    for (const candidate of candidates) {
      checkpoint(bot)
      if (attempts>=8) break
      const target=bot.blockAt(candidate.position)
      if (!target || !AIR.has(target.name) || !fullSupport(bot.blockAt(candidate.reference.position))) continue
      if (!bot.inventory.items().some(i=>i.name==='torch' && i.count>0)) break
      attempts++
      try { await interruptible(bot,()=>bot.placeBlock(candidate.reference,candidate.face)) }
      catch (error) { checkpoint(bot); if (error.name==='AbortError') throw error }
      checkpoint(bot)
      const actual=bot.blockAt(candidate.position)
      if (actual && TORCHES.has(actual.name)) {
        placed={position:{x:candidate.position.x,y:candidate.position.y,z:candidate.position.z},
          block:actual.name,placement:actual.name==='wall_torch'?'wall':'floor'}
        break
      }
    }
  } finally {
    // Native placement looks at its face. Restore the caller's view while this
    // operation still owns the bot; never start another look after cancellation.
    if (!currentContext(bot).signal?.aborted && typeof bot.look==='function') {
      try { await interruptible(bot,()=>bot.look(yaw,pitch)); viewRestored=true }
      catch (_) { checkpoint(bot) }
    }
  }
  checkpoint(bot)
  if (!placed) throw failure('PLACEMENT_FAILED','No confirmed nearby torch placement',{attempts})
  return {...placed,beforeLight,afterLight:lightInfo(bot,options),attempts,viewRestored}
}

module.exports={torchOptions,torchCandidates,placeTorch}
