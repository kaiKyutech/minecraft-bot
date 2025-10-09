const fs = require('fs')
const path = require('path')
const YAML = require('yaml')
const { buildState, loadStateSchema, calculateCompositeStates } = require('./state_builder')

const ACTIONS_DIR = path.join(__dirname, '../../config/actions')
const ACTION_FILES = [
  'gather_actions.yaml',
  'hand_craft_actions.yaml',
  'workbench_craft_actions.yaml',
  'movement_actions.yaml',
  'furnace_actions.yaml'
]
const MAX_ITERATIONS = process.env.GOAP_MAX_ITERATIONS ? Number(process.env.GOAP_MAX_ITERATIONS) : 2000

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

  let goalAction = null
  if (parsedGoal.type === 'action' || parsedGoal.type === 'action_with_params') {
    goalAction = actions.find(a => a.name === parsedGoal.actionName) || null
    if (!goalAction) {
      console.warn(`未知の目標です: ${goalInput}`)
      return null
    }
  }

  // 目標状態を取得
  const goalState = getGoalStateFromParsed(parsedGoal, actions, goalAction)
  if (!goalState) {
    console.warn(`未知の目標です: ${goalInput}`)
    return null
  }

  const initialState = buildState(worldState)

  // 状態指定の場合は、現在値を考慮して調整
  const adjustedGoal = adjustGoalForCurrentState(goalState, initialState, parsedGoal)

  // デバッグ出力（必要に応じてコメント解除）
  // console.log(`[GOAP Debug] goalInput: ${goalInput}`)
  // console.log(`[GOAP Debug] parsedGoal.type: ${parsedGoal.type}`)
  // console.log(`[GOAP Debug] goalState:`, goalState)
  // console.log(`[GOAP Debug] adjustedGoal:`, adjustedGoal)
  // console.log(`[GOAP Debug] initialState.inventory:`, initialState.inventory)

  let filteredActions = actions

  if (process.env.GOAP_DISABLE_ACTION_FILTER !== '1') {
    const relevantVars = analyzeRelevantVariables(adjustedGoal, actions, initialState)
    filteredActions = actions.filter(action => isActionRelevant(action, relevantVars))
    console.log(`[GOAP] 関連変数 (${relevantVars.size}個):`, Array.from(relevantVars).sort())
    console.log(`[GOAP] アクション数: ${actions.length} → ${filteredActions.length}`)

    // デバッグ: フィルタリングされたアクションのリスト
    if (process.env.GOAP_DEBUG_ACTIONS === '1') {
      console.log(`[GOAP] フィルタリング後のアクション:`)
      filteredActions.forEach(a => console.log(`  - ${a.name}`))
      console.log(`[GOAP] 除外されたアクション (${actions.length - filteredActions.length}個):`)
      const excludedActions = actions.filter(a => !filteredActions.includes(a))
      excludedActions.forEach(a => console.log(`  - ${a.name}`))
    }
  } else {
    console.log(`[GOAP] アクション数: ${actions.length}`)
  }


  const open = [{
    state: initialState,
    cost: 0,
    actions: []
  }]

  const visited = new Map()
  visited.set(serializeState(initialState), 0)

  let iterations = 0

  const heuristicContext = buildHeuristicContext(adjustedGoal, goalAction, filteredActions)

  // ヒューリスティック値をキャッシュ
  const hCache = new Map()
  const getF = (node) => {
    const sig = serializeState(node.state)
    if (!hCache.has(sig)) {
      hCache.set(sig, calculateHeuristic(node.state, heuristicContext))
    }
    return node.cost + hCache.get(sig)
  }

  while (open.length > 0 && iterations++ < MAX_ITERATIONS) {
    // A*アルゴリズム: f(n) = g(n) + h(n)
    // g(n) = これまでの実コスト (a.cost)
    // h(n) = ゴールまでの推定コスト (heuristic)
    open.sort((a, b) => getF(a) - getF(b))
    const current = open.shift()

    // デバッグ出力（環境変数で制御）
    const debugInterval = process.env.GOAP_DEBUG_INTERVAL ? Number(process.env.GOAP_DEBUG_INTERVAL) : 100
    const shouldLog = iterations <= 10 || iterations % debugInterval === 0

    if (shouldLog) {
      // ログ出力時は必ずh(n)を計算（キャッシュミスを避ける）
      const h = calculateHeuristic(current.state, heuristicContext)
      const f = current.cost + h
      const actionPreview = current.actions.length > 3
        ? `...${current.actions.slice(-3).map(a => a.action).join(' → ')}`
        : current.actions.map(a => a.action).join(' → ')

      console.log(`[GOAP Iter ${iterations}] queue:${open.length} visited:${visited.size} g:${current.cost} h:${h} f:${f}`)
      console.log(`  actions(${current.actions.length}): [${actionPreview || 'none'}]`)
    }

    // gather_logsを含む経路の追跡（デバッグ用）
    // if (current.actions.some(a => a.action && a.action.includes('gather_logs'))) {
    //   const h = calculateHeuristic(current.state, heuristicContext)
    //   console.log(`[GOAP Debug Iter ${iterations}] ★ Processing gather_logs path:`)
    //   console.log(`  Actions: [${current.actions.map(a => a.action).join(' → ')}]`)
    //   console.log(`  g(n)=${current.cost}, h(n)=${h}, f(n)=${current.cost + h}`)
    //   console.log(`  has_log: ${current.state.has_log}, nearby_furnace: ${current.state.nearby_furnace}`)
    // }

    if (isGoalSatisfied(adjustedGoal, current.state)) {
      console.log(`\n[GOAP] ✓ プラン発見`)
      console.log(`  イテレーション: ${iterations}, ステップ数: ${current.actions.length}, 総コスト: ${current.cost}`)
      return current.actions
    }

    for (const action of filteredActions) {
      if (!arePreconditionsSatisfied(action.preconditions, current.state)) {
        continue
      }

      // リソース収集の合理的上限チェック（探索空間の爆発を防ぐ）
      const nextState = applyEffects(action.effects, current.state)

      // 各リソースの合理的な上限（Minecraftの1スタック = 64個を基準）
      const RESOURCE_LIMITS = {
        'has_log': 32,
        'has_plank': 64,
        'has_stick': 64,
        'has_cobblestone': 64
      }

      // 上限を超えるリソース収集は行わない
      let exceedsLimit = false
      for (const [key, limit] of Object.entries(RESOURCE_LIMITS)) {
        if (nextState[key] && nextState[key] > limit) {
          exceedsLimit = true
          break
        }
      }

      if (exceedsLimit) {
        continue
      }

      const stepCost = Number.isFinite(action.cost) ? action.cost : 1
      const totalCost = current.cost + stepCost
      const signature = serializeState(nextState)

      if (visited.has(signature) && visited.get(signature) <= totalCost) {
        continue
      }

      visited.set(signature, totalCost)
      open.push({
        state: nextState,
        cost: totalCost,
        actions: [...current.actions, toPlanStep(action)]
      })
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(`\n[GOAP] ❌ プラン未発見 (タイムアウト)`)
    console.warn(`  目標: ${goalInput}`)
    console.warn(`  イテレーション: ${iterations} (上限: ${MAX_ITERATIONS})`)
    console.warn(`  残り候補: ${open.length}, 訪問済み: ${visited.size}`)

    const frontierSample = summarizeFrontier(open, heuristicContext)
    if (frontierSample.length > 0) {
      console.warn(`\n  未展開候補トップ${frontierSample.length}件:`)
      frontierSample.forEach((entry, index) => {
        console.warn(`    ${index + 1}. f=${entry.f} (g=${entry.g}+h=${entry.h}) steps=${entry.depth}`)
        if (entry.depth <= 10) {
          // 短いプランは全アクション表示
          console.warn(`       ${entry.allActions.join(' → ')}`)
        } else {
          // 長いプランは最後の5アクションのみ表示
          console.warn(`       ...${entry.sampleActions.join(' → ')}`)
        }
      })
    }
  } else {
    console.warn(`\n[GOAP] ❌ プラン未発見 (候補枯渇)`)
    console.warn(`  目標: ${goalInput}`)
    console.warn(`  イテレーション: ${iterations}, 訪問済み: ${visited.size}`)
    console.warn(`  原因: 実行可能なアクションがありません`)
  }
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
function getGoalStateFromParsed(parsedGoal, actions, goalAction = null) {
  if (parsedGoal.type === 'state') {
    // 状態指定の場合はそのまま返す
    return parsedGoal.state
  }

  if (parsedGoal.type === 'action' || parsedGoal.type === 'action_with_params') {
    const action = goalAction || actions.find(a => a.name === parsedGoal.actionName)
    if (!action) {
      console.warn(`未知の目標です: ${parsedGoal.actionName}`)
      return null
    }
    return extractPositiveEffects(action.effects)
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
    let current = 0

    // ドット記法の処理（例: "inventory.charcoal"）
    if (key.includes('.')) {
      const parts = key.split('.')
      let value = currentState
      for (const part of parts) {
        value = value?.[part]
        if (value === undefined) {
          value = 0
          break
        }
      }
      current = typeof value === 'number' ? value : 0
    } else {
      current = currentState[key] || 0
    }

    if (typeof targetValue === 'number') {
      // 現在の値に加算して目標とする
      adjusted[key] = current + targetValue
    } else {
      adjusted[key] = targetValue
    }
  }
  return adjusted
}

function buildHeuristicContext(finalGoal, goalAction, actions) {
  return {
    finalGoal,
    actions,
    goalAction
  }
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

const HEURISTIC_MAX = MAX_ITERATIONS * 2

function calculateHeuristic(state, context = {}) {
  if (!context) {
    if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
      console.log('[HEURISTIC] WARNING: context is null/undefined')
    }
    return 0
  }

  const finalGoal = context.finalGoal || {}
  const actions = context.actions || []

  if (!finalGoal || Object.keys(finalGoal).length === 0) {
    if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
      console.log('[HEURISTIC] WARNING: finalGoal is empty')
    }
    return 0
  }

  const memo = new Map()
  let estimate = 0

  if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
    console.log('[HEURISTIC] Computing h(n) for goal:', finalGoal)
    console.log('[HEURISTIC] Current state summary:', {
      has_log: state.has_log,
      has_plank: state.has_plank,
      has_cobblestone: state.has_cobblestone,
      inventory_charcoal: state.inventory?.charcoal,
      inventory_iron_ingot: state.inventory?.iron_ingot
    })
  }

  for (const [key, target] of Object.entries(finalGoal)) {
    const requirement = buildRequirementFromGoalTarget(target)
    const steps = estimateRequirement(key, requirement, state, actions, memo, new Set())

    if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
      console.log(`[HEURISTIC] ${key} ${formatRequirement(requirement)} -> estimated cost: ${steps}`)
    }

    if (!Number.isFinite(steps)) {
      if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
        console.log(`[HEURISTIC] ERROR: ${key} returned non-finite value`)
      }
      return HEURISTIC_MAX
    }
    estimate = Math.max(estimate, steps)
  }

  if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
    console.log(`[HEURISTIC] Final h(n) = ${estimate}`)
  }

  return Math.min(estimate, HEURISTIC_MAX)
}

