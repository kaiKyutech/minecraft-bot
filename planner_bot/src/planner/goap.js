const { MinHeap } = require('./priority_queue')
const { parseGoalInput, getGoalStateFromParsed, adjustGoalForCurrentState } = require('./goals')
const { buildHeuristicContext, isGoalSatisfied, calculateHeuristic, buildRequirementFromGoalTarget, computeRequirementDeficit, formatRequirement } = require('./heuristic')
const { getStateValue, arePreconditionsSatisfied, applyEffects, evaluateCondition, createStateSerializer, toPlanStep } = require('./state_operations')
const { analyzeRelevantVariables, isActionRelevant } = require('./relevance')
const { diagnoseGoalFailure } = require('./failure_diagnosis')
const { buildState } = require('./state_builder')

const { MAX_ITERATIONS, YIELD_INTERVAL } = require('./options')
const { planningLog, getLogger, planningLogger } = require('./logging')
const { prepareDomain, loadDomain, USE_AUTO_GATHER, USE_AUTO_CRAFT } = require('./domain')
const { reachable, needsPresence } = require('./reachability')

// Keep the public { plan, diagnosis } shape, including historical diagnoses.
// Callers and evaluation caches carry this private outcome separately.
const failedPlans = new WeakMap()
function failedPlan(diagnosis, reason, iterations = 0) {
  const result = { plan: null, diagnosis }
  failedPlans.set(result, Object.freeze({ reason, provenImpossible: reason === 'relaxed_unreachable', iterations, maxIterations: MAX_ITERATIONS }))
  return result
}
function getPlanFailure(result) { return failedPlans.get(result) || null }

function yieldToEventLoop() {
  // setImmediate()を使用してI/Oフェーズまで到達させる
  return new Promise((resolve) => setImmediate(resolve))
}

function plan(goalInput, worldState, logger = null, options = {}) {
  const context = require('../utils/context').currentContext()
  if (require('node:worker_threads').isMainThread && options.worker !== false && (options.worker === true || context.bot)) {
    return require('./planning_service').plan(goalInput,worldState,logger || getLogger(),{
      ...options,version:options.version || context.bot?.version,signal:options.signal || context.signal
    }).then(({result,planningFailure})=>{if(planningFailure)failedPlans.set(result,Object.freeze(planningFailure));return result})
  }
  return planningLog.run(planningLogger(logger), async () => {
    checkBudget(options)
    await prepareDomain(options.version, getLogger())
    checkBudget(options)
    return planPrepared(goalInput, worldState, options)
  })
}

function checkBudget(options) {
  if (options.signal?.aborted) throw Object.assign(new Error('Cancelled'), { name:'AbortError', code:'CANCELLED' })
  if (options.deadline !== undefined && performance.now() >= options.deadline) throw Object.assign(new Error('Evaluation budget exceeded'), { code:'BUDGET_EXCEEDED' })
}

