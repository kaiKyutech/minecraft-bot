/**
 * !info コマンドのハンドラ
 * 外部プロジェクト（LLM）から情報を取得するためのAPI
 *
 * 特徴:
 * - JSON形式でデータを返す
 * - bot.systemLog()でコンソール出力のみ
 * - 会話履歴には入れない
 *
 * 使用例:
 *   !info all
 *   !info vision {"yaw": 90, "pitch": 0}
 */

const vision = require('../creative_actions/vision')

/**
 * インベントリ情報を取得
 */
async function getInventoryInfo(bot, stateManager) {
  await stateManager.refresh(bot)
  const worldState = await stateManager.getState(bot)

  const inventory = worldState.inventory?.counts || {}
  const items = []

  // アイテムごとの詳細情報を収集
  for (const [itemName, count] of Object.entries(inventory)) {
    // カテゴリ判定
    let category = 'other'
    if (itemName.includes('pickaxe') || itemName.includes('axe') ||
        itemName.includes('sword') || itemName.includes('shovel') ||
        itemName.includes('hoe')) {
      category = 'tool'
    } else if (itemName.includes('log') || itemName.includes('plank') ||
               itemName.includes('stick') || itemName.includes('ore') ||
               itemName.includes('ingot') || itemName.includes('cobblestone') ||
               itemName.includes('stone') || itemName.includes('dirt')) {
      category = 'material'
    }

    items.push({
      name: itemName,
      count: count,
      category: category
    })
  }

  // カテゴリ別にソート（tool > material > other、各カテゴリ内は名前順）
  items.sort((a, b) => {
    const categoryOrder = { tool: 0, material: 1, other: 2 }
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category]
    if (catDiff !== 0) return catDiff
    return a.name.localeCompare(b.name)
  })

  // サマリー情報
  const summary = {
    totalItems: items.length,
    totalCount: items.reduce((sum, item) => sum + item.count, 0),
    tools: items.filter(i => i.category === 'tool').length,
    materials: items.filter(i => i.category === 'material').length,
    isEmpty: items.length === 0
  }

  return {
    items: items,
    summary: summary
  }
}

/**
 * 位置情報を取得
 */
async function getPositionInfo(bot, stateManager) {
  await stateManager.refresh(bot)
  const worldState = await stateManager.getState(bot)

  const position = {
    x: Math.floor(bot.entity.position.x),
    y: Math.floor(bot.entity.position.y),
    z: Math.floor(bot.entity.position.z)
  }

  const rotation = {
    yaw: bot.entity.yaw * 180 / Math.PI,  // ラジアンから度数に変換
    pitch: bot.entity.pitch * 180 / Math.PI
  }

  const time = {
    isDay: worldState.isDay,
    timeOfDay: bot.time.timeOfDay
  }

  return {
    position: position,
    rotation: rotation,
    time: time,
    health: bot.health,
    food: bot.food
  }
}

/**
 * 登録済み場所一覧を取得
 */
async function getLocationsInfo(bot, stateManager) {
  const locations = stateManager.getLocations()
  const locationList = []

  for (const [name, coords] of Object.entries(locations)) {
    const currentPos = bot.entity.position
    const distance = Math.floor(Math.sqrt(
      Math.pow(coords.x - currentPos.x, 2) +
      Math.pow(coords.y - currentPos.y, 2) +
      Math.pow(coords.z - currentPos.z, 2)
    ))

    locationList.push({
      name: name,
      position: {
        x: coords.x,
        y: coords.y,
        z: coords.z
      },
      distance: distance
    })
  }

  // 距離順にソート
  locationList.sort((a, b) => a.distance - b.distance)

  return {
    locations: locationList,
    count: locationList.length
  }
}

/**
 * ビジョン情報を取得（スクリーンショット）
 */
async function getVisionInfo(bot, stateManager, params) {
  // vision.capture を呼び出してスクリーンショットを取得
  const result = await vision.capture(bot, stateManager, params)

  // result.data には { image: base64String, metadata: {...} } が入っている
  return result.data
}

/**
 * すべての基本情報を取得（inventory, position, locations）
 */
async function getAllInfo(bot, stateManager) {
  const inventory = await getInventoryInfo(bot, stateManager)
  const position = await getPositionInfo(bot, stateManager)
  const locations = await getLocationsInfo(bot, stateManager)

  return {
    inventory: inventory,
    position: position,
    locations: locations
  }
}

/**
 * !info コマンドのメインハンドラ
 */
async function handleInfoCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()
  const parts = trimmed.split(' ')

  if (parts.length < 2) {
    throw new Error('使用方法: !info <type>\n利用可能: all, vision')
  }

  const infoType = parts[1]
  let params = {}

  if (parts.length > 2) {
    const jsonStr = parts.slice(2).join(' ')
    try {
      params = JSON.parse(jsonStr)
    } catch (error) {
      throw new Error(`パラメータのJSON解析に失敗: ${error.message}`)
    }
  }

  bot.systemLog(`[INFO] Retrieving ${infoType} information...`)

  let data

  if (infoType === 'all') {
    data = await getAllInfo(bot, stateManager)
    bot.systemLog('[INFO] All basic information:')
    bot.systemLog(JSON.stringify(data, null, 2))
  }
  else if (infoType === 'vision') {
    data = await getVisionInfo(bot, stateManager, params)
    bot.systemLog('[INFO] Vision data:')
    // 画像データは長いのでメタデータのみログ出力
    const { image, ...metadata } = data
    bot.systemLog(JSON.stringify({ ...metadata, imageSize: image ? image.length : 0 }, null, 2))
  }
  else {
    throw new Error(
      `未知の情報タイプ: ${infoType}\n` +
      `利用可能: all, vision`
    )
  }

  // 戻り値として返す（外部プロジェクトから関数として呼び出す場合）
  return {
    success: true,
    type: infoType,
    data: data
  }
}

module.exports = handleInfoCommand
