const { failure } = require('./utils/result')
const { interruptible, checkpoint } = require('./utils/context')
const { Vec3 } = require('vec3')
const minecraftData = require('minecraft-data')
const { goals, Movements } = require('mineflayer-pathfinder')
const { createLogger } = require('./utils/logger')
const { installDigExecution } = require('./utils/dig_execution')

const movementCache = new WeakMap()

async function moveTo(bot, params = {}) {
  // 指定座標まで pathfinder で移動する
  ensurePathfinder(bot)

  const position = resolvePosition(params)
  if (!position) {
    throw failure('INVALID_ARGUMENT', '移動座標が指定されていません')
  }

  const range = typeof params.range === 'number' ? params.range : 0
  const goal = range > 0
    ? new goals.GoalNear(position.x, position.y, position.z, range)
    : new goals.GoalBlock(position.x, position.y, position.z)

  // タイムアウトの設定
  let timeout = params.timeout
  if (timeout === undefined) {
    // タイムアウトが指定されていない場合は、距離に応じて動的に設定
    const distance = bot.entity.position.distanceTo(position)
    // 1ブロックあたり1秒（1000ms）、最小30秒
    timeout = Math.max(30000, distance * 1000)
  }

  checkpoint(bot)
  let timer
  const movement = bot.pathfinder.goto(goal)
  try {
    if (timeout === null) {
      await movement
    } else {
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`moveTo timeout (${timeout}ms)`), { code: 'TIMEOUT' })), timeout)
      })
      await Promise.race([movement, expired])
    }
    checkpoint(bot)
  } catch (error) {
    bot.pathfinder.setGoal(null)
    await Promise.resolve(movement).catch(() => {})
    checkpoint(bot)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function digBlock(bot, params = {}) {
  const targetPos = resolvePosition(params)
  if (!targetPos) throw failure('INVALID_ARGUMENT', '掘削対象の座標が必要です')
  const block = bot.blockAt(targetPos)
  if (!block) throw failure('BLOCK_NOT_FOUND', '指定位置にブロックが存在しません')
  installDigExecution(bot)
  await interruptible(bot, () => bot.dig(block))
}

// 指定ブロックに最適なツールを装備する
async function equipBestToolForBlock(bot, block) {
  try {
    // インベントリから最適なツールを探索
    const bestTool = await interruptible(bot, () => findBestTool(bot, block))

    if (bestTool) {
      const mcData = minecraftData(bot.version)
      const toolName = mcData.items[bestTool.type].name
      const logger = createLogger({ bot, category: 'primitive', commandName: bot.currentCommandName })
      logger.info(`[TOOL] ${block.name}用に${toolName}を装備`)
      await interruptible(bot, () => bot.equip(bestTool, 'hand'))
    } else {
      const logger = createLogger({ bot, category: 'primitive', commandName: bot.currentCommandName })
      logger.info(`[TOOL] ${block.name}用の適切なツールが見つからず、素手で掘削`)
      await interruptible(bot, () => bot.unequip('hand'))
    }
  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    const logger = createLogger({ bot, category: 'primitive', commandName: bot.currentCommandName })
    logger.info(`[TOOL] ツール装備に失敗、素手で掘削: ${error.message}`)
  }
}

// インベントリから指定ブロックに最も効果的なツールを見つける
async function findBestTool(bot, block) {
  if (!bot.version) return null

  const mcData = minecraftData(bot.version)

  // 実際のツール（武器・道具）のみを対象にする
  const validToolTypes = [
    'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe',
    'wooden_axe', 'stone_axe', 'iron_axe', 'golden_axe', 'diamond_axe', 'netherite_axe',
    'wooden_shovel', 'stone_shovel', 'iron_shovel', 'golden_shovel', 'diamond_shovel', 'netherite_shovel',
    'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe', 'netherite_hoe',
    'wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword', 'netherite_sword',
    'shears'
  ]

  const availableTools = bot.inventory.items()
    .filter(item => {
      if (!item || !mcData.items[item.type]) return false
      const itemName = mcData.items[item.type].name
      return validToolTypes.includes(itemName)
    })

  const blockData = mcData.blocks[block.type]
  const logger = createLogger({ bot, category: 'primitive', commandName: bot.currentCommandName })
  logger.info(`[TOOL] ${block.name}に最適ツール選択中...`)

  if (availableTools.length === 0) return null

  let bestTool = null
  let bestTime = Infinity

  // 現在の手持ちアイテムを保存
  const originalHeldItem = bot.heldItem

  // 各ツールでの採掘時間を計算（実際に装備して測定）
  for (const tool of availableTools) {
    try {
      const toolName = mcData.items[tool.type].name
      // ツールを装備
      await interruptible(bot, () => bot.equip(tool, 'hand'))
      await interruptible(bot, () => delay(30)) // 装備完了を待つ（1.20.xでは30msで十分）

      // 装備確認してから採掘時間を測定
      if (!bot.heldItem || bot.heldItem.type !== tool.type) {
        logger.info(`[TOOL] ${toolName}: 装備失敗をスキップ`)
        continue
      }

      const digTimeMs = bot.digTime(block)  // ミリ秒
      const digTimeSec = digTimeMs / 1000   // 秒に変換
      logger.info(`[TOOL] ${toolName}: ${digTimeSec.toFixed(2)}秒`)

      if (digTimeSec > 0 && digTimeSec < bestTime) {
        bestTime = digTimeSec
        bestTool = tool
      }
    } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
      // console.log(`[TOOL] ${mcData.items[tool.type].name}: テスト失敗 - ${error.message}`)
    }
  }

  // 素手での採掘時間を測定（手に何も持たない状態）
  try {
    await interruptible(bot, () => bot.unequip('hand'))
    await interruptible(bot, () => delay(30)) // 装備解除完了を待つ（1.20.xでは30msで十分）

    // 素手確認してから測定
    if (bot.heldItem) {
      logger.info(`[TOOL] 素手: 装備解除失敗をスキップ`)
      // handDigTimeを定義しないのでスキップされる
    } else {
      const handDigTimeMs = bot.digTime(block)  // ミリ秒
      const handDigTimeSec = handDigTimeMs / 1000  // 秒に変換
      logger.info(`[TOOL] 素手: ${handDigTimeSec.toFixed(2)}秒`)

      if (handDigTimeSec > 0 && (!bestTool || handDigTimeSec < bestTime)) {
        logger.info(`[TOOL] 素手が最適`)
        bestTool = null
        bestTime = handDigTimeSec
      }
    }
  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    logger.info(`[TOOL] 素手: 計算失敗 - ${error.message}`)
  }

  // 元の手持ちアイテムを復元
  try {
    if (originalHeldItem) {
      await interruptible(bot, () => bot.equip(originalHeldItem, 'hand'))
    } else {
      await interruptible(bot, () => bot.unequip('hand'))
    }
  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    // 復元失敗は無視
  }

  if (bestTool) {
    logger.info(`[TOOL] 最適ツール: ${mcData.items[bestTool.type].name} (${bestTime.toFixed(2)}秒)`)
  } else {
    logger.info(`[TOOL] 素手が最適`)
  }

  return bestTool
}