async function planPrepared(goalInput, worldState, options = {}) {
  try {
  const serializeState = createStateSerializer()
  const domainConfig = loadDomain()
  const actions = domainConfig.actions

  // 目標入力をパース
  const parsedGoal = parseGoalInput(goalInput)
  if (!parsedGoal) {
    getLogger().warn(`無効な目標形式です: ${goalInput}`)
    return failedPlan({ error: `無効な目標形式です: ${goalInput}` }, 'invalid_goal')
  }

  let goalAction = null
  if (parsedGoal.type === 'action' || parsedGoal.type === 'action_with_params') {
    goalAction = actions.find(a => a.name === parsedGoal.actionName) || null
    if (!goalAction) {
      getLogger().warn(`未知の目標です: ${goalInput}`)
      return failedPlan({ error: `未知の目標です: ${goalInput}` }, 'invalid_goal')
    }
  }

  // 目標状態を取得
  const goalState = getGoalStateFromParsed(parsedGoal, actions, goalAction)
  if (!goalState) {
    getLogger().warn(`未知の目標です: ${goalInput}`)
    return failedPlan({ error: `未知の目標です: ${goalInput}` }, 'invalid_goal')
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
    getLogger().debug(`[GOAP] 関連変数 (${relevantVars.size}個): ${JSON.stringify(Array.from(relevantVars).sort())}`)
    getLogger().debug(`[GOAP] アクション数: ${actions.length} → ${filteredActions.length}`)

    // デバッグ: フィルタリングされたアクションのリスト
    if (process.env.GOAP_DEBUG_ACTIONS === '1') {
      getLogger().debug(`[GOAP] フィルタリング後のアクション:`)
      filteredActions.forEach(a => getLogger().debug(`  - ${a.name}`))
      getLogger().debug(`[GOAP] 除外されたアクション (${actions.length - filteredActions.length}個):`)
      const excludedActions = actions.filter(a => !filteredActions.includes(a))
      excludedActions.forEach(a => getLogger().debug(`  - ${a.name}`))
    }
  } else {
    getLogger().debug(`[GOAP] アクション数: ${actions.length}`)
  }


  const heuristicContext = { ...buildHeuristicContext(adjustedGoal, goalAction, filteredActions), logShortage: true }

  checkBudget(options)
  const possibleFacts = options.possibleFacts || reachable(actions, initialState, options.deadline ?? Infinity, options.signal)
  checkBudget(options)
  if(possibleFacts && Object.entries(adjustedGoal).some(([key,target]) => {
    const actual = getStateValue(initialState, key)
    const present = typeof actual === 'number' ? actual > 0 : Boolean(actual)
    // Presence of a goal key need not appear among the domain's action keys.
    return needsPresence(target) && !present && !possibleFacts.has(key)
  })) {
    const diagnosis=diagnoseGoalFailure(adjustedGoal,initialState,filteredActions,heuristicContext)
    checkBudget(options)
    return failedPlan(diagnosis, 'relaxed_unreachable')
  }

  // 初期状態のヒューリスティック推定値を計算（情報表示のみ）
  const initialH = calculateHeuristic(initialState, heuristicContext)
  getLogger().debug(`[GOAP] ヒューリスティック推定: h=${initialH} (最大イテレーション: ${MAX_ITERATIONS})`)

  // ヒューリスティックが示す不足リソースを簡易表示
  const hintEntries = []
  for (const [key, target] of Object.entries(adjustedGoal)) {
    const requirement = buildRequirementFromGoalTarget(target)
    const deficit = computeRequirementDeficit(key, requirement, initialState)
    if (deficit > 0) {
      hintEntries.push(`${key} (${formatRequirement(requirement)}) → 不足 ${deficit}`)
    }
  }
  if (hintEntries.length > 0) {
    getLogger().debug(`[GOAP] ヒューリスティック補足: ${hintEntries.join(' / ')}`)
  }

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
    checkBudget(options)
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

      getLogger().debug(`[GOAP Iter ${iterations}] queue:${open.size} visited:${visited.size} g:${current.cost} h:${h} f:${f}`)
      getLogger().debug(`  actions(${current.actions.length}): [${actionPreview || 'none'}]`)
    }

    // gather_logsを含む経路の追跡（デバッグ用）
    // if (current.actions.some(a => a.action && a.action.includes('gather_logs'))) {
    //   const h = calculateHeuristic(current.state, heuristicContext)
      //   console.log(`[GOAP Debug Iter ${iterations}] ★ Processing gather_logs path:`)
      //   console.log(`  Actions: [${current.actions.map(a => a.action).join(' → ')}]`)
      //   console.log(`  g(n)=${current.cost}, h(n)=${h}, f(n)=${current.cost + h}`)
      // }

    if (isGoalSatisfied(adjustedGoal, current.state)) {
      getLogger().debug(`\n[GOAP] ✓ プラン発見`)
      getLogger().debug(`  イテレーション: ${iterations}, ステップ数: ${current.actions.length}, 総コスト: ${current.cost}`)
      return { plan: current.actions, diagnosis: null }
    }

    // デバッグ: ゴール判定の詳細を出力
    if (process.env.GOAP_DEBUG_GOAL === '1' && iterations <= 10) {
      getLogger().debug(`[GOAP Debug Iter ${iterations}] Goal check:`)
      getLogger().debug(`  adjustedGoal: ${JSON.stringify(adjustedGoal)}`)
      for (const [key, target] of Object.entries(adjustedGoal)) {
        const actual = getStateValue(current.state, key)
        getLogger().debug(`  ${key}: target=${target}, actual=${actual}, satisfied=${evaluateCondition(actual, target)}`)
      }
    }

    for (const action of filteredActions) {
      if (options.deadline !== undefined || options.signal) checkBudget(options)
      const satisfied = arePreconditionsSatisfied(action.preconditions, current.state)

      // デバッグ: 初回イテレーションのみ前提条件チェックの詳細を出力
      if (process.env.GOAP_DEBUG_PRECONDITIONS === '1' && iterations === 1) {
        getLogger().debug(`[PRECOND] ${action.name}: ${satisfied ? 'OK' : 'FAILED'}`)
        if (!satisfied && action.preconditions) {
          for (const [key, condition] of Object.entries(action.preconditions)) {
            const value = getStateValue(current.state, key)
            const result = evaluateCondition(value, condition)
            getLogger().debug(`  ${key}: value=${JSON.stringify(value)}, condition=${JSON.stringify(condition)}, result=${result}`)
          }
        }
      }

      if (!satisfied) {
        continue
      }

      // リソース収集の合理的上限チェック（探索空間の爆発を防ぐ）
      const nextState = applyEffects(action.effects, current.state)

      // デバッグ: effectsと状態遷移の詳細
      if (process.env.GOAP_DEBUG_EFFECTS === '1' && iterations === 1 && action.name.includes('dirt')) {
        getLogger().debug(`[EFFECTS] ${action.name}:`)
        getLogger().debug(`  effects: ${JSON.stringify(action.effects)}`)
        getLogger().debug(`  current.state.inventory.dirt: ${getStateValue(current.state, 'inventory.dirt')}`)
        getLogger().debug(`  current.state.inventory.category.log: ${getStateValue(current.state, 'inventory.category.log')}`)
        getLogger().debug(`  nextState.inventory.dirt: ${getStateValue(nextState, 'inventory.dirt')}`)
        getLogger().debug(`  nextState.inventory.category.log: ${getStateValue(nextState, 'inventory.category.log')}`)
      }

      // 各リソースの合理的な上限（Minecraftの1スタック = 64個を基準）
      // TODO: このチェックは誤検知が多いため一時的に無効化
      // inventory.category.log が既に多い場合、dirt採取でも除外されてしまう問題がある
      /*
      const RESOURCE_LIMITS = {
        'inventory.category.log': 32,
        'inventory.category.plank': 64,
        'inventory.stick': 64,
        'inventory.cobblestone': 64
      }

      // 上限を超えるリソース収集は行わない
      let exceedsLimit = false
      let exceedReason = ''
      for (const [key, limit] of Object.entries(RESOURCE_LIMITS)) {
        const value = getStateValue(nextState, key)
        if (typeof value === 'number' && value > limit) {
          exceedsLimit = true
          exceedReason = `${key}=${value} > ${limit}`
          break
        }
      }

      if (exceedsLimit) {
        if (process.env.GOAP_DEBUG_LIMIT === '1' && iterations === 1) {
          getLogger().debug(`[LIMIT] ${action.name}: EXCEEDED - ${exceedReason}`)
        }
        continue
      }
      */

      const stepCost = Number.isFinite(action.cost) ? action.cost : 1
      const totalCost = current.cost + stepCost
      const signature = serializeState(nextState)

      // デバッグ: 初回イテレーションのみ状態遷移の詳細を出力
      if (process.env.GOAP_DEBUG_STATE === '1' && iterations === 1) {
        getLogger().debug(`[STATE] ${action.name}:`)
        getLogger().debug(`  current.state.inventory.dirt: ${getStateValue(current.state, 'inventory.dirt')}`)
        getLogger().debug(`  nextState.inventory.dirt: ${getStateValue(nextState, 'inventory.dirt')}`)
        getLogger().debug(`  signature: ${signature.substring(0, 100)}...`)
        getLogger().debug(`  visited: ${visited.has(signature)}, cost: current=${current.cost}, total=${totalCost}, visited=${visited.get(signature)}`)
      }

      if (visited.has(signature) && visited.get(signature) <= totalCost) {
        if (process.env.GOAP_DEBUG_STATE === '1' && iterations === 1) {
          getLogger().debug(`  SKIPPED: already visited with lower cost`)
        }
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
    getLogger().warn(`\n[GOAP] ❌ プラン未発見 (イテレーション上限)`)
    getLogger().warn(`  目標: ${goalInput}`)
    getLogger().warn(`  初期ヒューリスティック: h=${initialH}`)
    getLogger().warn(`  イテレーション: ${iterations} / ${MAX_ITERATIONS}`)
    getLogger().warn(`  残り候補: ${open.size}, 訪問済み: ${visited.size}`)
    getLogger().warn(`  この目標は現在の状態から直接達成するには複雑すぎます。`)
    getLogger().warn(`  段階的に中間目標を実行してください。`)
  } else {
    getLogger().warn(`\n[GOAP] ❌ プラン未発見 (候補枯渇)`)
    getLogger().warn(`  目標: ${goalInput}`)
    getLogger().warn(`  イテレーション: ${iterations}, 訪問済み: ${visited.size}`)
    getLogger().warn(`  原因: 実行可能なアクションがありません`)
  }

  // 診断情報を追加
  checkBudget(options)
  const diagnosis = diagnoseGoalFailure(adjustedGoal, initialState, filteredActions, heuristicContext)
  checkBudget(options)
  return failedPlan(diagnosis, iterations >= MAX_ITERATIONS && open.size > 0 ? 'iteration_limit' : 'frontier_exhausted', iterations)

  } finally {
    // The logger belongs to this asynchronous call, not the module.
  }
}

