const goapPlanner = require('../planner/goap')
const skills = require('../skills')
const { checkStepPreconditions } = require('./precondition_checker')

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

    const preconditionsSatisfied = await checkStepPreconditions(bot, step, stateManager)

    if (!preconditionsSatisfied) {
      console.log(`[REACTIVE_GOAP] ステップ "${step.action}" の前提条件が満たされていません。リプランニングを実行...`)
      console.log(`[REACTIVE_GOAP] 目標: ${goalName}`)

      // 状態を更新してからリプランニング
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

module.exports = {
  executePlanWithReplanning
}
