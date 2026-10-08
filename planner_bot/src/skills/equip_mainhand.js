const { failure } = require('../utils/result')
const { interruptible, checkpoint } = require('../utils/context')
const primitives = require('../primitives')
const { createLogger } = require('../utils/logger')

/**
 * スキル: equip_mainhand
 * アイテムを手に持つ（メインハンド）
 *
 * @param {Object} bot - Mineflayerボット
 * @param {Object} params - { item: "diamond_sword" }
 * @param {Object} stateManager - 状態マネージャー
 */
module.exports = async function equipMainhand(bot, params = {}, stateManager) {
  if (!stateManager) throw failure('INVALID_ARGUMENT', 'stateManager が提供されていません')
  if (!params.item) throw failure('INVALID_ARGUMENT', 'item パラメータが必要です')

  const { item } = params

  const logger = createLogger({ bot, category: 'skill' })
  logger.info(`[EQUIP_MAINHAND] ${item} を手に持ちます`)

  try {
    // インベントリから対象アイテムを探す
    const itemToEquip = bot.inventory.items().find(i => i.name === item)
    if (!itemToEquip) {
      throw failure('ITEM_NOT_FOUND', `${item} がインベントリに見つかりません`)
    }

    // 手に持つ（メインハンド）
    await interruptible(bot, () => bot.equip(itemToEquip, 'hand'))

    logger.info(`[EQUIP_MAINHAND] ${item} を手に持ちました`)

  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    throw failure(error.code || 'EXECUTION_FAILED', `アイテムを手に持つのに失敗しました: ${error.message}`)
  }
}