// buildState関数は state_builder.js に移動

/**
 * 目標入力をパース
 * @param {string} input - ユーザー入力（例: "inventory.category.log:8", "inventory.furnace:1", "craft_wooden_pickaxe"）
 * @returns {Object|null} パース結果
 */

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

/**
 * state_schema.yamlから複合状態の依存関係を読み込む
 * @returns {Object} 複合状態名をキー、依存変数配列を値とするマップ
 */


// ゴール達成に不足しているリソース（ヒューリスティック推定）を取得
function collectShortages(goalInput, worldState, logger = null, options = {}) {
  return planningLog.run(planningLogger(logger), async () => {
    await prepareDomain(options.version, getLogger())
    return collectShortagesPrepared(goalInput, worldState)
  })
}

async function collectShortagesPrepared(goalInput, worldState) {
  try {
    const domainConfig = loadDomain()
    const actions = domainConfig.actions

    const parsedGoal = parseGoalInput(goalInput)
    if (!parsedGoal) return []

    let goalAction = null
    if (parsedGoal.type === 'action' || parsedGoal.type === 'action_with_params') {
      goalAction = actions.find(a => a.name === parsedGoal.actionName) || null
      if (!goalAction) return []
    }

    const goalState = getGoalStateFromParsed(parsedGoal, actions, goalAction)
    if (!goalState) return []

    const initialState = buildState(worldState)
    const adjustedGoal = adjustGoalForCurrentState(goalState, initialState, parsedGoal)

    let filteredActions = actions
    if (process.env.GOAP_DISABLE_ACTION_FILTER !== '1') {
      const relevantVars = analyzeRelevantVariables(adjustedGoal, actions, initialState)
      filteredActions = actions.filter(action => isActionRelevant(action, relevantVars))
    }

    const shortageOut = []
    const heuristicContext = { ...buildHeuristicContext(adjustedGoal, goalAction, filteredActions), logShortage: false, shortageOut }
    calculateHeuristic(initialState, heuristicContext)
    return shortageOut
  } finally {
    // The logger belongs to this asynchronous call, not the module.
  }
}

/**
 * 読み込まれた全アクションを取得
 * @returns {Array} アクション配列
 */
function getAllActions() {
  const domainConfig = loadDomain()
  return domainConfig.actions
}

module.exports = {
  plan,
  collectShortages,
  loadDomain,
  prepareDomain: require('node:worker_threads').isMainThread ? (...args) => require('./planning_service').prepare(...args) : prepareDomain,
  getAllActions,
  getPlanFailure,
  evaluateCondition,
  arePreconditionsSatisfied,
  USE_AUTO_GATHER,
  USE_AUTO_CRAFT
}
