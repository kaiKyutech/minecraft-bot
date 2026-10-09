const { getLogger } = require('./logging')
const { getStateValue, evaluateCondition } = require('./state_operations')
const { loadCompositeStateDependencies } = require('./relevance')
const { MAX_ITERATIONS } = require('./options')
const effectIndexes = new WeakMap()
function effectIndex(actions) {
  let index = effectIndexes.get(actions)
  if (!index) {
    index = new Map()
    for (const action of actions) {
      for (const key of Object.keys(action.effects || {})) {
        if (!index.has(key)) index.set(key, [])
        index.get(key).push(action)
      }
    }
    effectIndexes.set(actions, index)
  }
  return index
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
  // ゴール判定は「以上」(>=) で行う
  // 理由: craft_sticks_from_planks は "+4" を生成するが、ゴールは "2" かもしれない
  //       相対的な増加（既に持っている場合も追加で作る）をサポートするため
  return Object.entries(goalState).every(([key, targetValue]) => {
    const actualValue = getStateValue(state, key)

    // 数値の場合は「以上」でチェック
    if (typeof targetValue === 'number') {
      const actual = Number(actualValue)
      if (isNaN(actual)) return false
      return actual >= targetValue
    }

    // Boolean や文字列条件はそのまま評価
    return evaluateCondition(actualValue, targetValue)
  })
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
  // 外部から収集先を渡された場合はそれを使う（例: collectShortages）
  const shortageLog = Array.isArray(context.shortageOut) ? context.shortageOut : []
  let estimate = 0

  if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
    getLogger().debug('[HEURISTIC] Computing h(n) for goal:', finalGoal)
    getLogger().debug('[HEURISTIC] Current state summary:', {
      'inventory.category.log': getStateValue(state, 'inventory.category.log'),
      'inventory.category.plank': getStateValue(state, 'inventory.category.plank'),
      'inventory.cobblestone': getStateValue(state, 'inventory.cobblestone'),
      'inventory.charcoal': state.inventory?.charcoal,
      'inventory.iron_ingot': state.inventory?.iron_ingot
    })
  }

  for (const [key, target] of Object.entries(finalGoal)) {
    const requirement = buildRequirementFromGoalTarget(target)
    const steps = estimateRequirement(key, requirement, state, actions, memo, new Set(), shortageLog)

    if (process.env.GOAP_DEBUG_HEURISTIC === '1') {
      getLogger().debug(`[HEURISTIC] ${key} ${formatRequirement(requirement)} -> estimated cost: ${steps}`)
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
    getLogger().debug(`[HEURISTIC] Final h(n) = ${estimate}`)
  }

  // 不足リソースのログを表示（重複はマージ）。初回の計算時のみ。
  if (context.logShortage && !context._shortageLogged && shortageLog.length > 0) {
    const merged = new Map()
    for (const entry of shortageLog) {
      // nearby.* はGOAPでは解決できないので別枠扱い
      if (entry.key.startsWith('nearby.')) continue
      const sig = `${entry.key}|${entry.requirement.type}|${entry.requirement.operator || ''}|${entry.requirement.value}`
      if (!merged.has(sig)) {
        merged.set(sig, { ...entry })
      } else {
        const existing = merged.get(sig)
        existing.deficit = Math.max(existing.deficit, entry.deficit)
      }
    }
    const display = Array.from(merged.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(e => `${e.key} ${formatRequirement(e.requirement)} (不足=${e.deficit})`)
    getLogger().debug(`[GOAP] 不足リソース: ${display.join(', ')}`)
    context._shortageLogged = true
  }

  return Math.min(estimate, HEURISTIC_MAX)
}

function estimateRequirement(key, requirement, state, actions, memo, visiting, shortageLog) {
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
  if (shortageLog) {
    shortageLog.push({ key, requirement, deficit })
  }

  const compositeEstimate = tryEstimateCompositeRequirement(key, requirement, state, actions, memo, visiting, shortageLog)
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
        getLogger().debug(`[HEURISTIC] ${key} <- ${action.name} (必要回数 ${repeats})`)
      }
      for (const [preKey, preCondition] of Object.entries(action.preconditions)) {
        const preRequirement = buildRequirementFromCondition(preCondition)
        const subCost = estimateRequirement(preKey, preRequirement, state, actions, memo, visiting, shortageLog)
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
          getLogger().debug(`  [OK] 前提 ${preKey} ${formatRequirement(preRequirement)} -> 残り推定 ${subCost}`)
        }
      }
    }

    if (preconditionCost >= HEURISTIC_MAX) {
      continue
    }

    const actionCost = Number.isFinite(action.cost) ? action.cost : 1
    const total = preconditionCost + (actionCost * repeats)
    if (shouldDebugRequirement(key)) {
      getLogger().debug(`  => 推定コスト ${total} (前提: ${preconditionCost}, アクション: ${actionCost} x ${repeats})`)
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

function tryEstimateCompositeRequirement(key, requirement, state, actions, memo, visiting, shortageLog) {
  const dependenciesMap = loadCompositeStateDependencies()
  const deps = dependenciesMap[key]

  if (!deps || deps.length === 0) {
    return null
  }

  if (requirement.type === 'boolean' && requirement.value === true) {
    let best = HEURISTIC_MAX

    for (const depKey of deps) {
      const depRequirement = buildRequirementFromCompositeDependency(depKey)
      const steps = estimateRequirement(depKey, depRequirement, state, actions, memo, visiting, shortageLog)
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

  // Prepared action arrays are immutable; preserve their original tie order.
  for (const action of (effectIndex(actions).get(key) || [])) {
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

module.exports = { buildHeuristicContext, extractPositiveEffects, isGoalSatisfied, calculateHeuristic, buildRequirementFromGoalTarget, computeRequirementDeficit, findActionsForRequirement, formatRequirement }
