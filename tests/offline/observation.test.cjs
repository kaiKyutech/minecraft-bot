const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const createStateManager = require('../../planner_bot/src/planner/state_manager');
test('independent observation does not publish execution cache or change refresh flags', async () => {
  const sm = createStateManager(), previous = { marker: 'execution' };
  sm.cache = previous; sm.silentRefresh = true;
  sm.extractNearbyBlocks = async () => ({ flags: {}, summary: {}, blocks: { list: [] } });
  const world = await sm.observe({ entity: { position: new Vec3(0, 1, 0) } });
  assert.equal(sm.cache, previous);
  assert.equal(sm.silentRefresh, true);
  assert.deepEqual(world.inventory.counts, {});
});
test('out-of-order refreshes return their own observation and never roll published cache back', async () => {
  const sm = createStateManager(); sm.silentRefresh = true;
  const pending = [];
  sm.observe = () => new Promise(resolve => pending.push(resolve));
  const a = sm.refresh({}), b = sm.refresh({});
  pending[1]({ marker: 'new' }); assert.deepEqual(await b, { marker: 'new' });
  pending[0]({ marker: 'old' }); assert.deepEqual(await a, { marker: 'old' });
  assert.deepEqual(sm.cache, { marker: 'new' });
  const c = sm.refresh({}); sm.clear(); pending[2]({ marker: 'before clear' }); await c;
  assert.equal(sm.cache, null);
});
