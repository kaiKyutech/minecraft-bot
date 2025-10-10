const goapPlanner = require('../planner/goap')
const skills = require('../skills')
const { analyseStepPreconditions, getStateValue } = require('./precondition_checker')

/**
 * GOAPプランを実行（リプランニング対応）
 * @param {Object} bot - Mineflayerボット
 * @param {string} goalName - 目標名
 * @param {Array} initialPlan - 初期プラン
 * @param {Object} stateManager - 状態マネージャー
 */
async function executePlanWithReplanning(bot, goalName, initialPlan, stateManager) {
  let currentPlan = [...initialPlan]
  let stepIndex = 0

  while (stepIndex < currentPlan.length) {
    const step = currentPlan[stepIndex]

    if (!step.skill) {
      console.log(`目標達成: ${step.action}`)
      stepIndex++
      continue
    }

    const preconditionStatus = await analyseStepPreconditions(bot, step, stateManager)

    if (!preconditionStatus.satisfied) {
      console.log(`[REACTIVE_GOAP] ステップ "${step.action}" の前提条件が満たされていません。補助サブゴールを探索します...`)

      const resolved = await tryResolveMissingPreconditions(bot, step, stateManager, preconditionStatus)

      if (resolved) {
        // サブゴールで前提条件を満たしたので、同じステップを再評価
        continue
      }

      console.log(`[REACTIVE_GOAP] サブゴールでの解決に失敗。リプランニングを実行...`)
      console.log(`[REACTIVE_GOAP] 目標: ${goalName}`)

      await stateManager.refresh(bot)
      const newPlan = await replan(bot, goalName, stateManager)

      console.log(`[REACTIVE_GOAP] 新しいプラン長: ${newPlan.length}`)
      console.log(`[REACTIVE_GOAP] 新しいプラン: ${newPlan.map(s => s.action).join(' -> ')}`)
      logReplanDetails(newPlan)

      currentPlan = newPlan
      stepIndex = 0
      continue
    }

    // ステップ実行（実行時エラーもリプランニングで対応）
    try {
      await executeStep(bot, step, stateManager)
      stepIndex++
    } catch (error) {
      console.log(`[REACTIVE_GOAP] ステップ "${step.action}" の実行中にエラーが発生: ${error.message}`)
      console.log(`[REACTIVE_GOAP] 現在の状態から再度プランニングします...`)

      // 状態を更新してリプランニング
      await stateManager.refresh(bot)
      const newPlan = await replan(bot, goalName, stateManager)

      console.log(`[REACTIVE_GOAP] 新しいプラン長: ${newPlan.length}`)
      console.log(`[REACTIVE_GOAP] 新しいプラン: ${newPlan.map(s => s.action).join(' -> ')}`)
      logReplanDetails(newPlan)

      currentPlan = newPlan
      stepIndex = 0
      continue
    }
  }

  console.log(`[EXECUTION] 全${currentPlan.length}ステップ完了`)
  console.log(`[EXECUTION] 最終プラン: ${currentPlan.map(s => s.action).join(' -> ')}`)

  bot.chat('目標を完了しました')
}

/**
 * リプランニングを実行
 * @param {Object} bot - Mineflayerボット
 * @param {string} goalName - 目標名
 * @param {Object} stateManager - 状態マネージャー
 * @returns {Promise<Array>} 新しいプラン
 */
async function replan(bot, goalName, stateManager) {
  const currentState = await stateManager.getState(bot)
  const newPlan = goapPlanner.plan(goalName, currentState)

  if (!newPlan) {
    throw new Error('リプランニングに失敗しました。実行可能なプランが見つかりません。')
  }

  return newPlan
}

/**
 * 単一ステップを実行
 * @param {Object} bot - Mineflayerボット
 * @param {Object} step - プランステップ
 * @param {Object} stateManager - 状態マネージャー
 */
