const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { load } = require('../helpers/module');
const golden=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../fixtures/generated-actions.json'),'utf8'));
for(const [kind,fn]of [['gather','ensureGatherActionsGenerated'],['craft','ensureCraftActionsGenerated'],['equipment','ensureEquipmentActionsGenerated']]) {
  test(`${kind}: 1.20.1 generated action definitions and once-per-process guard`,async()=> {
    const writes=new Map();
    const proxy={...fs, mkdirSync(){},copyFileSync(){},writeFileSync:(file,bytes)=>writes.set(path.basename(file),YAML.parse(bytes).actions)};
    const generator=load(path.resolve(__dirname,`../../planner_bot/src/planner/${kind}_generator.js`),{fs:proxy});
    await generator[fn]('1.20.1');assert.ok(writes.size>0);
    for(const [name,actions]of writes)assert.deepEqual(actions,golden[name]);
    const count=writes.size;writes.clear();await generator[fn]('1.20.1');assert.equal(writes.size,0);assert.ok(count);
  });
}
