const primitives = require('../primitives')
const { Vec3 } = require('vec3')

/**
 * Navigation Actions - 場所の登録と移動
 * GOAPではなくLLMが直接制御する創造的行動
 */

/**
 * 固体の地面として扱えるブロックかどうか
 * @param {string} blockName - ブロック名
 * @returns {boolean}
 */
function isSolidGround(blockName) {
  // 空気や液体、葉っぱは地面として扱わない
  const nonSolidBlocks = [
    'air', 'cave_air', 'void_air',
    'water', 'lava', 'flowing_water', 'flowing_lava',
    'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
    'acacia_leaves', 'dark_oak_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
    'mangrove_leaves', 'cherry_leaves'
  ]
  return !nonSolidBlocks.includes(blockName)
}

/**
 * 指定したY座標の上に2ブロック分の空間があるか確認
 * @param {Object} bot - Mineflayerボット
 * @param {number} x - X座標
 * @param {number} y - Y座標（地面）
 * @param {number} z - Z座標
 * @returns {boolean}
 */
function hasSpaceAbove(bot, x, y, z) {
  const space1 = bot.blockAt(new Vec3(x, y + 1, z))
  const space2 = bot.blockAt(new Vec3(x, y + 2, z))

  return space1 && space1.name === 'air' && space2 && space2.name === 'air'
}

/**
 * 指定座標の地表高さを取得
 * @param {Object} bot - Mineflayerボット
 * @param {number} x - X座標
 * @param {number} z - Z座標
 * @param {string} verticalMode - 探索モード ("nearest" | "above" | "below" | "surface")
 * @returns {number} Y座標（立てる位置）
 */
function findSurfaceHeight(bot, x, z, verticalMode = 'nearest') {
  const startY = Math.floor(bot.entity.position.y)
  const maxRange = 50

  // "surface" モード: 上空から下に探索（空が見える地表）
  if (verticalMode === 'surface') {
    const maxY = 320  // Minecraft 1.18+ の最大高度
    const minY = -64  // Minecraft 1.18+ の最小高度

    for (let y = maxY; y >= minY; y--) {
      const block = bot.blockAt(new Vec3(x, y, z))
      if (block && isSolidGround(block.name)) {
        // 上に2ブロック分の空間があるか確認
        if (hasSpaceAbove(bot, x, y, z)) {
          console.log(`[NAVIGATION] 地表を検出: Y=${y + 1}`)
          return y + 1
        }
      }
    }
    throw new Error('地表が見つかりません')
  }

  // "below" モード: 下方向のみ探索
  if (verticalMode === 'below') {
    for (let offset = 1; offset <= maxRange; offset++) {
      const block = bot.blockAt(new Vec3(x, startY - offset, z))
      if (block && isSolidGround(block.name)) {
        // 上に2ブロック分の空間があるか確認
        if (hasSpaceAbove(bot, x, startY - offset, z)) {
          return startY - offset + 1
        }
      }
    }
    throw new Error(`現在地より下に立てる地面が見つかりません (探索範囲: ${maxRange}ブロック)`)
  }

  // "above" モード: 上方向のみ探索
  if (verticalMode === 'above') {
    for (let offset = 1; offset <= maxRange; offset++) {
      const block = bot.blockAt(new Vec3(x, startY + offset, z))
      if (block && isSolidGround(block.name)) {
        // 上に2ブロック分の空間があるか確認
        if (hasSpaceAbove(bot, x, startY + offset, z)) {
          return startY + offset + 1
        }
      }
    }
    throw new Error(`現在地より上に立てる地面が見つかりません (探索範囲: ${maxRange}ブロック)`)
  }

  // "nearest" モード: 上下交互に探索
  for (let offset = 1; offset <= maxRange; offset++) {
    // 下を確認
    const blockBelow = bot.blockAt(new Vec3(x, startY - offset, z))
    if (blockBelow && isSolidGround(blockBelow.name)) {
      // 上に2ブロック分の空間があるか確認
      if (hasSpaceAbove(bot, x, startY - offset, z)) {
        return startY - offset + 1
      }
    }

    // 上を確認
    const blockAbove = bot.blockAt(new Vec3(x, startY + offset, z))
    if (blockAbove && isSolidGround(blockAbove.name)) {
      // 上に2ブロック分の空間があるか確認
      if (hasSpaceAbove(bot, x, startY + offset, z)) {
        return startY + offset + 1
      }
    }
  }

  // 見つからなければ現在地のY座標を返す
  console.log(`[NAVIGATION] 立てる地面が見つかりませんでした。現在地のY座標を使用します`)
  return startY
}