async function executeStep(bot, step, stateManager) {
  const skill = skills[step.skill]

  if (typeof skill !== 'function') {
    throw new Error(`スキル ${step.skill} が見つかりません`)
  }

  console.log(`[EXECUTION] ステップ: ${step.action}`)

  await skill(bot, step.params || {}, stateManager)
  await stateManager.refresh(bot)

  console.log(`[EXECUTION] ステップ "${step.action}" 完了`)
}

/**
 * リプラン詳細をログ出力
 * @param {Array} plan - プラン
 */
function logReplanDetails(plan) {
  console.log(`[REACTIVE_GOAP] 新プランの詳細:`)
  plan.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.action} (skill: ${step.skill || 'なし'})`)
  })
}

function formatCondition(condition) {
  if (typeof condition === 'boolean' || typeof condition === 'number') {
    return String(condition)
  }
  return condition
}

function deriveSubGoalInput(missing, goapState) {
  const { key, condition } = missing
  const current = Number(getStateValue(goapState, key)) || 0

  const clamp = (value) => Math.max(1, Math.min(64, Math.round(value)))

  if (typeof condition === 'number') {
    const requiredDelta = condition - current
    if (requiredDelta <= 0) return null
    const deficit = clamp(requiredDelta)
    return `${key}:${deficit}`
  }

  if (typeof condition === 'string') {
    const trimmed = condition.trim()
    const comparison = trimmed.match(/^(>=|<=|==|!=|>|<)\s*(-?\d+)$/)
    if (comparison) {
      const [, operator, raw] = comparison
      const target = Number(raw)
      let required
      switch (operator) {
        case '>':
          required = target + 1
          break
        case '>=':
          required = target
          break
        case '==':
          required = target
          break
        default:
          return null
      }
      const deficitRaw = required - current
      if (deficitRaw <= 0) return null
      const deficit = clamp(deficitRaw)
      return `${key}:${deficit}`
    }

    if (/^-?\d+$/.test(trimmed)) {
      const target = Number(trimmed)
      const deficitRaw = target - current
      if (deficitRaw <= 0) return null
      const deficit = clamp(deficitRaw)
      return `${key}:${deficit}`
    }
  }

  if (typeof condition === 'boolean') {
    return condition === true ? `${key}:true` : `${key}:false`
  }

  return null
}

async function executeSimplePlan(bot, plan, stateManager) {
  for (const step of plan) {
    if (!step.skill) continue

    const status = await analyseStepPreconditions(bot, step, stateManager)
    if (!status.satisfied) {
      throw new Error(`サブプランのステップ ${step.action} の前提条件を満たせません`)
    }
    await executeStep(bot, step, stateManager)
  }
}

async function tryResolveMissingPreconditions(bot, step, stateManager, status) {
  for (const missing of status.missing) {
    const subGoalInput = deriveSubGoalInput(missing, status.goapState)
    if (!subGoalInput) {
      continue
    }

    console.log(`[REACTIVE_GOAP]   → 補助ゴール検討: ${missing.key} ${formatCondition(missing.condition)} / 現在値 ${missing.currentValue ?? 0}`)
    console.log(`[REACTIVE_GOAP]     サブゴール候補: ${subGoalInput}`)

    const subPlan = goapPlanner.plan(subGoalInput, status.worldState)

    if (!subPlan || subPlan.length === 0) {
      console.log(`[REACTIVE_GOAP]     サブプラン生成に失敗 (${subGoalInput})`)
      continue
    }

    console.log(`[REACTIVE_GOAP]     サブプラン: ${subPlan.map(s => s.action).join(' -> ')}`)

    try {
      await executeSimplePlan(bot, subPlan, stateManager)
      await stateManager.refresh(bot)
      console.log(`[REACTIVE_GOAP]     サブゴール達成 (${subGoalInput})`)
      return true
    } catch (error) {
      console.log(`[REACTIVE_GOAP]     サブゴール実行に失敗: ${error.message}`)
      await stateManager.refresh(bot)
    }
  }

  return false
}

module.exports = {
  executePlanWithReplanning
}
