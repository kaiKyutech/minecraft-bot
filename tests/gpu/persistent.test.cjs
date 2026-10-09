const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');const {fork}=require('node:child_process');const {once}=require('node:events');
const {connect,wait}=require('../helpers/live');const {createBotApi}=require('../../planner_bot/api');
process.env.LOG_LEVEL='error';
test('persistent vision repeatedly captures, coexists with legacy capture and releases resources',{timeout:90000},async()=>{
 const bot=await connect('flat','PersistVis03');const api=createBotApi(bot,{logLevel:'error'});const rows=[];
 const puppeteer=require('puppeteer'),launch=puppeteer.launch;const browsers=[];
 puppeteer.launch=async options=>{const b=await launch(options);browsers.push(b);return b};
 try{
  assert.equal((await api.captureVision()).error.code,'VISION_NOT_STARTED');
  const started=await api.startVision({port:3108,width:640,height:360});assert.equal(started.ok,true,JSON.stringify(started));assert.equal(started.data.port,3108);
  assert.equal((await api.startVision()).data.alreadyStarted,true);
  for(let i=0;i<10;i++){const t=performance.now(),result=await api.captureVision();assert.equal(result.ok,true,JSON.stringify(result));const bytes=Buffer.from(result.data.image,'base64');assert.equal(bytes.readUInt16BE(0),0xffd8);rows.push({durationMs:performance.now()-t,...result.data,image:undefined});}
  const png=await api.captureVision({type:'png'});assert.equal(png.ok,true);const bytes=Buffer.from(png.data.image,'base64');assert.equal(bytes.subarray(1,4).toString(),'PNG');
  const decoded=await require('canvas').loadImage(bytes);assert.equal(decoded.width,640);assert.equal(decoded.height,360);
  fs.mkdirSync('.cache/minecraft-bot/02-03-results',{recursive:true});fs.writeFileSync('.cache/minecraft-bot/02-03-results/03-vision.png',bytes);
  const legacy=await api.info('vision',{renderWait:500});assert.equal(legacy.ok,true,JSON.stringify(legacy));assert.ok(bot.viewer);assert.equal((await api.captureVision()).ok,true);
  const movement=api.moveToward({x:bot.entity.position.x+20,z:bot.entity.position.z},{maxMs:500});await wait(50);assert.equal((await api.captureVision()).ok,true);await movement;
  assert.equal((await api.stopVision()).ok,true);assert.equal(bot.viewer,null);assert.equal((await api.stopVision()).data.stopped,false);
  assert.ok(browsers.every(b=>!b.connected));
  puppeteer.launch=async()=>{throw new Error('simulated start failure')};assert.equal((await api.startVision({renderWait:0})).ok,false);assert.equal(bot.viewer,null);
  puppeteer.launch=async options=>{const b=await launch(options);browsers.push(b);return b};assert.equal((await api.startVision({renderWait:500})).ok,true);
  bot.quit();await wait(500);assert.equal(bot.viewer,null);assert.ok(browsers.every(b=>!b.connected));
 }catch(error){console.error(error);throw error}
 finally{puppeteer.launch=launch;await api.stopVision();await api.stop();bot.quit();fs.mkdirSync('.cache/minecraft-bot/02-03-results',{recursive:true});fs.writeFileSync('.cache/minecraft-bot/02-03-results/03-vision.json',JSON.stringify(rows,null,2))}
});
test('SIGTERM closes the owned browser before a standalone vision process exits',{timeout:60000},async()=>{
 const child=fork(path.join(__dirname,'../tools/vision-child.cjs'),{silent:true});let pid;
 try{
  const ready=await Promise.race([once(child,'message'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('child startup timeout')),30000);timer.unref()})]);pid=ready[0].pid;assert.ok(pid);
  // Request SIGTERM from inside the child: Windows TerminateProcess cannot run JS handlers.
  const exit=once(child,'exit');child.send('terminate');await exit;
  await wait(300);assert.throws(()=>process.kill(pid,0));
 }finally{if(child.connected)child.disconnect();if(child.exitCode===null)child.kill()}
});
