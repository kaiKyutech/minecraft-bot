const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const registry = require('minecraft-data')('1.20.1')
const Chunk = require('prismarine-chunk')('1.20.1')
const { createBotApi } = require('../../planner_bot/src/api')
function fixture() {
  const bot = new EventEmitter(), columns = new Map()
  Object.assign(bot, { version: '1.20.1', registry, game: { minY: -64, height: 384 }, entity: { position: new Vec3(.5, 4.8, .5) },
    world: { getColumn: (x, z) => columns.get(`${x},${z}`) } })
  bot.set = (x, y, z, name, emit = false) => {
    const key = `${Math.floor(x / 16)},${Math.floor(z / 16)}`
    let c = columns.get(key)
    if (!c) { c = new Chunk(); columns.set(key, c) }
    c.setBlockStateId(new Vec3(x & 15, y, z & 15), registry.blocksByName[name].defaultState)
    if (emit) bot.emit('blockUpdate', null, { position: new Vec3(x, y, z) })
  }
  bot.columns = columns
  return { bot, api: createBotApi(bot) }
}
const decoded = (d, i) => d.cells[i]?.map((v, n) => n % 2 ? d.names[v] : v) ?? null
test('terrain: tree, plants, water, lava, cliff, void and unloaded columns; floor and order', async () => {
  const { bot, api } = fixture()
  bot.set(-1, 2, -1, 'dirt'); bot.set(-1, 3, -1, 'oak_log'); bot.set(-1, 8, -1, 'oak_leaves')
  bot.set(0, -2, -1, 'sand'); bot.set(0, 0, -1, 'water'); bot.set(0, 1, -1, 'lily_pad')
  bot.set(1, -4, -1, 'stone'); bot.set(1, -1, -1, 'lava')
  bot.set(-1, 2, 0, 'grass_block'); bot.set(-1, 3, 0, 'tall_grass')
  bot.set(0, 20, 0, 'stone'); bot.set(0, 21, 0, 'snow')
  const r = await api.observeTerrain({ radius: 1, maxMs: 2000 }); assert.equal(r.ok, true)
  const d = r.data
  assert.deepEqual(d.center, { x: 0, y: 4, z: 0 }); assert.equal(d.complete, true)
  assert.deepEqual(decoded(d, 0), [2, 'dirt', 8, 'oak_leaves', null, null])
  assert.deepEqual(decoded(d, 1), [-2, 'sand', 1, 'lily_pad', 0, 'water'])
  assert.deepEqual(decoded(d, 2), [-4, 'stone', -1, 'lava', -1, 'lava'])
  assert.deepEqual(decoded(d, 3), [2, 'grass_block', 3, 'tall_grass', null, null])
  assert.deepEqual(decoded(d, 4), [20, 'stone', 21, 'snow', null, null])
  assert.deepEqual(decoded(d, 5), [null, null, null, null, null, null])
  bot.columns.delete('0,0'); bot.emit('chunkColumnUnload', new Vec3(0, 0, 0))
  const unloaded = await api.observeTerrain({ radius: 1 }); assert.equal(unloaded.data.cells[4], null)
  assert.ok(unloaded.data.unknownRatio > 0)
})
test('terrain: cache, single-column update, load/unload, respawn, movement and output isolation', async () => {
  const { bot, api } = fixture(); bot.set(0, 1, 0, 'stone')
  const a = await api.observeTerrain({ radius: 1 }), b = await api.observeTerrain({ radius: 1 })
  assert.equal(b.data.reads, 0); b.data.cells[4][0] = 999; b.data.names[1] = 'bad'
  assert.equal((await api.observeTerrain({ radius: 1 })).data.cells[4][0], 1)
  bot.set(0, 4, 0, 'dirt', true)
  assert.equal((await api.observeTerrain({ radius: 1 })).data.cells[4][0], 4)
  bot.set(0, 4, 0, 'air', true)
  assert.equal((await api.observeTerrain({ radius: 1 })).data.cells[4][0], 1)
  for (const event of ['chunkColumnLoad', 'chunkColumnUnload', 'respawn']) {
    bot.emit(event, new Vec3(0, 0, 0)); assert.ok((await api.observeTerrain({ radius: 1 })).data.reads > 0)
  }
  bot.entity.position.x = -1.1
  const moved = await api.observeTerrain({ radius: 1 }); assert.equal(moved.data.center.x, -2)
  assert.deepEqual(a.data.bounds, { minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: -64, maxY: 319 })
  bot.emit('end'); assert.equal(bot.listenerCount('blockUpdate'), 0)
})
test('terrain: budgets resume partial columns; cancellation and concurrent observations do not own actions', async () => {
  const { bot, api } = fixture(); bot.set(0, -64, 0, 'bedrock')
  const zero = await api.observeTerrain({ radius: 1, maxMs: 0 })
  assert.equal(zero.ok, true); assert.equal(zero.data.timedOut, true); assert.equal(zero.data.pending, 9)
  assert.deepEqual(zero.data.cells, Array(9).fill(null))
  let partial = await api.observeTerrain({ radius: 16, maxMs: 1 })
  assert.equal(partial.data.timedOut, true)
  const controller = new AbortController(); setImmediate(() => controller.abort())
  const cancelled = await api.observeTerrain({ radius: 64, maxMs: 2000, signal: controller.signal })
  assert.equal(cancelled.error.code, 'CANCELLED')
  assert.equal((await api.observeTerrain({ signal: AbortSignal.abort() })).error.code, 'CANCELLED')
  const results = await Promise.all([api.observeTerrain({ radius: 16, maxMs: 2000 }), api.observeTerrain({ radius: 16, maxMs: 2000 })])
  assert.deepEqual(results[0].data.cells, results[1].data.cells)
  assert.ok(results.every(r => r.data.complete))
  const { operationsFor } = require('../../planner_bot/src/executor/operation_manager')
  const operations = operationsFor(bot)
  let release, started
  const ready = new Promise(r => { started = r })
  const action = operations.run('test', async signal => { started(); await new Promise(r => { release = r }); assert.equal(signal.aborted, false) })
  await ready; await api.observeTerrain({ radius: 0 }); assert.equal(operations.busy(), true)
  release(); await action
})
test('terrain: invalidation during yield and changing dimension; argument validation and step', async () => {
  const { bot, api } = fixture(); bot.set(0, -64, 0, 'bedrock')
  setImmediate(() => { bot.set(0, 30, 0, 'stone', true); bot.emit('chunkColumnLoad', new Vec3(0, 0, 0)) })
  const r = await api.observeTerrain({ radius: 16, maxMs: 2000 })
  assert.equal(r.data.complete, true)
  assert.equal((await api.observeTerrain({ radius: 0 })).data.cells[0][0], 30)
  const step = await api.observeTerrain({ radius: 4, step: 3 })
  assert.equal(step.data.width, 3); assert.equal(step.data.bounds.maxX, 2)
  for (const params of [null, { radius: 129 }, { radius: 1.2 }, { step: 0 }, { maxMs: Infinity }, { signal: {} }]) {
    assert.equal((await api.observeTerrain(params)).error.code, 'INVALID_ARGUMENT')
  }
  bot.emit('respawn'); bot.game = { minY: 0, height: 16 }; bot.columns.clear(); bot.set(0, 3, 0, 'dirt')
  assert.equal((await api.observeTerrain({ radius: 0 })).data.bounds.maxY, 15)
  bot.world = null
  assert.equal((await api.observeTerrain()).error.code, 'BOT_NOT_READY')
})
test('terrain: unloaded grids yield too, and an in-flight dimension transition rejects mixed bounds', async () => {
  const { bot, api } = fixture()
  let heartbeat = false
  setImmediate(() => { heartbeat = true })
  const unknown = await api.observeTerrain({ radius: 128, maxMs: 2000 })
  assert.equal(unknown.data.unloaded, 66049); assert.equal(unknown.data.complete, true)
  assert.equal(heartbeat, true)
  bot.set(0, -64, 0, 'bedrock')
  setImmediate(() => { bot.game = { minY: 0, height: 256 }; bot.emit('respawn') })
  const transitioned = await api.observeTerrain({ radius: 128, maxMs: 2000 })
  assert.equal(transitioned.error.code, 'BOT_NOT_READY')
})
