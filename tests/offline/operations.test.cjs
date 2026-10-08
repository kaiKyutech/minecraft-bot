const { test } = require('node:test');
const assert = require('node:assert/strict');
const { operationsFor } = require('../../planner_bot/src/executor/operation_manager');
const { interruptible, withContext } = require('../../planner_bot/src/utils/context');
const tick = () => new Promise(setImmediate);
function fixture() {
  const events = [];
  const bot = { pathfinder: { setGoal: x => events.push(['goal', x]) }, stopDigging: () => events.push('stopDigging') };
  return { bot, events, manager: operationsFor(bot) };
}
test('replacement waits for old work, drops superseded requests, and cannot erase the latest controller', async () => {
  const { bot, manager, events } = fixture(); let finish;
  const a = manager.run('goal', async () => { events.push('a-start'); await interruptible(bot, () => new Promise(resolve => { finish = resolve; })); events.push('a-after'); }).catch(e => e);
  await tick(); const old = bot.currentAbortController;
  const b = manager.run('skill', async () => events.push('b-start')).catch(e => e);
  const c = manager.run('move', async () => { events.push('c-start'); bot.pathfinder.setGoal('c'); });
  assert.equal(old.signal.aborted, true); assert.equal(events.includes('c-start'), false);
  finish(); assert.equal((await a).code, 'CANCELLED'); assert.equal((await b).code, 'CANCELLED'); await c;
  assert.equal(events.includes('a-after'), false); assert.equal(events.includes('b-start'), false);
  assert.deepEqual(events.at(-1), ['goal', 'c']); old.abort(); assert.deepEqual(events.at(-1), ['goal', 'c']);
});
test('an already-aborted request does not stop existing work; managers are per bot', async () => {
  const a = fixture(), b = fixture(); let finish;
  const existing = a.manager.run('goal', () => new Promise(resolve => { finish = resolve; })); await tick();
  const signal = AbortSignal.abort(); await assert.rejects(a.manager.run('move', () => {}, { signal }), { code: 'CANCELLED' });
  assert.equal(a.bot.currentAbortController.signal.aborted, false);
  await b.manager.stop(); assert.equal(a.bot.currentAbortController.signal.aborted, false); finish(); await existing;
});
test('stop invalidates queued chest continuations, drains the transfer, and closes its container', async () => {
  const { manager, bot, events } = fixture();
  await manager.run('chestOpen', async () => { bot.currentChest = { close: () => events.push('close') }; });
  let finish;
  const deposit = manager.continueChest(() => new Promise(resolve => { finish = resolve; })).catch(e => e);
  await tick(); const queued = manager.continueChest(() => events.push('withdraw')).catch(e => e);
  const stop = manager.stop(); finish(); assert.equal((await deposit).code, 'CANCELLED'); assert.equal((await queued).code, 'CANCELLED');
  await stop; assert.equal(events.includes('withdraw'), false); assert.equal(events.at(-1), 'close'); assert.equal(bot.currentChest, null);
});
test('aborted container creation closes the returned handle and never proceeds to transfer', async () => {
  const { bot } = fixture(); const controller = new AbortController(); let closed = false;
  await assert.rejects(withContext({ bot, signal: controller.signal }, () => interruptible(bot, async () => { controller.abort(); return { close: () => { closed = true; } }; }, handle => handle.close())), { code: 'CANCELLED' });
  assert.equal(closed, true);
});
test('external abort stops a persistent follow after its start has returned', async () => {
  const { bot, manager } = fixture(); const controller = new AbortController();
  await manager.run('follow', async () => { bot.followTarget = 'Peer'; }, { signal: controller.signal });
  assert.equal(manager.busy(), true); controller.abort(); await manager.tail;
  assert.equal(bot.followTarget, null); assert.equal(manager.busy(), false);
});
test('external abort drains a chest transfer and closes a legacy container', async () => {
  const {bot,manager,events}=fixture();const controller=new AbortController();let finish;
  bot.currentChest={close:()=>events.push('close')};
  const running=manager.continueChest(()=>new Promise(resolve=>{finish=resolve}),{signal:controller.signal}).catch(e=>e);
  await tick();controller.abort();finish();assert.equal((await running).code,'CANCELLED');
  assert.equal(bot.currentChest,null);assert.equal(manager.busy(),false);assert.equal(events.at(-1),'close');
});
