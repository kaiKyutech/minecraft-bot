const primitives = require('../primitives')

/**
 * Navigation Actions - 場所の登録と移動
 * GOAPではなくLLMが直接制御する創造的行動
 */
module.exports = {
  /**
   * 現在地を名前付きで登録
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {name: string, blockType?: string}
   */
  async register(bot, stateManager, params) {
    if (!params.name) {
      throw new Error('場所名（name）が必要です')
    }

    let position = bot.entity.position

    // blockType指定があれば、そのブロックの位置を登録
    if (params.blockType) {
      const block = bot.findBlock({
        matching: (b) => b && b.name === params.blockType,
        maxDistance: 100
      })
      if (!block) {
        throw new Error(`${params.blockType} が見つかりません`)
      }
      position = block.position
      console.log(`[NAVIGATION] ${params.blockType} の位置を「${params.name}」として登録`)
    } else {
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
      throw new Error(
        `場所「${params.name}」は登録されていません。` +
        `登録済み: ${registered.length > 0 ? registered.join(', ') : 'なし'}`
      )
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
   * 登録済み場所の一覧
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {}
   */
  async list(bot, stateManager, params) {
    const locations = stateManager.getLocations()
    const names = Object.keys(locations)

    if (names.length === 0) {
      console.log('[NAVIGATION] 登録された場所はありません')
      return {
        success: true,
        message: '登録された場所はありません',
        locations: {}
      }
    }

    console.log('[NAVIGATION] 登録済みの場所:')
    for (const name of names) {
      const loc = locations[name]
      console.log(`  - ${name}: (${loc.x}, ${loc.y}, ${loc.z})`)
    }

    return {
      success: true,
      message: `${names.length}個の場所が登録されています`,
      locations: locations
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
  }
}
