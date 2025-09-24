const fs = require('fs')
const path = require('path')
const YAML = require('yaml')

const CONFIG_PATH = path.join(__dirname, '../../config/actions.yaml')
const MAX_ITERATIONS = 500

let domain

function loadDomain() {
  if (domain) return domain
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  const parsed = YAML.parse(raw)
  if (!parsed || !Array.isArray(parsed.actions)) {
    throw new Error('actions.yaml に actions 配列が定義されていません')
  }
  domain = parsed
  return domain
}

function plan(goalName, worldState) {
  const domainConfig = loadDomain()
  const actions = domainConfig.actions
  const goalAction = actions.find((action) => action.name === goalName)

  if (!goalAction) {
    console.warn(`goal ${goalName} に対応するアクションが見つかりません`)
    return null
  }

  const initialState = buildState(worldState)
  const open = [{
    state: initialState,
    cost: 0,
    actions: []
  }]

  const visited = new Map()
  visited.set(serializeState(initialState), 0)

  let iterations = 0

  while (open.length > 0 && iterations++ < MAX_ITERATIONS) {
    open.sort((a, b) => a.cost - b.cost)
    const current = open.shift()

    if (isGoalSatisfied(goalAction, current.state)) {
      return [...current.actions, toPlanStep(goalAction)]
    }

    for (const action of actions) {
      if (action.name === goalAction.name) continue
      if (!arePreconditionsSatisfied(action.preconditions, current.state)) continue

      const nextState = applyEffects(action.effects, current.state)
      const stepCost = Number.isFinite(action.cost) ? action.cost : 1
      const totalCost = current.cost + stepCost
      const signature = serializeState(nextState)

      if (visited.has(signature) && visited.get(signature) <= totalCost) continue

      visited.set(signature, totalCost)
      open.push({
        state: nextState,
        cost: totalCost,
        actions: [...current.actions, toPlanStep(action)]
      })
    }
  }

  console.warn(`goal ${goalName} のプランを見つけられませんでした`)
  return null
}

function buildState(worldState) {
  const facts = Object.create(null)

  facts.inventory_space = true

  const counts = worldState?.inventory?.counts || {}

  let logCount = 0
  let plankCount = 0

  for (const [name, count] of Object.entries(counts)) {
    if (name.endsWith('_log')) logCount += count
    if (name.endsWith('_planks')) plankCount += count
    if (name === 'stick') facts.has_stick = count
    if (name === 'crafting_table') facts.has_workbench = count > 0
    if (name === 'wooden_pickaxe') facts.has_wooden_pickaxe = count > 0
  }

  facts.has_log = logCount
  facts.has_plank = plankCount

  if (typeof facts.has_stick !== 'number') facts.has_stick = 0
  if (typeof facts.has_workbench !== 'boolean') facts.has_workbench = false
  if (typeof facts.has_wooden_pickaxe !== 'boolean') facts.has_wooden_pickaxe = false

  return facts
}

function isGoalSatisfied(goalAction, state) {
  return arePreconditionsSatisfied(goalAction.preconditions, state)
}

function arePreconditionsSatisfied(preconditions = {}, state) {
  return Object.entries(preconditions).every(([key, condition]) => {
    const value = state[key]
    return evaluateCondition(value, condition)
  })
}

function applyEffects(effects = {}, state) {
  const next = { ...state }

  for (const [key, rawEffect] of Object.entries(effects)) {
    if (typeof rawEffect === 'number') {
      next[key] = rawEffect
      continue
    }

    if (typeof rawEffect === 'boolean') {
      next[key] = rawEffect
      continue
    }

    if (typeof rawEffect === 'string') {
      const effect = rawEffect.trim()

      if (/^[+-]\d+$/.test(effect)) {
        const delta = Number(effect)
        const current = typeof next[key] === 'number' ? next[key] : Number(next[key]) || 0
        next[key] = current + delta
        continue
      }

      if (/^-?\d+$/.test(effect)) {
        next[key] = Number(effect)
        continue
      }

      if (effect === 'true' || effect === 'false') {
        next[key] = effect === 'true'
        continue
      }

      next[key] = effect
      continue
    }

    next[key] = rawEffect
  }

  return normaliseNumericState(next)
}

function evaluateCondition(value, condition) {
  if (typeof condition === 'boolean') {
    return Boolean(value) === condition
  }

  if (typeof condition === 'number') {
    return Number(value) === condition
  }

  if (typeof condition === 'string') {
    const trimmed = condition.trim()

    if (trimmed === 'true' || trimmed === 'false') {
      return Boolean(value) === (trimmed === 'true')
    }

    const comparison = trimmed.match(/^(>=|<=|==|!=|>|<)\s*(-?\d+)$/)
    if (comparison) {
      const [, operator, rawNumber] = comparison
      const target = Number(rawNumber)
      const actual = Number(value) || 0
      switch (operator) {
        case '>': return actual > target
        case '>=': return actual >= target
        case '<': return actual < target
        case '<=': return actual <= target
        case '==': return actual === target
        case '!=': return actual !== target
        default: return false
      }
    }

    if (/^-?\d+$/.test(trimmed)) {
      return Number(value) === Number(trimmed)
    }
  }

  return value === condition
}

function normaliseNumericState(state) {
  const next = { ...state }
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'number' && value < 0) {
      next[key] = 0
    }
  }
  return next
}

function serializeState(state) {
  const sorted = Object.keys(state).sort().map((key) => `${key}:${JSON.stringify(state[key])}`)
  return sorted.join('|')
}

function toPlanStep(action) {
  return {
    action: action.name,
    skill: action.skill,
    params: action.params || null,
    cost: Number.isFinite(action.cost) ? action.cost : 1
  }
}

module.exports = {
  plan
}
