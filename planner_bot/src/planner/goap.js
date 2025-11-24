const fs = require('fs')
const path = require('path')
const YAML = require('yaml')
const { buildState, loadStateSchema, calculateCompositeStates } = require('./state_builder')
const { createLogger } = require('../utils/logger')

const ACTIONS_DIR = path.join(__dirname, '../../config/actions')
const ACTION_FILES = [
  'gather_actions.yaml',
  'hand_craft_actions.yaml',
  'workbench_craft_actions.yaml',
  'movement_actions.yaml',
  'furnace_actions.yaml',
  'equipment_actions.yaml'
]
const MAX_ITERATIONS = process.env.GOAP_MAX_ITERATIONS ? Number(process.env.GOAP_MAX_ITERATIONS) : 500
const YIELD_INTERVAL = process.env.GOAP_YIELD_INTERVAL ? Number(process.env.GOAP_YIELD_INTERVAL) : 50  // 50 → 25に短縮

let domain
let activeLogger = null

/**
 * 最小ヒープ（優先度キュー）
 * A*アルゴリズムの開リストを効率的に管理（O(log n)でpush/pop）
 */
class MinHeap {
  constructor(scoreFn) {
    this.a = []  // 配列として管理
    this.score = scoreFn  // ノードのスコア（f値）を取得する関数
  }

  push(node) {
    this.a.push(node)
    this._up(this.a.length - 1)
  }

  pop() {
    if (this.a.length === 0) return undefined
    const result = this.a[0]
    const last = this.a.pop()
    if (this.a.length > 0) {
      this.a[0] = last
      this._down(0)
    }
    return result
  }

  get size() {
    return this.a.length
  }

  _up(i) {
    const node = this.a[i]
    const nodeScore = this.score(node)
    while (i > 0) {
      const pi = ((i - 1) >> 1)  // 親インデックス
      const parent = this.a[pi]
      if (this.score(parent) <= nodeScore) break
      this.a[i] = parent
      i = pi
    }
    this.a[i] = node
  }

  _down(i) {
    const node = this.a[i]
    const nodeScore = this.score(node)
    const len = this.a.length
    const half = len >> 1
    while (i < half) {
      let ci = (i << 1) + 1  // 左子インデックス
      let child = this.a[ci]
      const ri = ci + 1
      // 右子が存在し、右子の方がスコアが小さければ右子を選択
      if (ri < len && this.score(this.a[ri]) < this.score(child)) {
        ci = ri
        child = this.a[ri]
      }
      if (nodeScore <= this.score(child)) break
      this.a[i] = child
      i = ci
    }
    this.a[i] = node
  }
}

function yieldToEventLoop() {
  // setImmediate()を使用してI/Oフェーズまで到達させる
  return new Promise((resolve) => setImmediate(resolve))
}

function getLogger() {
  if (activeLogger && typeof activeLogger.info === 'function') return activeLogger
  // デフォルト: command/category指定なし、レベルは環境変数に従う
  activeLogger = createLogger({ category: 'goap' })
  return activeLogger
}

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
        getLogger().info(`[GOAP] ${filename} から ${parsed.actions.length} 個のアクションを読み込みました`)
      }
    } catch (error) {
      getLogger().error(`[GOAP] ${filename} の読み込みに失敗: ${error.message}`)
    }
  }

  if (allActions.length === 0) {
    throw new Error('アクションが1つも読み込まれませんでした')
  }

  domain = { actions: allActions }
  getLogger().info(`[GOAP] 合計 ${allActions.length} 個のアクションを読み込みました`)
  return domain
}

