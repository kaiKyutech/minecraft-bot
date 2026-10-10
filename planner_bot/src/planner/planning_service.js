const { Worker } = require('node:worker_threads')
const { performance } = require('node:perf_hooks')
const path = require('node:path')
const domain = require('./domain')
const { createLogger } = require('../utils/logger')
let worker, preparing, sequence=0, clientSequence=0
const pending=new Map(),clients=new WeakMap()
function forget(id) { try { worker?.postMessage({method:'forget',client:id}) } catch {} }
const finalized=new FinalizationRegistry(forget)
const cancelled=()=>Object.assign(new Error('Cancelled'),{name:'AbortError',code:'CANCELLED'})
function start() {
  if (worker) return worker
  const next=new Worker(path.join(__dirname,'planning_worker.js'),{env:{...process.env,LOG_LEVEL:'error'}})
  worker=next
  const failed=error=>{
    if(worker!==next)return
    worker=null;preparing=null
    const failure=Object.assign(new Error(error.message||'Planning worker exited'),{code:'PLANNER_WORKER_FAILED'})
    for(const job of pending.values()){job.cleanup();job.reject(failure)}pending.clear()
  }
  next.on('error',failed)
  next.on('exit',code=>failed(new Error('Planning worker exited ('+code+')')))
  next.on('message',message=>{
    const job=pending.get(message.id);if(!job)return
    pending.delete(message.id);job.cleanup()
    try {
      for(const entry of message.logs||[])job.logger?.[entry.level]?.(...entry.args)
      if(message.error)job.reject(Object.assign(new Error(message.error.message),message.error))
      else job.resolve(message.data)
    }catch(error){job.reject(error)}
    if(!pending.size)next.unref()
  })
  next.unref();return next
}
function request(method,payload,options={},logger=null) {
  if(options.signal?.aborted)return Promise.reject(cancelled())
  const current=start(),cancel=new SharedArrayBuffer(8),flag=new Int32Array(cancel),id=++sequence
  const abort=()=>Atomics.store(flag,0,1)
  options.signal?.addEventListener('abort',abort,{once:true})
  let deadlineTimer
  const cleanup=()=>{clearTimeout(deadlineTimer);options.signal?.removeEventListener('abort',abort)}
  const env=Object.fromEntries(['GOAP_DISABLE_ACTION_FILTER','GOAP_DEBUG_GOAL','GOAP_DEBUG_PRECONDITIONS','GOAP_DEBUG_EFFECTS','GOAP_DEBUG_LIMIT','GOAP_DEBUG_STATE'].map(key=>[key,process.env[key]]))
  const levels=['debug','info','warn','error'].filter(level=>logger&&(!logger.enabled||logger.enabled(level)))
  const {signal,deadline,_deadline,...serialOptions}=options
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject,logger,cleanup});current.ref()
    const limit=options._deadline??options.deadline
    if(limit!==undefined&&Number.isFinite(limit))deadlineTimer=setTimeout(()=>{
      // Only a job that has not started can be returned before acknowledgement.
      // CAS guarantees the worker will skip it, so no search continues afterward.
      if(Atomics.compareExchange(flag,1,0,-1)!==0)return
      pending.delete(id);cleanup();if(!pending.size)current.unref()
      reject(Object.assign(new Error('Evaluation budget exceeded'),{code:'BUDGET_EXCEEDED'}))
    },Math.max(0,limit-performance.now()))
    try{current.postMessage({id,method,...payload,options:serialOptions,cancel,env,levels,
      deadline:deadline===undefined?undefined:performance.timeOrigin+deadline,
      evaluationDeadline:_deadline===undefined?undefined:performance.timeOrigin+_deadline})}
    catch(error){pending.delete(id);cleanup();if(!pending.size)current.unref();reject(error)}
  })
}
async function prepare(version,logger=createLogger({category:'setup'})) {
  const resolved=version||domain.getSelectedVersion()||process.env.MC_VERSION||'1.20.1'
  domain.selectVersion(resolved)
  if(!preparing)preparing=request('prepare',{}, {version:resolved},logger).then(data=>domain.adoptPreparedDomain(resolved,data)).catch(error=>{preparing=null;throw error})
  return preparing
}
// Send exactly the fields consumed by buildState, without hundreds of thousands
// of coordinate rows, Item methods, or other live Mineflayer objects.
function planningWorld(world) {
  if(!world)return world
  const entities={}
  for(const [key,entity]of Object.entries(world.entities||{}))if(entity?.name==='item')entities[key]={name:entity.name,position:entity.position?{x:entity.position.x,y:entity.position.y,z:entity.position.z}:null}
  return {inventory:{counts:world.inventory?.counts||{}},equipment:world.equipment,nearby:world.nearby,
    nearby_blocks:world.nearby_blocks,inventory_space:world.inventory_space,isDay:world.isDay,
    position:world.position?{x:world.position.x,y:world.position.y,z:world.position.z}:null,entities,
    _gatherEffort:world._gatherEffort}
}
async function plan(goal,world,logger,options={}) {
  if(options.signal?.aborted)throw cancelled()
  if(options.deadline!==undefined&&performance.now()>=options.deadline)throw Object.assign(new Error('Evaluation budget exceeded'),{code:'BUDGET_EXCEEDED'})
  await prepare(options.version,logger)
  const effort=await require('./gather_cost').gatherEffort(world,options)
  const result=await request('plan',{goal,world:planningWorld({...world,_gatherEffort:effort})},options,logger)
  if(options.signal?.aborted)throw cancelled()
  return result
}
function client(bot) {
  if(clients.has(bot))return clients.get(bot)
  const id=++clientSequence;clients.set(bot,id);finalized.register(bot,id,bot)
  bot.once?.('end',()=>{clients.delete(bot);finalized.unregister(bot);forget(id)})
  return id
}
async function evaluate(bot,goals,world,options) {
  const effort=await require('./gather_cost').gatherEffort(world,{...options,deadline:options._deadline})
  return request('evaluate',{client:client(bot),goals,world:planningWorld({...world,_gatherEffort:effort})},options)
}
function reachableFacts(world,goals,options) {
  return request('reachableFacts',{goals,world:planningWorld(world)},options)
}
async function close() {const current=worker;if(current)await current.terminate()}
module.exports={prepare,plan,evaluate,reachableFacts,close,planningWorld}
