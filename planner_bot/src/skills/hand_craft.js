const primitives = require('../primitives')

/**
 * 中位スキル: hand_craft
 * 2x2の手クラフト（作業台不要）を実行します
 *
 * 前提条件はGOAPが保証するため、スキル内では材料チェック不要
 * - 板から棒を作る
 * - 原木から板を作る
 * - 板から作業台を作る
 * - その他2x2で可能なレシピ
 */
module.exports = async function handCraft(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')
  if (!params.recipe) throw new Error('recipe パラメータが必要です')

  console.log(`[HAND_CRAFT] レシピ「${params.recipe}」を手クラフトで実行`)

  // 動的レシピ解決
  const itemName = resolveDynamicRecipe(bot, params.recipe)
  if (!itemName) {
    throw new Error(`レシピ「${params.recipe}」の解決に失敗しました`)
  }

  try {
    // GOAPが前提条件を保証済みのため、直接クラフト実行
    await primitives.craftItem(bot, {
      itemName: itemName,
      count: params.count || 1,
      table: null  // 手クラフト（2x2グリッド）
    })

    console.log(`[HAND_CRAFT] レシピ「${params.recipe}」の作成が完了`)

    // 状態を更新（GOAPが次の判断に使用）
    await stateManager.refresh(bot)

  } catch (error) {
    throw new Error(`手クラフトに失敗しました: ${error.message}`)
  }
}

/**
 * 動的レシピ解決
 * インベントリの内容に基づいて実際に作成するアイテムを決定
 */
function resolveDynamicRecipe(bot, recipeType) {
  const inventory = bot.inventory.items()

  switch (recipeType) {
    case 'log_to_planks': {
      // インベントリから原木・幹を探し、対応する板アイテム名を算出する
      const logItem = inventory.find(item => /(_log|_stem)$/.test(item.name))
      if (!logItem) {
        throw new Error('原木がインベントリにありません')
      }

      const logMatch = logItem.name.match(/^(stripped_)?(.+?)(_log|_stem)$/)
      if (!logMatch) {
        throw new Error(`原木の名前を板に変換できません: ${logItem.name}`)
      }

      const [, , species] = logMatch
      const planksName = `${species}_planks`
      console.log(`[HAND_CRAFT] 動的解決: ${logItem.name} → ${planksName}`)

      return planksName
    }

    case 'planks_to_sticks':
      // 棒は常に同じなので固定
      return 'stick'

    case 'crafting_table':
      // 作業台も常に同じ
      return 'crafting_table'

    default:
      throw new Error(`未知のレシピタイプ: ${recipeType}`)
  }
}
