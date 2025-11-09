const { loadStateSchema, loadBlockCategories } = require('./state_builder')
const { scanBlocks } = require('../utils/block_scanner')

const SCAN_RANGE = process.env.STATE_SCAN_RANGE ? Number(process.env.STATE_SCAN_RANGE) : 60
const parsedMaxChecks = process.env.STATE_SCAN_MAX_CHECKS
  ? Number(process.env.STATE_SCAN_MAX_CHECKS)
  : Infinity
const SCAN_MAX_CHECKS = Number.isFinite(parsedMaxChecks) && parsedMaxChecks > 0
  ? parsedMaxChecks
  : Infinity

/**
 * ボットの状態を取得・更新するためのヘルパー
 */
class StateManager {
  constructor() {
    this.cache = null
    this.namedLocations = {}  // 登録された場所の座標マップ {name: {x, y, z}}
  }

  async getState(bot) {
    if (!this.cache) {
      await this.refresh(bot)
    }
    return this.cache
  }

  async refresh(bot) {
    const blockData = await this.extractNearbyBlocks(bot)

    this.cache = {
      timestamp: Date.now(),
      inventory: this.extractInventory(bot), // インベントリ生データ
      equipment: this.extractEquipment(bot), // 装備情報
      position: bot.entity?.position ? bot.entity.position.clone() : null,
      isDay: bot.time ? bot.time.isDay : true,
      nearby_blocks: blockData.flags, // 既存booleanフラグ
      nearby: blockData.summary,      // ドット記法用（ブロック/カテゴリのヒット数）
      blocks: blockData.blocks        // ブロック座標リスト
    }

    // デバッグ用: GOAP状態をログ出力
    this.logCurrentState(bot)

    return this.cache
  }

  extractInventory(bot) {
    const slots = bot.inventory?.items() || []
    const counts = {}

    // デバッグ: 全スロットの詳細をログ出力
    if (process.env.DEBUG_INVENTORY === '1') {
      console.log('[STATE] インベントリスロット詳細:')
      for (const item of slots) {
        console.log(`  - ${item.name} x${item.count} (slot: ${item.slot}, type: ${item.type})`)
      }
    }

    for (const item of slots) {
      counts[item.name] = (counts[item.name] || 0) + item.count
    }
    return {
      raw: slots,
      counts
    }
    // 結果例: { oak_log: 5, birch_log: 2, stone_pickaxe: 1 }
  }

  /**
   * 装備情報を抽出
   * @param {Object} bot - Mineflayerボット
   * @returns {Object} - { helmet: 'diamond_helmet', chestplate: 'iron_chestplate', ... }
   */
  extractEquipment(bot) {
    const equipment = {
      helmet: 'none',
      chestplate: 'none',
      leggings: 'none',
      boots: 'none',
      mainhand: 'none',
      offhand: 'none'
    }

    // Mineflayerの装備スロット:
    // slots[5] = helmet
    // slots[6] = chestplate
    // slots[7] = leggings
    // slots[8] = boots
    // slots[45] = offhand

    const slots = bot.inventory?.slots || []
    if (slots[5]) equipment.helmet = slots[5].name
    if (slots[6]) equipment.chestplate = slots[6].name
    if (slots[7]) equipment.leggings = slots[7].name
    if (slots[8]) equipment.boots = slots[8].name
    if (slots[45]) equipment.offhand = slots[45].name

    // メインハンド: bot.heldItem または bot.inventory.slots[bot.quickBarSlot + 36]
    const heldItem = bot.heldItem
    if (heldItem) {
      equipment.mainhand = heldItem.name
    }

    return equipment
  }

  async extractNearbyBlocks(bot) {
    // state_schema.yamlの環境設定を読み込み
    // 状態スキーマに基づいて動的にブロック検索
    const schema = loadStateSchema()
    const categories = loadBlockCategories()
    const nearbyBlocks = {}

    if (!schema.environment_states) return nearbyBlocks

    const environmentStates = Object.entries(schema.environment_states)
      .map(([stateName, config]) => buildEnvironmentDefinition(stateName, config, categories))
      .filter(Boolean)

    for (const state of environmentStates) {
      nearbyBlocks[state.stateName] = state.defaultValue
    }

    if (environmentStates.length === 0) {
      return nearbyBlocks
    }

    let remaining = environmentStates.filter(state => !nearbyBlocks[state.stateName]).length

    if (remaining <= 0) {
      return nearbyBlocks
    }

    const maxRequiredDistance = environmentStates.reduce(
      (acc, state) => Math.max(acc, state.maxDistance || 0),
      0
    )
    const scanRange = Math.min(Math.max(maxRequiredDistance, 1), SCAN_RANGE)

    const scanMaxChecks = SCAN_MAX_CHECKS === Infinity ? -1 : SCAN_MAX_CHECKS

    const { summary, blocks } = await scanBlocks(bot, {
      range: scanRange,
      maxChecks: scanMaxChecks,
      collectBlocks: true,  // ★ ブロック座標リストを収集
      onBlock: ({ name, rawDistance }) => {
        for (const state of environmentStates) {
          if (nearbyBlocks[state.stateName]) continue
          if (rawDistance > state.maxDistance) continue

          if (state.type === 'single') {
            if (name === state.blockName) {
              nearbyBlocks[state.stateName] = true
              remaining--
            }
          } else if (state.type === 'category') {
            if (state.blockSet.has(name)) {
              nearbyBlocks[state.stateName] = true
              remaining--
            }
          }
        }
        return remaining <= 0
      }
    })

    if (process.env.STATE_SCAN_DEBUG === '1') {
      console.log(
        `[STATE_SCAN] range=${summary.scanRange} checks=${summary.checksUsed} ` +
        `remaining=${remaining} limit=${summary.maxChecks ?? 'unlimited'} ` +
        `limitReached=${summary.limitReached ? 1 : 0} callbackStop=${summary.stoppedByCallback ? 1 : 0}`
      )
    }

    const blockCounts = summary.typeCounts || {}

    return {
      flags: nearbyBlocks,
      summary: buildNearbySummary(blockCounts, categories),
      blocks: {
        list: blocks || [],
        summary: blockCounts
      }
    }
  }

