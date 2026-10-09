const { performance } = require('node:perf_hooks')
const { withContext, interruptible } = require('./utils/context')
const { failure, errorResult, fromLegacy } = require('./utils/result')
const { createLogger } = require('./utils/logger')
const { operationsFor } = require('./executor/operation_manager')
const goap = require('./planner/goap')
const runGoal = require('./executor/goal_runner')
const skills = require('./skills')
const primitives = require('./primitives')
const navigation = require('./navigation/actions')
const { look } = require('./navigation/look')
const { start } = require('./navigation/idle')
const { info } = require('./planner/information')
const { status } = require('./planner/status')

function createBotApi(bot, options = {}) {
  const stateManager = options.stateManager || bot.stateManager
  const operations = operationsFor(bot)
  if (options.logLevel) bot.logLevel = options.logLevel
  const call = (commandName, fn, fallback = 'INTERNAL_ERROR') => withContext({ bot, commandName, logLevel: options.logLevel, signal: null }, async () => {
    try { return fromLegacy(await fn(), fallback) }
    catch (error) {
      if (!error.code && error.name !== 'AbortError' && !error.needsLLM && !error.reason) createLogger({ bot, category: 'command' }).error(error.stack || error.message)
      return errorResult(error, fallback)
    }
  })
  const ready = () => {
    if (!bot.version || !bot.entity) throw failure('BOT_NOT_READY', 'Wait for the bot spawn event before planning')
    return bot.version
  }
  const action = (collection, name, unknownCode) => {
    if (typeof name !== 'string' || !name) throw failure('INVALID_ARGUMENT', 'An action name is required')
    if (!Object.hasOwn(collection, name) || typeof collection[name] !== 'function') throw failure(unknownCode, `Unknown action: ${name}`)
    return collection[name]
  }
  const paramsObject = params => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw failure('INVALID_ARGUMENT', 'Parameters must be an object')
    return params
  }
  const observationManager = () => {
    // The view shares named locations, but owns its observation and refresh flags.
    const view = Object.create(stateManager)
    view.cache = null
    view.silentRefresh = true
    view.refreshGeneration = 0
    view.publishedGeneration = 0
    return view
  }
  const api = {
    observe: () => call('info', () => stateManager.observe(bot)),
    observeFast: (params = {}) => call('info', () => { ready();paramsObject(params);return require('./planner/fast_observation').observeFast(bot,stateManager,params) }),
    evaluateGoals: (goals, params = {}) => call('goal', () => { ready(); paramsObject(params); return require('./planner/goal_evaluator').evaluate(bot,stateManager,goals,params) }),
    refresh: () => call('refresh', async () => { const start = performance.now(); await stateManager.refresh(bot); return { durationMs: performance.now() - start } }),
    planGoal: (goal, params = {}) => call('goal', async () => {
      if (typeof goal !== 'string' || !goal.trim()) throw failure('INVALID_ARGUMENT', 'A goal string is required')
      const version = ready()
      paramsObject(params)
      const worldState = params.worldState || await stateManager.observe(bot, {signal:params.signal})
      const result = await goap.plan(goal, worldState, createLogger({ bot, category: 'goap.plan' }), { version, worker: true, signal: params.signal })
      if (!result.plan) throw failure('PLAN_NOT_FOUND', 'No plan found for this goal', { goal, diagnosis: result.diagnosis, ...goap.getPlanFailure?.(result) })
      return result
    }),
    executeGoal: (goal, params = {}) => call('goal', async () => {
      if (typeof goal !== 'string' || !goal.trim()) throw failure('INVALID_ARGUMENT', 'A goal string is required')
      ready()
      if(params.onProgress!==undefined&&typeof params.onProgress!=='function')throw failure('INVALID_ARGUMENT','onProgress must be a function')
      const {Progress}=require('./executor/progress')
      const progress=new Progress(bot,params.onProgress)
      return operations.run('goal', signal => withContext({progress},async()=>{
        progress.emit('goal_start',{goal})
        try{await runGoal(bot, params.username || 'api', goal, stateManager, signal);progress.emit('goal_end',{goal,ok:true});return { goal, message: `目標「${goal}」を完了しました` }}
        catch(error){progress.emit('goal_end',{goal,ok:false,code:error.name==='AbortError'?'CANCELLED':error.code||'EXECUTION_FAILED'});throw error}
      }), params)
    }, 'EXECUTION_FAILED'),
    executeSkill: (name, params = {}, execution = {}) => call('skill', () => {
      const fn = action(skills, name, 'UNKNOWN_SKILL'); paramsObject(params)
      return operations.run('skill', async () => { await interruptible(bot, () => stateManager.refresh(bot)); const result = await interruptible(bot, () => fn(bot, params, stateManager)); await interruptible(bot, () => stateManager.refresh(bot)); return { name, result: result === undefined ? null : result } }, execution)
    }, 'EXECUTION_FAILED'),
    executePrimitive: (name, params = {}, execution = {}) => call('primitive', () => {
      const camel = typeof name === 'string' ? name.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) : name
      const fn = action(primitives, camel, 'UNKNOWN_PRIMITIVE'); paramsObject(params)
      return operations.run('primitive', async () => {
        await interruptible(bot, () => stateManager.refresh(bot))
        const result = await interruptible(bot, () => fn(bot, params))
        await interruptible(bot, () => stateManager.refresh(bot))
        return { name: camel, result: result === undefined ? null : result }
      }, execution)
    }, 'EXECUTION_FAILED'),
    navigate: (name, params = {}, execution = {}) => call('navigation', () => {
      const fn = action(navigation, name, 'UNKNOWN_ACTION'); paramsObject(params)
      const run = () => fn(bot, stateManager, params)
      return ['chestDeposit', 'chestWithdraw', 'chestClose'].includes(name) ? operations.continueChest(run, execution) : operations.run(name, run, execution)
    }, 'EXECUTION_FAILED'),
    moveToward: (target, execution = {}) => call('navigation', () => {
      ready();paramsObject(target);paramsObject(execution)
      if(!Number.isFinite(target.x)||!Number.isFinite(target.z)||(target.y!==undefined&&!Number.isFinite(target.y)))throw failure('INVALID_ARGUMENT','Finite x/z and optional y required')
      const maxMs=execution.maxMs??5000,range=execution.range??2
      if(!Number.isFinite(maxMs)||maxMs<0||!Number.isFinite(range)||range<0)throw failure('INVALID_ARGUMENT','maxMs/range must be finite and non-negative')
      const deadline=performance.now()+maxMs
      return operations.run('moveToward',signal=>require('./navigation/move_toward').moveToward(bot,target,{...execution,range,deadline},signal),execution)
    },'EXECUTION_FAILED'),
    placeBlock: (params = {}, execution = {}) => call('creative', () => {
      paramsObject(params)
      return operations.run('placeBlock', () => require('./navigation/placement').placeBlock(bot, stateManager, params), execution)
    }, 'PLACEMENT_FAILED'),
    placeTorch: (params = {}) => call('placeTorch', () => {
      ready(); paramsObject(params)
      const { torchOptions, placeTorch } = require('./navigation/torch_placement')
      const settings = torchOptions(params)
      return operations.run('placeTorch', () => placeTorch(bot, settings), params)
    }, 'PLACEMENT_FAILED'),
    info: (type, params = {}) => call('info', () => {
      if (!['all', 'vision', 'scanBlocks', 'recipesFor', 'recipesUsing'].includes(type)) throw failure(type ? 'UNKNOWN_ACTION' : 'INVALID_ARGUMENT', `Unknown information type: ${type}`)
      paramsObject(params)
      const get = async () => {
        if (type === 'vision' && (params.yaw !== undefined || params.pitch !== undefined) && operations.busy()) throw failure('OPERATION_CONFLICT', 'Directional vision is unavailable while an operation is running')
        const value = await info(bot, observationManager(), type, params)
        return value.data
      }
      return type === 'vision' ? operations.capture(get) : get()
    }, type === 'vision' ? 'VISION_CAPTURE_FAILED' : 'INTERNAL_ERROR'),
    status: () => call('status', () => status(bot, observationManager())),
    startVision: (params = {}) => call('info', () => {ready();paramsObject(params);return operations.capture(()=>require('./vision/persistent').start(bot,params))},'VISION_CAPTURE_FAILED'),
    captureVision: (params = {}) => call('info', () => {ready();paramsObject(params);return operations.capture(()=>require('./vision/persistent').capture(bot,params))},'VISION_CAPTURE_FAILED'),
    stopVision: () => call('info', () => operations.capture(()=>require('./vision/persistent').stop(bot)),'VISION_CAPTURE_FAILED'),
    look: (name, params = {}) => call('look', () => look(bot, name, paramsObject(params))),
    startIdle: (params = {}) => call('idle_on', () => start(bot, paramsObject(params))),
    stop: () => call('stop', () => operations.stop()),
    chat: (params = {}) => call('chat', async () => {
      paramsObject(params)
      if (bot.currentChest || operations.active?.kind === 'chestOpen') await operations.continueChest(() => navigation.chestClose(bot, stateManager, {}))
      return require('./bot/conversation').chat(bot, params)
    }),
    echo: (username, message) => call('echo', async () => { await bot.speak(username, message); return { message } }),
    addMessage: (speaker, content, type = 'conversation') => call('history', () => { bot.addMessage(speaker, content, type); return { latestSequence: bot.conversationSequence } }),
    history: (params = {}) => call('history', () => { const history = bot.getConversationHistory(params); return { history, count: history.length, latestSequence: bot.conversationSequence } }),
    speak: (username, message) => call('chat', () => bot.speak(username, message)),
    speakNearby: (message, radius) => call('chat', () => bot.speakNearby(message, radius))
  }
  return api
}

module.exports = { createBotApi }
