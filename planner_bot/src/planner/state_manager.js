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
          nearbyBlocks[config.block_name] = !!block
        } catch (error) {
          nearbyBlocks[config.block_name] = false
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
          nearbyBlocks[config.category] = !!block
        } catch (error) {
          nearbyBlocks[config.category] = false
        }
      }
    }

    return nearbyBlocks
    // 結果例: { oak_log: 5, birch_log: 2, stone_pickaxe: 1 }
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
