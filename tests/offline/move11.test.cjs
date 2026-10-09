const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const path = require('node:path')
const { load } = require('../helpers/module')
const real = require('mineflayer-pathfinder')
class Movements {
  getMoveDiagonal(node, dir, neighbors) {
    neighbors.push(...[-1, 0, 1].map(dy => ({ x: node.x + dir.x, y: node.y + dy, z: node.z + dir.z })))
  }
}
const { moveToward, TowardMovements } = load(path.resolve(__dirname, '../../planner_bot/src/navigation/move_toward.js'), {
  'mineflayer-pathfinder': { ...real, Movements }
})
function fixture(status = 'success') {
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(0, 10, 0), onGround: true }
  let reject, resolve
  const route = [{ x: 1, y: 10, z: 0 }]
  bot.pathfinder = {
    setMovements(m) { this.movements = m; this.changes = (this.changes || 0) + 1 },
    goto(goal) { this.goal = goal; bot.emit('path_update', { status, path: route }); return new Promise((r, j) => { resolve = r; reject = j }) },
    setGoal(goal) { this.goal = goal; if (goal === null) reject?.(Object.assign(new Error('stopped'), { name: 'GoalChanged' })) },
    isMining() { return false }, isBuilding() { return false }
  }
  return { bot, route, arrive() { bot.entity.position = new Vec3(10, 10, 0); resolve() },
    complete() { resolve() }, run(ms = 10000, signal = new AbortController().signal, target = { x: 10, z: 0 }) { return moveToward(bot, target, { deadline: performance.now() + ms, range: 1 }, signal) } }
}
function clean(bot) {
  assert.equal(bot.pathfinder.goal, null)
  assert.equal(bot.listenerCount('path_update'), 0)
  assert.equal(bot.listenerCount('goal_reached'), 0)
  assert.equal(bot.listenerCount('physicsTick'), 0)
}
test('moveToward keeps level diagonals but uses cardinal steps for height changes', () => {
  const neighbors = [], movements = new TowardMovements({})
  movements.getMoveDiagonal({ x: 0, y: 10, z: 0 }, { x: 1, z: 1 }, neighbors)
  assert.deepEqual(neighbors.map(p => p.y), [10])
})
test('moveToward walks up a step, keeps walking while airborne, and restores sprint on level ground', async () => {
  const f = fixture(); f.route[0].y = 11
  const running = f.run()
  assert.equal(f.bot.pathfinder.movements.allowSprinting, false)
  f.bot.entity.position.y = 10.7; f.bot.entity.onGround = false; f.bot.emit('physicsTick')
  assert.equal(f.bot.pathfinder.movements.allowSprinting, false)
  f.route.shift(); f.bot.entity.onGround = true; f.bot.emit('physicsTick')
  assert.equal(f.bot.pathfinder.movements.allowSprinting, true)
  f.arrive(); assert.equal((await running).reason, 'arrived'); clean(f.bot)
})
test('stationary successful path retries walking once and returns no_progress quickly despite jump jitter', async () => {
  const f = fixture(), t = performance.now()
  const jitter = setInterval(() => { f.bot.entity.position.y = f.bot.entity.position.y === 10 ? 11.2 : 10 }, 80)
  try {
    const result = await f.run()
    assert.equal(result.reason, 'no_progress'); assert.equal(result.pathStatus, 'success')
    assert.equal(result.walkingRetry, true); assert.equal(result.distanceReduced, 0)
    assert.equal(f.bot.pathfinder.changes, 2); assert.ok(performance.now() - t < 4000)
    clean(f.bot)
  } finally { clearInterval(jitter) }
})
test('unfinished search returns no_progress without claiming proven no_path', async () => {
  const f = fixture('partial'), result = await f.run()
  assert.equal(result.reason, 'no_progress'); assert.equal(result.pathStatus, 'partial')
  assert.equal(result.walkingRetry, false); clean(f.bot)
})
test('retreating along a detour counts as progress even if target distance increases', async () => {
  const f = fixture(), movement = setInterval(() => { f.bot.entity.position.x -= 0.5 }, 50)
  try {
    const result = await f.run(1000)
    assert.equal(result.reason, 'timeout'); assert.ok(result.distanceReduced < 0)
    assert.equal(result.walkingRetry, false); clean(f.bot)
  } finally { clearInterval(movement) }
})
test('planned digging time is allowed before diagnosing stationary movement', async () => {
  const f = fixture()
  f.bot.pathfinder.isMining = () => true; f.bot.targetDigBlock = {}; f.bot.digTime = () => 6000
  const result = await f.run(3100)
  assert.equal(result.reason, 'timeout'); assert.equal(result.walkingRetry, false); clean(f.bot)
})
test('cancellation removes watchdog, path and physics listeners', async () => {
  const f = fixture(), controller = new AbortController(), running = f.run(10000, controller.signal)
  controller.abort()
  await assert.rejects(running, e => e.code === 'CANCELLED' && e.details.reason === 'cancelled')
  clean(f.bot)
})


test('pathfinder goal_reached while bobbing in water is arrival even if the final floor moved below the goal', async () => {
  const f = fixture(), running = f.run(10000, new AbortController().signal, { x: 10, y: 10, z: 0 })
  f.bot.entity.position = new Vec3(9, 9, 0)
  assert.equal(f.bot.pathfinder.goal.isEnd(f.bot.entity.position.floored()), false)
  assert.equal(f.bot.pathfinder.goal.isEnd(f.bot.entity.position.floored().offset(0, 1, 0)), true)
  f.bot.emit('goal_reached', f.bot.pathfinder.goal); f.complete()
  assert.equal((await running).reason, 'arrived'); clean(f.bot)
})
