const { performance } = require('node:perf_hooks')
const { goals, Movements } = require('mineflayer-pathfinder')
const { failure } = require('../utils/result')
const { cancelled } = require('../utils/context')
const { diggingScope } = require('../utils/dig_execution')

async function moveToward(bot,target,options,signal){
  const start=bot.entity.position.clone(),range=options.range??2
  const distance=p=>target.y===undefined?Math.hypot(p.x-target.x,p.z-target.z):Math.hypot(p.x-target.x,p.y-target.y,p.z-target.z)
  const result=reason=>{const end=bot.entity.position.clone();return {target:{...target},startPosition:{...start},endPosition:{...end},startDistance:distance(start),endDistance:distance(end),distanceReduced:distance(start)-distance(end),reached:reason==='arrived',reason,distanceType:target.y===undefined?'horizontal':'3d'}}
  if(signal.aborted){const e=cancelled();e.details=result('cancelled');throw e}
  if(distance(start)<=range)return result('arrived')
  if(performance.now()>=options.deadline)return result('timeout')
  const movement=new Movements(bot,bot.registry);movement.canDig=true;movement.allowSprinting=true
  bot.pathfinder.setMovements(movement)
  const goal=target.y===undefined?new goals.GoalNearXZ(target.x,target.z,range):new goals.GoalNear(target.x,target.y,target.z,range)
  let timer,abort
  const closeDigging=diggingScope(bot,signal)
  let running
  try{
    running=bot.pathfinder.goto(goal)
    const reason=await Promise.race([
      running.then(()=>goal.isEnd(bot.entity.position.floored())?'arrived':'no_path',error=>{
        if(signal.aborted)return 'cancelled'
        if(['NoPath','Timeout','PathStopped'].includes(error.name))return 'no_path'
        throw error
      }),
      new Promise(resolve=>{timer=setTimeout(()=>resolve('timeout'),Math.max(0,options.deadline-performance.now()));abort=()=>resolve('cancelled');signal.addEventListener('abort',abort,{once:true})})
    ])
    bot.pathfinder.setGoal(null);await running.catch(()=>{})
    if(signal.aborted||reason==='cancelled'){const e=cancelled();e.details=result('cancelled');throw e}
    return result(reason)
  }finally{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);bot.pathfinder.setGoal(null);await Promise.resolve(running).catch(()=>{});await closeDigging()}
}
module.exports={moveToward}