  logCurrentState(bot) {
    const { buildState } = require('./state_builder')
    const goapState = buildState(this.cache)

    // Boolean値、Numeric値、装備状態を分類して表示
    const booleanStates = []
    const numericStates = []
    const equipmentStates = []

    for (const [key, value] of Object.entries(goapState)) {
      if (typeof value === 'boolean') {
        booleanStates.push(`${key}:${value ? 1 : 0}`)
      } else if (typeof value === 'number') {
        numericStates.push(`${key}:${value}`)
      } else if (typeof value === 'object' && value !== null) {
        if (key === 'inventory') {
          for (const [itemName, count] of Object.entries(value)) {
            if (typeof count === 'number' && count > 0) {
              numericStates.push(`inventory.${itemName}:${count}`)
            }
          }
        } else if (key === 'nearby') {
          const nearbyEntries = []
          for (const [itemName, count] of Object.entries(value)) {
            if (itemName === 'category' && count && typeof count === 'object') continue
            if (typeof count === 'number' && count > 0) {
              nearbyEntries.push(`nearby.${itemName}:${count}`)
            }
          }
          if (nearbyEntries.length > 0) {
            console.log(`[STATE] Nearby Counts: ${nearbyEntries.join(' ')}`)
          }
          const categoryInfo = value.category
          if (categoryInfo && typeof categoryInfo === 'object') {
            const categoryEntries = []
            for (const [categoryName, catCount] of Object.entries(categoryInfo)) {
              if (typeof catCount === 'number' && catCount > 0) {
                categoryEntries.push(`nearby.category.${categoryName}:${catCount}`)
              }
            }
            if (categoryEntries.length > 0) {
              console.log(`[STATE] Nearby Categories: ${categoryEntries.join(' ')}`)
            }
          }
        } else if (key === 'equipment') {
          // equipmentオブジェクトの中身を展開して表示
          for (const [itemName, equipped] of Object.entries(value)) {
            if (equipped === true) {
              equipmentStates.push(`equipment.${itemName}:1`)
            }
          }
        }
      }
    }

    console.log(`[STATE] Boolean: ${booleanStates.join(' ')}`)
    console.log(`[STATE] Numeric: ${numericStates.join(' ')}`)
    if (equipmentStates.length > 0) {
      console.log(`[STATE] Equipment: ${equipmentStates.join(' ')}`)
    }
  }

  clear() {
    this.cache = null
  }

  /**
   * 場所を名前付きで登録
   * @param {string} name - 場所名
   * @param {Object} position - 座標 {x, y, z}
   */
  registerLocation(name, position) {
    this.namedLocations[name] = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z)
    }
    console.log(`[STATE_MANAGER] 場所「${name}」を登録: (${this.namedLocations[name].x}, ${this.namedLocations[name].y}, ${this.namedLocations[name].z})`)
  }

  /**
   * 登録済み場所の取得
   * @param {string} name - 場所名
   * @returns {Object|null} - 座標 {x, y, z} または null
   */
  getLocation(name) {
    return this.namedLocations[name] || null
  }

  /**
   * 登録済み場所の一覧取得
   * @returns {Object} - {name: {x, y, z}, ...}
   */
  getLocations() {
    return { ...this.namedLocations }
  }
}

function buildEnvironmentDefinition(stateName, config, categories) {
  const detectionMethod = config.detection_method
  const maxDistance = config.max_distance || SCAN_RANGE
  const defaultValue = config.default !== undefined ? config.default : false

  if (detectionMethod === 'findBlock') {
    if (!config.block_name) return null
    return {
      stateName,
      type: 'single',
      blockName: config.block_name,
      maxDistance,
      defaultValue
    }
  }

  if (detectionMethod === 'findBlockCategory') {
    const blocks = categories?.categories?.[config.category]?.blocks || []
    if (blocks.length === 0) return null
    return {
      stateName,
      type: 'category',
      blockSet: new Set(blocks),
      maxDistance,
      defaultValue
    }
  }

  return null
}

function buildNearbySummary(blockCounts, categories) {
  const summary = Object.create(null)

  for (const [name, count] of Object.entries(blockCounts)) {
    summary[name] = count
  }

  const categoryCounts = Object.create(null)
  const categoryMap = categories?.categories || {}
  for (const [categoryName, config] of Object.entries(categoryMap)) {
    let total = 0
    for (const blockName of config.blocks || []) {
      total += blockCounts[blockName] || 0
    }
    if (total > 0) {
      categoryCounts[categoryName] = total
    }
  }

  if (Object.keys(categoryCounts).length > 0) {
    summary.category = categoryCounts
  }

  return summary
}

function createStateManager() {
  return new StateManager()
}

module.exports = createStateManager
module.exports.StateManager = StateManager
