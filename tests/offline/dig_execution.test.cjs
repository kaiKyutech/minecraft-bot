const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { digBlock } = require('../../planner_bot/src/primitives');
const { withContext } = require('../../planner_bot/src/utils/context');
const wait = ms => new Promise(r => setTimeout(r, ms));
function botFixture(onGround) {
  const bot = new EventEmitter();
  Object.assign(bot, { entity: { onGround }, blockAt: p => ({ name: 'stone', position: p }),
    canDigBlock: () => true, digTime: () => bot.entity.onGround ? 1150 : 5650,
    logWriter: () => {}, calls: [], async dig() { bot.calls.push({onGround: bot.entity.onGround, predictedMs: bot.digTime()}); } });
  return bot;
}
test('D1 starts after a short fall, with the grounded dig time', async () => {
  const bot = botFixture(false);setTimeout(() => {bot.entity.onGround=true;}, 80);
  await digBlock(bot, {position:new Vec3(0,10,0)});
  assert.deepEqual(bot.calls, [{onGround:true,predictedMs:1150}]);
});
test('D1 sustained non-grounded mining is bounded and retains mineflayer timing', async () => {
  const bot = botFixture(false), t=Date.now();await digBlock(bot, {position:new Vec3(0,10,0)});
  assert.ok(Date.now()-t>=1000&&Date.now()-t<1600);assert.deepEqual(bot.calls,[{onGround:false,predictedMs:5650}]);
});
test('D1 cancellation while waiting cannot start digging later', async () => {
  const bot=botFixture(false),controller=new AbortController();setTimeout(()=>controller.abort(),50);
  await assert.rejects(withContext({bot,signal:controller.signal},()=>digBlock(bot,{position:new Vec3(0,10,0)})),{code:'CANCELLED'});
  await wait(80);assert.equal(bot.calls.length,0);
});