function estimateRequirement(key, requirement, state, actions, memo, visiting) {
  const signature = buildRequirementSignature(key, requirement, state)
  if (memo.has(signature)) return memo.get(signature)
  if (visiting.has(signature)) return HEURISTIC_MAX

  visiting.add(signature)

  const deficit = computeRequirementDeficit(key, requirement, state)
  if (deficit <= 0) {
    memo.set(signature, 0)
    visiting.delete(signature)
    return 0
  }

  const compositeEstimate = tryEstimateCompositeRequirement(key, requirement, state, actions, memo, visiting)
  if (compositeEstimate !== null) {
    memo.set(signature, compositeEstimate)
    visiting.delete(signature)
    return compositeEstimate
  }

  const candidateActions = findActionsForRequirement(key, requirement, actions)
  if (candidateActions.length === 0) {
    if (shouldDebugRequirement(key)) {
      console.log(`[HEURISTIC] 要求 ${key} ${formatRequirement(requirement)} を満たすアクションが見つかりません`)
    }
    memo.set(signature, HEURISTIC_MAX)
    visiting.delete(signature)
    return HEURISTIC_MAX
  }

  let best = HEURISTIC_MAX

  for (const action of candidateActions) {
    const contribution = computeActionContribution(action.effects[key], requirement)
    if (!contribution.canSatisfy) {
      continue
    }

    const repeats = requirement.type === 'numeric'
      ? Math.max(1, Math.ceil(deficit / Math.max(contribution.gain, 1)))
      : 1

    let preconditionCost = 0
    if (action.preconditions) {
      if (shouldDebugRequirement(key)) {
        console.log(`[HEURISTIC] ${key} <- ${action.name} (必要回数 ${repeats})`)
      }
      for (const [preKey, preCondition] of Object.entries(action.preconditions)) {
        const preRequirement = buildRequirementFromCondition(preCondition)
        const subCost = estimateRequirement(preKey, preRequirement, state, actions, memo, visiting)
        if (!Number.isFinite(subCost) || subCost >= HEURISTIC_MAX) {
          if (shouldDebugRequirement(key)) {
            console.log(`  [NG] 前提 ${preKey} ${formatRequirement(preRequirement)} の推定が失敗`)
          }
          preconditionCost = HEURISTIC_MAX
          break
        }
        preconditionCost = Math.max(preconditionCost, subCost)
        if (shouldDebugRequirement(key)) {
          console.log(`  [OK] 前提 ${preKey} ${formatRequirement(preRequirement)} -> 残り推定 ${subCost}`)
        }
      }
    }

    if (preconditionCost >= HEURISTIC_MAX) {
      continue
    }

    const actionCost = Number.isFinite(action.cost) ? action.cost : 1
    const total = preconditionCost + (actionCost * repeats)
    if (shouldDebugRequirement(key)) {
      console.log(`  => 推定コスト ${total} (前提: ${preconditionCost}, アクション: ${actionCost} x ${repeats})`)
    }
    if (total < best) {
      best = total
    }
  }

  if (best >= HEURISTIC_MAX && shouldDebugRequirement(key)) {
    console.log(`[HEURISTIC] 要求 ${key} ${formatRequirement(requirement)} の推定に失敗 (循環または未解決)`)
  }

  memo.set(signature, best)
  visiting.delete(signature)
  return best
}

