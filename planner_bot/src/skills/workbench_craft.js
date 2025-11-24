const primitives = require('../primitives')
const { createLogger } = require('../utils/logger')
const { goals } = require('mineflayer-pathfinder')

/**
 * 中位スキル: workbench_craft
 * 3x3の作業台クラフトを実行します
 *
 * 前提条件はGOAPが保証するため、スキル内では材料・作業台チェック不要
 * - 木のツール類（ピッケル、斧、剣など）
 * - 石のツール類
 * - その他3x3でのみ可能なレシピ
 */
module.exports = async function workbenchCraft(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')
  if (!params.recipe) throw new Error('recipe パラメータが必要です')

  const logger = createLogger({ bot, category: 'skill' })
  logger.info(`[WORKBENCH_CRAFT] レシピ「${params.recipe}」を作業台で実行`)

  // レシピ名をそのままアイテム名として使用
  const itemName = params.recipe

  // 1. stateManagerから作業台の座標を取得
  const state = await stateManager.getState(bot)
  const workbenchData = state.blocks?.list?.find(b => b.name === 'crafting_table')

  if (!workbenchData) {
    throw new Error('近くに作業台が見つかりません（GOAPの前提条件エラー）')
  }

  logger.info(`[WORKBENCH_CRAFT] 作業台の位置: ${JSON.stringify(workbenchData.position)} (距離: ${workbenchData.distance.toFixed(1)}m)`)

  // 2. 作業台に近づく（4ブロック以内）
  const currentDistance = bot.entity.position.distanceTo(workbenchData.position)
  if (currentDistance > 4) {
    logger.info(`[WORKBENCH_CRAFT] 作業台へ移動中...`)
    await bot.pathfinder.goto(new goals.GoalNear(
      workbenchData.position.x,
      workbenchData.position.y,
      workbenchData.position.z,
      4
    ))
  }

  // 3. bot.blockAtで直接ブロックを取得（チャンク読み込み問題を回避）
  const Vec3 = require('vec3')
  const workbench = bot.blockAt(new Vec3(
    workbenchData.position.x,
    workbenchData.position.y,
    workbenchData.position.z
  ))

  if (!workbench || workbench.name !== 'crafting_table') {
    throw new Error('作業台の座標にブロックが見つかりません')
  }

  logger.info(`[WORKBENCH_CRAFT] 作業台使用: ${JSON.stringify(workbench.position)}`)

  try {
    const count = params.count || 1
    // GOAPが前提条件を保証済みのため、直接クラフト実行
    await primitives.craftItem(bot, {
      itemName: itemName,
      count: count,
      table: workbench  // Blockインスタンスそのものを渡す
    })

    logger.info(`[WORKBENCH_CRAFT] レシピ「${params.recipe}」の作成が完了`)

  } catch (error) {
    throw new Error(`作業台クラフトに失敗しました: ${error.message}`)
  }
}
