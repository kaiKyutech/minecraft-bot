const { failure } = require('../utils/result')
const { interruptible, checkpoint } = require('../utils/context')
const primitives = require('../primitives')
const { skillCandidates, canPlaceBlockAt, goapFallbackCandidates } = require('../navigation/placement_search')
const { createLogger } = require('../utils/logger')

/**
 * 中位スキル: place_block
 * 指定されたブロックをボットの目の前に設置します
 *
 * 前提条件はGOAPが保証するため、スキル内では材料チェック不要
 * - 作業台、チェスト等の設置
 * - 簡単な建築ブロックの設置
 */
module.exports = async function placeBlock(bot, params = {}, stateManager) {
  if (!stateManager) throw failure('INVALID_ARGUMENT', 'stateManager が提供されていません')
  if (!params.blockName) throw failure('INVALID_ARGUMENT', 'blockName パラメータが必要です')

  const logger = createLogger({ bot, category: 'skill' })
  logger.info(`[PLACE_BLOCK] ブロック「${params.blockName}」をボットの目の前に設置中`)

  try {
    // インベントリから指定されたブロックを検索
    const blockItem = bot.inventory.items().find(item => item.name === params.blockName)
    if (!blockItem) {
      throw failure('ITEM_NOT_FOUND', `${params.blockName}がインベントリにありません`)
    }

    // ブロックを手に装備
    await interruptible(bot, () => bot.equip(blockItem, 'hand'))
    await interruptible(bot, () => delay(50)) // 装備待ち（1.20.xでは短縮可能）

    const placeOptions = skillCandidates(bot)

    let placed = false
    for (const placePos of placeOptions) {
      const check = canPlaceBlockAt(bot, placePos, 'skill')
      if (!check.canPlace) continue
      const referenceBlock = check.adjacentBlock

      try {
        // primitives.placeBlockを使用
        await interruptible(bot, () => primitives.placeBlock(bot, {
          reference: referenceBlock.position,
          face: { x: 0, y: 1, z: 0 }  // 上面に設置
        }))

        logger.info(`[PLACE_BLOCK] ${params.blockName}を${placePos}に設置完了`)
        placed = true
        break

      } catch (placeError) {
      checkpoint(bot)
      if (placeError?.name === 'AbortError') throw placeError
        logger.info(`[PLACE_BLOCK] ${placePos}への設置失敗、次の位置を試行`)
        continue
      }
    }

    if (!placed) {
      for (const candidate of goapFallbackCandidates(bot)) {
        checkpoint(bot)
        try {
          await interruptible(bot, () => primitives.placeBlock(bot, { reference: candidate.adjacentBlock.position, face: candidate.face }))
          placed = true
          logger.info(`[PLACE_BLOCK] ${params.blockName}を${candidate.position}に設置完了（fallback）`)
          break
        } catch (error) {
          checkpoint(bot)
          if (error.name === 'AbortError') throw error
        }
      }
    }
    if (!placed) {
      throw failure('PLACEMENT_FAILED', '適切な設置位置が見つかりませんでした')
    }

  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    throw failure(error.code || 'PLACEMENT_FAILED', `ブロック設置に失敗しました: ${error.message}`)
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
