const { performance } = require('node:perf_hooks')
const { goals, Movements } = require('mineflayer-pathfinder')
const { cancelled } = require('../utils/context')
const { diggingScope } = require('../utils/dig_execution')

class TowardMovements extends Movements {
  getMoveDiagonal(node, direction, neighbors) {
    const candidates = []
    super.getMoveDiagonal(node, direction, candidates)
    // Use cardinal steps for changes of height; diagonal corners can collide.
    neighbors.push(...candidates.filter(move => move.y === node.y))
  }
}

async function moveToward(bot, target, options, signal) {
  const start = bot.entity.position.clone(), range = options.range ?? 2
  const distance = p => target.y === undefined
    ? Math.hypot(p.x - target.x, p.z - target.z)
    : Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z)
  let pathStatus = null, walkingRetry = false
  const result = reason => {
    const end = bot.entity.position.clone()
    return { target: { ...target }, startPosition: { ...start }, endPosition: { ...end },
      startDistance: distance(start), endDistance: distance(end),
      distanceReduced: distance(start) - distance(end), reached: reason === 'arrived',
      reason, distanceType: target.y === undefined ? 'horizontal' : '3d',
      pathStatus, walkingRetry }
  }
  if (signal.aborted) { const e = cancelled(); e.details = result('cancelled'); throw e }
  if (distance(start) <= range) return result('arrived')
  if (performance.now() >= options.deadline) return result('timeout')
  const movement = new TowardMovements(bot)
  movement.canDig = true
  movement.allowSprinting = true
  bot.pathfinder.setMovements(movement)
  const goal = target.y === undefined
    ? new goals.GoalNearXZ(target.x, target.z, range)
    : new goals.GoalNear(target.x, target.y, target.z, range)
  let timer, monitor, abort, running, reachedEvent = false
  let anchor = start.clone(), lastProgress = performance.now(), workStarted = null
  let activePath = []
  const adjustSprint = () => {
    const next = activePath[0], position = bot.entity.position
    if (walkingRetry || (next && next.y - position.y > 0.5)) movement.allowSprinting = false
    else if (bot.entity.onGround) movement.allowSprinting = true
  }
  const reached = completedGoal => { if (completedGoal === goal) reachedEvent = true }
  const update = path => { pathStatus = path.status; activePath = path.path; adjustSprint() }
  const closeDigging = diggingScope(bot, signal)
  bot.on?.('path_update', update)
  bot.on?.('goal_reached', reached)
  bot.prependListener?.('physicsTick', adjustSprint)
  try {
    running = bot.pathfinder.goto(goal)
    const reason = await Promise.race([
      running.then(() => reachedEvent || goal.isEnd(bot.entity.position.floored()) ? 'arrived' : 'no_path', error => {
        if (signal.aborted) return 'cancelled'
        if (['NoPath', 'Timeout', 'PathStopped'].includes(error.name)) return 'no_path'
        throw error
      }),
      new Promise(resolve => {
        timer = setTimeout(() => resolve('timeout'), Math.max(0, options.deadline - performance.now()))
        abort = () => resolve('cancelled')
        signal.addEventListener('abort', abort, { once: true })
        monitor = setInterval(() => {
          const now = performance.now(), position = bot.entity.position
          // Jumping repeatedly against an obstacle is not forward progress.
          // Retreats and detours count, regardless of distance to the final goal.
          if (Math.hypot(position.x - anchor.x, position.z - anchor.z) >= 0.75 || Math.abs(position.y - anchor.y) >= 1.5) {
            anchor = position.clone(); lastProgress = now
          }
          const mining = bot.pathfinder.isMining?.(), building = bot.pathfinder.isBuilding?.()
          if (mining || building) {
            workStarted ??= now
            const predicted = mining && bot.targetDigBlock && typeof bot.digTime === 'function'
              ? bot.digTime(bot.targetDigBlock) : 0
            if (now - workStarted < Math.max(2000, predicted + 1500)) { lastProgress = now; return }
          } else workStarted = null
          if (!walkingRetry && pathStatus === 'success' && now - lastProgress >= 800) {
            // Sprint-jump prediction can repeatedly collide with a one-block
            // ascent. Replan with ordinary walking/jumping for this operation.
            walkingRetry = true
            movement.allowSprinting = false
            bot.pathfinder.setMovements(movement)
            anchor = position.clone(); lastProgress = now
          } else if (now - lastProgress >= 2000) resolve('no_progress')
        }, 100)
      })
    ])
    clearTimeout(timer); clearInterval(monitor)
    bot.pathfinder.setGoal(null)
    await running.catch(() => {})
    if (signal.aborted || reason === 'cancelled') { const e = cancelled(); e.details = result('cancelled'); throw e }
    return result(reason)
  } finally {
    clearTimeout(timer); clearInterval(monitor)
    if (abort) signal.removeEventListener('abort', abort)
    bot.removeListener?.('path_update', update)
    bot.removeListener?.('goal_reached', reached)
    bot.removeListener?.('physicsTick', adjustSprint)
    bot.pathfinder.setGoal(null)
    await Promise.resolve(running).catch(() => {})
    await closeDigging()
  }
}
module.exports = { moveToward, TowardMovements }
