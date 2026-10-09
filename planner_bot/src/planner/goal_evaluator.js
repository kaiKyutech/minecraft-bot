const { performance } = require('node:perf_hooks')
const goap = require('./goap')
const { buildState, loadBlockCategories } = require('./state_builder')
const { serializeState } = require('./state_operations')
const { failure } = require('../utils/result')

// Calibrated against the 02 flat primitive timings and natural 25.5/34.0/46.5s runs.
// Straight-line travel and a planning-compatible world cannot prove reachability.
const TIMING = Object.freeze({ logMs:6000, stoneMs:1700, gatherOtherMs:2200, craftMs:550, placeMs:650,
  smeltMs:10500, stepOverheadMs:500, moveMsPerBlock:300 })
const caches = new WeakMap()
function check(deadline, signal) {
  if(signal?.aborted)throw Object.assign(new Error('Cancelled'),{name:'AbortError',code:'CANCELLED'})
  return performance.now() >= deadline
}
function environment(world, deadline) {
  const closest=new Map(), origin=world.position, categories=loadBlockCategories().categories||{}
  let complete=true
  for(const block of world.blocks?.list||[]) {
    if(performance.now()>=deadline){complete=false;break}
    if(!block.position||!origin)continue
    const distance=Math.hypot(block.position.x-origin.x,block.position.y-origin.y,block.position.z-origin.z)
    const old=closest.get(block.name)
    if(!old||distance<old.distance)closest.set(block.name,{position:block.position,distance})
  }
  return {closest,categories,complete}
}
function estimate(plan, env) {
  const resources=new Map(), steps=[],placed=new Set();let estimatedMs=0
  const use=(name,count,usage='consume')=>{
    const names=env.categories[name]?.blocks||[name]
    let nearest=null,block=name
    for(const candidate of names){const found=env.closest.get(candidate);if(found&&(!nearest||found.distance<nearest.distance)){nearest=found;block=candidate}}
    const key=usage+':'+block
    const old=resources.get(key)||{block,count:0,usage,category:env.categories[name]?name:null,selection:'nearest_estimate',nearestPosition:nearest?.position?{...nearest.position}:null,nearestDistance:nearest?.distance??null}
    old.count=usage==='station'?Math.max(old.count,count):old.count+count;resources.set(key,old);return nearest?.distance||0
  }
  for(const step of plan){
    const count=step.params?.count||1;let base=0,distance=0
    if(step.skill==='gather'){
      const name=step.params?.itemName;distance=use(name,count)
      base=count*(name==='log'||String(name).includes('log')?TIMING.logMs:name==='basic_stone'||name==='stone'||name==='cobblestone'?TIMING.stoneMs:TIMING.gatherOtherMs)
    }else if(step.skill==='move_to'){
      const name=step.params?.blockType||(step.action.includes('workbench')?'crafting_table':step.action.includes('furnace')?'furnace':null)
      if(name&&!placed.has(name))distance=use(name,1,'station')
    }else if(step.skill==='furnace_smelt'){base=TIMING.smeltMs;if(!placed.has('furnace'))distance=use('furnace',1,'station')}
    else if(step.skill==='place_block'){base=TIMING.placeMs;placed.add(step.params?.blockName)}
    else if(step.skill==='hand_craft'||step.skill==='workbench_craft')base=TIMING.craftMs*count
    const ms=step.skill?base+distance*TIMING.moveMsPerBlock+TIMING.stepOverheadMs:0
    steps.push({action:step.action,baseMs:base,distance,estimatedMs:ms});estimatedMs+=ms
  }
  return {estimatedMs:Math.round(estimatedMs),estimateDetails:{model:'02-live-v1',coefficients:TIMING,steps,distanceType:'straight_line',reachabilityKnown:false,resourceSummaryComplete:env.complete},resources:[...resources.values()]}
}

