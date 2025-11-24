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
  if (!stateManager) throw new Error('stateManager が提供されていません')
  if (!params.item) throw new Error('item パラメータが必要です')

  const { item } = params

  const logger = createLogger({ bot, category: 'skill' })
  logger.info(`[EQUIP_MAINHAND] ${item} を手に持ちます`)

  try {
    // インベントリから対象アイテムを探す
    const itemToEquip = bot.inventory.items().find(i => i.name === item)
    if (!itemToEquip) {
      throw new Error(`${item} がインベントリに見つかりません`)
    }

    // 手に持つ（メインハンド）
    await bot.equip(itemToEquip, 'hand')

    logger.info(`[EQUIP_MAINHAND] ${item} を手に持ちました`)

  } catch (error) {
    throw new Error(`アイテムを手に持つのに失敗しました: ${error.message}`)
  }
}
