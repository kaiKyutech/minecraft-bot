const primitives = require('../primitives')

/**
 * スキル: equip_armor
 * 防具を装備する
 *
 * @param {Object} bot - Mineflayerボット
 * @param {Object} params - { slot: "helmet", item: "diamond_helmet" }
 * @param {Object} stateManager - 状態マネージャー
 */
module.exports = async function equipArmor(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')
  if (!params.slot) throw new Error('slot パラメータが必要です')
  if (!params.item) throw new Error('item パラメータが必要です')

  const { slot, item } = params

  console.log(`[EQUIP_ARMOR] ${item} を ${slot} スロットに装備します`)

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
      throw new Error(`不明な装備スロット: ${slot}`)
    }

    // インベントリから対象アイテムを探す
    const itemToEquip = bot.inventory.items().find(i => i.name === item)
    if (!itemToEquip) {
      throw new Error(`${item} がインベントリに見つかりません`)
    }

    // 装備を実行（Mineflayer API: bot.equip(item, destination)）
    await bot.equip(itemToEquip, destination)

    console.log(`[EQUIP_ARMOR] ${item} の装備が完了しました`)

  } catch (error) {
    throw new Error(`装備に失敗しました: ${error.message}`)
  }
}
