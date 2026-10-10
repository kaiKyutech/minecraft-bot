process.env.LOG_LEVEL = 'error'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict')
const { states, goals } = require('../study04/benchmark.cjs')
const { makePlanner, replay } = require('../study04/harness.cjs')
const goap = require('../../planner_bot/src/planner/goap'), service = require('../../planner_bot/src/planner/planning_service')
const baseline = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'baseline-1201.json.gz'))))
const version = process.argv[2] || '1.20.1', output = path.resolve(__dirname, '../../.cache/minecraft-bot/14-study')
const expected = version === '1.21.4' ? JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'expected-1214.json.gz')))) : baseline
const clean = value => JSON.parse(JSON.stringify(value))
function rename(value) {
  if (Array.isArray(value)) return value.map(rename)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k === 'grass' ? 'short_grass' : k, rename(v)]))
  return value === 'grass' ? 'short_grass' : value
}
async function main() {
  fs.mkdirSync(output, { recursive: true })
  const prep = performance.now(); await goap.prepareDomain(version)
  const rows = [], solver = makePlanner({ production: true }), preparationMs = performance.now() - prep
  let exact = 0, ticks = 0, tickAt = performance.now(), maxPauseMs = 0
  const timer = setInterval(() => { const now = performance.now(); maxPauseMs = Math.max(maxPauseMs, now - tickAt); tickAt = now; ticks++ }, 10)
  try {
    for (const state of states()) {
      const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(state.file))), world = version === '1.21.4' ? rename(raw) : raw
      const before = JSON.stringify(world)
      for (const goal of goals) {
        const r = await solver.run(goal, world, { version, worker: false })
        assert.equal(r.thrown, undefined)
        if (r.result.plan) assert.equal(replay(goal, world, r.result.plan).valid, true)
        const worker = await goap.plan(goal, world, null, { version, worker: true })
        assert.deepEqual(clean(worker), clean(r.result), `${state.name}/${goal} worker differs`)
        assert.deepEqual(goap.getPlanFailure(worker), r.planningFailure)
        const row = { state: state.name, goal, plan: r.result.plan, diagnosis: r.result.diagnosis, reason: r.reason,
          planningFailure: r.planningFailure, iterations: r.metrics.iterations, cost: r.result.plan?.reduce((n,s) => n+s.cost,0) ?? null, durationMs: r.durationMs }
        {
          const old = expected.rows.find(x => x.state === row.state && x.goal === goal)
          assert.ok(old)
          for (const key of ['plan','diagnosis','reason','planningFailure','iterations','cost']) assert.deepEqual(clean(row[key]), clean(old[key]), `${state.name}/${goal}/${key} changed`)
          exact++
        }
        rows.push(row)
      }
      assert.equal(JSON.stringify(world), before)
      console.log(version, state.name, 'verified main/worker')
    }
  } finally { clearInterval(timer); await service.close() }
  const summary = {}; for (const row of rows) summary[row.reason] = (summary[row.reason] || 0) + 1
  const differences = rows.filter(r => Boolean(r.plan) !== Boolean(baseline.rows.find(b => b.state === r.state && b.goal === r.goal).plan))
    .map(r => ({ state:r.state, goal:r.goal, before:baseline.rows.find(b=>b.state===r.state&&b.goal===r.goal).reason, after:r.reason }))
  const result = { version, base:baseline.base, preparationMs, exact, actions:goap.getAllActions().length, summary, differences, ticks, maxPauseMs, rows }
  fs.writeFileSync(path.join(output, `matrix-${version}.json`), JSON.stringify(result,null,2))
  console.log(JSON.stringify({version,exact,summary,actions:result.actions,differences}))
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
module.exports = { rename }
