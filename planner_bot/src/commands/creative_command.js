/**
 * !creative コマンドのハンドラ
 * 建築関連の操作（ブロック設置など）
 *
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} commandStr - コマンド文字列
 * @param {Object} stateManager - 状態マネージャー
 */

const primitives = require('../primitives')
const Vec3 = require('vec3')

/**
 * 指定座標にブロックが設置可能かチェック
 * @returns {Object} { canPlace: boolean, reason?: string, adjacentBlock?: Block, face?: Vec3 }
 */
function canPlaceBlockAt(bot, targetPos) {
  // 1. 座標がロード済みチャンク内か確認
  const block = bot.blockAt(targetPos)
  if (!block) {
    return {
      canPlace: false,
      reason: '座標が範囲外です（チャンクが読み込まれていません）'
    }
  }

  // 2. 座標が空気ブロックか確認
  if (block.name !== 'air') {
    return {
      canPlace: false,
      reason: `既にブロック（${block.name}）が存在します`
    }
  }

  // 3. 隣接する固体ブロックを探す
  const faceVectors = [
    new Vec3(0, -1, 0),  // 下
    new Vec3(0, 1, 0),   // 上
    new Vec3(1, 0, 0),   // 東
    new Vec3(-1, 0, 0),  // 西
    new Vec3(0, 0, 1),   // 南
    new Vec3(0, 0, -1)   // 北
  ]

  for (const faceVector of faceVectors) {
    const adjacentPos = targetPos.plus(faceVector)
    const adjacentBlock = bot.blockAt(adjacentPos)

    if (adjacentBlock && adjacentBlock.name !== 'air') {
      return {
        canPlace: true,
        adjacentBlock: adjacentBlock,
        face: faceVector
      }
    }
  }

  return {
    canPlace: false,
    reason: '周囲に設置可能なブロックがありません（空中の座標です）'
  }
}

/**
 * 周囲で最も近い設置可能な座標を探す
 * @param {Object} bot - Mineflayerボット
 * @param {number} maxDistance - 最大探索距離（デフォルト: 5）
 * @param {boolean} allowSelfPosition - 自分の位置に設置を許可するか（デフォルト: false）
 * @returns {Object|null} { position: Vec3, distance: number } or null
 */
function findNearestPlaceablePosition(bot, maxDistance = 5, allowSelfPosition = false) {
  const botPos = bot.entity.position.floored()
  const candidates = []

  // 周囲をスキャン
  for (let dx = -maxDistance; dx <= maxDistance; dx++) {
    for (let dy = -maxDistance; dy <= maxDistance; dy++) {
      for (let dz = -maxDistance; dz <= maxDistance; dz++) {
        const targetPos = botPos.offset(dx, dy, dz)
        const distance = botPos.distanceTo(targetPos)

        // 最大距離を超えたらスキップ
        if (distance > maxDistance) continue

        // 自分の位置（真下を含む）をスキップ（allowSelfPosition = false の場合）
        if (!allowSelfPosition && targetPos.x === botPos.x && targetPos.z === botPos.z) {
          continue
        }

        // 設置可能かチェック
        const check = canPlaceBlockAt(bot, targetPos)
        if (check.canPlace) {
          candidates.push({
            position: targetPos,
            distance: distance,
            adjacentBlock: check.adjacentBlock,
            face: check.face
          })
        }
      }
    }
  }

  // 距離順にソート
  candidates.sort((a, b) => a.distance - b.distance)

  return candidates.length > 0 ? candidates[0] : null
}

/**
 * ブロックを指定座標に設置
 */
