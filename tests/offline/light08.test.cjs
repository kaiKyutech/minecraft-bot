const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const { lightInfo } = require('../../planner_bot/src/utils/light_info')
const { createBotApi } = require('../../planner_bot/src/api')

function fixture() {
  const blocks = new Map(), bot = new EventEmitter()
  Object.assign(bot, { version: '1.20.1', entity: { position: new Vec3(0.5, 10, 0.5), yaw: 0, pitch: 0 },
    game: { minY: 0, height: 30 }, entities: {},
    blockAt: p => blocks.get(p.floored().toString()) ?? { name: 'air', light: 0, skyLight: 0, transparent: true },
    stateManager: { extractInventory: () => ({ counts: {} }), extractEquipment: () => ({}) } })
  return { bot, blocks, put: (x,y,z,name,light=0,skyLight=0) => blocks.set(new Vec3(x,y,z).toString(), { name, light, skyLight }) }
}
test('light retains raw values and combines block/sky with strict darkness threshold', () => {
  const f = fixture()
  assert.deepEqual(lightInfo(f.bot), { block: 0, sky: 0, level: 0, dark: true, torchNearby: false })
  f.put(0,11,0,'air',8,0)
  assert.equal(lightInfo(f.bot).dark, false)
  f.put(0,11,0,'air',0,15)
  assert.equal(lightInfo(f.bot).level, 15)
  f.bot.time = { timeOfDay: 18000 }
  assert.equal(lightInfo(f.bot).level, 15) // raw skylight; intentionally no time correction
  assert.equal(lightInfo(f.bot,{darkBelow:16}).dark, true)
})
test('floor and wall torches override delayed zero light; radius ignores other emitters', () => {
  const f = fixture()
  for (const name of ['torch','wall_torch']) {
    f.put(3,10,4,name)
    assert.deepEqual(lightInfo(f.bot), { block: 0, sky: 0, level: 0, dark: false, torchNearby: true })
    assert.equal(lightInfo(f.bot,{torchRadius:4}).dark,true)
  }
  f.put(3,10,4,'soul_torch')
  assert.equal(lightInfo(f.bot).torchNearby,false)
})
test('unloaded light and torch searches remain unknown instead of inventing darkness', () => {
  const f = fixture(), original = f.bot.blockAt
  f.bot.blockAt = p => p.floored().x === -1 ? null : original(p)
  assert.equal(lightInfo(f.bot).torchNearby,null)
  assert.equal(lightInfo(f.bot).dark,null)
  f.put(1,10,0,'torch')
  assert.equal(lightInfo(f.bot).dark,false)
  f.bot.blockAt = () => null
  assert.deepEqual(lightInfo(f.bot), { block:null,sky:null,level:null,dark:null,torchNearby:null })
})
test('fast observation detects new torches even with zero resource budget and validates light options', async () => {
  const f = fixture(), api = createBotApi(f.bot)
  const params = { range:1,maxChecks:0,maxMs:0 }
  assert.equal((await api.observeFast(params)).data.light.dark,true)
  f.put(1,10,0,'wall_torch')
  const result = await api.observeFast(params)
  assert.equal(result.ok,true)
  assert.equal(result.data.light.torchNearby,true)
  assert.equal(result.data.light.dark,false)
  assert.equal(result.data.totalChecks,0)
  for (const bad of [{darkBelow:-1},{darkBelow:1.5},{torchRadius:9},{torchRadius:NaN}])
    assert.equal((await api.observeFast(bad)).error.code,'INVALID_ARGUMENT')
})
