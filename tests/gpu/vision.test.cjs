const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {root,connect}=require('../helpers/live');
const {handleChatCommand}=require('../../planner_bot/src/commands');
test('!info vision returns a PNG and closes viewer/browser',{timeout:60000,todo:'Current capture.js references undefined logger; browser launch is not reached'},async()=>{
  let bot;const start=Date.now();const record={input:'!info vision {"yaw":90,"pitch":0,"renderWait":1000}',gpuAuthorizedOn:'2026-10-09'};
  try{
    bot=await connect('flat','SurveyVision');
    const value=await handleChatCommand(bot,'Observer',record.input,bot.stateManager);
    record.returned={...value,data:{...value.data,image:`<base64 ${value.data.image.length} chars>`}};
    assert.equal(value.success,true);const bytes=Buffer.from(value.data.image,'base64');assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(bot.viewer,null);
  }catch(error){record.thrown={name:error.name,message:error.message};throw error;}
  finally{record.durationMs=Date.now()-start;bot?.quit();fs.mkdirSync(path.join(root,'tests/results'),{recursive:true});fs.writeFileSync(path.join(root,'tests/results/vision.json'),JSON.stringify(record,null,2));}
});