function tryEstimateCompositeRequirement(key, requirement, state, actions, memo, visiting) {
  const dependenciesMap = loadCompositeStateDependencies()
  const deps = dependenciesMap[key]

  if (!deps || deps.length === 0) {
    return null
  }

  if (requirement.type === 'boolean' && requirement.value === true) {
    let best = HEURISTIC_MAX

    for (const depKey of deps) {
      const depRequirement = buildRequirementFromCompositeDependency(depKey)
      const steps = estimateRequirement(depKey, depRequirement, state, actions, memo, visiting)
      if (Number.isFinite(steps) && steps < best) {
        best = steps
      }
    }

    return best
  }

  return null
}

function buildRequirementFromCompositeDependency(depKey) {
  if (depKey.startsWith('inventory.')) {
    return { type: 'numeric', operator: '>=', value: 1 }
  }
  return { type: 'boolean', value: true }
}

function shouldDebugRequirement(key) {
  if (process.env.GOAP_DEBUG_HEURISTIC !== '1') return false
  const target = process.env.GOAP_DEBUG_TARGET
  if (!target) return true
  return target === key
}

function buildRequirementSignature(key, requirement, state) {
  const deficit = computeRequirementDeficit(key, requirement, state)
  return `${key}|${requirement.type}|${requirement.operator ?? ''}|${requirement.value}|${deficit}`
}

