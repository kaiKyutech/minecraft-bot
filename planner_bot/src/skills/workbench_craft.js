const primitives = require('../primitives')

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

  console.log(`[WORKBENCH_CRAFT] レシピ「${params.recipe}」を作業台で実行`)

  // レシピ名をそのままアイテム名として使用
  const itemName = params.recipe

  // 近くの作業台を探す
  const workbench = bot.findBlock({
    matching: (block) => block && block.name === 'crafting_table',
    maxDistance: 5
  })

  if (!workbench) {
    throw new Error('近くに作業台が見つかりません（GOAPの前提条件エラー）')
  }

  const distance = bot.entity.position.distanceTo(workbench.position)
  console.log(`[WORKBENCH_CRAFT] 作業台発見: ${JSON.stringify(workbench.position)} (${distance.toFixed(1)}m)`)

  try {
    const count = params.count || 1
    // GOAPが前提条件を保証済みのため、直接クラフト実行
    await primitives.craftItem(bot, {
      itemName: itemName,
      count: count,
      table: workbench  // Blockインスタンスそのものを渡す
    })

    console.log(`[WORKBENCH_CRAFT] レシピ「${params.recipe}」の作成が完了`)

    // クラフト完了をチャットに通知（デモ用）
    await bot.chatWithDelay(`${itemName} を作成しました`)

  } catch (error) {
    throw new Error(`作業台クラフトに失敗しました: ${error.message}`)
  }
}
