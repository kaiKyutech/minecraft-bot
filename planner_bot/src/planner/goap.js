const fs = require('fs')
const path = require('path')
const YAML = require('yaml')
const { buildState, loadStateSchema, calculateCompositeStates } = require('./state_builder')

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

  // console.log(`[GOAP Debug] goalInput: ${goalInput}`)
  // console.log(`[GOAP Debug] parsedGoal.type: ${parsedGoal.type}`)
  // console.log(`[GOAP Debug] goalState:`, goalState)
  // console.log(`[GOAP Debug] adjustedGoal:`, adjustedGoal)
  // console.log(`[GOAP Debug] initialState (relevant):`, {
  //   has_log: initialState.has_log,
  //   has_plank: initialState.has_plank,
  //   has_stick: initialState.has_stick,
  //   has_wooden_pickaxe: initialState.has_wooden_pickaxe,
  //   nearby_workbench: initialState.nearby_workbench
  // })

  // 関連性フィルタリング: ゴールに関連するアクションだけを抽出
  const relevantVars = analyzeRelevantVariables(adjustedGoal, actions)
  const filteredActions = actions.filter(action => isActionRelevant(action, relevantVars))

  console.log(`[GOAP] 関連変数:`, Array.from(relevantVars))
  console.log(`[GOAP] アクション数: ${actions.length} → ${filteredActions.length}`)
  console.log(`[GOAP] フィルタされたアクション:`, filteredActions.map(a => a.name))

  // 斧関連のアクションが含まれているか確認
  const axeRelated = filteredActions.filter(a => a.name.includes('axe') || a.name.includes('with_axe'))
  if (axeRelated.length > 0) {
    console.log(`[GOAP] 斧関連アクション:`, axeRelated.map(a => a.name))
  } else {
    console.log(`[GOAP] 警告: 斧関連アクションがフィルタされています`)
  }

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

    for (const action of filteredActions) {
      if (!arePreconditionsSatisfied(action.preconditions, current.state)) {
        // デバッグ: どのアクションが前提条件を満たさないか
        // if (iterations <= 5) {
        //   console.log(`[GOAP Debug] Action ${action.name} failed preconditions`)
        //   console.log(`  Preconditions:`, action.preconditions)
        //   console.log(`  Current state:`, current.state)
        // }
        continue
      }

      const nextState = applyEffects(action.effects, current.state)
      // if (iterations <= 5) {
      //   console.log(`[GOAP Debug] Action ${action.name} passed, nextState:`, nextState)
      //   console.log(`[GOAP Debug]   has_any_axe: ${nextState.has_any_axe}, has_wooden_axe: ${nextState.has_wooden_axe}`)
      // }
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
 * @param {string} input - ユーザー入力（例: "has_log:8", "inventory.furnace:1", "craft_wooden_pickaxe"）
 * @returns {Object|null} パース結果
 */
function parseGoalInput(input) {
  const trimmed = input.trim()

  // パターン1: ドット記法の状態指定（例: "inventory.furnace:1", "inventory.iron_ingot:5"）
  if (/^[a-z_]+\.[a-z_]+:\d+$/.test(trimmed)) {
    const [key, value] = trimmed.split(':')
    return {
      type: 'state',
      state: { [key]: Number(value) }
    }
  }

  // パターン2: 従来の状態指定（例: "has_log:8", "has_wooden_pickaxe:2"）
  if (/^has_[a-z_]+:\d+$/.test(trimmed)) {
    const [key, value] = trimmed.split(':')
    return {
      type: 'state',
      state: { [key]: Number(value) }
    }
  }

  // パターン3: アクション名（例: "craft_wooden_pickaxe", "gather_logs"）
  if (/^[a-z_]+$/.test(trimmed)) {
    return {
      type: 'action',
      actionName: trimmed
    }
  }

  // パターン4: アクション+パラメータ（将来の拡張用）
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
    let value

    // ドット記法のサポート（例: "inventory.iron_ingot"）
    if (key.includes('.')) {
      const parts = key.split('.')
      value = state
      for (const part of parts) {
        value = value?.[part]
        if (value === undefined) break
      }
    } else {
      value = state[key]
    }

    return evaluateCondition(value, condition)
  })
}