module.exports = {
  /**
   * 現在地または指定座標を名前付きで登録
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {name: string, coords?: [x, y, z], blockType?: string}
   */
  async register(bot, stateManager, params) {
    if (!params.name) {
      throw new Error('場所名（name）が必要です')
    }

    let position = bot.entity.position

    // coords指定があれば、その座標を登録
    if (params.coords) {
      if (!Array.isArray(params.coords) || params.coords.length !== 3) {
        throw new Error('座標は [x, y, z] の形式で指定してください')
      }
      const [x, y, z] = params.coords
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
        throw new Error('座標は数値である必要があります')
      }
      position = { x, y, z }
      console.log(`[NAVIGATION] 座標 [${x}, ${y}, ${z}] を「${params.name}」として登録`)
    }
    // blockType指定があれば、そのブロックの位置を登録
    else if (params.blockType) {
      const block = bot.findBlock({
        matching: (b) => b && b.name === params.blockType,
        maxDistance: 100
      })
      if (!block) {
        throw new Error(`${params.blockType} が見つかりません`)
      }
      position = block.position
      console.log(`[NAVIGATION] ${params.blockType} の位置を「${params.name}」として登録`)
    }
    // どちらも指定されていない場合は現在地
    else {
      console.log(`[NAVIGATION] 現在地を「${params.name}」として登録`)
    }

    stateManager.registerLocation(params.name, position)

    return {
      success: true,
      message: `場所「${params.name}」を登録しました`,
      location: {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z)
      }
    }
  },

  /**
   * 登録済みの場所に移動
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {name: string}
   */
  async goto(bot, stateManager, params) {
    if (!params.name) {
      throw new Error('場所名（name）が必要です')
    }

    const location = stateManager.getLocation(params.name)
    if (!location) {
      const registered = Object.keys(stateManager.namedLocations)
      const message = `場所「${params.name}」は登録されていません。登録済み: ${registered.length > 0 ? registered.join(', ') : 'なし'}`
      console.log(`[NAVIGATION] ${message}`)
      return {
        success: false,
        message: message,
        registeredLocations: registered
      }
    }

    console.log(`[NAVIGATION] 「${params.name}」へ移動開始: (${location.x}, ${location.y}, ${location.z})`)

    await primitives.moveTo(bot, {
      position: location,
      range: 3.0
    })

    console.log(`[NAVIGATION] 「${params.name}」に到達しました`)

    return {
      success: true,
      message: `「${params.name}」に到着しました`,
      location: location
    }
  },

  /**
   * 座標指定で移動
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {x: number, y: number, z: number}
   */
  async gotoCoords(bot, stateManager, params) {
    const { x, y, z } = params
    if (x === undefined || y === undefined || z === undefined) {
      throw new Error('座標（x, y, z）が必要です')
    }

    console.log(`[NAVIGATION] 座標 (${x}, ${y}, ${z}) へ移動開始`)

    await primitives.moveTo(bot, {
      position: { x, y, z },
      range: 3.0
    })

    console.log(`[NAVIGATION] 座標に到達しました`)

    return {
      success: true,
      message: `(${x}, ${y}, ${z})に到着しました`,
      location: { x, y, z }
    }
  },

  /**
   * プレイヤーを追跡
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {username?: string}
   */
  async follow(bot, stateManager, params) {
    const targetUsername = params.username
    if (!targetUsername) {
      throw new Error('追跡するプレイヤー名（username）が必要です')
    }

    const targetPlayer = bot.players[targetUsername]
    if (!targetPlayer || !targetPlayer.entity) {
      throw new Error(`プレイヤー「${targetUsername}」が見つかりません`)
    }

    console.log(`[NAVIGATION] ${targetUsername} を追跡開始`)

    // 既に追跡中なら停止
    if (bot.followTarget) {
      bot.pathfinder.setGoal(null)
    }

    // 追跡情報を保存
    bot.followTarget = targetUsername

    // pathfinderを使って追跡
    const { GoalFollow } = require('mineflayer-pathfinder').goals
    const goal = new GoalFollow(targetPlayer.entity, 3) // 3ブロック距離を保つ

    bot.pathfinder.setGoal(goal, true)

    return {
      success: true,
      message: `${targetUsername} の追跡を開始しました`,
      target: targetUsername
    }
  },

  /**
   * 追跡を停止
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {}
   */
  async stopFollow(bot, stateManager, params) {
    if (!bot.followTarget) {
      return {
        success: true,
        message: '追跡していません'
      }
    }

    const target = bot.followTarget
    bot.followTarget = null
    bot.pathfinder.setGoal(null)

    console.log(`[NAVIGATION] ${target} の追跡を停止しました`)

    return {
      success: true,
      message: `${target} の追跡を停止しました`,
      previousTarget: target
    }
  },

  /**
   * 方向と距離を指定して移動
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {yaw: number, distance: number, verticalMode?: string}
   */
  async moveInDirection(bot, stateManager, params) {
    const { distance, verticalMode = 'nearest' } = params
    let { yaw } = params

    if (distance === undefined) {
      throw new Error('距離（distance）が必要です')
    }

    // yawが指定されていない場合は現在の視線方向を使用
    if (yaw === undefined) {
      yaw = bot.entity.yaw * 180 / Math.PI  // ラジアンから度数に変換
      console.log(`[NAVIGATION] yaw未指定、現在の視線方向を使用: ${yaw.toFixed(2)}°`)
    }

    // 有効な verticalMode かチェック
    const validModes = ['nearest', 'above', 'below', 'surface']
    if (!validModes.includes(verticalMode)) {
      throw new Error(`verticalMode は ${validModes.join(', ')} のいずれかである必要があります`)
    }

    const currentPos = bot.entity.position

    // Yaw（度数）を使って目標XZ座標を計算
    // Mineflayer座標系: 北=0°, 反時計回り（西=90°, 南=180°, 東=270°または-90°）
    const yawRadians = yaw * Math.PI / 180
    const targetX = Math.floor(currentPos.x - Math.sin(yawRadians) * distance)
    const targetZ = Math.floor(currentPos.z - Math.cos(yawRadians) * distance)

    console.log(`[NAVIGATION] Yaw ${yaw.toFixed(2)}° 方向に ${distance} ブロック移動開始`)
    console.log(`[NAVIGATION] 目標XZ: (${targetX}, ${targetZ})`)

    // 目標座標の地表高さを取得
    let targetY
    try {
      targetY = findSurfaceHeight(bot, targetX, targetZ, verticalMode)
      console.log(`[NAVIGATION] 目標Y座標: ${targetY} (verticalMode: ${verticalMode})`)
    } catch (error) {
      console.error(`[NAVIGATION] ${error.message}`)
      throw error
    }

    // 移動実行
    await primitives.moveTo(bot, {
      position: { x: targetX, y: targetY, z: targetZ },
      range: 3.0
    })

    const finalPos = bot.entity.position
    console.log(`[NAVIGATION] 到達: (${Math.floor(finalPos.x)}, ${Math.floor(finalPos.y)}, ${Math.floor(finalPos.z)})`)

    return {
      success: true,
      message: `Yaw ${yaw}° 方向に ${distance} ブロック移動しました`,
      targetPosition: {
        x: targetX,
        y: targetY,
        z: targetZ
      },
      actualPosition: {
        x: Math.floor(finalPos.x),
        y: Math.floor(finalPos.y),
        z: Math.floor(finalPos.z)
      }
    }
  }
}
