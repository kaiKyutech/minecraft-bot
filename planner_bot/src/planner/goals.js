const { getLogger } = require('./logging')
const { extractPositiveEffects } = require('./heuristic')
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
      getLogger().warn(`未知の目標です: ${parsedGoal.actionName}`)
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

module.exports = { parseGoalInput, getGoalStateFromParsed, adjustGoalForCurrentState }
