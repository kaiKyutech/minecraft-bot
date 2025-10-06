const fs = require('fs')
const path = require('path')
const YAML = require('yaml')

const STATE_SCHEMA_PATH = path.join(__dirname, '../../config/state_schema.yaml')
const CATEGORIES_PATH = path.join(__dirname, '../../config/block_categories.yaml')

let stateSchema
let blockCategories

function loadStateSchema() {
  if (stateSchema) return stateSchema
  const raw = fs.readFileSync(STATE_SCHEMA_PATH, 'utf8')
  stateSchema = YAML.parse(raw)
  return stateSchema
}

function loadBlockCategories() {
  if (blockCategories) return blockCategories
  const raw = fs.readFileSync(CATEGORIES_PATH, 'utf8')
  blockCategories = YAML.parse(raw)
  return blockCategories
}

/**
 * 状態スキーマに基づいてボットの現在状態を構築
 */
function buildState(worldState) {
  const schema = loadStateSchema()
  const facts = Object.create(null)

  // インベントリ状態の構築
  buildInventoryStates(facts, worldState, schema.inventory_states)

  // 環境状態の構築
  buildEnvironmentStates(facts, worldState, schema.environment_states)

  // 世界状態の構築
  buildWorldStates(facts, worldState, schema.world_states)

  return facts
}

function buildInventoryStates(facts, worldState, inventorySchema) {
  const counts = worldState?.inventory?.counts || {}
  const categories = loadBlockCategories()

  // 各状態の初期値設定
  for (const [stateName, config] of Object.entries(inventorySchema)) {
    facts[stateName] = config.default
  }

  // カテゴリベースでインベントリを集計
  let logCount = 0
  let plankCount = 0
  let basicStoneCount = 0

  // カテゴリ定義から動的に集計
  if (categories?.categories) {
    for (const [itemName, count] of Object.entries(counts)) {
      // log カテゴリ
      if (categories.categories.log?.blocks.includes(itemName)) {
        logCount += count
      }
      // plank カテゴリ
      if (categories.categories.plank?.blocks.includes(itemName)) {
        plankCount += count
      }
      // basic_stone カテゴリ
      if (categories.categories.basic_stone?.blocks.includes(itemName)) {
        basicStoneCount += count
      }
    }
  }

  // 個別アイテムの処理
  for (const [name, count] of Object.entries(counts)) {
    if (name === 'stick') facts.has_stick = count
    if (name === 'crafting_table') facts.has_workbench = count
    if (name === 'wooden_pickaxe') facts.has_wooden_pickaxe = count
    if (name === 'wooden_axe') facts.has_wooden_axe = count
    if (name === 'wooden_sword') facts.has_wooden_sword = count
    if (name === 'wooden_shovel') facts.has_wooden_shovel = count
    if (name === 'wooden_hoe') facts.has_wooden_hoe = count
    if (name === 'stone_pickaxe') facts.has_stone_pickaxe = count
    if (name === 'stone_axe') facts.has_stone_axe = count
    if (name === 'stone_sword') facts.has_stone_sword = count
    if (name === 'stone_shovel') facts.has_stone_shovel = count
    if (name === 'stone_hoe') facts.has_stone_hoe = count
  }

  // カテゴリ集計結果を設定
  facts.has_log = logCount
  facts.has_plank = plankCount
  facts.has_cobblestone = basicStoneCount // basic_stone → cobblestone として扱う

  // 複合状態を計算
  calculateCompositeStates(facts)
}

function buildEnvironmentStates(facts, worldState, environmentSchema) {
  const nearbyBlocks = worldState?.nearby_blocks || {}

  // スキーマで定義された環境状態を設定
  for (const [stateName, config] of Object.entries(environmentSchema)) {
    if (config.detection_method === 'findBlock') {
      facts[stateName] = nearbyBlocks[stateName] || config.default
    } else if (config.detection_method === 'findBlockCategory') {
      facts[stateName] = nearbyBlocks[stateName] || config.default
    } else {
      facts[stateName] = config.default
    }
  }
}

function buildWorldStates(facts, worldState, worldSchema) {
  for (const [stateName, config] of Object.entries(worldSchema)) {
    switch (stateName) {
      case 'is_day':
        facts[stateName] = worldState?.isDay !== false
        break
      default:
        facts[stateName] = config.default
    }
  }
}

/**
 * 複合状態を計算（state_schema.yamlの定義に基づく）
 * @param {Object} state - 状態オブジェクト
 */
function calculateCompositeStates(state) {
  const schema = loadStateSchema()

  // inventory_states, environment_states, world_statesの全てをチェック
  for (const section of ['inventory_states', 'environment_states', 'world_states']) {
    if (!schema[section]) continue

    for (const [stateName, config] of Object.entries(schema[section])) {
      // computed: true かつ depends_on が定義されている場合
      if (config.computed && Array.isArray(config.depends_on)) {
        // depends_onの変数のいずれかが >= 1 なら true
        state[stateName] = config.depends_on.some(depVar => (state[depVar] || 0) >= 1)
      }
    }
  }
}

/**
 * 利用可能な状態変数の一覧を取得
 */
function getAvailableStates() {
  const schema = loadStateSchema()
  const states = {}

  Object.assign(states, schema.inventory_states)
  Object.assign(states, schema.environment_states)
  Object.assign(states, schema.world_states)

  return states
}

module.exports = {
  buildState,
  getAvailableStates,
  loadStateSchema,
  loadBlockCategories,
  calculateCompositeStates
}