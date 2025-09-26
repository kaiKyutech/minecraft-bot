const primitives = require('../primitives')

/**
 * 中位スキル: move_to
 * 指定された位置またはブロックまで移動します
 *
 * 前提条件はGOAPが保証するため、スキル内では目標存在チェック不要
 * - 特定の座標への移動
 * - 特定のブロック（作業台等）への移動
 */
module.exports = async function moveTo(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')

  let targetPosition

  // パラメータから目標位置を決定
  if (params.position) {
    // 直接座標指定
    targetPosition = params.position
    console.log(`[MOVE_TO] 座標${JSON.stringify(targetPosition)}へ移動中`)

  } else if (params.blockType) {
    // ブロックタイプ指定（例：crafting_table）
    const targetBlock = bot.findBlock({
      matching: (block) => block && block.name === params.blockType,
      maxDistance: params.maxDistance || 32
    })

    if (!targetBlock) {
      throw new Error(`${params.blockType}が近くに見つかりません`)
    }

    targetPosition = targetBlock.position
    console.log(`[MOVE_TO] ${params.blockType}(${targetPosition})へ移動中`)

  } else {
    throw new Error('position または blockType パラメータが必要です')
  }

  try {
    // primitives.moveToを使用して移動
    await primitives.moveTo(bot, {
      position: targetPosition,
      range: params.range || 3.0
    })

    console.log(`[MOVE_TO] 目標位置に到着`)

    // 状態を更新
    await stateManager.refresh(bot)

  } catch (error) {
    throw new Error(`移動に失敗しました: ${error.message}`)
  }
}