// minecraft-dataを使った手動採掘時間計算（デバッグ用）
function calculateDigTimeManual(block, tool, mcData) {
  const logger = createLogger({ category: 'primitive', commandName: 'primitive' })
  try {
    const blockData = mcData.blocks[block.type]
    if (!blockData || typeof blockData.hardness !== 'number') {
      return Infinity
    }

    const hardness = blockData.hardness

    if (tool) {
      const toolData = mcData.items[tool.type]
      if (!toolData) return Infinity

      // ツールの採掘速度を取得（簡略化）
      const toolSpeeds = {
        'wooden_pickaxe': 2.0, 'stone_pickaxe': 4.0, 'iron_pickaxe': 6.0,
        'wooden_axe': 2.0, 'stone_axe': 4.0, 'iron_axe': 6.0,
        'wooden_shovel': 2.0, 'stone_shovel': 4.0, 'iron_shovel': 6.0
      }

      const speed = toolSpeeds[toolData.name] || 1.0

      // 適切なツールかチェック（詳細化）
      const isCorrectTool = checkToolSuitability(block.name, toolData.name)

      logger.info(`[MANUAL] ${toolData.name} for ${block.name}: isCorrect=${isCorrectTool}, speed=${speed}, hardness=${hardness}`)

      return isCorrectTool ? hardness / speed : (hardness * 5) / speed
    } else {
      // 素手
      return hardness * 5
    }
  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    return Infinity
  }
}

