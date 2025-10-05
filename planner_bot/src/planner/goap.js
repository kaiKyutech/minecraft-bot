const fs = require('fs')
const path = require('path')
const YAML = require('yaml')
const { buildState } = require('./state_builder')

const ACTIONS_DIR = path.join(__dirname, '../../config/actions')
const ACTION_FILES = [
  'gather_actions.yaml',
  'hand_craft_actions.yaml',
  'workbench_craft_actions.yaml',
  'movement_actions.yaml'
]
const MAX_ITERATIONS = 2000

let domain

function loadDomain() {
  if (domain) return domain

  // 複数のアクションファイルを読み込んでマージ
  let allActions = []

  for (const filename of ACTION_FILES) {
    const filepath = path.join(ACTIONS_DIR, filename)
    try {
      const raw = fs.readFileSync(filepath, 'utf8')
      const parsed = YAML.parse(raw)
      if (parsed && Array.isArray(parsed.actions)) {
        allActions = allActions.concat(parsed.actions)
        console.log(`[GOAP] ${filename} から ${parsed.actions.length} 個のアクションを読み込みました`)
      }
    } catch (error) {
      console.error(`[GOAP] ${filename} の読み込みに失敗: ${error.message}`)
    }
  }

  if (allActions.length === 0) {
    throw new Error('アクションが1つも読み込まれませんでした')
  }

  domain = { actions: allActions }
  console.log(`[GOAP] 合計 ${allActions.length} 個のアクションを読み込みました`)
  return domain
}

