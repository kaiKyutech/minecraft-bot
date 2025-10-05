const goapPlanner = require('../planner/goap')
const { executePlanWithReplanning } = require('../executor/goap_executor')

/**
 * !goal コマンドのハンドラ
 * @param {Object} bot - Mineflayerボット
 * @param {string} goalName - 目標名
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleGoalCommand(bot, goalName, stateManager) {
  bot.chat(`受信した目標: ${goalName}`)

  // プランニング
  const worldState = await stateManager.getState(bot)
  const plan = goapPlanner.plan(goalName, worldState)

  if (!plan) {
    bot.chat('実行可能なプランが見つかりませんでした。')
    return
  }

  // プラン詳細をログ出力
  logPlanDetails(goalName, plan)

  bot.chat(`計画されたアクション: ${plan.map((step) => step.action).join(' -> ')}`)

  // プラン実行（リプランニング対応）
  await executePlanWithReplanning(bot, goalName, plan, stateManager)
}

/**
 * プラン詳細をコンソールに出力
 * @param {string} goalName - 目標名
 * @param {Array} plan - プラン
 */
function logPlanDetails(goalName, plan) {
  console.log('=== GOAP PLAN DETAILS ===')
  console.log(`目標: ${goalName}`)
  console.log(`プラン長: ${plan.length} ステップ`)
  console.log('詳細:')

  plan.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.action}`)
    console.log(`     スキル: ${step.skill || 'なし'}`)
    console.log(`     パラメータ: ${JSON.stringify(step.params || {})}`)

    if (step.preconditions && Object.keys(step.preconditions).length > 0) {
      console.log(`     前提条件: ${JSON.stringify(step.preconditions)}`)
    }
    if (step.effects && Object.keys(step.effects).length > 0) {
      console.log(`     効果: ${JSON.stringify(step.effects)}`)
    }

    console.log(`     コスト: ${step.cost || 0}`)
    console.log('')
  })

  const totalCost = plan.reduce((sum, step) => sum + (step.cost || 0), 0)
  console.log(`総コスト: ${totalCost}`)
  console.log('========================')
}

module.exports = handleGoalCommand
