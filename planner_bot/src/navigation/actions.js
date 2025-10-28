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
   * @param {Object} params - {coords: [x, y, z]}
   */
  async gotoCoords(bot, stateManager, params) {
    if (!params.coords) {
      throw new Error('座標（coords）が必要です')
    }

    if (!Array.isArray(params.coords) || params.coords.length !== 3) {
      throw new Error('座標は [x, y, z] の形式で指定してください')
    }

    const [x, y, z] = params.coords

    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
      throw new Error('座標は数値である必要があります')
    }

    console.log(`[NAVIGATION] 座標 [${x}, ${y}, ${z}] へ移動開始`)

    await primitives.moveTo(bot, {
      position: { x, y, z },
      range: 3.0
    })

    console.log(`[NAVIGATION] 座標 [${x}, ${y}, ${z}] に到達しました`)

    return {
      success: true,
      message: `[${x}, ${y}, ${z}]に到着しました`,
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
  },

  /**
   * プレイヤーの近くに移動してアイテムをドロップ
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {targetPlayer: string, itemName: string, count?: number, maxDistance?: number}
   */
  async dropItem(bot, stateManager, params) {
    const { targetPlayer, itemName, count = 1, maxDistance = 100 } = params

    if (!targetPlayer) {
      throw new Error('対象プレイヤー名（targetPlayer）が必要です')
    }

    if (!itemName) {
      throw new Error('アイテム名（itemName）が必要です')
    }

    // プレイヤーの存在確認
    const player = bot.players[targetPlayer]
    if (!player || !player.entity) {
      throw new Error(`プレイヤー「${targetPlayer}」が見つかりません`)
    }

    // 距離チェック
    const distance = bot.entity.position.distanceTo(player.entity.position)
    if (distance > maxDistance) {
      throw new Error(
        `プレイヤー「${targetPlayer}」が遠すぎます（距離: ${Math.floor(distance)}ブロック、最大: ${maxDistance}ブロック）`
      )
    }

    console.log(`[NAVIGATION] ${targetPlayer} の近くに移動してアイテムをドロップします（現在距離: ${Math.floor(distance)}ブロック）`)

    // インベントリにアイテムがあるか確認（移動前にチェック）
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) {
      throw new Error(`アイテム「${itemName}」がインベントリにありません`)
    }

    const availableCount = item.count
    const dropCount = Math.min(count, availableCount)

    // GoalFollowで追跡しながら近づく（プレイヤーが移動しても追いかける）
    const { GoalFollow } = require('mineflayer-pathfinder').goals
    const goal = new GoalFollow(player.entity, 2) // 2ブロック以内まで近づく

    bot.pathfinder.setGoal(goal, true)
    console.log(`[NAVIGATION] ${targetPlayer} を追跡開始（移動しても追いかけます）`)

    // 2.5ブロック以内に入るまで待つ（最大30秒）
    await new Promise((resolve, reject) => {
      const startTime = Date.now()
      const timeout = 30000 // 30秒

      const checkInterval = setInterval(() => {
        const currentDistance = bot.entity.position.distanceTo(player.entity.position)

        if (currentDistance <= 2.5) { // 2.5ブロック以内に入ったら成功
          clearInterval(checkInterval)
          console.log(`[NAVIGATION] ${targetPlayer} の近くに到着しました（距離: ${Math.floor(currentDistance * 10) / 10}ブロック）`)
          resolve()
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`タイムアウト: ${targetPlayer} に近づけませんでした（30秒経過）`))
        }
      }, 100) // 100msごとにチェック
    })

    // 追跡停止
    bot.pathfinder.setGoal(null)

    // プレイヤーの方を向く（目の高さ）
    const targetPosition = player.entity.position.offset(0, player.entity.height, 0)
    await bot.lookAt(targetPosition)
    console.log(`[NAVIGATION] ${targetPlayer} の方を向きました`)

    console.log(`[NAVIGATION] ${itemName} を ${dropCount}個ドロップします`)

    // アイテムをドロップ
    await bot.toss(item.type, null, dropCount)

    console.log(`[NAVIGATION] ${targetPlayer} の近くに ${itemName} を ${dropCount}個ドロップしました`)

    return {
      success: true,
      message: `${targetPlayer} の近くに ${itemName} を ${dropCount}個ドロップしました`,
      targetPlayer: targetPlayer,
      itemName: itemName,
      droppedCount: dropCount,
      availableCount: availableCount
    }
  },

  /**
   * 周囲のドロップアイテムを拾う
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {range?: number, itemName?: string}
   */
  async pickupItems(bot, stateManager, params) {
    const { range = 5, itemName = null } = params

    console.log(`[NAVIGATION] 周囲${range}ブロック以内のアイテムを拾います${itemName ? `（対象: ${itemName}）` : ''}`)

    // 周囲のドロップアイテムを検索
    const droppedItems = Object.values(bot.entities)
      .filter(entity => {
        if (entity.name !== 'item') return false
        const distance = bot.entity.position.distanceTo(entity.position)
        if (distance > range) return false

        // itemName指定がある場合はフィルタ
        if (itemName && entity.metadata && entity.metadata[8]) {
          const item = entity.metadata[8]
          if (item && item.itemId) {
            const itemType = bot.registry.items[item.itemId]
            if (itemType && itemType.name !== itemName) return false
          }
        }

        return true
      })

    if (droppedItems.length === 0) {
      console.log(`[NAVIGATION] 拾うアイテムが見つかりませんでした`)
      return {
        success: true,
        message: '拾うアイテムが見つかりませんでした',
        pickedUpCount: 0,
        items: []
      }
    }

    console.log(`[NAVIGATION] ${droppedItems.length}個のアイテムが見つかりました`)

    // 最も近いアイテムの位置に移動（近づけば自動的に拾われる）
    const closestItem = droppedItems.reduce((closest, item) => {
      const distClosest = bot.entity.position.distanceTo(closest.position)
      const distItem = bot.entity.position.distanceTo(item.position)
      return distItem < distClosest ? item : closest
    })

    try {
      // 最も近いアイテムに移動すれば、範囲内の全アイテムが自動的に拾われる
      await primitives.moveTo(bot, {
        position: closestItem.position,
        range: 1.0
      })

      // 少し待機（アイテムが自動的に拾われるのを待つ）
      await new Promise(resolve => setTimeout(resolve, 500))

      console.log(`[NAVIGATION] アイテムを拾いました`)
    } catch (error) {
      console.log(`[NAVIGATION] 移動に失敗しました: ${error.message}`)
    }

    return {
      success: true,
      message: `アイテムを拾いました`,
      foundCount: droppedItems.length
    }
  },

  /**
   * チェストを開いて内容を確認
   * @param {Object} params - { coords: [x, y, z] } - coords省略時は最も近いチェストを開く
   */
  async chestOpen(bot, stateManager, params) {
    const { coords } = params || {}

    let targetPos
    let x, y, z

    // 座標が指定されている場合
    if (coords) {
      // パラメータ検証
      if (!Array.isArray(coords) || coords.length !== 3) {
        return {
          success: false,
          error: '座標（coords）は [x, y, z] の形式で指定してください'
        }
      }

      const [cx, cy, cz] = coords
      if (typeof cx !== 'number' || typeof cy !== 'number' || typeof cz !== 'number') {
        return {
          success: false,
          error: '座標は数値である必要があります'
        }
      }

      x = cx
      y = cy
      z = cz
      targetPos = new Vec3(x, y, z)
      console.log(`[NAVIGATION] チェストを開く: [${x}, ${y}, ${z}]`)
    } else {
      // 座標が指定されていない場合、最も近いチェストを探す
      console.log(`[NAVIGATION] 近くのチェストを探索中...`)

      const chestBlock = bot.findBlock({
        matching: (block) => block.name === 'chest',
        maxDistance: 32
      })

      if (!chestBlock) {
        return {
          success: false,
          error: '周囲32ブロック以内にチェストが見つかりませんでした'
        }
      }

      targetPos = chestBlock.position
      x = targetPos.x
      y = targetPos.y
      z = targetPos.z
      const distance = bot.entity.position.distanceTo(targetPos)
      console.log(`[NAVIGATION] チェストを発見: [${x}, ${y}, ${z}] (距離: ${distance.toFixed(1)} ブロック)`)
    }

    // ブロックが存在するか確認
    const block = bot.blockAt(targetPos)
    if (!block) {
      return {
        success: false,
        error: '座標が範囲外です（チャンクが読み込まれていません）',
        position: { x, y, z }
      }
    }

    // チェストかどうか確認
    if (block.name !== 'chest') {
      return {
        success: false,
        error: `指定座標はチェストではありません（${block.name}）`,
        position: { x, y, z },
        blockName: block.name
      }
    }

    // チェストまで移動
    const distance = bot.entity.position.distanceTo(targetPos)
    if (distance > 4.5) {
      console.log(`[NAVIGATION] チェストまで移動中... (距離: ${Math.floor(distance)} ブロック)`)
      try {
        await primitives.moveTo(bot, { position: targetPos, range: 4.5 })
        console.log(`[NAVIGATION] 移動完了`)
      } catch (error) {
        return {
          success: false,
          error: `移動に失敗しました: ${error.message}`,
          position: { x, y, z }
        }
      }
    }

    // チェストを開く
    let chest
    try {
      chest = await bot.openContainer(block)
      console.log(`[NAVIGATION] チェストを開きました`)
    } catch (error) {
      return {
        success: false,
        error: `チェストを開けませんでした: ${error.message}`,
        position: { x, y, z }
      }
    }

    // チェストのスロットを直接参照
    // chest.slots にはチェスト部分 + プレイヤーインベントリ（36スロット）が含まれる
    // プレイヤーインベントリ = 27スロット（本体） + 9スロット（ホットバー）
    const inventorySlots = 36
    const chestSlotCount = chest.slots.length - inventorySlots

    const chestSlots = chest.slots.slice(0, chestSlotCount)
    const chestItemList = chestSlots
      .filter(item => item !== null && item !== undefined)
      .map(item => ({
        name: item.name,
        count: item.count,
        slot: item.slot
      }))

    // ボットのインベントリ情報も取得
    const botInventory = bot.inventory.items().map(item => ({
      name: item.name,
      count: item.count,
      slot: item.slot
    }))

    // チェストの空きスロット数を計算（通常27、ラージチェストは54）
    const totalSlots = chestSlotCount
    const usedSlots = chestItemList.length
    const emptySlots = totalSlots - usedSlots

    // チェストは開いたまま（LLMが判断するため）
    // bot.currentChestを保存してdeposit/withdrawで使用
    bot.currentChest = chest
    bot.currentChestPosition = { x, y, z }

    console.log(`[NAVIGATION] チェストの内容を確認しました（開いたまま）`)
    console.log(`[NAVIGATION] チェスト: ${chestItemList.length}種類のアイテム, 空きスロット: ${emptySlots}/${totalSlots}`)

    return {
      success: true,
      message: `チェストを開きました`,
      position: { x, y, z },
      chest: {
        itemCount: chestItemList.length,
        items: chestItemList,
        totalSlots: totalSlots,
        usedSlots: usedSlots,
        emptySlots: emptySlots
      },
      inventory: {
        itemCount: botInventory.length,
        items: botInventory
      }
    }
  },

  /**
   * チェストにアイテムを預ける（事前にchestOpenが必要）
   * @param {Object} params - { item: string, count: number }
   */
  async chestDeposit(bot, stateManager, params) {
    const { item, count } = params

    // パラメータ検証
    if (!item) {
      return {
        success: false,
        error: 'アイテム名（item）が必要です'
      }
    }

    // チェストが開いているか確認
    if (!bot.currentChest) {
      return {
        success: false,
        error: '先に chestOpen コマンドでチェストを開いてください'
      }
    }

    const depositCount = count || null // nullは全て預ける

    console.log(`[NAVIGATION] チェストに預ける: ${item} x ${depositCount || '全て'}`)

    // インベントリにアイテムがあるか確認
    const inventoryItem = bot.inventory.items().find(i => i.name === item)
    if (!inventoryItem) {
      return {
        success: false,
        error: `インベントリに ${item} がありません`,
        inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count }))
      }
    }

    // アイテムを預ける
    try {
      await bot.currentChest.deposit(inventoryItem.type, null, depositCount)
      const actualCount = depositCount || inventoryItem.count
      console.log(`[NAVIGATION] ${item} x ${actualCount} を預けました`)

      return {
        success: true,
        message: `${item} x ${actualCount} をチェストに預けました`,
        position: bot.currentChestPosition,
        item: item,
        count: actualCount
      }
    } catch (error) {
      return {
        success: false,
        error: `アイテムを預けられませんでした: ${error.message}`,
        position: bot.currentChestPosition,
        item: item
      }
    }
  },

  /**
   * チェストからアイテムを取り出す（事前にchestOpenが必要）
   * @param {Object} params - { item: string, count: number }
   */
  async chestWithdraw(bot, stateManager, params) {
    const { item, count } = params

    // パラメータ検証
    if (!item) {
      return {
        success: false,
        error: 'アイテム名（item）が必要です'
      }
    }

    // チェストが開いているか確認
    if (!bot.currentChest) {
      return {
        success: false,
        error: '先に chestOpen コマンドでチェストを開いてください'
      }
    }

    const withdrawCount = count || null // nullは全て取り出す

    console.log(`[NAVIGATION] チェストから取り出す: ${item} x ${withdrawCount || '全て'}`)

    // チェスト内にアイテムがあるか確認
    const chestItem = bot.currentChest.items().find(i => i.name === item)
    if (!chestItem) {
      return {
        success: false,
        error: `チェストに ${item} がありません`,
        position: bot.currentChestPosition,
        chestItems: bot.currentChest.items().map(i => ({ name: i.name, count: i.count }))
      }
    }

    // アイテムを取り出す
    try {
      await bot.currentChest.withdraw(chestItem.type, null, withdrawCount)
      const actualCount = withdrawCount || chestItem.count
      console.log(`[NAVIGATION] ${item} x ${actualCount} を取り出しました`)

      return {
        success: true,
        message: `${item} x ${actualCount} をチェストから取り出しました`,
        position: bot.currentChestPosition,
        item: item,
        count: actualCount
      }
    } catch (error) {
      return {
        success: false,
        error: `アイテムを取り出せませんでした: ${error.message}`,
        position: bot.currentChestPosition,
        item: item
      }
    }
  },

  /**
   * チェストを閉じる
   */
  async chestClose(bot, stateManager, params) {
    // チェストが開いているか確認
    if (!bot.currentChest) {
      return {
        success: false,
        error: '開いているチェストがありません'
      }
    }

    const position = bot.currentChestPosition

    // チェストを閉じる
    bot.currentChest.close()
    console.log(`[NAVIGATION] チェストを閉じました`)

    // 状態をクリア
    bot.currentChest = null
    bot.currentChestPosition = null

    return {
      success: true,
      message: `チェストを閉じました`,
      position: position
    }
  }
}
