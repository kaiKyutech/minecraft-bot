const { interruptible, checkpoint } = require('../utils/context')
const { createLogger } = require('../utils/logger')
const { failure } = require('../utils/result')
const primitives = require('../primitives')
const Vec3 = require('vec3')

const { canPlaceBlockAt, findNearestPlaceablePosition } = require('./placement_search')

/**
 * ブロックを指定座標に設置
 */
async function placeBlock(bot, stateManager, params) {
  const { name, coords, allowSelfPosition = false } = params

  // パラメータ検証
  if (!name) {
    return {
      success: false,
      code: 'INVALID_ARGUMENT',
      error: 'ブロック名（name）が必要です'
    }
  }

  // インベントリにブロックがあるか確認
  const item = bot.inventory.items().find(i => i.name === name)
  if (!item) {
    return {
      success: false,
      code: 'ITEM_NOT_FOUND',
      error: `インベントリに ${name} がありません`,
      inventory: bot.inventory.items().map(i => i.name)
    }
  }

  let targetPos
  let targetCoords

  // 座標が指定されている場合
  if (coords) {
    if (!Array.isArray(coords) || coords.length !== 3) {
      return {
        success: false,
        code: 'INVALID_ARGUMENT',
        error: '座標（coords）は [x, y, z] の形式で指定してください'
      }
    }

    const [x, y, z] = coords
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
      return {
        success: false,
        code: 'INVALID_ARGUMENT',
        error: '座標は数値である必要があります'
      }
    }

    targetPos = new Vec3(x, y, z)
    targetCoords = { x, y, z }

    createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] ブロック設置: ${name} を [${x}, ${y}, ${z}] に配置`)
    createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] 現在位置: [${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}]`)

    // 事前チェック
    const check = canPlaceBlockAt(bot, targetPos)
    if (!check.canPlace) {
      return {
        success: false,
        code: 'PLACEMENT_FAILED',
        error: `設置できません: ${check.reason}`,
        position: targetCoords
      }
    }
  } else {
    // 座標が指定されていない場合、最も近い設置可能な場所を探す
    createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] 周囲で設置可能な場所を探索中...`)

    const nearest = findNearestPlaceablePosition(bot, 5, allowSelfPosition)
    if (!nearest) {
      return {
        success: false,
        code: 'PLACEMENT_FAILED',
        error: '周囲5ブロック以内に設置可能な場所が見つかりませんでした'
      }
    }

    targetPos = nearest.position
    targetCoords = {
      x: targetPos.x,
      y: targetPos.y,
      z: targetPos.z
    }

    createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] 設置可能な場所を発見: [${targetCoords.x}, ${targetCoords.y}, ${targetCoords.z}] (距離: ${nearest.distance.toFixed(1)} ブロック)`)
  }

  // 設置座標に移動（設置可能な距離まで）
  const distance = bot.entity.position.distanceTo(targetPos)
  createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] 目標座標までの距離: ${distance.toFixed(2)} ブロック`)

  if (distance > 4.5) {
    createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] 目標座標まで移動中... (距離: ${Math.floor(distance)} ブロック)`)
    try {
      await interruptible(bot, () => primitives.moveTo(bot, { position: targetPos, range: 4.5 }))
      createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] 移動完了`)
    } catch (error) {
    checkpoint(bot)
    if (error?.name === 'AbortError') throw error
      return {
        success: false,
        code: error.code || 'EXECUTION_FAILED',
        error: `移動に失敗しました: ${error.message}`,
        position: targetCoords
      }
    }
  } else {
    createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] 既に範囲内にいます。移動不要`)
  }

  // ブロックを手に持つ
  try {
    await interruptible(bot, () => bot.equip(item, 'hand'))
  } catch (error) {
    checkpoint(bot)
    if (error?.name === 'AbortError') throw error
    return {
      success: false,
      code: error.code || 'PLACEMENT_FAILED',
      error: `ブロックを装備できませんでした: ${error.message}`,
      position: targetCoords
    }
  }

  // 再度設置可能かチェック（移動後に状況が変わっている可能性）
  const finalCheck = canPlaceBlockAt(bot, targetPos)
  if (!finalCheck.canPlace) {
    return {
      success: false,
      code: 'PLACEMENT_FAILED',
      error: `設置できません: ${finalCheck.reason}`,
      position: targetCoords
    }
  }

  // ブロックを設置
  try {
    await interruptible(bot, () => bot.placeBlock(finalCheck.adjacentBlock, finalCheck.face.scaled(-1)))
    createLogger({ bot, category: 'navigation', commandName: 'creative' }).info(`[CREATIVE] ${name} を [${targetCoords.x}, ${targetCoords.y}, ${targetCoords.z}] に設置しました`)

    return {
      success: true,
      message: `${name} を [${targetCoords.x}, ${targetCoords.y}, ${targetCoords.z}] に設置しました`,
      block: name,
      position: targetCoords
    }
  } catch (error) {
    checkpoint(bot)
    if (error?.name === 'AbortError') throw error
    return {
      success: false,
      code: error.code || 'PLACEMENT_FAILED',
      error: `設置に失敗しました: ${error.message}`,
      position: targetCoords
    }
  }
}


module.exports = { placeBlock, canPlaceBlockAt, findNearestPlaceablePosition }