function formatRequirement(requirement) {
  if (!requirement) return 'unknown'
  if (requirement.type === 'numeric') {
    return `${requirement.operator || '>='} ${requirement.value}`
  }
  if (requirement.type === 'boolean') {
    return `== ${requirement.value}`
  }
  return `== ${requirement.value}`
}

function computeRequirementDeficit(key, requirement, state) {
  const actual = getStateValue(state, key)

  switch (requirement.type) {
    case 'numeric': {
      const value = Number(actual) || 0
      switch (requirement.operator) {
        case '>':
          return Math.max(0, (requirement.value + 1) - value)
        case '>=':
          return Math.max(0, requirement.value - value)
        case '==':
          return Math.max(0, Math.abs(requirement.value - value))
        case '!=':
          return value === requirement.value ? 1 : 0
        case '<':
          return value < requirement.value ? 0 : 1
        case '<=':
          return value <= requirement.value ? 0 : 1
        default:
          return Math.max(0, requirement.value - value)
      }
    }
    case 'boolean': {
      const current = Boolean(actual)
      return current === requirement.value ? 0 : 1
    }
    case 'exact':
    default: {
      return actual === requirement.value ? 0 : 1
    }
  }
}

function buildRequirementFromGoalTarget(target) {
  if (typeof target === 'number') {
    return { type: 'numeric', operator: '>=', value: target }
  }
  if (typeof target === 'boolean') {
    return { type: 'boolean', value: target }
  }
  if (typeof target === 'string') {
    if (/^[+-]?\d+$/.test(target.trim())) {
      const numeric = Number(target.trim())
      return { type: 'numeric', operator: '>=', value: numeric }
    }
    if (target.trim() === 'true' || target.trim() === 'false') {
      return { type: 'boolean', value: target.trim() === 'true' }
    }
  }
  return { type: 'exact', value: target }
}

