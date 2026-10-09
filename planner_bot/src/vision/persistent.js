const fs=require('node:fs')
const {performance}=require('node:perf_hooks')
const {failure}=require('../utils/result')
const sessions=new Map()
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let hooked=false
const handlers={}
function hooks(){
 if(hooked)return;hooked=true
 for(const [name,code]of [['SIGINT',130],['SIGTERM',143]]){
  handlers[name]=()=>{const exit=process.listenerCount(name)===1;stopAll().finally(()=>{if(exit)process.exit(code)})}
  process.on(name,handlers[name])
 }
}
function unhook(){if(sessions.size||!hooked)return;for(const [name,fn]of Object.entries(handlers))process.removeListener(name,fn);hooked=false}
function owns(bot,viewer){return sessions.get(bot)?.viewer===viewer}
function metadata(bot){return {position:{...bot.entity.position},yaw:bot.entity.yaw*180/Math.PI,pitch:bot.entity.pitch*180/Math.PI,timestamp:Date.now()}}
async function stop(bot){
 const state=sessions.get(bot);if(!state)return {stopped:false}
 if(state.closing)return state.closing
 state.closing=(async()=>{
  let error
  await state.initialized
  try{await state.browser?.close()}catch(e){error=e;state.browser?.process()?.kill()}
  try{await state.viewer?.close()}catch(e){error ||= e}
  finally{if(bot.viewer===state.viewer)bot.viewer=null;bot.removeListener?.('end',state.end);sessions.delete(bot);unhook()}
  if(error)throw error
  return {stopped:true}
 })()
 return state.closing
}
async function stopAll(){await Promise.allSettled([...sessions.keys()].map(stop))}
async function start(bot,options={}){
 const startTime=performance.now(),width=options.width??640,height=options.height??360,viewDistance=options.viewDistance??4
 if(!Number.isInteger(width)||width<16||width>3840||!Number.isInteger(height)||height<16||height>2160||!Number.isInteger(viewDistance)||viewDistance<1||viewDistance>16)throw failure('INVALID_ARGUMENT','Invalid vision dimensions/viewDistance')
 if(options.renderWait!==undefined&&(!Number.isFinite(options.renderWait)||options.renderWait<0||options.renderWait>60000))throw failure('INVALID_ARGUMENT','renderWait must be 0..60000 ms')
 if(sessions.has(bot))return {alreadyStarted:true,...sessions.get(bot).info}
 if(bot.viewer)throw failure('OPERATION_CONFLICT','Another viewer already owns this bot')
 const getPort=(await import('get-port')).default
 if(options.port!==undefined&&(!Number.isInteger(options.port)||options.port<1||options.port>65535))throw failure('INVALID_ARGUMENT','Invalid vision port')
 const port=await getPort(options.port===undefined?{}:{port:options.port})
 if(options.port!==undefined&&port!==options.port)throw failure('OPERATION_CONFLICT','Requested viewer port is in use')
 const state={info:{port,url:`http://localhost:${port}`,width,height,viewDistance},browser:null,viewer:null,page:null,closing:null}
 state.initialized=new Promise(resolve=>{state.finishInitialization=resolve})
 sessions.set(bot,state);hooks()
 state.end=()=>{state.ended=true;stop(bot).catch(()=>{})};bot.once('end',state.end)
 try{
  require('prismarine-viewer').mineflayer(bot,{port,firstPerson:true,viewDistance});state.viewer=bot.viewer;state.viewer.port=port
  const executablePath=options.executablePath||process.env.PUPPETEER_EXECUTABLE_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p))
  state.browser=await require('puppeteer').launch({headless:true,executablePath,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']})
  state.page=await state.browser.newPage();await state.page.setViewport({width,height,deviceScaleFactor:1})
  await state.page.goto(state.info.url,{waitUntil:'networkidle2',timeout:20000});await wait(options.renderWait??4000)
  if(state.ended||state.closing)throw failure('VISION_CAPTURE_FAILED','Bot ended during vision startup')
  return {...state.info,durationMs:performance.now()-startTime,alreadyStarted:false}
 }catch(error){state.finishInitialization();await stop(bot).catch(()=>{});throw error}
 finally{state.finishInitialization()}
}
async function capture(bot,options={}){
 const state=sessions.get(bot)
 if(!state?.page||state.closing)throw failure('VISION_NOT_STARTED','Call startVision before captureVision')
 const type=options.type??'jpeg',quality=options.quality??80
 if(!['jpeg','png'].includes(type)||!Number.isInteger(quality)||quality<0||quality>100)throw failure('INVALID_ARGUMENT','Use jpeg/png with quality 0..100')
 const begin=performance.now(),meta=metadata(bot)
 const image=await state.page.screenshot({type,encoding:'base64',...(type==='jpeg'?{quality}:{})})
 return {image,format:type,width:state.info.width,height:state.info.height,metadata:meta,durationMs:performance.now()-begin}
}
module.exports={start,capture,stop,stopAll,owns}
