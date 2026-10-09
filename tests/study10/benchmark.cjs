const { monitorEventLoopDelay } = require('node:perf_hooks')
const { EventEmitter } = require('node:events')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const registry = require('minecraft-data')('1.20.1'), Chunk = require('prismarine-chunk')('1.20.1')
const { createBotApi } = require('../../planner_bot/src/api')
const wait = ms => new Promise(r => setTimeout(r, ms))
async function measure(api, options) {
  await wait(10)
  const lag = monitorEventLoopDelay({ resolution: 1 }); lag.enable()
  let heartbeats = 0, maxHeartbeatGapMs = 0, last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now(); maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - last); last = now; heartbeats++
  }, 1)
  const r = await api.observeTerrain(options)
  await wait(5); clearInterval(timer); lag.disable(); assert.equal(r.ok, true)
  return { result: r.data, stats: { durationMs: r.data.durationMs, maxDelayMs: lag.max / 1e6,
    p99DelayMs: lag.percentile(99) / 1e6, heartbeats, maxHeartbeatGapMs, reads: r.data.reads, cacheHits: r.data.cacheHits,
    complete: r.data.complete, unknownRatio: r.data.unknownRatio, jsonBytes: Buffer.byteLength(JSON.stringify(r.data)) } }
}
async function main() {
  const rows = []
  for (const radius of [32, 64, 96]) {
    const bot = new EventEmitter(), columns = new Map()
    Object.assign(bot, { version: '1.20.1', registry, game: { minY: -64, height: 384 }, entity: { position: { x: .5, y: 70, z: .5 } },
      world: { getColumn: (x, z) => columns.get(`${x},${z}`) } })
    for (let z = -7; z <= 7; z++) for (let x = -7; x <= 7; x++) {
      const c = new Chunk()
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        c.setBlockStateId({ x: lx, y: 60 + Math.floor(12 * Math.sin((x * 16 + lx) / 15)), z: lz }, registry.blocksByName.stone.defaultState)
      }
      columns.set(`${x},${z}`, c)
    }
    const api = createBotApi(bot)
    for (const condition of ['cold', 'warm', 'warm-repeat', 'move-1']) {
      if (condition === 'move-1') bot.entity.position.x++
      const m = await measure(api, { radius, maxMs: 10000 })
      assert.equal(m.result.complete, true); assert.equal(m.result.unknown, 0)
      rows.push({ radius, condition, ...m.stats }); console.log(JSON.stringify(rows.at(-1)))
    }
    bot.emit('end')
  }
  fs.writeFileSync(path.join(__dirname, 'benchmark.json'), JSON.stringify({ node: process.version, resolutionMs: 1, rows }, null, 2) + '\n')
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { measure }
