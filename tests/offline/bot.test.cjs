const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { load } = require('../helpers/module');
require('node:test').beforeEach(t=>{t.mock.method(console,'log',()=>{});t.mock.method(console,'warn',()=>{});});
function factory(options={},config={aiBotCount:1,username:'Bot'}) {
  let passed;
  const bot=new EventEmitter();Object.assign(bot,{username:config.aiBotCount===1?config.username:`${config.username}2`,loadPlugin(){},whisper(){},chat(){}});
  const api=load(path.resolve(__dirname,'../../planner_bot/src/bot/ai_bot.js'),{mineflayer:{createBot:x=>{passed=x;return bot;}}});
  api.createAIBot(2,config,options);return {bot,passed};
}
test('one bot keeps base username; multiple bots append id',()=> {
  assert.equal(factory().passed.username,'Bot');assert.equal(factory({}, {aiBotCount:2,username:'Bot'}).passed.username,'Bot2');
});
test('conversation sequence, self-role, structured content and filter intersection',()=> {
  const {bot}=factory();bot.addMessage('Peer','hello','conversation');bot.addMessage('Bot',{message:'hi'},'system_info');
  assert.equal(bot.conversationSequence,2);assert.equal(bot.getConversationHistory()[0].role,'user');assert.equal(bot.getConversationHistory()[1].role,'assistant');
  assert.deepEqual(bot.getConversationHistory({username:'Bot',type:'conversation'}),[]);
  assert.equal(bot.getConversationHistory({usernames:['Bot'],type:'system_info'})[0].content.message,'hi');
});
test('FIFO retains last 100 while sequence remains monotonic',()=> {
  const {bot}=factory();for(let i=0;i<102;i++)bot.addMessage('Peer',i,'conversation');
  assert.equal(bot.getConversationHistory().length,100);assert.equal(bot.getConversationHistory()[0].sequence,3);assert.equal(bot.conversationSequence,102);
});
test('default natural whisper emits event and does not append history',async()=> {
  const {bot}=factory();let message;bot.on('newNaturalMessage',x=>message=x);bot.emit('whisper','Peer','hello');
  assert.equal(message.from,'Peer');assert.equal(message.content,'hello');assert.equal(typeof message.timestamp,'number');assert.equal(bot.conversationSequence,0);
});
test('custom natural handler replaces default event; self messages ignored',async()=> {
  let calls=0;const {bot}=factory({onNaturalMessage:async()=>{calls++;}});let events=0;bot.on('newNaturalMessage',()=>events++);
  bot.emit('whisper','Bot','self');bot.emit('whisper','Peer','hi');await new Promise(setImmediate);
  assert.equal(calls,1);assert.equal(events,0);
});
test('autoHandleWhisper false disables auto commands and natural events',()=>assert.equal(factory({autoHandleWhisper:false}).bot.listenerCount('whisper'),0));
test('speak, speakNearby and deprecated chatWithDelay forward without history',async()=> {
  const {bot}=factory();const sent=[];bot.whisper=(...x)=>sent.push(x);bot.chat=x=>sent.push(x);
  await bot.speak('Peer','hello');await bot.speakNearby('near',7);await bot.chatWithDelay('Peer','old');
  assert.deepEqual(sent,[['Peer','hello'],'/w @a[distance=..7] near',['Peer','old']]);assert.equal(bot.conversationSequence,0);
});
