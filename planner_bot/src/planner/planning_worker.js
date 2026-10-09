const { parentPort } = require('node:worker_threads')
const { performance } = require('node:perf_hooks')
const goap = require('./goap')
const bots = new Map()
let tail = Promise.resolve()
parentPort.on('message', request => {
  if (request.method === 'forget') { bots.delete(request.client); return }
  tail = tail.then(() => handle(request)).catch(() => {})
})
async function handle(request) {
  const logs = [], levels = new Set(request.levels)
  const logger = Object.fromEntries(['debug','info','warn','error'].map(level => [level, (...args) => { if (levels.has(level)) logs.push({level,args}) }]))
  const flag = new Int32Array(request.cancel)
  if (Atomics.compareExchange(flag,1,0,1)!==0) {
    parentPort.postMessage({id:request.id,error:{name:'Error',code:'BUDGET_EXCEEDED',message:'Evaluation budget exceeded'},logs:[]});return
  }
  const signal = { get aborted() { return Atomics.load(flag,0) !== 0 } }
  const options = {...request.options, signal}
  if (request.deadline !== undefined) options.deadline = request.deadline - performance.timeOrigin
  if (request.evaluationDeadline !== undefined) options._deadline = request.evaluationDeadline - performance.timeOrigin
  for (const [key,value] of Object.entries(request.env)) { if (value === undefined) delete process.env[key]; else process.env[key]=value }
  try {
    let data
    if (request.method === 'prepare') data = await goap.prepareDomain(options.version,logger)
    else if (request.method === 'plan') {
      const result = await goap.plan(request.goal,request.world,logger,options)
      data = {result,planningFailure:goap.getPlanFailure(result)}
    } else if (request.method === 'evaluate') {
      let bot = bots.get(request.client)
      if (!bot) {bot={version:options.version,logLevel:'error'};bots.set(request.client,bot)}
      data = await require('./goal_evaluator').evaluate(bot,null,request.goals,{...options,worldState:request.world})
    } else if (request.method === 'reachableFacts') {
      data = require('./reachable_facts').compute(request.world, request.goals, options.deadline, signal)
    } else throw Error('Unknown planning request')
    if (signal.aborted) throw Object.assign(new Error('Cancelled'),{name:'AbortError',code:'CANCELLED'})
    parentPort.postMessage({id:request.id,data,logs})
  } catch(error) {
    parentPort.postMessage({id:request.id,error:{name:error.name,code:error.code,message:error.message,details:error.details},logs})
  }
}