async function evaluateLocal(bot,stateManager,goals,options={}) {
  if(!Array.isArray(goals)||!goals.length||goals.some(g=>typeof g!=='string'||!g.trim()))throw failure('INVALID_ARGUMENT','A non-empty array of goal strings is required')
  const maxMs=options.maxMs??1000
  if(!Number.isFinite(maxMs)||maxMs<0)throw failure('INVALID_ARGUMENT','maxMs must be finite and non-negative')
  const perGoalMs=options.perGoalMs??Math.max(20,maxMs/goals.length)
  if(!Number.isFinite(perGoalMs)||perGoalMs<0)throw failure('INVALID_ARGUMENT','perGoalMs must be finite and non-negative')
  const start=performance.now(),deadline=options._deadline??(start+Math.max(0,maxMs-5))
  let world=options.worldState,observationMs=0,preparationMs=0
  if(world?.kind==='fast_observation'||world?.complete===false)throw failure('INVALID_ARGUMENT','evaluateGoals requires a full worldState from observe()')
  if(!world&&!check(deadline,options.signal)){
    const t=performance.now()
    try{world=await stateManager.observe(bot,{deadline,signal:options.signal})}catch(error){if(error.code!=='BUDGET_EXCEEDED')throw error}
    observationMs=performance.now()-t
  }
  let key,env,possibleFacts,cache=caches.get(bot)
  if(!cache){cache=new Map();caches.set(bot,cache)}
  if(world&&!check(deadline,options.signal)){
    const facts=buildState(world)
    key=bot.version+':'+(process.env.GOAP_DISABLE_ACTION_FILTER||'')+':'+serializeState(facts)
    const t=performance.now();await goap.prepareDomain(bot.version);preparationMs=performance.now()-t
    env=options._environment||environment(world,deadline)
    if(!check(deadline,options.signal))possibleFacts=require('./reachability').reachable(goap.getAllActions(),facts,deadline,options.signal)
  }
  const results=[]
  for(const goal of goals){
    if(!world||!env||check(deadline,options.signal)){results.push({goal,status:'unevaluated',plan:null,stepCount:null,estimatedMs:null,resources:[],diagnosis:null,reason:'budget_exceeded'});continue}
    const cacheKey=key+':'+goal,cached=cache.get(cacheKey);let result=cached?.result,planningFailure=cached?.planningFailure
    try{
      if(!result){result=await goap.plan(goal,world,null,{version:bot.version,deadline:Math.min(deadline,performance.now()+perGoalMs),signal:options.signal,possibleFacts});planningFailure=goap.getPlanFailure(result);cache.set(cacheKey,{result:structuredClone(result),planningFailure});if(cache.size>256)cache.delete(cache.keys().next().value)}
      const status=result.plan?'plannable':result.diagnosis?.error?'invalid':planningFailure?.provenImpossible?'unplannable':'unevaluated'
      results.push({goal,status,plan:result.plan?structuredClone(result.plan):null,stepCount:result.plan?.length??null,...(result.plan?estimate(result.plan,env):{estimatedMs:null,resources:[]}),diagnosis:structuredClone(result.diagnosis),reason:status==='plannable'||status==='invalid'?null:planningFailure?.reason||'frontier_exhausted'})
    }catch(error){
      if(error.code!=='BUDGET_EXCEEDED')throw error
      results.push({goal,status:'unevaluated',plan:null,stepCount:null,estimatedMs:null,resources:[],diagnosis:null,reason:'budget_exceeded'})
    }
  }
  return {results,durationMs:performance.now()-start,observationMs,preparationMs,timedOut:results.some(r=>r.reason==='budget_exceeded')}
}
async function environmentAsync(world,deadline,signal) {
  const closest=new Map(),origin=world.position,categories=loadBlockCategories().categories||{}
  let complete=true,slice=performance.now()+2,n=0
  for(const block of world.blocks?.list||[]) {
    if(check(deadline,signal)){complete=false;break}
    if(++n%128===0&&performance.now()>=slice){await new Promise(setImmediate);slice=performance.now()+2;if(check(deadline,signal)){complete=false;break}}
    if(!block.position||!origin)continue
    const distance=Math.hypot(block.position.x-origin.x,block.position.y-origin.y,block.position.z-origin.z),old=closest.get(block.name)
    if(!old||distance<old.distance)closest.set(block.name,{position:{...block.position},distance})
  }
  return {closest,categories,complete}
}
async function evaluate(bot,stateManager,goals,options={}) {
  if(!require('node:worker_threads').isMainThread || options.worker===false)return evaluateLocal(bot,stateManager,goals,options)
  // Keep the existing argument errors and whole-call budget, including observation,
  // preparation, projection, queueing, reachability, and A*.
  if(!Array.isArray(goals)||!goals.length||goals.some(g=>typeof g!=='string'||!g.trim()))throw failure('INVALID_ARGUMENT','A non-empty array of goal strings is required')
  const maxMs=options.maxMs??1000,perGoalMs=options.perGoalMs??Math.max(20,maxMs/goals.length)
  if(!Number.isFinite(maxMs)||maxMs<0)throw failure('INVALID_ARGUMENT','maxMs must be finite and non-negative')
  if(!Number.isFinite(perGoalMs)||perGoalMs<0)throw failure('INVALID_ARGUMENT','perGoalMs must be finite and non-negative')
  const start=performance.now(),deadline=start+Math.max(0,maxMs-5),signal=options.signal
  let world=options.worldState,observationMs=0,preparationMs=0
  if(world?.kind==='fast_observation'||world?.complete===false)throw failure('INVALID_ARGUMENT','evaluateGoals requires a full worldState from observe()')
  if(!world&&!check(deadline,signal)) {
    const t=performance.now()
    try{world=await stateManager.observe(bot,{deadline,signal})}catch(error){if(error.code!=='BUDGET_EXCEEDED')throw error}
    observationMs=performance.now()-t
  }
  const finish=async()=>{
    const result=await evaluateLocal(bot,stateManager,goals,{...options,worldState:world,_deadline:deadline})
    return {...result,durationMs:performance.now()-start,observationMs,preparationMs}
  }
  if(!world||check(deadline,signal))return finish()
  const t=performance.now();await require('./planning_service').prepare(bot.version);preparationMs=performance.now()-t
  if(check(deadline,signal))return finish()
  const env=await environmentAsync(world,deadline,signal)
  if(check(deadline,signal))return finish()
  let result
  try{result=await require('./planning_service').evaluate(bot,goals,world,{version:bot.version,maxMs,perGoalMs,signal,_deadline:deadline,_environment:env})}
  catch(error){if(error.code==='BUDGET_EXCEEDED')return finish();throw error}
  check(Infinity,signal)
  return {...result,durationMs:performance.now()-start,observationMs,preparationMs}
}
module.exports={evaluate,TIMING}
