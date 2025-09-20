const { Vec3 } = require('vec3')
const minecraftData = require('minecraft-data')
const { goals, Movements } = require('mineflayer-pathfinder')

const movementCache = new WeakMap()

async function moveTo(bot, params = {}) {
  ensurePathfinder(bot)

  const position = resolvePosition(params)
  if (!position) {
    throw new Error('移動座標が指定されていません')
  }

  const range = typeof params.range === 'number' ? params.range : 0
  const goal = range > 0
    ? new goals.GoalNear(position.x, position.y, position.z, range)
    : new goals.GoalBlock(position.x, position.y, position.z)

  await bot.pathfinder.goto(goal)
}

async function digBlock(bot, params = {}) {
  const targetPos = resolvePosition(params)
  if (!targetPos) {
    throw new Error('掘削対象の座標が必要です')
  }

  const block = bot.blockAt(targetPos)
  if (!block) {
    throw new Error('指定位置にブロックが存在しません')
  }

  if (!bot.canDigBlock(block)) {
    throw new Error(`このブロックは掘れません: ${block.name}`)
  }

  await bot.dig(block)
}

async function collectDrops(bot, params = {}) {
  ensurePathfinder(bot)

  const radius = params.radius ?? 6
  const itemName = params.itemName
  if (!bot.version) {
    throw new Error('bot.version が取得できるまで待ってください')
  }
  const mcData = minecraftData(bot.version)

  const drops = Object.values(bot.entities)
    .filter((entity) => entity && entity.name === 'item')
    .filter((entity) => {
      if (itemName) {
        const held = entity.metadata?.[entity.metadata.length - 1]
        const displayName = held?.itemId ? mcData.items[held.itemId]?.name : null
        return displayName === itemName
      }
      return true
    })
    .filter((entity) => bot.entity.position.distanceTo(entity.position) <= radius)
    .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))

  for (const drop of drops) {
    await moveTo(bot, { position: drop.position, range: 1.5 })
    await delay(params.waitMs ?? 400)
  }
}

async function craftItem(bot, params = {}) {
  if (!params.itemName) {
    throw new Error('itemName が必要です')
  }

  if (!bot.version) {
    throw new Error('bot.version が取得できるまで待ってください')
  }

  const mcData = minecraftData(bot.version)
  const recipeItem = mcData.itemsByName[params.itemName]
  if (!recipeItem) {
    throw new Error(`未知のアイテム名です: ${params.itemName}`)
  }

  const count = params.count ?? 1

  let tableBlock = null
  if (params.table) {
    const tablePos = resolvePosition({ position: params.table })
    tableBlock = bot.blockAt(tablePos)
  }

  const recipes = bot.recipesFor(recipeItem.id, params.metadata ?? null, count, tableBlock)
  if (!recipes || recipes.length === 0) {
    throw new Error('利用可能なレシピが見つかりません')
  }

  try {
    await bot.craft(recipes[0], count, tableBlock)
  } catch (error) {
    if (/missing ingredient/i.test(error.message)) {
      throw new Error('必要な素材が不足しています')
    }
    throw error
  }
}

async function placeBlock(bot, params = {}) {
  if (!params.reference) {
    throw new Error('reference 座標が必要です')
  }

  const referencePos = resolvePosition({ position: params.reference })
  const referenceBlock = bot.blockAt(referencePos)
  if (!referenceBlock) {
    throw new Error('参照ブロックが存在しません')
  }

  const face = params.face ?? { x: 0, y: 1, z: 0 }
  const faceVector = new Vec3(face.x, face.y, face.z)

  const heldItem = bot.heldItem
  if (!heldItem) {
    throw new Error('手にブロックが装備されていません')
  }

  await bot.placeBlock(referenceBlock, faceVector)
}

async function equipItem(bot, params = {}) {
  if (!params.itemName) {
    throw new Error('itemName が必要です')
  }

  const destination = params.destination ?? 'hand'
  const item = bot.inventory.items().find((invItem) => invItem.name === params.itemName)
  if (!item) {
    throw new Error(`インベントリに ${params.itemName} がありません`)
  }

  await bot.equip(item, destination)
}

function ensurePathfinder(bot) {
  if (!bot.pathfinder) {
    throw new Error('pathfinder プラグインが読み込まれていません')
  }

  if (movementCache.has(bot)) return movementCache.get(bot)

  if (!bot.version) {
    throw new Error('bot.version が取得できるまで待ってください')
  }

  const mcData = minecraftData(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = true
  movements.allowSprinting = true

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

module.exports = {
  moveTo,
  digBlock,
  collectDrops,
  craftItem,
  placeBlock,
  equipItem
}