function plan(goalInput, worldState) {
  const domainConfig = loadDomain()
  const actions = domainConfig.actions

  // 目標入力をパース
  const parsedGoal = parseGoalInput(goalInput)
  if (!parsedGoal) {
    console.warn(`無効な目標形式です: ${goalInput}`)
    return null
  }

  // 目標状態を取得
  const goalState = getGoalStateFromParsed(parsedGoal)
  if (!goalState) {
    console.warn(`未知の目標です: ${goalInput}`)
    return null
  }

  const initialState = buildState(worldState)

  // 状態指定の場合は、現在値を考慮して調整
  const adjustedGoal = adjustGoalForCurrentState(goalState, initialState, parsedGoal)

  console.log(`[GOAP Debug] goalInput: ${goalInput}`)
  console.log(`[GOAP Debug] parsedGoal.type: ${parsedGoal.type}`)
  console.log(`[GOAP Debug] goalState:`, goalState)
  console.log(`[GOAP Debug] adjustedGoal:`, adjustedGoal)
  console.log(`[GOAP Debug] initialState (relevant):`, {
    has_log: initialState.has_log,
    has_plank: initialState.has_plank,
    has_stick: initialState.has_stick,
    has_wooden_pickaxe: initialState.has_wooden_pickaxe,
    nearby_workbench: initialState.nearby_workbench
  })

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

    if (iterations <= 10 || current.state.has_workbench > 0) {
      console.log(`[GOAP Debug Iter ${iterations}] Current state has_workbench: ${current.state.has_workbench}, has_plank: ${current.state.has_plank}, has_stick: ${current.state.has_stick}, nearby_workbench: ${current.state.nearby_workbench}`)
    }

    if (isGoalSatisfied(adjustedGoal, current.state)) {
      return current.actions
    }

    for (const action of actions) {
      if (!arePreconditionsSatisfied(action.preconditions, current.state)) {
        // デバッグ: どのアクションが前提条件を満たさないか
        if (iterations <= 5) {
          console.log(`[GOAP Debug] Action ${action.name} failed preconditions`)
          console.log(`  Preconditions:`, action.preconditions)
          console.log(`  Current state:`, current.state)
        }
        continue
      }

      const nextState = applyEffects(action.effects, current.state)
      if (iterations <= 5) {
        console.log(`[GOAP Debug] Action ${action.name} passed, nextState:`, nextState)
      }
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

  console.warn(`goal ${goalInput} のプランを見つけられませんでした`)
  return null
}

// buildState関数は state_builder.js に移動

/**
 * 目標入力をパース
 * @param {string} input - ユーザー入力（例: "has_log:8", "craft_wooden_pickaxe"）
 * @returns {Object|null} パース結果
 */
function parseGoalInput(input) {
  const trimmed = input.trim()

  // パターン1: 状態指定（例: "has_log:8", "has_wooden_pickaxe:2"）
  if (/^has_[a-z_]+:\d+$/.test(trimmed)) {
    const [key, value] = trimmed.split(':')
    return {
      type: 'state',
      state: { [key]: Number(value) }
    }
  }

  // パターン2: アクション名（例: "craft_wooden_pickaxe", "gather_logs"）
  if (/^[a-z_]+$/.test(trimmed)) {
    return {
      type: 'action',
      actionName: trimmed
    }
  }

  // パターン3: アクション+パラメータ（将来の拡張用）
  // 例: "gather_logs count:8"
  const match = trimmed.match(/^([a-z_]+)\s+(.+)$/)
  if (match) {
    const [, actionName, paramsStr] = match
    const params = parseParams(paramsStr)
    return {
      type: 'action_with_params',
      actionName: actionName,
      params: params
    }
  }

  return null
}

/**
 * パラメータ文字列をパース
 * @param {string} str - パラメータ文字列（例: "count:8", "count:8,quality:high"）
 * @returns {Object} パラメータオブジェクト
 */
function parseParams(str) {
  const params = {}
  const pairs = str.split(',')
  for (const pair of pairs) {
    const [key, value] = pair.split(':')
    if (key && value) {
      params[key.trim()] = isNaN(value) ? value.trim() : Number(value)
    }
  }
  return params
}

/**
 * パース済みの目標から目標状態を取得
 * @param {Object} parsedGoal - パース済み目標
 * @returns {Object|null} 目標状態
 */
function getGoalStateFromParsed(parsedGoal) {
  if (parsedGoal.type === 'state') {
    // 状態指定の場合はそのまま返す
    return parsedGoal.state
  } else if (parsedGoal.type === 'action') {
    // アクション名の場合は従来のロジック
    return getGoalState(parsedGoal.actionName)
  } else if (parsedGoal.type === 'action_with_params') {
    // パラメータ付きアクション（将来の拡張）
    return getGoalState(parsedGoal.actionName)
  }
  return null
}

/**
 * 現在値を考慮してゴールを調整
 * @param {Object} goalState - 目標状態
 * @param {Object} currentState - 現在状態
 * @param {Object} parsedGoal - パース済み目標
 * @returns {Object} 調整済みゴール
 */
function adjustGoalForCurrentState(goalState, currentState, parsedGoal) {
  // 状態指定・アクション名指定の両方で現在値に加算する
  // これにより、同じアイテムを複数回作成したり、既に持っているアイテムをさらに追加できる
  const adjusted = {}
  for (const [key, targetValue] of Object.entries(goalState)) {
    const current = currentState[key] || 0
    if (typeof targetValue === 'number') {
      // 現在の値に加算して目標とする
      adjusted[key] = current + targetValue
    } else {
      adjusted[key] = targetValue
    }
  }
  return adjusted
}

function getGoalState(goalName) {
  const domain = loadDomain()

  // アクション名と一致するアクションを探す
  const action = domain.actions.find(a => a.name === goalName)

  if (!action) {
    console.warn(`未知の目標です: ${goalName}`)
    return null
  }

  // そのアクションの正の効果（増加する効果）をゴール状態として返す
  return extractPositiveEffects(action.effects)
}

/**
 * アクションの効果から正の効果（増加する効果）のみを抽出
 * @param {Object} effects - アクションの効果
 * @returns {Object} 正の効果のみを含むオブジェクト
 */
function extractPositiveEffects(effects) {
  if (!effects || typeof effects !== 'object') {
    return {}
  }

  const positiveEffects = {}

  for (const [key, value] of Object.entries(effects)) {
    // 文字列で減少を示す場合（例: "-2", "-3"）はスキップ
    if (typeof value === 'string' && value.startsWith('-')) {
      continue
    }

    // 文字列で増加を示す場合（例: "+4"）
    // これは相対的な増加なので絶対値に変換できない → スキップ
    // （ただし、将来的には現在値を考慮して目標値を設定することも可能）
    if (typeof value === 'string' && value.startsWith('+')) {
      const delta = Number(value)
      if (delta > 0) {
        // とりあえず増加分をそのまま目標値とする
        // 例: "+4" → 4 （現在値+4ではなく、4個を目標とする）
        positiveEffects[key] = delta
      }
      continue
    }

    // 数値の場合: 正の値のみ
    if (typeof value === 'number' && value > 0) {
      positiveEffects[key] = value
    }
    // booleanでtrueの場合
    else if (value === true || value === 'true') {
      positiveEffects[key] = true
    }
    // 文字列で数値の場合
    else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      const num = Number(value.trim())
      if (num > 0) {
        positiveEffects[key] = num
      }
    }
  }

  return positiveEffects
}

function isGoalSatisfied(goalState, state) {
  return arePreconditionsSatisfied(goalState, state)
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
  plan,
  loadDomain,
  evaluateCondition,
  arePreconditionsSatisfied
}
