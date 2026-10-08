require('node:test').before(() => require('../../planner_bot/src/planner/goap').prepareDomain('1.20.1'));
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { buildState, loadBlockCategories } = require('../../planner_bot/src/planner/state_builder');
const createStateManager = require('../../planner_bot/src/planner/state_manager');
const { getStateValue, analyseStepPreconditions } = require('../../planner_bot/src/executor/precondition_checker');
test('category log counts and equipment map retain actual item names',()=> {
  const state=buildState({inventory:{counts:{oak_log:2,birch_log:3,wooden_pickaxe:1}},equipment:{mainhand:'wooden_pickaxe',helmet:'iron_helmet'},inventory_space:false,nearby_blocks:{},nearby:{stone:2,category:{basic_stone:2}}});
  assert.equal(state.inventory.category.log,5); assert.equal(state.inventory.category.pickaxe,true);
  assert.equal(state.equipment.wooden_pickaxe,true); assert.equal(state.equipment.iron_helmet,true);
  assert.equal(state.inventory_space,false); assert.equal(state.nearby.category.basic_stone,2);
});
test('dropped entity detection is horizontal and has a 16 block radius',()=> {
  const world={position:{x:0,y:0,z:0},inventory:{counts:{}},entities:{a:{name:'item',position:{x:16,y:100,z:0}}}};
  assert.equal(buildState(world).nearby_drops,true);
  world.entities.a.position.x=17; assert.equal(buildState(world).nearby_drops,false);
});
test('state manager aggregates slots, copies position, caches until clear',async()=> {
  const sm=createStateManager();sm.silentRefresh=true;
  let calls=0;sm.extractNearbyBlocks=async()=>{calls++;return {flags:{},summary:{stone:2},blocks:{list:[],summary:{stone:2}}};};
  const bot={inventory:{items:()=>[{name:'oak_log',count:2},{name:'oak_log',count:3}],slots:[],emptySlotCount:()=>0},entity:{position:new Vec3(1,2,3)},time:{isDay:false}};
  const first=await sm.getState(bot); assert.equal(first.inventory.counts.oak_log,5);assert.equal(first.inventory_space,false);
  assert.notEqual(first.position,bot.entity.position);assert.equal(first.isDay,false);
  assert.equal(await sm.getState(bot),first);assert.equal(calls,1);
  sm.clear();await sm.getState(bot);assert.equal(calls,2);
});
test('locations floor coordinates and shallow-copy registry',()=> {
  const sm=createStateManager();sm.registerLocation('home',{x:1.9,y:-2.1,z:3.3});
  assert.deepEqual(sm.getLocation('home'),{x:1,y:-3,z:3});assert.equal(sm.getLocation('missing'),null);
  const locations=sm.getLocations();delete locations.home;assert.ok(sm.getLocation('home'));
});
test('category configuration remains available and stable by identity',()=>assert.equal(loadBlockCategories(),loadBlockCategories()));
test('nested state accessor returns undefined for absent key',()=> {
  assert.equal(getStateValue({inventory:{category:{log:3}}},'inventory.category.log'),3);
  assert.equal(getStateValue({},'inventory.category.log'),undefined);
});
test('unknown action is accepted by current runtime precondition checker',async()=> {
  const result=await analyseStepPreconditions({}, {action:'not-in-domain'}, {getState:async()=>({inventory:{counts:{}}})});
  assert.equal(result.satisfied,true);assert.deepEqual(result.missing,[]);
});
