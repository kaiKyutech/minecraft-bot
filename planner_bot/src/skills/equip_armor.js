const { failure } = require('../utils/result')
const { interruptible, checkpoint } = require('../utils/context')
const primitives = require('../primitives')
const { createLogger } = require('../utils/logger')

/**
 * スキル: equip_armor
 * 防具を装備する
 *
 * @param {Object} bot - Mineflayerボット
 * @param {Object} params - { slot: "helmet", item: "diamond_helmet" }
 * @param {Object} stateManager - 状態マネージャー
 */
module.exports = async function equipArmor(bot, params = {}, stateManager) {
  if (!stateManager) throw failure('INVALID_ARGUMENT', 'stateManager が提供されていません')
  if (!params.slot) throw failure('INVALID_ARGUMENT', 'slot パラメータが必要です')
  if (!params.item) throw failure('INVALID_ARGUMENT', 'item パラメータが必要です')

  const { slot, item } = params

  const logger = createLogger({ bot, category: 'skill' })
  logger.info(`[EQUIP_ARMOR] ${item} を ${slot} スロットに装備します`)

  try {
    // パラメータのslotをMineflayerのdestinationにマッピング
    const destinationMap = {
      helmet: 'head',
      chestplate: 'torso',
      leggings: 'legs',
      boots: 'feet'
    }

    const destination = destinationMap[slot]
    if (!destination) {
      throw failure('INVALID_ARGUMENT', `不明な装備スロット: ${slot}`)
    }

    // インベントリから対象アイテムを探す
    const itemToEquip = bot.inventory.items().find(i => i.name === item)
    if (!itemToEquip) {
      throw failure('ITEM_NOT_FOUND', `${item} がインベントリに見つかりません`)
    }

    // 装備を実行（Mineflayer API: bot.equip(item, destination)）
    await interruptible(bot, () => bot.equip(itemToEquip, destination))

    logger.info(`[EQUIP_ARMOR] ${item} の装備が完了しました`)

  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    throw failure(error.code || 'EXECUTION_FAILED', `装備に失敗しました: ${error.message}`)
  }
}
