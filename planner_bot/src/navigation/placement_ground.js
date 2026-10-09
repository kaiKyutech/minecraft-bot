const { checkpoint, interruptible } = require('../utils/context')
const { createLogger } = require('../utils/logger')
const primitives = require('../primitives')

const tree = block => /_(log|wood|leaves|stem|hyphae)$/.test(block?.name || '')
const space = block => block && ['air','cave_air','void_air','grass','short_grass','tall_grass'].includes(block.name)

function footing(bot) {
  const p = bot.entity.position, y = Math.floor(p.y - .01), support = []
  for (let x=Math.floor(p.x-.29); x<=Math.floor(p.x+.29); x++) {
    for (let z=Math.floor(p.z-.29); z<=Math.floor(p.z+.29); z++) {
      const block=bot.blockAt(p.floored().offset(x-Math.floor(p.x),y-Math.floor(p.y),z-Math.floor(p.z)))
      if(!block)return []
      if (block?.boundingBox === 'block') support.push(block)
    }
  }
  return support
}
function treeFooting(bot) { const support=footing(bot);return support.length>0&&support.every(tree) }

function groundCandidates(bot) {
  const base=bot.entity.position.floored(), result=[]
  for(let dx=-6;dx<=6;dx++) for(let dz=-6;dz<=6;dz++) {
    if(dx*dx+dz*dz>36)continue
    for(let drop=2;drop<=8;drop++) {
      const position=base.offset(dx,-drop,dz),foot=bot.blockAt(position.offset(0,-1,0))
      if(foot?.boundingBox!=='block'||tree(foot)||!space(bot.blockAt(position))||!space(bot.blockAt(position.offset(0,1,0))))continue
      result.push({position,distance:bot.entity.position.distanceTo(position.offset(.5,0,.5))})
    }
  }
  return result.sort((a,b)=>a.distance-b.distance)
}

// Execution-only repositioning. Never discard a tree from GOAP knowledge or
// change gather targets. A bounded failed descent retains the placement policy.
async function descendForPlacement(bot) {
  if(!treeFooting(bot))return
  const logger=createLogger({bot,category:'skill'}),deadline=Date.now()+8000
  for(const {position} of groundCandidates(bot).slice(0,3)) {
    checkpoint(bot)
    const remaining=deadline-Date.now()
    if(remaining<=0)break
    try {
      await interruptible(bot,()=>primitives.moveTo(bot,{position,range:0,timeout:remaining}))
    } catch(error) {
      checkpoint(bot)
      if(error.name==='AbortError'||error.code==='REPEATED_FAILURE')throw error
    }
    const settleDeadline=Math.min(deadline,Date.now()+400)
    while(bot.entity.onGround===false&&Date.now()<settleDeadline)await interruptible(bot,()=>new Promise(resolve=>setTimeout(resolve,25)))
    if(bot.entity.onGround!==false&&footing(bot).some(block=>!tree(block))) {
      logger.info(`[PLACE_BLOCK] 地面への移動後に設置: ${bot.entity.position}`)
      return
    }
  }
  logger.info('[PLACE_BLOCK] 降りられる地面なし／移動上限、現在地の設置候補を確認')
}
module.exports={treeFooting,groundCandidates,descendForPlacement}
