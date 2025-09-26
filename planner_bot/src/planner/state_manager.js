const { loadStateSchema, loadBlockCategories } = require('./state_builder')

/**
 * ボットの状態を取得・更新するためのヘルパー
 */
class StateManager {
  constructor() {
    this.cache = null
  }

  async getState(bot) {
    if (!this.cache) {
      await this.refresh(bot)
    }
    return this.cache
  }

  async refresh(bot) {
    this.cache = {
      timestamp: Date.now(),
      inventory: this.extractInventory(bot), // インベントリ生データ
      position: bot.entity?.position ? bot.entity.position.clone() : null,
      isDay: bot.time ? bot.time.isDay : true,
      nearby_blocks: this.extractNearbyBlocks(bot) // 周辺ブロック検索
    }

    // デバッグ用: GOAP状態をログ出力
    this.logCurrentState(bot)

    return this.cache
  }

  extractInventory(bot) {
    const slots = bot.inventory?.items() || []
    const counts = {}
    for (const item of slots) {
      counts[item.name] = (counts[item.name] || 0) + item.count
    }
    return {
      raw: slots,
      counts
    }
    // 結果例: { oak_log: 5, birch_log: 2, stone_pickaxe: 1 }
  }

  extractNearbyBlocks(bot) {
    // state_schema.yamlの環境設定を読み込み
    // 状態スキーマに基づいて動的にブロック検索
    const schema = loadStateSchema()
    const categories = loadBlockCategories()
    const nearbyBlocks = {}

    if (!schema.environment_states) return nearbyBlocks

    for (const [stateName, config] of Object.entries(schema.environment_states)) {
      if (config.detection_method === 'findBlock') {
        // 個別ブロック検索
        try {
          const block = bot.findBlock({
            matching: (block) => block && block.name === config.block_name,
            maxDistance: config.max_distance || 32,
            count: 1
          })
          nearbyBlocks[stateName] = !!block

          // 作業台の場合、詳細情報をログ出力
          if (config.block_name === 'crafting_table' && block) {
            const distance = bot.entity.position.distanceTo(block.position)
            console.log(`[STATE] ${stateName}: found crafting_table at ${JSON.stringify(block.position)} (distance: ${distance.toFixed(2)})`)
          }
        } catch (error) {
          nearbyBlocks[stateName] = false
        }
      } else if (config.detection_method === 'findBlockCategory') {
        // カテゴリベースブロック検索
        try {
          const categoryBlocks = categories?.categories?.[config.category]?.blocks || []
          const block = bot.findBlock({
            matching: (block) => block && categoryBlocks.includes(block.name),
            maxDistance: config.max_distance || 32,
            count: 1
          })
          nearbyBlocks[stateName] = !!block
        } catch (error) {
          nearbyBlocks[stateName] = false
        }
      }
    }

    return nearbyBlocks
    // 結果例: { oak_log: 5, birch_log: 2, stone_pickaxe: 1 }
  }

  logCurrentState(bot) {
    const { buildState } = require('./state_builder')
    const goapState = buildState(this.cache)

    // Boolean値のみを1/0で表示
    const booleanStates = []
    const numericStates = []

    for (const [key, value] of Object.entries(goapState)) {
      if (typeof value === 'boolean') {
        booleanStates.push(`${key}:${value ? 1 : 0}`)
      } else if (typeof value === 'number') {
        numericStates.push(`${key}:${value}`)
      }
    }

    console.log(`[STATE] Boolean: ${booleanStates.join(' ')}`)
    console.log(`[STATE] Numeric: ${numericStates.join(' ')}`)
  }

  clear() {
    this.cache = null
  }
}

function createStateManager() {
  return new StateManager()
}

module.exports = createStateManager
module.exports.StateManager = StateManager