async function collectDrops(bot, params = {}) {
  // 半径内に落ちているアイテムを順番に拾いに行く
  ensurePathfinder(bot)

  const radius = params.radius ?? 6
  const itemName = params.itemName
  if (!bot.version) {
    throw failure('BOT_NOT_READY', 'bot.version が取得できるまで待ってください')
  }
  const mcData = minecraftData(bot.version)

  // デバッグ: 近くのエンティティを確認
  const nearbyEntities = Object.values(bot.entities)
    .filter((entity) => entity && bot.entity.position.distanceTo(entity.position) <= radius)
      // const logger = createLogger({ bot, category: 'primitive', commandName: bot.currentCommandName })
      // logger.info(`[COLLECT] 範囲内エンティティ: ${nearbyEntities.map(e => `${e.name}(${e.id})`).join(', ')}`)

  const drops = Object.values(bot.entities)
    .filter((entity) => entity && entity.name === 'item')
    .filter((entity) => {
      if (itemName) {
        const held = entity.metadata?.[entity.metadata.length - 1]
        const displayName = held?.itemId ? mcData.items[held.itemId]?.name : null
        // logger.info(`[COLLECT] アイテムドロップ: ${displayName} (期待: ${itemName})`)
        return displayName === itemName
      }
      return true
    })
    .filter((entity) => bot.entity.position.distanceTo(entity.position) <= radius)
    .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))

  // logger.info(`[COLLECT] 対象ドロップ数: ${drops.length}`)

  let pickedUpCount = 0

  for (const drop of drops) {
    try {
      // ドロップに近づく（タイムアウト3秒）
      await interruptible(bot, () => moveTo(bot, { position: drop.position, range: 1.2, timeout: 3000 }))

      // 少し待ってから再度エンティティの存在確認
      await interruptible(bot, () => delay(params.waitMs ?? 50)) // ドロップ接近後の待機（1.20.xでは短縮可能）

      // エンティティがまだ存在するか確認（既に自動ピックアップされた可能性）
      const stillExists = bot.entities[drop.id]
      if (!stillExists) {
        pickedUpCount++
        continue
      }

      // より近づいて確実にピックアップを誘発（タイムアウト2秒）
      await interruptible(bot, () => moveTo(bot, { position: drop.position, range: 0.8, timeout: 2000 }))
      await interruptible(bot, () => delay(50)) // ピックアップ待機（1.20.xでは短縮可能）

      // もう一度存在確認
      if (!bot.entities[drop.id]) {
        pickedUpCount++
      }
    } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
      const logger = createLogger({ bot, category: 'primitive', commandName: bot.currentCommandName })
      logger.info(`[COLLECT] ドロップ回収失敗（スキップ）: ${error.message}`)
      // ドロップ1個の回収失敗は許容して次に進む
      continue
    }
  }

  return pickedUpCount
}

async function craftItem(bot, params = {}) {
  // 指定アイテムをクラフトする（レシピは自動選択）
  if (!params.itemName) {
    throw failure('INVALID_ARGUMENT', 'itemName が必要です')
  }

  if (!bot.version) {
    throw failure('BOT_NOT_READY', 'bot.version が取得できるまで待ってください')
  }

  const mcData = minecraftData(bot.version)
  const recipeItem = mcData.itemsByName[params.itemName]
  if (!recipeItem) {
    throw failure('ITEM_NOT_FOUND', `未知のアイテム名です: ${params.itemName}`)
  }

  const count = params.count ?? 1
  const tableBlock = params.table || null

  const recipes = bot.recipesFor(recipeItem.id, params.metadata ?? null, count, tableBlock)
  if (!recipes || recipes.length === 0) {
    throw failure('RECIPE_NOT_FOUND', '利用可能なレシピが見つかりません')
  }

  try {
    await interruptible(bot, () => bot.craft(recipes[0], count, tableBlock))
  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    if (/missing ingredient/i.test(error.message)) {
      throw failure('ITEM_NOT_FOUND', '必要な素材が不足しています')
    }
    throw error
  }
}

async function placeBlock(bot, params = {}) {
  // 手持ちのブロックを基準ブロックの指定面に設置する
  if (!params.reference) {
    throw failure('INVALID_ARGUMENT', 'reference 座標が必要です')
  }

  const referencePos = resolvePosition({ position: params.reference })
  const referenceBlock = bot.blockAt(referencePos)
  if (!referenceBlock) {
    throw failure('BLOCK_NOT_FOUND', '参照ブロックが存在しません')
  }

  const face = params.face ?? { x: 0, y: 1, z: 0 }
  const faceVector = new Vec3(face.x, face.y, face.z)

  const heldItem = bot.heldItem
  if (!heldItem) {
    throw failure('PLACEMENT_FAILED', '手にブロックが装備されていません')
  }

  await interruptible(bot, () => bot.placeBlock(referenceBlock, faceVector))
}

async function equipItem(bot, params = {}) {
  // インベントリ内のアイテムを指定スロットに装備する
  if (!params.itemName) {
    throw failure('INVALID_ARGUMENT', 'itemName が必要です')
  }

  const destination = params.destination ?? 'hand'
  const item = bot.inventory.items().find((invItem) => invItem.name === params.itemName)
  if (!item) {
    throw failure('ITEM_NOT_FOUND', `インベントリに ${params.itemName} がありません`)
  }

  await interruptible(bot, () => bot.equip(item, destination))
}