async function plan(goalInput, worldState, logger = null) {
  // loggerがinfo/warn/errorを持たない場合はデフォルトを使用
  if (logger && typeof logger.info === 'function' && typeof logger.warn === 'function') {
    activeLogger = logger
  } else {
    activeLogger = null
  }
  try {
  const domainConfig = loadDomain()
  const actions = domainConfig.actions

  // 目標入力をパース
  const parsedGoal = parseGoalInput(goalInput)
  if (!parsedGoal) {
    getLogger().warn(`無効な目標形式です: ${goalInput}`)
    return { plan: null, diagnosis: { error: `無効な目標形式です: ${goalInput}` } }
  }

  let goalAction = null
  if (parsedGoal.type === 'action' || parsedGoal.type === 'action_with_params') {
    goalAction = actions.find(a => a.name === parsedGoal.actionName) || null
    if (!goalAction) {
      getLogger().warn(`未知の目標です: ${goalInput}`)
      return { plan: null, diagnosis: { error: `未知の目標です: ${goalInput}` } }
    }
  }

  // 目標状態を取得
  const goalState = getGoalStateFromParsed(parsedGoal, actions, goalAction)
  if (!goalState) {
    getLogger().warn(`未知の目標です: ${goalInput}`)
    return { plan: null, diagnosis: { error: `未知の目標です: ${goalInput}` } }
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
    getLogger().info(`[GOAP] 関連変数 (${relevantVars.size}個): ${JSON.stringify(Array.from(relevantVars).sort())}`)
    getLogger().info(`[GOAP] アクション数: ${actions.length} → ${filteredActions.length}`)

    // デバッグ: フィルタリングされたアクションのリスト
    if (process.env.GOAP_DEBUG_ACTIONS === '1') {
      getLogger().info(`[GOAP] フィルタリング後のアクション:`)
      filteredActions.forEach(a => getLogger().info(`  - ${a.name}`))
      getLogger().info(`[GOAP] 除外されたアクション (${actions.length - filteredActions.length}個):`)
      const excludedActions = actions.filter(a => !filteredActions.includes(a))
      excludedActions.forEach(a => getLogger().info(`  - ${a.name}`))
    }
  } else {
    getLogger().info(`[GOAP] アクション数: ${actions.length}`)
  }


  const heuristicContext = buildHeuristicContext(adjustedGoal, goalAction, filteredActions)

  // 初期状態のヒューリスティック推定値を計算（情報表示のみ）
  const initialH = calculateHeuristic(initialState, heuristicContext)
  getLogger().info(`[GOAP] ヒューリスティック推定: h=${initialH} (最大イテレーション: ${MAX_ITERATIONS})`)

  // ヒューリスティック値をキャッシュ
  const hCache = new Map()
  const getF = (node) => {
    const sig = serializeState(node.state)
    if (!hCache.has(sig)) {
      hCache.set(sig, calculateHeuristic(node.state, heuristicContext))
    }
    return node.cost + hCache.get(sig)
  }

  // MinHeapで開リストを管理（O(log n)で最小f値ノードを取得）
  const open = new MinHeap(getF)
  open.push({
    state: initialState,
    cost: 0,
    actions: []
  })

  const visited = new Map()
  visited.set(serializeState(initialState), 0)

  let iterations = 0

  while (open.size > 0 && iterations < MAX_ITERATIONS) {
    iterations++

    if (YIELD_INTERVAL > 0 && iterations % YIELD_INTERVAL === 0) {
      await yieldToEventLoop()
    }

    // A*アルゴリズム: f(n) = g(n) + h(n)
    // g(n) = これまでの実コスト (a.cost)
    // h(n) = ゴールまでの推定コスト (heuristic)
    // MinHeapが自動的に最小f値のノードを返す
    const current = open.pop()

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

      getLogger().info(`[GOAP Iter ${iterations}] queue:${open.size} visited:${visited.size} g:${current.cost} h:${h} f:${f}`)
      getLogger().info(`  actions(${current.actions.length}): [${actionPreview || 'none'}]`)
    }

    // gather_logsを含む経路の追跡（デバッグ用）
    // if (current.actions.some(a => a.action && a.action.includes('gather_logs'))) {
    //   const h = calculateHeuristic(current.state, heuristicContext)
      //   console.log(`[GOAP Debug Iter ${iterations}] ★ Processing gather_logs path:`)
      //   console.log(`  Actions: [${current.actions.map(a => a.action).join(' → ')}]`)
      //   console.log(`  g(n)=${current.cost}, h(n)=${h}, f(n)=${current.cost + h}`)
      // }

    if (isGoalSatisfied(adjustedGoal, current.state)) {
      getLogger().info(`\n[GOAP] ✓ プラン発見`)
      getLogger().info(`  イテレーション: ${iterations}, ステップ数: ${current.actions.length}, 総コスト: ${current.cost}`)
      return { plan: current.actions, diagnosis: null }
    }

    for (const action of filteredActions) {
      if (!arePreconditionsSatisfied(action.preconditions, current.state)) {
        continue
      }

      // リソース収集の合理的上限チェック（探索空間の爆発を防ぐ）
      const nextState = applyEffects(action.effects, current.state)

      // 各リソースの合理的な上限（Minecraftの1スタック = 64個を基準）
      const RESOURCE_LIMITS = {
        'inventory.category.log': 32,
        'inventory.category.plank': 64,
        'inventory.stick': 64,
        'inventory.cobblestone': 64
      }

      // 上限を超えるリソース収集は行わない
      let exceedsLimit = false
      for (const [key, limit] of Object.entries(RESOURCE_LIMITS)) {
        const value = getStateValue(nextState, key)
        if (typeof value === 'number' && value > limit) {
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
      // MinHeapに新しいノードを追加（自動的にf値でソートされる）
      open.push({
        state: nextState,
        cost: totalCost,
        actions: [...current.actions, toPlanStep(action)]
      })
    }
  }

  if (iterations >= MAX_ITERATIONS && open.size > 0) {
    goapWarn(`\n[GOAP] ❌ プラン未発見 (イテレーション上限)`)
    goapWarn(`  目標: ${goalInput}`)
    goapWarn(`  初期ヒューリスティック: h=${initialH}`)
    goapWarn(`  イテレーション: ${iterations} / ${MAX_ITERATIONS}`)
    goapWarn(`  残り候補: ${open.size}, 訪問済み: ${visited.size}`)
    goapWarn(`  この目標は現在の状態から直接達成するには複雑すぎます。`)
    goapWarn(`  段階的に中間目標を実行してください。`)
  } else {
    goapWarn(`\n[GOAP] ❌ プラン未発見 (候補枯渇)`)
    goapWarn(`  目標: ${goalInput}`)
    goapWarn(`  イテレーション: ${iterations}, 訪問済み: ${visited.size}`)
    goapWarn(`  原因: 実行可能なアクションがありません`)
  }

  // 診断情報を追加
  const diagnosis = diagnoseGoalFailure(adjustedGoal, initialState, filteredActions, heuristicContext)
  return { plan: null, diagnosis }

  } finally {
    activeLogger = null
  }
}

// buildState関数は state_builder.js に移動

/**
 * ゴール失敗の診断を行う
 * @param {Object} goal - 目標状態
 * @param {Object} currentState - 現在状態
 * @param {Array} actions - 利用可能なアクション
 * @param {Object} heuristicContext - ヒューリスティック計算のコンテキスト
 * @returns {Object} 診断結果
 */
function diagnoseGoalFailure(goal, currentState, actions, heuristicContext) {
  const missingRequirements = []
  const suggestions = []

  for (const [key, targetValue] of Object.entries(goal)) {
    const requirement = buildRequirementFromGoalTarget(targetValue)
    const deficit = computeRequirementDeficit(key, requirement, currentState)

    if (deficit > 0) {
      // この要求が満たされていない
      const currentValue = getStateValue(currentState, key)
      const displayCurrent = currentValue !== undefined ? currentValue : 'なし'
      const displayTarget = typeof targetValue === 'number'
        ? `${targetValue}個`
        : targetValue === true ? 'true' : String(targetValue)

      missingRequirements.push({
        key,
        current: displayCurrent,
        target: displayTarget,
        deficit
      })

      // 複合状態の依存関係をチェック
      const compositeStateDeps = loadCompositeStateDependencies()
      const isComputedState = compositeStateDeps[key] && compositeStateDeps[key].length > 0

      if (isComputedState) {
        // 複合状態の場合、依存しているインベントリアイテムを提案
        const dependencies = compositeStateDeps[key]
        suggestions.push({
          target: key,
          action: null,
          isComputedState: true,
          dependencies: dependencies,
          message: `${key} は複合状態です。以下のいずれかを入手してください: ${dependencies.join(', ')}`
        })
        continue
      }

      // この要求を満たすためのアクションを探す
      const candidateActions = findActionsForRequirement(key, requirement, actions)

      if (candidateActions.length > 0) {
        // コスト順にソート（低コスト優先）
        const sortedActions = candidateActions.sort((a, b) => {
          const costA = Number.isFinite(a.cost) ? a.cost : 1
          const costB = Number.isFinite(b.cost) ? b.cost : 1
          return costA - costB
        })

        // 全てのアクションを調べて、前提条件の充足状況を記録
        for (const action of sortedActions) {
          if (action.preconditions) {
            const preconditionStatus = []
            let allSatisfied = true

            for (const [preKey, preCondition] of Object.entries(action.preconditions)) {
              const preValue = getStateValue(currentState, preKey)
              const isSatisfied = evaluateCondition(preValue, preCondition)
              const displayPreValue = preValue !== undefined ? preValue : 'なし'

              preconditionStatus.push({
                key: preKey,
                current: displayPreValue,
                required: preCondition,
                satisfied: isSatisfied
              })

              if (!isSatisfied) {
                allSatisfied = false
              }
            }

            // 全ての選択肢を記録（満たされているかどうかに関わらず）
            suggestions.push({
              target: key,
              action: action.name,
              cost: action.cost,
              allSatisfied: allSatisfied,
              preconditions: preconditionStatus
            })
          }
        }
      } else {
        // アクションが見つからない場合
        suggestions.push({
          target: key,
          action: null,
          message: `${key}を達成するアクションが見つかりません`
        })
      }
    }
  }

  return {
    missingRequirements,
    suggestions
  }
}

/**
 * 目標入力をパース
 * @param {string} input - ユーザー入力（例: "inventory.category.log:8", "inventory.furnace:1", "craft_wooden_pickaxe"）
 * @returns {Object|null} パース結果
 */
function parseGoalInput(input) {
  const trimmed = input.trim()

  // パターン1: ドット記法の状態指定（数値）
  const dotNumericMatch = trimmed.match(/^([a-z_]+(?:\.[a-z_]+)+):(\d+)$/)
  if (dotNumericMatch) {
    const [, key, value] = dotNumericMatch
    return {
      type: 'state',
      state: { [key]: Number(value) }
    }
  }

  // パターン2: ドット記法のBoolean状態指定（例: "inventory.foo:true"）
  const dotBoolMatch = trimmed.match(/^([a-z_]+(?:\.[a-z_]+)+):(true|false)$/)
  if (dotBoolMatch) {
    const [, key, value] = dotBoolMatch
    return {
      type: 'state',
      state: { [key]: value === 'true' }
    }
  }

  // パターン3: Boolean状態指定（例: "nearby_workbench:true"）
  if (/^[a-z_]+:(true|false)$/.test(trimmed)) {
    const [key, value] = trimmed.split(':')
    return {
      type: 'state',
      state: { [key]: value === 'true' }
    }
  }

  // パターン4: has_ 系の数値指定
  if (/^has_[a-z_]+:\d+$/.test(trimmed)) {
    const [key, value] = trimmed.split(':')
    return {
      type: 'state',
      state: { [key]: Number(value) }
    }
  }

  // パターン5: アクション名（例: "craft_wooden_pickaxe", "gather_logs"）
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
      goapWarn(`未知の目標です: ${parsedGoal.actionName}`)
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
      getLogger().warn('[HEURISTIC] WARNING: context is null/undefined')
    }
    return 0
  }

  const finalGoal = context.finalGoal || {}
  const actions = context.actions || []

  if (!finalGoal || Object.keys(finalGoal).length === 0) {
    if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
      getLogger().warn('[HEURISTIC] WARNING: finalGoal is empty')
    }
    return 0
  }

  const memo = new Map()
  let estimate = 0

  if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
    getLogger().info('[HEURISTIC] Computing h(n) for goal:', finalGoal)
    getLogger().info('[HEURISTIC] Current state summary:', {
      'inventory.category.log': getStateValue(state, 'inventory.category.log'),
      'inventory.category.plank': getStateValue(state, 'inventory.category.plank'),
      'inventory.cobblestone': getStateValue(state, 'inventory.cobblestone'),
      'inventory.charcoal': state.inventory?.charcoal,
      'inventory.iron_ingot': state.inventory?.iron_ingot
    })
  }

  for (const [key, target] of Object.entries(finalGoal)) {
    const requirement = buildRequirementFromGoalTarget(target)
    const steps = estimateRequirement(key, requirement, state, actions, memo, new Set())

    if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
      getLogger().info(`[HEURISTIC] ${key} ${formatRequirement(requirement)} -> estimated cost: ${steps}`)
    }

    if (!Number.isFinite(steps)) {
      if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
        getLogger().warn(`[HEURISTIC] ERROR: ${key} returned non-finite value`)
      }
      return HEURISTIC_MAX
    }
    estimate = Math.max(estimate, steps)
  }

  if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
    getLogger().info(`[HEURISTIC] Final h(n) = ${estimate}`)
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
      getLogger().warn(`[HEURISTIC] 要求 ${key} ${formatRequirement(requirement)} を満たすアクションが見つかりません`)
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
        getLogger().info(`[HEURISTIC] ${key} <- ${action.name} (必要回数 ${repeats})`)
      }
      for (const [preKey, preCondition] of Object.entries(action.preconditions)) {
        const preRequirement = buildRequirementFromCondition(preCondition)
        const subCost = estimateRequirement(preKey, preRequirement, state, actions, memo, visiting)
        if (!Number.isFinite(subCost) || subCost >= HEURISTIC_MAX) {
          if (shouldDebugRequirement(key)) {
            getLogger().warn(`  [NG] 前提 ${preKey} ${formatRequirement(preRequirement)} の推定が失敗`)
          }
          preconditionCost = HEURISTIC_MAX
          break
        }
        // Math.max → 合計に変更（全ての前提条件を満たす必要があるため）
        preconditionCost += subCost
        if (shouldDebugRequirement(key)) {
          getLogger().info(`  [OK] 前提 ${preKey} ${formatRequirement(preRequirement)} -> 残り推定 ${subCost}`)
        }
      }
    }

    if (preconditionCost >= HEURISTIC_MAX) {
      continue
    }

    const actionCost = Number.isFinite(action.cost) ? action.cost : 1
    const total = preconditionCost + (actionCost * repeats)
    if (shouldDebugRequirement(key)) {
      getLogger().info(`  => 推定コスト ${total} (前提: ${preconditionCost}, アクション: ${actionCost} x ${repeats})`)
    }
    if (total < best) {
      best = total
    }
  }

  if (best >= HEURISTIC_MAX && shouldDebugRequirement(key)) {
    getLogger().warn(`[HEURISTIC] 要求 ${key} ${formatRequirement(requirement)} の推定に失敗 (循環または未解決)`)
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
      let original = state
      for (const part of parts) {
        if (!current[part]) {
          current[part] = {}
        } else if (original && current[part] === original[part]) {
          current[part] = Array.isArray(current[part])
            ? current[part].slice()
            : { ...current[part] }
        }
        current = current[part]
        original = original ? original[part] : undefined
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
  // undefined/nullは条件を満たさないと判定（false positive を防ぐ）
  const isUndef = (value === undefined || value === null)

  if (typeof condition === 'boolean') {
    // booleanの場合: undefinedはfalseとして扱う
    return !isUndef && Boolean(value) === condition
  }

  if (typeof condition === 'number') {
    // 数値比較の場合: undefinedは条件を満たさない
    return !isUndef && Number(value) === condition
  }

  if (typeof condition === 'string') {
    const trimmed = condition.trim()

    if (trimmed === 'true' || trimmed === 'false') {
      return !isUndef && Boolean(value) === (trimmed === 'true')
    }

    const comparison = trimmed.match(/^(>=|<=|==|!=|>|<)\s*(-?\d+)$/)
    if (comparison) {
      const [, operator, rawNumber] = comparison
      const target = Number(rawNumber)
      // undefinedは負の無限大として扱う（全ての >= や > 条件で不合格）
      const actual = isUndef ? Number.NEGATIVE_INFINITY : Number(value)

      switch (operator) {
        case '>': return actual > target
        case '>=': return actual >= target
        case '<': return actual < target
        case '<=': return actual <= target
        case '==': return !isUndef && actual === target
        case '!=': return !isUndef && actual !== target
        default: return false
      }
    }

    if (/^-?\d+$/.test(trimmed)) {
      return !isUndef && Number(value) === Number(trimmed)
    }
  }

  // その他の比較: undefined/nullは条件を満たさない
  if (isUndef) return false
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

/**
 * 再帰的に安定したシリアライズを行う（ネストされたオブジェクトのキー順序も保証）
 * @param {*} obj - シリアライズする値
 * @returns {string} 決定的な文字列表現
 */
function stableStringify(obj) {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj)
  }
  if (typeof obj !== 'object') {
    return JSON.stringify(obj)
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']'
  }
  // オブジェクトの場合: キーをソートして再帰的にシリアライズ
  const keys = Object.keys(obj).sort()
  const body = keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',')
  return '{' + body + '}'
}

/**
 * 状態をシリアライズして一意な文字列に変換（訪問済み判定用）
 * @param {Object} state - 状態オブジェクト
 * @returns {string} シリアライズされた文字列
 */
function serializeState(state) {
  return stableStringify(state)
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
