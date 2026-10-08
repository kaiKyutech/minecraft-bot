const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { handleChatCommand } = require('../../planner_bot/src/commands');
test('!refresh should complete state refresh', async()=> {
  let refreshed=false;
  const result=await handleChatCommand({systemLog(){},shouldLogCommand:()=>true},'Peer','!refresh',{refresh:async()=>{refreshed=true;}});
  assert.equal(refreshed,true);assert.equal(result.success,true);
});
test('replanning failure should produce a diagnostic without circular import TypeError', ()=> {
  const script=`require('./planner_bot/src/commands');
    const p=require('./planner_bot/src/planner/goap');
    p.plan=async()=>({plan:null,diagnosis:{suggestions:[{message:'missing'}],missingRequirements:[]}});
    const e=require('./planner_bot/src/executor/goap_executor');
    const bot={systemLog(){},shouldLogCommand:()=>false};
    const sm={refresh:async()=>{},getState:async()=>({inventory:{counts:{}}})};
    e.executePlanWithReplanning(bot,'inventory.x:1',[{action:'absent',skill:'absent'}],sm)
      .catch(err=>{process.stdout.write(err.message);});`;
  const result=spawnSync(process.execPath,['-e',script],{cwd:require('node:path').resolve(__dirname,'../..'),encoding:'utf8'});
  assert.equal(result.status,0);assert.doesNotMatch(result.stdout,/buildStructuredDiagnosis is not a function/);
});
