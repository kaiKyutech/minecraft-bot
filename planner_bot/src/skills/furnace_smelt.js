const minecraftData = require('minecraft-data')
const { createLogger } = require('../utils/logger')

/**
 * 中位スキル: furnace_smelt
 * かまどを使ってアイテムを精錬する
 * - 近くのかまどを探す
 * - 材料と燃料を使って精錬を実行
 */
module.exports = async function furnaceSmelt(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')

  const { input, fuel, output, fuel_count = 1 } = params

  if (!input || !fuel || !output) {
    throw new Error('input, fuel, output パラメータが必要です')
  }

  const logger = createLogger({ bot, category: 'skill' })
  logger.info(`[FURNACE_SMELT] ${input} を ${fuel} で精錬して ${output} を作成`)

  const mcData = minecraftData(bot.version)

  // かまどを探す
  const furnaceBlock = bot.findBlock({
    matching: (block) => block && block.name === 'furnace',
    maxDistance: 5
  })

  if (!furnaceBlock) {
    throw new Error('近くにかまどが見つかりません')
  }

  logger.info(`[FURNACE_SMELT] かまどを発見: ${JSON.stringify(furnaceBlock.position)}`)

  // かまどに近づく
  const distance = bot.entity.position.distanceTo(furnaceBlock.position)
  if (distance > 4) {
    logger.info(`[FURNACE_SMELT] かまどに近づいています（距離: ${distance.toFixed(2)}）`)
    await bot.pathfinder.goto(new (require('mineflayer-pathfinder').goals.GoalNear)(
      furnaceBlock.position.x,
      furnaceBlock.position.y,
      furnaceBlock.position.z,
      3
    ))
  }

  // 材料アイテムを探す
  const inputItem = resolveItemFromName(bot, mcData, input)
  if (!inputItem) {
    throw new Error(`材料アイテム ${input} がインベントリに見つかりません`)
  }

  // 燃料アイテムを探す
  const fuelItem = resolveItemFromName(bot, mcData, fuel)
  if (!fuelItem) {
    throw new Error(`燃料 ${fuel} がインベントリに見つかりません`)
  }

  logger.info(`[FURNACE_SMELT] 材料: ${inputItem.name}, 燃料: ${fuelItem.name}`)

  // かまどを開く
  const furnace = await bot.openFurnace(furnaceBlock)

  try {
    // 材料を配置
    await furnace.putInput(inputItem.type, null, 1)
    logger.info(`[FURNACE_SMELT] 材料を配置しました`)

    // 燃料を配置
    await furnace.putFuel(fuelItem.type, null, fuel_count)
    logger.info(`[FURNACE_SMELT] 燃料を配置しました`)

    // 精錬が完了するまで待つ（最大30秒）
    logger.info(`[FURNACE_SMELT] 精錬中...`)
    const timeout = 30000
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 1000))

      // 出力スロットをチェック
      if (furnace.outputItem()) {
        logger.info(`[FURNACE_SMELT] 精錬完了`)
        await furnace.takeOutput()
        logger.info(`[FURNACE_SMELT] ${output} を取得しました`)
        break
      }
    }

    if (!furnace.outputItem() && Date.now() - startTime >= timeout) {
      throw new Error('精錬がタイムアウトしました')
    }

  } finally {
    furnace.close()
  }

  logger.info(`[FURNACE_SMELT] 完了`)
}

/**
 * アイテム名からインベントリ内のアイテムを探す
 * カテゴリ名（log, planks）や個別名（oak_log）に対応
 */
function resolveItemFromName(bot, mcData, itemName) {
  // カテゴリ名の場合（log, planks等）
  if (itemName === 'log') {
    // 任意の種類の原木を探す
    const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log']
    for (const logType of logTypes) {
      const item = bot.inventory.items().find(item => item.name === logType)
      if (item) return item
    }
  }

  if (itemName === 'planks') {
    // 任意の種類の板を探す
    const plankTypes = ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks']
    for (const plankType of plankTypes) {
      const item = bot.inventory.items().find(item => item.name === plankType)
      if (item) return item
    }
  }

  // 個別アイテム名の場合
  return bot.inventory.items().find(item => item.name === itemName)
}
