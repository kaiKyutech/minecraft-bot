const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { handleChatCommand } = require('../../planner_bot/src/commands');
test('!refresh should complete state refresh', async()=> {
  let refreshed=false;
  const result=await handleChatCommand({systemLog(){},shouldLogCommand:()=>true},'Peer','!refresh',{refresh:async()=>{refreshed=true;}});
  assert.equal(refreshed,true);assert.equal(result.ok,true);
});
test('replanning failure should produce a diagnostic without circular import TypeError', ()=> {
  const script=`(async()=>{require('./planner_bot/src/commands');
    const p=require('./planner_bot/src/planner/goap');await p.prepareDomain('1.20.1');
    p.plan=async()=>({plan:null,diagnosis:{suggestions:[{message:'missing'}],missingRequirements:[]}});
    const e=require('./planner_bot/src/executor/goap_executor');
    const bot={systemLog(){},shouldLogCommand:()=>false};
    const sm={refresh:async()=>{},getState:async()=>({inventory:{counts:{}}})};
    e.executePlanWithReplanning(bot,'inventory.x:1',[{action:'absent',skill:'absent'}],sm)
      .catch(err=>{process.stdout.write(JSON.stringify({code:err.code,message:err.message,diagnosis:err.diagnosis}));});})();`;
  const result=spawnSync(process.execPath,['-e',script],{cwd:require('node:path').resolve(__dirname,'../..'),encoding:'utf8'});
  assert.equal(result.status,0);assert.match(result.stdout,/REPLAN_FAILED/);assert.doesNotMatch(result.stderr,/circular dependency/);assert.doesNotMatch(result.stdout,/buildStructuredDiagnosis is not a function/);
});
