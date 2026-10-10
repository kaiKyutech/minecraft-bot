const { randomUUID, createHash } = require('node:crypto')
const domain = require('../planner/domain')
const goap = require('../planner/goap')
const runner = require('./goal_runner')
const { buildState } = require('../planner/state_builder')
const { parseGoalInput, getGoalStateFromParsed, adjustGoalForCurrentState } = require('../planner/goals')
const { isGoalSatisfied } = require('../planner/heuristic')
const { failure } = require('../utils/result')
const { checkpoint, cancelled, withContext } = require('../utils/context')
const { FailureGuard } = require('./failure_guard')

const stores = new WeakMap(), liveStores = new Set()
const HANDOFF = Symbol('prepared goal handoff')
const MAX_CANDIDATES = 128, MAX_ROUNDS = 3, MAX_AGE_MS = 60000
function stamp(bot) {
  const model = domain.loadDomain()
  const fingerprint = createHash('sha256').update(JSON.stringify({model,
    schema: require('../planner/state_builder').loadStateSchema(bot.version),
    categories: require('../planner/state_builder').loadBlockCategories(bot.version)})).digest('hex')
  return { version: bot.version, model, fingerprint, epoch: require('../planner/planning_service').getEpoch(), filter: process.env.GOAP_DISABLE_ACTION_FILTER || '' }
}
function same(a, b) { return a.version === b.version && a.model === b.model && a.fingerprint === b.fingerprint && a.epoch === b.epoch && a.filter === b.filter }
function storeFor(bot) {
  if (!stores.has(bot)) {
    const store = { generation: 0, round: 0, candidates: new Map(), handles: new Map(), ended: false }
    stores.set(bot, store)
    const ref = new WeakRef(store)
    liveStores.add(ref)
    bot.once?.('end', () => { store.ended = true; invalidate(bot); store.candidates.clear(); liveStores.delete(ref) })
  }
  return stores.get(bot)
}
function invalidate(bot, keep) {
  const store = stores.get(bot)
  if (!store) return
  if (keep && keep.generation === store.generation && !store.ended) {
    store.handles.clear()
    return
  }
  store.generation++
  store.handles.clear()
}
function prune(store, current) {
  const now = Date.now()
  for (const [id, record] of store.candidates) {
    if (now - record.createdAt > MAX_AGE_MS || record.round <= store.round - MAX_ROUNDS || (current && !same(record.stamp, current))) store.candidates.delete(id)
  }
  for (const [id, record] of store.handles) if (now - record.createdAt > MAX_AGE_MS || (current && !same(record.stamp, current))) store.handles.delete(id)
}
function retain(bot, result, world) {
  const store = storeFor(bot)
  if (store.ended) return result
  store.round++
  if (!world || !result.results.some(row => row.status === 'plannable')) { prune(store); return result }
  const current = stamp(bot)
  prune(store, current)
  // Store a compact, independent observation once per round, not the block list.
  const snapshot = structuredClone(require('../planner/planning_service').planningWorld(world))
  for (const row of result.results) if (row.status === 'plannable' && Array.isArray(row.plan)) {
    const candidate = randomUUID()
    store.candidates.set(candidate, { goal: row.goal, plan: structuredClone(row.plan), world: snapshot,
      observedAt: world.timestamp ?? Date.now(), createdAt: Date.now(), round: store.round, stamp: current })
    row.candidate = candidate
    while (store.candidates.size > MAX_CANDIDATES) store.candidates.delete(store.candidates.keys().next().value)
  }
  return result
}
function liveWorld(bot, sm, world) {
  return { ...world, inventory: sm.extractInventory ? sm.extractInventory(bot) : world.inventory,
    equipment: sm.extractEquipment ? sm.extractEquipment(bot) : world.equipment,
    position: bot.entity?.position || world.position }
}
function hasLiveFacts(sm) { return typeof sm.extractInventory === 'function' && typeof sm.extractEquipment === 'function' }
function targetFor(goal, world, bot) {
  const parsed = parseGoalInput(goal)
  const target = parsed && getGoalStateFromParsed(parsed, goap.getAllActions())
  if (!target || !Object.keys(target).length) throw failure('INVALID_ARGUMENT', 'Unknown goal')
  return adjustGoalForCurrentState(target, buildState(world, bot.version), parsed)
}
function needsObservation(goal) {
  const parsed = parseGoalInput(goal)
  const target = parsed && getGoalStateFromParsed(parsed, goap.getAllActions())
  return !target || Object.keys(target).some(key => !key.startsWith('inventory.') && !key.startsWith('equipment.'))
}
function validatePlan(plan) {
  const actions = new Map(goap.getAllActions().map(action => [action.name, action]))
  return Array.isArray(plan) && plan.every(step => {
    const action = actions.get(step.action)
    return action && action.skill === step.skill && JSON.stringify(action.params || {}) === JSON.stringify(step.params || {})
  })
}
async function prepare(bot, sm, goal, options = {}) {
  const store = storeFor(bot), generation = ++store.generation
  store.handles.clear()
  const check = () => { checkpoint(bot, options.signal); if (store.ended || store.generation !== generation) throw cancelled() }
  check()
  // Use this request's context, never the current physical owner's signal.
  return withContext({ bot, signal: options.signal || null }, async () => {
    await goap.prepareDomain(bot.version); check()
    const current = stamp(bot)
    prune(store, current)
    const candidate = store.candidates.get(options.candidate)
    const reusable = candidate?.goal === goal && same(candidate.stamp, current) && validatePlan(candidate.plan)
    let world = reusable ? liveWorld(bot, sm, candidate.world) : await sm.observe(bot, { signal: options.signal })
    check()
    if (reusable && (needsObservation(goal) || !hasLiveFacts(sm))) { world = await sm.observe(bot, { signal: options.signal }); check() }
    const target = targetFor(goal, world, bot)
    const alreadySatisfied = isGoalSatisfied(target, buildState(world, bot.version))
    const prepGoals = alreadySatisfied ? [] : await runner.buildPickaxePreparationGoals(goal, { ...world, inventory: buildState(world, bot.version).inventory }, bot)
    check()
    const executionGoal = prepGoals[0] || goal
    let plan, reused = false
    if (alreadySatisfied) plan = []
    else if (reusable && !prepGoals.length && candidate.plan.length) { plan = structuredClone(candidate.plan); reused = true }
    else {
      if (reusable) { world = await sm.observe(bot, { signal: options.signal }); check() }
      const result = await goap.plan(executionGoal, world, null, { version: bot.version, worker: true, signal: options.signal })
      check()
      if (!Array.isArray(result.plan)) throw failure('PLAN_NOT_FOUND', 'No plan found for this goal', { goal: executionGoal, diagnosis: result.diagnosis, ...goap.getPlanFailure?.(result) })
      plan = result.plan
    }
    check()
    if (!same(current, stamp(bot))) throw failure('PREPARED_GOAL_INVALID', 'Domain changed during preparation')
    const handle = randomUUID()
    store.handles.set(handle, { goal, executionGoal, plan: structuredClone(plan), world: structuredClone(require('../planner/planning_service').planningWorld(world)),
      generation, stamp: current, createdAt: Date.now(), signal: options.signal })
    return { handle, goal, reused, alreadySatisfied, preparationGoal: prepGoals[0] || null }
  })
}
function consume(bot, handle) {
  const store = storeFor(bot), record = store.handles.get(handle)
  store.handles.delete(handle)
  if (!record || store.ended || record.generation !== store.generation || Date.now() - record.createdAt > MAX_AGE_MS || !same(record.stamp, stamp(bot))) {
    throw failure('PREPARED_GOAL_INVALID', 'Prepared handle expired, consumed, or superseded')
  }
  checkpoint(bot, record.signal)
  return record
}
async function execute(bot, sm, record, signal) {
  const store = storeFor(bot)
  if (store.ended || record.generation !== store.generation || Date.now() - record.createdAt > MAX_AGE_MS || !same(record.stamp, stamp(bot))) throw failure('PREPARED_GOAL_INVALID', 'Preparation superseded during handoff')
  checkpoint(bot, record.signal)
  return withContext({ failureGuard: new FailureGuard() }, async () => {
    // Inventory is read after drain. Environmental predicates need a new observation.
    let world = liveWorld(bot, sm, record.world)
    if (needsObservation(record.goal) || !hasLiveFacts(sm)) {
      await sm.refresh(bot); checkpoint(bot, signal); world = await sm.getState(bot)
    }
    const target = targetFor(record.goal, world, bot)
    if (isGoalSatisfied(target, buildState(world, bot.version))) return
    const tools = await runner.buildPickaxePreparationGoals(record.goal, { ...world, inventory: buildState(world, bot.version).inventory }, bot)
    checkpoint(bot, signal)
    if (record.executionGoal !== record.goal && tools[0] === record.executionGoal) {
      const reporter = require('./progress').progress(bot)
      reporter?.stack.push(record.goal)
      try { await runner(bot, 'api', record.executionGoal, sm, signal, 0, 10, null, null, false, { plan: record.plan, world }) }
      finally { reporter?.stack.pop() }
      await runner(bot, 'api', record.goal, sm, signal)
    } else if (record.executionGoal === record.goal && !tools.length && record.plan.length) {
      await runner(bot, 'api', record.goal, sm, signal, 0, 10, null, null, false, { plan: record.plan, world })
    } else {
      // A stale empty plan or newly missing tool must never report unconditional success.
      await runner(bot, 'api', record.goal, sm, signal)
    }
    await sm.refresh(bot); checkpoint(bot, signal)
    const final = await sm.getState(bot)
    if (!isGoalSatisfied(target, buildState(final, bot.version))) throw failure('GOAL_NOT_SATISFIED', 'Execution finished without satisfying the goal', { goal: record.goal, target })
  })
}
function invalidateDomain() {
  for (const ref of liveStores) {
    const store = ref.deref()
    if (!store) { liveStores.delete(ref); continue }
    store.generation++; store.handles.clear(); store.candidates.clear()
  }
}
module.exports = { retain, prepare, consume, execute, invalidate, invalidateDomain, HANDOFF }
