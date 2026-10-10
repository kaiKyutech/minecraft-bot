const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const planner = require('../../planner_bot/src/planner/goap');
const { buildState } = require('../../planner_bot/src/planner/state_builder');
const { clean } = require('../helpers/live');
const dir = path.resolve(__dirname,'../fixtures');
const logger = { info(){}, warn(){}, error(){} };
for (const name of fs.readdirSync(dir).filter(x => x.endsWith('-plans.json'))) {
  const label = name.replace('-plans.json','');
  const state = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,`${label}.json.gz`))));
  const expected = JSON.parse(fs.readFileSync(path.join(dir,name)));
  for (const [goal, result] of Object.entries(expected)) {
    test(`${label}: historical count-only plan and full observation validity for ${goal}`, async () => {
      const before = clean(state);
      // Task 12 intentionally changes geometric costs. Keep the original golden
      // as the count-only domain contract; do not adopt a new golden implicitly.
      assert.deepEqual(clean(await planner.plan(goal,{...state,blocks:{list:[]}},logger)), result);
      const actual = await planner.plan(goal,state,logger);
      if (actual.plan) assert.equal(require('../study04/harness.cjs').replay(goal,state,actual.plan).valid,true);
      else assert.ok(['iteration_limit','frontier_exhausted','relaxed_unreachable'].includes(planner.getPlanFailure(actual).reason));
      assert.deepEqual(state,before,'planning must not mutate the observation');
    });
  }
  test(`${label}: exact built state`, () => {
    const expectedFile = path.join(dir,`${label}-facts.json`);
    assert.deepEqual(clean(buildState(state)), JSON.parse(fs.readFileSync(expectedFile)));
  });
}
for (const [value, condition, expected] of [
  [undefined,false,false],[undefined,true,false],[undefined,0,false],[undefined,'== 0',false],
  [3,2,false],[1,2,false],[3,'>= 3',true],[3,'> 3',false],[3,'<= 3',true],[3,'< 3',false],
  [3,'== 3',true],[3,'!= 4',true],[false,false,true],[true,true,true],['oak','oak',true],
]) test(`condition ${JSON.stringify(value)} / ${JSON.stringify(condition)}`,()=>assert.equal(planner.evaluateCondition(value,condition),expected));
test('nested preconditions and missing inventory counts',()=> {
  assert.equal(planner.arePreconditionsSatisfied({'inventory.stick':'>= 2'},{inventory:{stick:2}}),true);
  assert.equal(planner.arePreconditionsSatisfied({'inventory.stick':'>= 2'},{inventory:{}}),false);
});
test('unknown action returns structured diagnostic',async()=> {
  assert.deepEqual(await planner.plan('absent_goal',{},logger),{plan:null,diagnosis:{error:'未知の目標です: absent_goal'}});
});
test('inventory count goal adds requested quantity to current stock',async()=> {
  const state={inventory:{counts:{oak_log:1,oak_planks:4}},nearby_blocks:{},nearby:{},equipment:{},inventory_space:true};
  const result=await planner.plan('inventory.oak_planks:4',state,logger);
  assert.ok(result.plan.length > 0,'four already held planks do not satisfy an additional-four goal');
  assert.ok(result.plan.some(step=>step.skill==='hand_craft'));
});
