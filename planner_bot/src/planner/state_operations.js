const { calculateCompositeStates } = require('./state_builder')

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

module.exports = { getStateValue, arePreconditionsSatisfied, applyEffects, evaluateCondition, serializeState, toPlanStep }
