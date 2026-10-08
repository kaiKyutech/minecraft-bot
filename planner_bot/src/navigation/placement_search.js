const Vec3 = require('vec3')

/**
 * 指定座標にブロックが設置可能かチェック
 * @returns {Object} { canPlace: boolean, reason?: string, adjacentBlock?: Block, face?: Vec3 }
 */
function canPlaceBlockAt(bot, targetPos, policy = 'creative') {
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
  const faceVectors = policy === 'skill' ? [new Vec3(0, -1, 0)] : [
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

function skillCandidates(bot) {
  const pos = bot.entity.position.floored()
  return [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[1,0,1],[-1,0,-1]].map(([x,y,z]) => pos.offset(x,y,z))
}

module.exports = { canPlaceBlockAt, findNearestPlaceablePosition, skillCandidates }
