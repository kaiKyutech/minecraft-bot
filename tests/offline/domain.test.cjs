const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/module');

test('domain preparation is shared, retries failures and rejects another version', async () => {
  const scratch = path.resolve(__dirname, '../../.cache/minecraft-bot/domain-test');
  fs.mkdirSync(scratch, { recursive: true });
  const cache = fs.mkdtempSync(path.join(scratch, 'run-'));
  let failed = false, gathers = 0;
  const write = (dir, name, skill) => fs.writeFileSync(path.join(dir, name), JSON.stringify({ actions: [{ name, skill, effects: {}, preconditions: {}, cost: 1 }] }));
  const domain = load(path.resolve(__dirname, '../../planner_bot/src/planner/domain.js'), {
    path: { ...path, resolve: (...args) => args.at(-1) === '../../../.cache/minecraft-bot/actions' ? cache : path.resolve(...args) },
    './gather_generator': { ensureGatherActionsGenerated: async (version, dir) => {
      gathers++; if (!failed) { failed = true; throw new Error('simulated write failure'); }
      write(dir, 'gather_auto.yaml', 'gather');
    } },
    './craft_generator': { ensureCraftActionsGenerated: async (version, dir) => {
      write(dir, 'hand_craft_auto.yaml', 'hand_craft'); write(dir, 'workbench_craft_auto.yaml', 'workbench_craft');
    } },
    './equipment_generator': { ensureEquipmentActionsGenerated: async (version, dir) => write(dir, 'equipment_auto.yaml', 'equip_mainhand') }
  });
  const logger = { info() {}, error() {} };
  assert.throws(() => domain.loadDomain(), { code: 'DOMAIN_NOT_READY' });
  await assert.rejects(domain.prepareDomain('1.20.1', logger), { code: 'DOMAIN_PREPARATION_FAILED' });
  const a = domain.prepareDomain('1.20.1', logger), b = domain.prepareDomain('1.20.1', logger);
  assert.equal(a, b);
  const prepared = await a;
  assert.equal(domain.loadDomain(), prepared);
  assert.equal(gathers, 2);
  assert.deepEqual(prepared.actions.slice(0, 4).map(x => x.name), ['equipment_auto.yaml', 'gather_auto.yaml', 'hand_craft_auto.yaml', 'workbench_craft_auto.yaml']);
  await assert.rejects(domain.prepareDomain('1.19.4', logger), { code: 'VERSION_CONFLICT' });
  assert.equal(domain.loadDomain(), prepared);
});

test('planning prepares generated actions without changing tracked YAML and keeps concurrent results isolated', async () => {
  const planner = require('../../planner_bot/src/planner/goap');
  const dir = path.resolve(__dirname, '../../planner_bot/config/actions_generated');
  const before = Object.fromEntries(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]));
  const state = { inventory: { counts: { oak_log: 1 } }, nearby_blocks: {}, nearby: {}, equipment: {}, inventory_space: true };
  const logs = [[], []];
  const logger = i => ({ info: x => logs[i].push(String(x)), warn: x => logs[i].push(String(x)), error: x => logs[i].push(String(x)) });
  const results = await Promise.all([planner.plan('inventory.stick:4', state, logger(0)), planner.plan('inventory.oak_planks:4', state, logger(1))]);
  assert.ok(results.every(x => Array.isArray(x.plan)));
  for (const [name, bytes] of Object.entries(before)) assert.deepEqual(fs.readFileSync(path.join(dir, name)), bytes);
  const isolated = await planner.plan('inventory.stick:4', state, logger(0));
  assert.deepEqual(results[0], isolated);
  assert.ok(logs[0].some(x => x.includes('inventory.stick')));
  assert.ok(logs[1].some(x => x.includes('inventory.oak_planks')));
});
