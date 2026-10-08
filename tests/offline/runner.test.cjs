const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { load } = require('../helpers/module');
function fixture(plan, execute = async () => {}) {
  const calls = [], world = { inventory: { counts: {} }, nearby_blocks: {}, nearby: {}, equipment: {}, inventory_space: true };
  const run = load(path.resolve(__dirname, '../../planner_bot/src/executor/goal_runner.js'), {
    '../planner/goap': { prepareDomain: async () => calls.push('prepare'), getAllActions: () => [], plan: async goal => { calls.push(goal); return plan(goal, world); } },
    '../executor/goap_executor': { executePlanWithReplanning: async (bot, goal) => execute(goal, world) }
  });
  const bot = { systemLog() {}, shouldLogCommand: () => false, version: '1.20.1' };
  const sm = { refresh: async () => {}, getState: async () => world };
  return { run: (goal, ...args) => run(bot, 'Peer', goal, sm, ...args), calls, world };
}
test('goal runner preserves quantity reduction followed by the remaining quantity', async () => {
  const f = fixture(goal => goal.endsWith(':3') ? { plan: null, diagnosis: {} } : { plan: [] }, (goal, world) => { world.inventory.counts.oak_log = (world.inventory.counts.oak_log || 0) + Number(goal.split(':')[1]); });
  await f.run('inventory.oak_log:3', null, 0, 10, null, null, false);
  assert.deepEqual(f.calls.filter(x => x !== 'prepare'), ['inventory.oak_log:3', 'inventory.oak_log:1', 'inventory.oak_log:2']);
  assert.equal(f.world.inventory.counts.oak_log, 3);
});
test('runner retains depth/cycle metadata and unsatisfied goal diagnostics', async () => {
  const f = fixture(() => ({ plan: null, diagnosis: { error: 'unknown target' } }));
  await assert.rejects(f.run('inventory.x:1', null, 0, 10, null, null, false), error => error.needsLLM === true && error.diagnosis.error === 'unknown target');
  await assert.rejects(f.run('inventory.x:1', null, 0, 10, [], new Set(['inventory.x:1']), false), error => error.reason === 'circular_dependency');
  await assert.rejects(f.run('inventory.x:1', null, 10, 10, [], new Set(), false), error => error.reason === 'max_depth_reached');
});
