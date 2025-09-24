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

  // レシピ名からアイテム名への変換
  const recipeToItem = {
    'wooden_pickaxe': 'wooden_pickaxe',
    'wooden_axe': 'wooden_axe',
    'wooden_sword': 'wooden_sword',
    'wooden_shovel': 'wooden_shovel',
    'wooden_hoe': 'wooden_hoe',
    'stone_pickaxe': 'stone_pickaxe',
    'stone_axe': 'stone_axe',
    'stone_sword': 'stone_sword',
    'stone_shovel': 'stone_shovel',
    'stone_hoe': 'stone_hoe'
  }

  const itemName = recipeToItem[params.recipe]
  if (!itemName) {
    throw new Error(`未知のレシピです: ${params.recipe}`)
  }

  try {
    // まず近くに設置済み作業台があるかチェック
    let workbench = bot.findBlock({
      matching: (block) => block && block.name === 'crafting_table',
      maxDistance: 32
    })

    if (!workbench) {
      // 近くにない場合、インベントリから作業台を設置
      const workbenchItem = bot.inventory.items().find(item => item.name === 'crafting_table')
      if (!workbenchItem) {
        throw new Error('作業台がインベントリにありません')
      }

      console.log('[WORKBENCH_CRAFT] 作業台をインベントリから設置中...')

      // 作業台を設置
      await placeWorkbench(bot, workbenchItem)

      // 設置後に再検索
      workbench = bot.findBlock({
        matching: (block) => block && block.name === 'crafting_table',
        maxDistance: 5
      })

      if (!workbench) {
        throw new Error('作業台の設置に失敗しました')
      }
    }

    console.log(`[WORKBENCH_CRAFT] 作業台(${workbench.position})を使用`)

    // GOAPが前提条件を保証済みのため、直接クラフト実行
    await primitives.craftItem(bot, {
      itemName: itemName,
      count: params.count || 1,
      table: workbench.position  // 作業台の座標のみを指定
    })

    console.log(`[WORKBENCH_CRAFT] レシピ「${params.recipe}」の作成が完了`)

    // 状態を更新（GOAPが次の判断に使用）
    await stateManager.refresh(bot)

  } catch (error) {
    throw new Error(`作業台クラフトに失敗しました: ${error.message}`)
  }
}

/**
 * 作業台をボットの近くに設置
 */
async function placeWorkbench(bot, workbenchItem) {
  try {
    // 作業台を手に装備
    await bot.equip(workbenchItem, 'hand')
    await delay(100) // 装備待ち

    // ボットの位置を取得
    const botPos = bot.entity.position.floored()

    // 設置候補位置（ボットの隣接する位置）
    const placeOptions = [
      botPos.offset(1, 0, 0),   // 東側
      botPos.offset(-1, 0, 0),  // 西側
      botPos.offset(0, 0, 1),   // 南側
      botPos.offset(0, 0, -1),  // 北側
      botPos.offset(1, 0, 1),   // 南東
      botPos.offset(-1, 0, -1)  // 北西
    ]

    let placed = false
    for (const placePos of placeOptions) {
      // 設置位置が空いているかチェック
      const targetBlock = bot.blockAt(placePos)
      if (!targetBlock || targetBlock.name !== 'air') {
        continue // この位置は使用不可
      }

      // 参照ブロック（設置位置の下のブロック）をチェック
      const referenceBlock = bot.blockAt(placePos.offset(0, -1, 0))
      if (!referenceBlock || referenceBlock.name === 'air') {
        continue // 参照ブロックがない
      }

      try {
        // primitives.placeBlockを使用
        await primitives.placeBlock(bot, {
          reference: referenceBlock.position,
          face: { x: 0, y: 1, z: 0 }  // 上面に設置
        })

        console.log(`[WORKBENCH_CRAFT] 作業台を${placePos}に設置完了`)
        placed = true
        break

      } catch (placeError) {
        console.log(`[WORKBENCH_CRAFT] ${placePos}への設置失敗、次の位置を試行`)
        continue
      }
    }

    if (!placed) {
      throw new Error('適切な設置位置が見つかりませんでした')
    }

  } catch (error) {
    throw new Error(`作業台設置に失敗: ${error.message}`)
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}