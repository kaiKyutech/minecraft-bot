process.env.LOG_LEVEL = 'error'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict')
const { states, goals } = require('../study04/benchmark.cjs')
const { makePlanner, replay } = require('../study04/harness.cjs')
const goap = require('../../planner_bot/src/planner/goap')
async function main() {
  await goap.prepareDomain('1.20.1')
  const mode = process.argv[2] || 'compare'
  const solvers = {
    before:makePlanner({production:true,sourceText:require('node:child_process').execFileSync('git',['show','bee3d1c:planner_bot/src/planner/goap.js'],{encoding:'utf8',cwd:path.resolve(__dirname,'../..')})}),
    after:makePlanner({production:true})
  }, output={before:[],after:[]}
  const selected=mode==='compare'?['before','after']:[mode]
  const warm=JSON.parse(zlib.gunzipSync(fs.readFileSync(states()[0].file)))
  for(const phase of selected)await solvers[phase].run('inventory.stick:4',warm)
  for (const state of states()) {
    const world = JSON.parse(zlib.gunzipSync(fs.readFileSync(state.file))), original = JSON.stringify(world)
    for (const goal of goals) for (let repeat = 0; repeat < 2; repeat++) for(const phase of repeat?[...selected].reverse():selected){
      const r = await solvers[phase].run(goal, world)
      assert.equal(r.thrown, undefined)
      if (r.result.plan) assert.equal(replay(goal, world, r.result.plan).valid, true)
      output[phase].push({ state: state.name, goal, repeat, plan: r.result.plan, cost: r.result.plan?.reduce((n,s) => n+s.cost,0) ?? null,
        iterations: r.metrics.iterations, durationMs: r.durationMs, reason: r.reason })
    }
    assert.equal(JSON.stringify(world), original)
    console.log(state.name, 'checked')
  }
  for(const phase of selected)fs.writeFileSync(path.join(__dirname, `${phase}.json`), JSON.stringify({ base: 'bee3d1c', phase, node:process.version, model:phase==='after'?require('../../planner_bot/src/planner/gather_cost').MODEL:null, cases: output[phase].length / 2, rows:output[phase] }, null, 2))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
