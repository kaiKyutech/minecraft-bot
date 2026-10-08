const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {root,connect}=require('../helpers/live');
const {handleChatCommand}=require('../../planner_bot/src/commands');
test('!info vision returns a PNG and closes viewer/browser',{timeout:60000},async()=>{
  let bot;const start=Date.now();const record={input:'!info vision {"yaw":90,"pitch":0,"renderWait":1000}',gpuAuthorizedOn:'2026-10-09'};
  try{
    bot=await connect('flat','SurveyVision');
    const value=await handleChatCommand(bot,'Observer',record.input,bot.stateManager);
    assert.equal(value.ok,true,JSON.stringify(value.error));
    record.returned={...value,data:{...value.data,image:`<base64 ${value.data.image.length} chars>`}};
    assert.equal(value.ok,true);const bytes=Buffer.from(value.data.image,'base64');assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(bot.viewer,null);
    const {createBotApi}=require('../../planner_bot/src/api');const {operationsFor}=require('../../planner_bot/src/executor/operation_manager');
    const api=createBotApi(bot);let finish;const running=operationsFor(bot).run('goal',()=>new Promise(resolve=>{finish=resolve}));await new Promise(setImmediate);
    try {
      const owner=bot.currentAbortController;
      assert.equal((await api.info('vision',{yaw:90})).error.code,'OPERATION_CONFLICT');
      const again=await api.info('vision',{renderWait:1000});assert.equal(again.ok,true,JSON.stringify(again.error));
      assert.equal(bot.viewer,null);assert.equal(bot.currentAbortController,owner);assert.equal(owner.signal.aborted,false);
    } finally {finish();await running}
    const puppeteer=require('puppeteer'),launch=puppeteer.launch;
    try {
      puppeteer.launch=async()=>{throw new Error('simulated browser launch failure')};
      assert.equal((await api.info('vision',{renderWait:0})).error.code,'VISION_CAPTURE_FAILED');assert.equal(bot.viewer,null);
    } finally {puppeteer.launch=launch;}
    try {
      puppeteer.launch=async options=>{
        const browser=await launch(options),close=browser.close.bind(browser);
        browser.close=async()=>{await close();throw new Error('simulated browser close failure')};return browser;
      };
      const failure=await api.info('vision',{renderWait:1000});assert.equal(failure.error.code,'VISION_CAPTURE_FAILED');assert.equal(bot.viewer,null);
    } finally {puppeteer.launch=launch;}
  }catch(error){record.thrown={name:error.name,message:error.message};throw error;}
  finally{record.durationMs=Date.now()-start;bot?.quit();fs.mkdirSync(path.join(root,'tests/results'),{recursive:true});fs.writeFileSync(path.join(root,'tests/results/vision.json'),JSON.stringify(record,null,2));}
});
