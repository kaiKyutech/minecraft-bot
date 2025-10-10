const goapPlanner = require('../planner/goap')
const { buildState } = require('../planner/state_builder')

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

function listUnsatisfiedPreconditions(step, goapState) {
  const domain = goapPlanner.loadDomain()
  const action = domain.actions.find(a => a.name === step.action)

  if (!action || !action.preconditions) {
    return []
  }

  const missing = []

  for (const [key, condition] of Object.entries(action.preconditions)) {
    const value = getStateValue(goapState, key)
    if (!goapPlanner.evaluateCondition(value, condition)) {
      missing.push({ key, condition, currentValue: value })
    }
  }

  return missing
}

/**
 * GOAPアクションステップの前提条件が現在の状態で満たされているかチェック
 * @param {Object} step - プランステップ { action, skill, params, ... }
 * @param {Object} currentState - 現在のGOAP状態
 * @returns {boolean} 前提条件が満たされているか
 */
function areStepPreconditionsSatisfied(step, currentState) {
  const domain = goapPlanner.loadDomain()
  const action = domain.actions.find(a => a.name === step.action)

  if (!action || !action.preconditions) {
    return true // 前提条件なしは常にOK
  }

  return goapPlanner.arePreconditionsSatisfied(action.preconditions, currentState)
}

/**
 * 現在の状態でステップの前提条件をチェック（ボットから状態を取得）
 * @param {Object} bot - Mineflayerボット
 * @param {Object} step - プランステップ
 * @param {Object} stateManager - 状態マネージャー
 * @returns {Promise<boolean>} 前提条件が満たされているか
 */
async function checkStepPreconditions(bot, step, stateManager) {
  const currentState = await stateManager.getState(bot)
  const builtState = buildState(currentState)
  return areStepPreconditionsSatisfied(step, builtState)
}

async function analyseStepPreconditions(bot, step, stateManager) {
  const currentWorld = await stateManager.getState(bot)
  const goapState = buildState(currentWorld)
  const missing = listUnsatisfiedPreconditions(step, goapState)
  return {
    satisfied: missing.length === 0,
    missing,
    worldState: currentWorld,
    goapState
  }
}

module.exports = {
  areStepPreconditionsSatisfied,
  checkStepPreconditions,
  analyseStepPreconditions,
  listUnsatisfiedPreconditions,
  getStateValue
}