function buildRequirementFromCondition(condition) {
  if (typeof condition === 'boolean') {
    return { type: 'boolean', value: condition }
  }

  if (typeof condition === 'number') {
    return { type: 'numeric', operator: '>=', value: condition }
  }

  if (typeof condition === 'string') {
    const trimmed = condition.trim()

    if (trimmed === 'true' || trimmed === 'false') {
      return { type: 'boolean', value: trimmed === 'true' }
    }

    const comparison = trimmed.match(/^(>=|<=|==|!=|>|<)\s*(-?\d+)$/)
    if (comparison) {
      return {
        type: 'numeric',
        operator: comparison[1],
        value: Number(comparison[2])
      }
    }

    if (/^-?\d+$/.test(trimmed)) {
      return { type: 'numeric', operator: '>=', value: Number(trimmed) }
    }
  }

  return { type: 'exact', value: condition }
}

function findActionsForRequirement(key, requirement, actions) {
  const candidates = []

  for (const action of actions) {
    if (!action.effects || action.effects[key] === undefined) continue

    const contribution = computeActionContribution(action.effects[key], requirement)
    if (contribution.canSatisfy) {
      candidates.push(action)
    }
  }

  return candidates
}

function computeActionContribution(effect, requirement) {
  if (effect === undefined) {
    return { canSatisfy: false, gain: 0 }
  }

  if (requirement.type === 'boolean') {
    if (typeof effect === 'boolean') {
      return { canSatisfy: effect === requirement.value, gain: 1 }
    }
    if (typeof effect === 'string') {
      const trimmed = effect.trim()
      if (trimmed === 'true' || trimmed === 'false') {
        return { canSatisfy: (trimmed === 'true') === requirement.value, gain: 1 }
      }
    }
    return { canSatisfy: false, gain: 0 }
  }

  if (requirement.type === 'exact') {
    if (effect === requirement.value) {
      return { canSatisfy: true, gain: 1 }
    }
    if (typeof effect === 'string') {
      const trimmed = effect.trim()
      if (trimmed === String(requirement.value)) {
        return { canSatisfy: true, gain: 1 }
      }
    }
    return { canSatisfy: false, gain: 0 }
  }

  // numeric requirement
  if (typeof effect === 'number') {
    if (effect >= requirement.value) {
      return { canSatisfy: true, gain: effect }
    }
    if (effect > 0) {
      return { canSatisfy: true, gain: effect }
    }
    return { canSatisfy: false, gain: 0 }
  }

  if (typeof effect === 'string') {
    const trimmed = effect.trim()
    if (/^[+-]\d+$/.test(trimmed)) {
      const delta = Number(trimmed)
      if (delta > 0) {
        return { canSatisfy: true, gain: delta }
      }
      // negative contribution cannot satisfy numeric requirement
      return { canSatisfy: false, gain: 0 }
    }

    if (/^-?\d+$/.test(trimmed)) {
      const absolute = Number(trimmed)
      if (absolute >= requirement.value) {
        return { canSatisfy: true, gain: absolute }
      }
      if (absolute > 0) {
        return { canSatisfy: true, gain: absolute }
      }
      return { canSatisfy: false, gain: 0 }
    }
  }

  return { canSatisfy: false, gain: 0 }
}

function getStateValue(state, key) {
  if (!key.includes('.')) {
    return state[key]
  }

  const parts = key.split('.')
  let value = state
  for (const part of parts) {
    value = value?.[part]
    if (value === undefined) {
      return undefined
    }
  }
  return value
}

