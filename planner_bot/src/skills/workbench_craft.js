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
  // Mineflayerのbot.recipesFor()が自動的にレシピを検索するため、
  // 手動マッピングは不要。任意のMinecraftアイテム名を指定可能
  const itemName = params.recipe

  try {
    // GOAPが nearby_workbench: true を保証済みのため、近くの作業台を検索
    console.log(`[WORKBENCH_CRAFT] ボット位置: ${JSON.stringify(bot.entity.position)}`)

    const workbench = bot.findBlock({
      matching: (block) => block && block.name === 'crafting_table',
      maxDistance: 5
    })

    if (!workbench) {
      // デバッグ用: より広範囲で作業台を探してログ出力
      const distantWorkbench = bot.findBlock({
        matching: (block) => block && block.name === 'crafting_table',
        maxDistance: 100
      })
      if (distantWorkbench) {
        const distance = bot.entity.position.distanceTo(distantWorkbench.position)
        console.log(`[WORKBENCH_CRAFT] 遠くの作業台発見: ${JSON.stringify(distantWorkbench.position)} (distance: ${distance.toFixed(2)})`)
      }
      throw new Error('近くに作業台が見つかりません（GOAPの前提条件エラー）')
    }

    const distance = bot.entity.position.distanceTo(workbench.position)
    console.log(`[WORKBENCH_CRAFT] 作業台発見: ${JSON.stringify(workbench.position)} (distance: ${distance.toFixed(2)})`)

    console.log(`[WORKBENCH_CRAFT] 作業台(${workbench.position})を使用`)

    // GOAPが前提条件を保証済みのため、直接クラフト実行
    await primitives.craftItem(bot, {
      itemName: itemName,
      count: params.count || 1,
      table: workbench.position  // 作業台の座標のみを指定
    })

    console.log(`[WORKBENCH_CRAFT] レシピ「${params.recipe}」の作成が完了`)

    // クラフト完了後、さらに待機してからインベントリ確認（1.20.xでは短縮可能）
    await new Promise(resolve => setTimeout(resolve, 50))

    // 状態を更新（GOAPが次の判断に使用）
    await stateManager.refresh(bot)

  } catch (error) {
    throw new Error(`作業台クラフトに失敗しました: ${error.message}`)
  }
}