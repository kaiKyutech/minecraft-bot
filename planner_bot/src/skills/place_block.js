const primitives = require('../primitives')

/**
 * 中位スキル: place_block
 * 指定されたブロックをボットの目の前に設置します
 *
 * 前提条件はGOAPが保証するため、スキル内では材料チェック不要
 * - 作業台、チェスト等の設置
 * - 簡単な建築ブロックの設置
 */
module.exports = async function placeBlock(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')
  if (!params.blockName) throw new Error('blockName パラメータが必要です')

  console.log(`[PLACE_BLOCK] ブロック「${params.blockName}」をボットの目の前に設置中`)

  try {
    // インベントリから指定されたブロックを検索
    const blockItem = bot.inventory.items().find(item => item.name === params.blockName)
    if (!blockItem) {
      throw new Error(`${params.blockName}がインベントリにありません`)
    }

    // ブロックを手に装備
    await bot.equip(blockItem, 'hand')
    await delay(100) // 装備待ち

    // ボットの位置を取得
    const botPos = bot.entity.position.floored()

    // 設置候補位置（ボットの目の前の位置）
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

        console.log(`[PLACE_BLOCK] ${params.blockName}を${placePos}に設置完了`)
        placed = true
        break

      } catch (placeError) {
        console.log(`[PLACE_BLOCK] ${placePos}への設置失敗、次の位置を試行`)
        continue
      }
    }

    if (!placed) {
      throw new Error('適切な設置位置が見つかりませんでした')
    }

    // 状態を更新
    await stateManager.refresh(bot)

  } catch (error) {
    throw new Error(`ブロック設置に失敗しました: ${error.message}`)
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}