function summarizeFrontier(open, context, limit = 5) {
  if (!Array.isArray(open) || open.length === 0) {
    return []
  }

  const sampleSize = Math.min(open.length, limit * 3)
  const annotated = []

  for (let i = 0; i < sampleSize; i++) {
    const node = open[i]
    const h = calculateHeuristic(node.state, context)
    const g = node.cost || 0
    annotated.push({
      node,
      g,
      h,
      f: g + h
    })
  }

  annotated.sort((a, b) => a.f - b.f)

  return annotated.slice(0, limit).map(entry => ({
    g: entry.g,
    h: entry.h,
    f: entry.f,
    depth: entry.node.actions?.length || 0,
    allActions: (entry.node.actions || []).map(step => step.action || '?'),
    sampleActions: (entry.node.actions || []).slice(-5).map(step => step.action || '?')
  }))
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
 * @param {Object} initialState - 初期状態（複合状態の展開判定に使用）
 * @returns {Set} 関連する状態変数のセット
 */
function analyzeRelevantVariables(goal, actions, initialState = null) {
  const relevant = new Set(Object.keys(goal))
  const queue = [...relevant]

  // state_schema.yamlから複合状態の依存関係を動的に読み込む
  const compositeStateDependencies = loadCompositeStateDependencies()

  // 複合状態の展開を追跡（展開済みの複合状態からさらに展開しない）
  const expandedCompositeStates = new Set()

  while (queue.length > 0) {
    const variable = queue.shift()

    // 複合状態の依存関係を展開
    // ただし、以下の条件を全て満たす場合のみ:
    // 1. この変数が複合状態である
    // 2. まだ展開していない
    // 3. 初期状態で既に満たされているか、または初期状態が提供されていない
    if (compositeStateDependencies[variable] && !expandedCompositeStates.has(variable)) {
      // 初期状態で既にこの複合状態が満たされている場合は展開しない
      // （既に持っているピッケルを作り直す必要はない）
      const isAlreadySatisfied = initialState && initialState[variable] === true

      if (!isAlreadySatisfied) {
        // この複合状態を展開済みとしてマーク
        for (const depVar of compositeStateDependencies[variable]) {
          if (!relevant.has(depVar)) {
            relevant.add(depVar)
            queue.push(depVar)
            // 展開された依存変数が複合状態の場合、それを記録
            if (compositeStateDependencies[depVar]) {
              expandedCompositeStates.add(depVar)
            }
          }
        }
      }
    }

    // この変数に影響を与えるアクション（正の効果を持つもの）を探す
    for (const action of actions) {
      // このアクションの効果にvariableが含まれているか
      if (action.effects && action.effects[variable] !== undefined) {
        const effectValue = action.effects[variable]

        // 正の効果のみを追跡（マイナス効果は無視）
        let isPositiveEffect = false
        if (typeof effectValue === 'string') {
          // "+1", "+4" などの増加効果
          if (effectValue.startsWith('+')) {
            isPositiveEffect = true
          }
          // "-1" などの減少効果は無視
        } else if (typeof effectValue === 'number' && effectValue > 0) {
          isPositiveEffect = true
        } else if (effectValue === true || effectValue === 'true') {
          isPositiveEffect = true
        }

        // 正の効果を持つアクションの前提条件のみを追加
        if (isPositiveEffect && action.preconditions) {
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
  // アクションの効果が関連変数のいずれかに正の影響を与えるか
  if (action.effects) {
    let hasPositiveEffect = false

    for (const [effectVar, effectValue] of Object.entries(action.effects)) {
      if (relevantVars.has(effectVar)) {
        // 正の効果を持つかチェック
        let isPositiveEffect = false
        if (typeof effectValue === 'string') {
          if (effectValue.startsWith('+')) {
            isPositiveEffect = true
          }
        } else if (typeof effectValue === 'number' && effectValue > 0) {
          isPositiveEffect = true
        } else if (effectValue === true || effectValue === 'true') {
          isPositiveEffect = true
        }

        if (isPositiveEffect) {
          hasPositiveEffect = true
        }
      }
    }

    // 少なくとも1つの関連変数に正の効果があればtrue
    return hasPositiveEffect
  }
  return false
}

module.exports = {
  plan,
  loadDomain,
  evaluateCondition,
  arePreconditionsSatisfied
}