function ensurePathfinder(bot) {
  if (!bot.pathfinder) {
    throw failure('BOT_NOT_READY', 'pathfinder プラグインが読み込まれていません')
  }

  if (movementCache.has(bot)) return movementCache.get(bot)

  if (!bot.version) {
    throw failure('BOT_NOT_READY', 'bot.version が取得できるまで待ってください')
  }

  const mcData = minecraftData(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = true
  movements.allowSprinting = true

  const dirtBlock = mcData.blocksByName.dirt
  if (dirtBlock && typeof dirtBlock.id === 'number') {
    movements.scaffoldingBlocks = new Set([dirtBlock.id])
  }

  bot.pathfinder.setMovements(movements)
  movementCache.set(bot, movements)
  return movements
}

function resolvePosition(params = {}) {
  if (params.position instanceof Vec3) {
    return params.position
  }

  if (params.position && typeof params.position === 'object') {
    const { x, y, z } = params.position
    if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
      return new Vec3(x, y, z)
    }
  }

  const { x, y, z } = params
  if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
    return new Vec3(x, y, z)
  }

  return null
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function findBlock(bot, params = {}) {
  // 条件に一致するブロックを1つ探索し、位置情報を返す
  const options = buildFindBlockOptions(params)
  const start = process.hrtime.bigint()
  const block = bot.findBlock(options)
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
  const logger = createLogger({ bot, category: 'primitive', commandName: bot.currentCommandName })
  logger.info(`[PRIMITIVES] findBlock match=${describeMatch(params.match)} distance=${options.maxDistance} took ${elapsedMs.toFixed(1)}ms`)
  if (!block) throw failure('BLOCK_NOT_FOUND', '条件に合うブロックが見つかりません')
  return {
    position: block.position.clone(),
    name: block.name,
    block
  }
}

async function findBlocks(bot, params = {}) {
  // 条件に一致するブロックを複数探索し、位置情報リストを返す
  const options = buildFindBlockOptions(params)
  const start = process.hrtime.bigint()
  const blocks = bot.findBlocks(options)
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
  const logger = createLogger({ bot, category: 'primitive', commandName: bot.currentCommandName })
  logger.info(`[PRIMITIVES] findBlocks match=${describeMatch(params.match)} distance=${options.maxDistance} count=${options.count} took ${elapsedMs.toFixed(1)}ms`)
  if (!blocks || blocks.length === 0) {
    throw failure('BLOCK_NOT_FOUND', '条件に合うブロックが見つかりません')
  }
  return blocks.map((pos) => ({
    position: pos.clone(),
    name: bot.blockAt(pos)?.name || null
  }))
}

function buildFindBlockOptions(params) {
  // findBlock(s) 用オプションを構築するヘルパー
  if (!params.match) {
    throw failure('INVALID_ARGUMENT', 'match 条件が必要です')
  }

  const maxDistance = params.maxDistance ?? 32
  const count = params.count ?? 1
  const useCube = params.useCube ?? true

  return {
    matching: buildMatchingPredicate(params.match),
    maxDistance,
    count,
    useCube
  }
}

function buildMatchingPredicate(match) {
  // match 引数から block.name 評価用の述語関数を生成する
  if (typeof match === 'string') {
    return (block) => block && block.name === match
  }

  if (Array.isArray(match)) {
    const set = new Set(match)
    return (block) => block && set.has(block.name)
  }

  if (typeof match === 'object') {
    const equals = Array.isArray(match.equals) ? new Set(match.equals) : null
    const includes = typeof match.includes === 'string' ? match.includes : null

    return (block) => {
      if (!block) return false
      if (equals && equals.has(block.name)) return true
      if (includes && block.name.includes(includes)) return true
      return false
    }
  }

  throw failure('INVALID_ARGUMENT', 'match 条件の形式が不正です')
}

module.exports = {
  moveTo,
  digBlock,
  collectDrops,
  craftItem,
  placeBlock,
  equipItem,
  findBlock,
  findBlocks,
  equipBestToolForBlock,
  findBestTool
}

function describeMatch(match) {
  if (typeof match === 'string') return match
  if (Array.isArray(match)) return `[${match.join(',')}]`
  if (typeof match === 'object' && match !== null) {
    const parts = []
    if (Array.isArray(match.equals)) parts.push(`equals=${match.equals.join(',')}`)
    if (typeof match.includes === 'string') parts.push(`includes=${match.includes}`)
    return `{${parts.join(' ')}}`
  }
  return String(match)
}
