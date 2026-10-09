const { performance } = require('node:perf_hooks')
const { failure } = require('../utils/result')
const { buildState } = require('./state_builder')
const { reachable, needsPresence } = require('./reachability')
const { getStateValue } = require('./state_operations')
const { parseGoalInput, getGoalStateFromParsed, adjustGoalForCurrentState } = require('./goals')

const present = value => typeof value === 'number' ? value > 0 : Boolean(value)
function check(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'CANCELLED' })
}
function goalResults(goals, actions, state, keys, complete) {
  return goals.map(goal => {
    const parsed = parseGoalInput(goal)
    const target = parsed && getGoalStateFromParsed(parsed, actions)
    if (!target) return { goal, status: complete ? 'invalid' : 'unknown', provenImpossible: false, missingKeys: [], reason: complete ? 'invalid_goal' : 'budget_exceeded' }
    const adjusted = adjustGoalForCurrentState(target, state, parsed)
    const missingKeys = Object.entries(adjusted).filter(([key, value]) => needsPresence(value) && !present(getStateValue(state, key)) && !keys.has(key)).map(([key]) => key)
    const status = !missingKeys.length ? 'possible' : complete ? 'unreachable' : 'unknown'
    return { goal, status, provenImpossible: status === 'unreachable', missingKeys, reason: status === 'unreachable' ? 'relaxed_unreachable' : status === 'unknown' ? 'budget_exceeded' : null }
  })
}

// Runs in the existing planning worker. The optional metadata collector uses
// exactly the closure used by evaluateGoals/plan; it does not change its keys.
function compute(world, goals, deadline, signal) {
  check(signal)
  const start = performance.now(), state = buildState(world)
  const actions = require('./goap').getAllActions(), details = {}
  reachable(actions, state, deadline, signal, details)
  // Also expose initial leaf facts outside action keys. GOAP checks these
  // directly for goals; do not introduce them into the legacy closure's seeds.
  function initialLeaves(value, prefix = '') {
    for (const [name, item] of Object.entries(value || {})) {
      const key = prefix ? prefix + '.' + name : name
      if (item && typeof item === 'object') initialLeaves(item, key)
      else if (present(item)) details.facts.set(key, { key, initial: true, round: 0, firstAction: null, source: 'initial', derivedFrom: null })
    }
  }
  initialLeaves(state)
  const keys = new Set(details.facts.keys())
  const results = goalResults(goals, actions, state, keys, details.complete)
  check(signal)
  return { facts: [...details.facts.values()], goals: results, closureMs: performance.now() - start, rounds: details.rounds, complete: details.complete, timedOut: details.timedOut, actionCount: actions.length }
}

async function reachableFacts(bot, stateManager, options = {}) {
  const maxMs = options.maxMs ?? 1000, goals = options.goals ?? [], signal = options.signal
  if (!Number.isFinite(maxMs) || maxMs < 0) throw failure('INVALID_ARGUMENT', 'maxMs must be finite and non-negative')
  if (!Array.isArray(goals) || goals.some(goal => typeof goal !== 'string' || !goal.trim())) throw failure('INVALID_ARGUMENT', 'goals must be an array of goal strings')
  let world = options.worldState
  if (world !== undefined && (!world || typeof world !== 'object' || Array.isArray(world) || world.kind === 'fast_observation' || world.complete === false)) throw failure('INVALID_ARGUMENT', 'reachableFacts requires a full worldState from observe()')
  check(signal)
  const start = performance.now(), deadline = start + maxMs
  let observationMs = 0, preparationMs = 0, observationComplete = Boolean(world), result
  const timedOut = () => ({ facts: [], goals: goals.map(goal => ({ goal, status: 'unknown', provenImpossible: false, missingKeys: [], reason: 'budget_exceeded' })), closureMs: 0, rounds: 0, complete: false, timedOut: true, actionCount: null })
  if (!world && performance.now() < deadline) {
    const t = performance.now()
    try { world = await stateManager.observe(bot, { deadline, signal }); observationComplete = true }
    catch (error) { if (error.code !== 'BUDGET_EXCEEDED') throw error }
    finally { observationMs = performance.now() - t }
  }
  check(signal)
  if (world && performance.now() < deadline) {
    const service = require('./planning_service'), t = performance.now()
    await service.prepare(bot.version)
    preparationMs = performance.now() - t
    check(signal)
    if (performance.now() < deadline) {
      try { result = await service.reachableFacts(world, goals, { deadline, signal, version: bot.version }) }
      catch (error) { if (error.code !== 'BUDGET_EXCEEDED') throw error }
    }
  }
  check(signal)
  return { ...(result || timedOut()), observationComplete, observationMs, preparationMs, durationMs: performance.now() - start }
}
module.exports = { reachableFacts, compute }