function applyEffects(effects = {}, state) {
  const next = { ...state }

  for (const [key, rawEffect] of Object.entries(effects)) {
    // ドット記法のサポート（例: "inventory.iron_ingot: -3"）
    if (key.includes('.')) {
      const parts = key.split('.')
      const lastKey = parts.pop()

      // ネストされたオブジェクトをイミュータブルにコピー
      let current = next
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (!current[part]) {
          current[part] = {}
        } else if (current[part] === state[part]) {
          // 元のstateと同じ参照なら、コピーを作成
          current[part] = { ...current[part] }
        }
        current = current[part]
      }

      // 効果を適用
      if (typeof rawEffect === 'string' && /^[+-]\d+$/.test(rawEffect.trim())) {
        const delta = Number(rawEffect)
        const oldValue = typeof current[lastKey] === 'number' ? current[lastKey] : Number(current[lastKey]) || 0
        current[lastKey] = Math.max(0, oldValue + delta)
      } else if (typeof rawEffect === 'number') {
        current[lastKey] = Math.max(0, rawEffect)
      } else {
        current[lastKey] = rawEffect
      }
      continue
    }

    // 既存のロジック（ドット記法以外）
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

  const normalized = normaliseNumericState(next)
  // state_builder.jsの共有関数を使用して複合状態を再計算
  calculateCompositeStates(normalized)
  return normalized
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

/**
 * state_schema.yamlから複合状態の依存関係を読み込む
 * @returns {Object} 複合状態名をキー、依存変数配列を値とするマップ
 */
function loadCompositeStateDependencies() {
  const schema = loadStateSchema()
  const dependencies = {}

  // inventory_states, environment_states, world_statesの全てをチェック
  for (const section of ['inventory_states', 'environment_states', 'world_states']) {
    if (!schema[section]) continue

    for (const [stateName, config] of Object.entries(schema[section])) {
      // computed: true かつ depends_on が定義されている場合（旧方式）
      if (config.computed && Array.isArray(config.depends_on)) {
        dependencies[stateName] = config.depends_on
      }

      // computed: true かつ depends_on_inventory が定義されている場合（新方式）
      if (config.computed && Array.isArray(config.depends_on_inventory)) {
        // inventoryアイテムを "inventory.item_name" 形式に変換
        dependencies[stateName] = config.depends_on_inventory.map(
          itemName => `inventory.${itemName}`
        )
      }
    }
  }

  return dependencies
}

/**
 * 後方解析: ゴールに関連する状態変数を特定
 * @param {Object} goal - 目標状態
 * @param {Array} actions - 全アクション
 * @returns {Set} 関連する状態変数のセット
 */
function analyzeRelevantVariables(goal, actions) {
  const relevant = new Set(Object.keys(goal))
  const queue = [...relevant]

  // state_schema.yamlから複合状態の依存関係を動的に読み込む
  const compositeStateDependencies = loadCompositeStateDependencies()

  while (queue.length > 0) {
    const variable = queue.shift()

    // 複合状態の場合、その依存変数も追加
    if (compositeStateDependencies[variable]) {
      for (const depVar of compositeStateDependencies[variable]) {
        if (!relevant.has(depVar)) {
          relevant.add(depVar)
          queue.push(depVar)
        }
      }
    }

    // この変数に影響を与えるアクションを探す
    for (const action of actions) {
      // このアクションの効果にvariableが含まれているか
      if (action.effects && action.effects[variable] !== undefined) {
        // このアクションの前提条件も関連する
        if (action.preconditions) {
          for (const preVar of Object.keys(action.preconditions)) {
            if (!relevant.has(preVar)) {
              relevant.add(preVar)
              queue.push(preVar)
            }
          }
        }
      }
    }
  }

  return relevant
}

/**
 * アクションが関連変数に影響するかチェック
 * @param {Object} action - アクション
 * @param {Set} relevantVars - 関連変数のセット
 * @returns {boolean} 関連があればtrue
 */
function isActionRelevant(action, relevantVars) {
  // アクションの効果が関連変数のいずれかに影響するか
  if (action.effects) {
    for (const effectVar of Object.keys(action.effects)) {
      if (relevantVars.has(effectVar)) {
        return true
      }
    }
  }
  return false
}

module.exports = {
  plan,
  loadDomain,
  evaluateCondition,
  arePreconditionsSatisfied
}