async function placeBlock(bot, stateManager, params) {
  const { name, coords, allowSelfPosition = false } = params

  // パラメータ検証
  if (!name) {
    return {
      success: false,
      error: 'ブロック名（name）が必要です'
    }
  }

  // インベントリにブロックがあるか確認
  const item = bot.inventory.items().find(i => i.name === name)
  if (!item) {
    return {
      success: false,
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
        error: '座標（coords）は [x, y, z] の形式で指定してください'
      }
    }

    const [x, y, z] = coords
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
      return {
        success: false,
        error: '座標は数値である必要があります'
      }
    }

    targetPos = new Vec3(x, y, z)
    targetCoords = { x, y, z }

    console.log(`[CREATIVE] ブロック設置: ${name} を [${x}, ${y}, ${z}] に配置`)
    console.log(`[CREATIVE] 現在位置: [${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}]`)

    // 事前チェック
    const check = canPlaceBlockAt(bot, targetPos)
    if (!check.canPlace) {
      return {
        success: false,
        error: `設置できません: ${check.reason}`,
        position: targetCoords
      }
    }
  } else {
    // 座標が指定されていない場合、最も近い設置可能な場所を探す
    console.log(`[CREATIVE] 周囲で設置可能な場所を探索中...`)

    const nearest = findNearestPlaceablePosition(bot, 5, allowSelfPosition)
    if (!nearest) {
      return {
        success: false,
        error: '周囲5ブロック以内に設置可能な場所が見つかりませんでした'
      }
    }

    targetPos = nearest.position
    targetCoords = {
      x: targetPos.x,
      y: targetPos.y,
      z: targetPos.z
    }

    console.log(`[CREATIVE] 設置可能な場所を発見: [${targetCoords.x}, ${targetCoords.y}, ${targetCoords.z}] (距離: ${nearest.distance.toFixed(1)} ブロック)`)
  }

  // 設置座標に移動（設置可能な距離まで）
  const distance = bot.entity.position.distanceTo(targetPos)
  console.log(`[CREATIVE] 目標座標までの距離: ${distance.toFixed(2)} ブロック`)

  if (distance > 4.5) {
    console.log(`[CREATIVE] 目標座標まで移動中... (距離: ${Math.floor(distance)} ブロック)`)
    try {
      await primitives.moveTo(bot, { position: targetPos, range: 4.5 })
      console.log(`[CREATIVE] 移動完了`)
    } catch (error) {
      return {
        success: false,
        error: `移動に失敗しました: ${error.message}`,
        position: targetCoords
      }
    }
  } else {
    console.log(`[CREATIVE] 既に範囲内にいます。移動不要`)
  }

  // ブロックを手に持つ
  try {
    await bot.equip(item, 'hand')
  } catch (error) {
    return {
      success: false,
      error: `ブロックを装備できませんでした: ${error.message}`,
      position: targetCoords
    }
  }

  // 再度設置可能かチェック（移動後に状況が変わっている可能性）
  const finalCheck = canPlaceBlockAt(bot, targetPos)
  if (!finalCheck.canPlace) {
    return {
      success: false,
      error: `設置できません: ${finalCheck.reason}`,
      position: targetCoords
    }
  }

  // ブロックを設置
  try {
    await bot.placeBlock(finalCheck.adjacentBlock, finalCheck.face.scaled(-1))
    console.log(`[CREATIVE] ${name} を [${targetCoords.x}, ${targetCoords.y}, ${targetCoords.z}] に設置しました`)

    return {
      success: true,
      message: `${name} を [${targetCoords.x}, ${targetCoords.y}, ${targetCoords.z}] に設置しました`,
      block: name,
      position: targetCoords
    }
  } catch (error) {
    return {
      success: false,
      error: `設置に失敗しました: ${error.message}`,
      position: targetCoords
    }
  }
}

async function handleCreativeCommand(bot, username, commandStr, stateManager) {
  const trimmed = commandStr.trim()
  const parts = trimmed.split(' ')

  if (parts.length < 1) {
    throw new Error(
      '使用方法: !creative <action> <params>\n' +
      '利用可能なアクション:\n' +
      '  placeBlock - ブロックを設置'
    )
  }

  const action = parts[0]  // parts[1] → parts[0] に修正
  let params = {}

  if (parts.length > 1) {  // parts.length > 2 → parts.length > 1 に修正
    const jsonStr = parts.slice(1).join(' ')  // parts.slice(2) → parts.slice(1) に修正
    try {
      params = JSON.parse(jsonStr)
    } catch (error) {
      throw new Error(`パラメータのJSON解析に失敗: ${error.message}`)
    }
  }

  console.log(`[CREATIVE] アクション: ${action}`)

  let result

  if (action === 'placeBlock') {
    result = await placeBlock(bot, stateManager, params)
  } else {
    throw new Error(
      `未知のアクション: ${action}\n` +
      '利用可能: placeBlock'
    )
  }

  return {
    success: true,
    action: action,
    data: result
  }
}

module.exports = handleCreativeCommand
