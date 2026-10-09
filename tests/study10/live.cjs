process.env.LOG_LEVEL = 'error'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process'), { once } = require('node:events'), { Vec3 } = require('vec3')
const { createAIBot, createBotApi } = require('../../planner_bot/api')
const { measure } = require('./benchmark.cjs')
const { clearTerrainCache } = require('../../planner_bot/src/planner/terrain_observation')
const root = path.resolve(__dirname, '../..'), server = path.join(root, '.cache/minecraft-bot/10-study/server')
const wait = ms => new Promise(r => setTimeout(r, ms))
function rcon(...commands) {
  return execFileSync(process.execPath, [path.resolve(root, '../minecraft-agent-jev/tools/rcon.mjs'), ...commands],
    { env: { ...process.env, RCON_PROPERTIES: path.join(server, 'server.properties') }, encoding: 'utf8', timeout: 30000 })
}
async function main() {
  if (process.argv[2] === 'stop') { rcon('save-all', 'stop'); return }
  const username = 'Terrain10' + Date.now().toString(36).slice(-6)
  const bot = createAIBot(1, { host: '127.0.0.1', port: 25569, username, version: '1.20.1', aiBotCount: 1 }, { autoHandleWhisper: false })
  const api = createBotApi(bot, { logLevel: 'error' }), report = { node: process.version, port: 25569, rconPort: 25579, rows: [], samples: [], concurrent: [] }
  let timer
  try {
    await Promise.race([once(bot, 'spawn'), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('spawn timeout')), 30000) })]); clearTimeout(timer)
    bot.logWriter = () => {}
    rcon('time set 6000', 'weather clear', 'gamerule randomTickSpeed 0', `clear ${username}`, `tp ${username} -4.5 69 16.5`)
    await wait(4000); bot.physicsEnabled = false
    let map
    for (const radius of [32, 64, 96]) {
      clearTerrainCache(bot)
      for (const condition of ['cold', 'warm', 'warm-repeat', 'move-1']) {
        if (condition === 'move-1') { rcon(`tp ${username} -3.5 69 16.5`); await wait(500) }
        const m = await measure(api, { radius, maxMs: 10000 }); assert.equal(m.result.complete, true)
        report.rows.push({ radius, condition, ...m.stats }); console.log(JSON.stringify(report.rows.at(-1)))
        if (radius === 96 && condition === 'cold') map = m.result
      }
      rcon(`tp ${username} -4.5 69 16.5`); await wait(500)
    }
    const found = []
    for (let i = 0; i < map.cells.length; i++) {
      const c = map.cells[i]; if (!c) continue
      found.push({ x: map.bounds.minX + i % map.width, z: map.bounds.minZ + Math.floor(i / map.width),
        groundY: c[0], ground: map.names[c[1]], topY: c[2], top: map.names[c[3]], fluidY: c[4], fluid: map.names[c[5]] })
    }
    const peak = found.filter(c => c.groundY !== null).sort((a, b) => b.groundY - a.groundY)[0]
    const waters = found.filter(c => c.fluid === 'water'), lake = waters.sort((a, b) => Math.hypot(a.x + 4, a.z - 16) - Math.hypot(b.x + 4, b.z - 16))[0]
    assert.ok(peak); assert.ok(lake); report.peak = peak; report.waterColumns = waters.length; report.lake = lake
    // Independent blockAt top-down comparisons, outside timing windows. Verify height by
    // absence above it and verify exact block names against server RCON as well.
    const candidates = [peak, lake, ...found.filter(c => c.top?.endsWith('_leaves')).slice(0, 4)]
    for (const c of candidates) {
      let actualTop
      for (let y = bot.game.minY + bot.game.height - 1; y >= bot.game.minY; y--) {
        const b = bot.blockAt(new Vec3(c.x, y, c.z), false)
        if (b && !['air', 'cave_air', 'void_air'].includes(b.name)) { actualTop = { y, name: b.name }; break }
      }
      assert.deepEqual(actualTop, { y: c.topY, name: c.top })
      assert.equal(bot.blockAt(new Vec3(c.x, c.groundY, c.z), false).name, c.ground)
      if (c.fluid) assert.equal(bot.blockAt(new Vec3(c.x, c.fluidY, c.z), false).name, c.fluid)
      const marker = `terrain10_${report.samples.length}_${Date.now()}`
      rcon(`execute if block ${c.x} ${c.groundY} ${c.z} minecraft:${c.ground} if block ${c.x} ${c.topY} ${c.z} minecraft:${c.top} run say ${marker}`)
      assert.ok(fs.readFileSync(path.join(server, 'logs/latest.log'), 'utf8').includes(`[Rcon] ${marker}`))
      report.samples.push({ ...c, topScanMatched: true, serverConfirmed: true })
    }
    // Compare movement and GOAP windows with/without terrain polling on this isolated copy.
    bot.physicsEnabled = true
    for (const polling of [false, true]) {
      rcon(`tp ${username} -4.5 69 16.5`); await wait(1000)
      clearTerrainCache(bot); let running = true, calls = 0, maxTerrainMs = 0
      const { monitorEventLoopDelay } = require('node:perf_hooks')
      const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable(); await wait(100); lag.reset()
      const loop = polling ? (async () => { while (running) {
        const r = await api.observeTerrain({ radius: 96, maxMs: 1000 }); assert.equal(r.ok, true)
        calls++; maxTerrainMs = Math.max(maxTerrainMs, r.data.durationMs); await wait(100)
      } })() : Promise.resolve()
      const moved = await api.moveToward({ x: 5, z: 16 }, { maxMs: 5000 })
      running = false; await loop; lag.disable()
      assert.equal(moved.ok, true); assert.ok(moved.data.distanceReduced > 0)
      report.concurrent.push({ kind: 'move', polling, calls, maxTerrainMs, maxDelayMs: lag.max / 1e6, p99DelayMs: lag.percentile(99) / 1e6, result: moved.data })
    }
    // A known inventory recipe exercises real planning/execution without mining altering the map.
    await api.planGoal('inventory.stick:4')
    for (const polling of [false, true]) {
      rcon(`clear ${username}`, `give ${username} oak_planks 8`); await wait(500)
      clearTerrainCache(bot); let running = true, calls = 0
      const { monitorEventLoopDelay } = require('node:perf_hooks'), lag = monitorEventLoopDelay({ resolution: 10 })
      lag.enable(); await wait(100); lag.reset()
      const loop = polling ? (async () => { while (running) {
        assert.equal((await api.observeTerrain({ radius: 96, maxMs: 1000 })).ok, true); calls++; await wait(100)
      } })() : Promise.resolve()
      const start = performance.now(), result = await api.executeGoal('inventory.stick:4', { signal: AbortSignal.timeout(30000) })
      const durationMs = performance.now() - start
      running = false; await loop; lag.disable(); assert.equal(result.ok, true)
      report.concurrent.push({ kind: 'goap-sticks', polling, calls, durationMs, windowMs: performance.now() - start,
        maxDelayMs: lag.max / 1e6, p99DelayMs: lag.percentile(99) / 1e6, result,
        sticks: bot.inventory.items().filter(i => i.name === 'stick').reduce((n, i) => n + i.count, 0) })
    }
    rcon(`clear ${username}`, `tp ${username} -4.5 69 16.5`); await wait(800)
    clearTerrainCache(bot)
    let running = true, calls = 0
    const { monitorEventLoopDelay } = require('node:perf_hooks'), lag = monitorEventLoopDelay({ resolution: 10 })
    const progress = []
    lag.enable()
    const loop = (async () => { while (running) {
      const observed = await api.observeTerrain({ radius: 96, maxMs: 1000 }); assert.equal(observed.ok, true)
      calls++; await wait(100)
    } })()
    const start = performance.now(), result = await api.executeGoal('inventory.category.log:4', {
      signal: AbortSignal.timeout(120000), onProgress: e => progress.push({ type: e.type, atMs: performance.now() - start })
    })
    const durationMs = performance.now() - start
    running = false; await loop; lag.disable()
    report.concurrent.push({ kind: 'goap-gather-logs', polling: true, calls, durationMs, maxDelayMs: lag.max / 1e6,
      p99DelayMs: lag.percentile(99) / 1e6, result, progress,
      logs: bot.inventory.items().filter(i => i.name.endsWith('_log')).reduce((n, i) => n + i.count, 0) })
    assert.equal(result.ok, true)
    fs.writeFileSync(path.join(__dirname, 'live-results.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ peak, lake, waterColumns: waters.length, concurrent: report.concurrent }))
  } finally {
    clearTimeout(timer); await api.stop(); bot.quit()
  }
}
main().then(() => process.exit(0), e => { console.error(e.stack); process.exit(1) })
