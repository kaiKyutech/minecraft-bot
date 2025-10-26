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
 *   !info scanBlocks {"range": 32, "types": ["diamond_ore"]}
 */

const vision = require('../vision/capture')
const { scanBlocks } = require('../utils/block_scanner')

/**
 * インベントリ情報を取得
 * @param {Object} worldState - 既に取得済みの状態（省略時は自動取得）
 */
async function getInventoryInfo(bot, stateManager, worldState = null) {
  if (!worldState) {
    await stateManager.refresh(bot)
    worldState = await stateManager.getState(bot)
  }

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
 * @param {Object} worldState - 既に取得済みの状態（省略時は自動取得）
 */
async function getPositionInfo(bot, stateManager, worldState = null) {
  if (!worldState) {
    await stateManager.refresh(bot)
    worldState = await stateManager.getState(bot)
  }

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
 * 周辺ブロック情報を取得（スキャン）
 */
async function getScanBlocksInfo(bot, stateManager, params) {
  let range = params.range !== undefined ? Number(params.range) : 32;
  if (!Number.isFinite(range) || range <= 0) range = 32;

  let filterTypes = params.types !== undefined ? params.types : params.type;
  if (typeof filterTypes === "string") {
    filterTypes = [filterTypes];
  }
  if (Array.isArray(filterTypes) && filterTypes.length === 0) {
    filterTypes = null;
  }

  const rawMaxChecks = params.maxChecks !== undefined ? Number(params.maxChecks) : 25000;
  const limitEnabled = rawMaxChecks > 0 && Number.isFinite(rawMaxChecks);
  const maxChecksLabel = limitEnabled ? rawMaxChecks : 'unlimited';

  bot.systemLog(`[INFO] Scanning blocks within ${range} blocks (maxChecks=${maxChecksLabel})...`);
  if (filterTypes) {
    bot.systemLog(`[INFO] Filtering by types: ${filterTypes.join(", ")}`);
  }

  const result = scanBlocks(bot, {
    ...params,
    range,
    types: filterTypes
  });

  const summary = result.summary;
  const statusSuffix = summary.limitReached ? ' (maxChecks reached)' : '';
  bot.systemLog(`[INFO] Found ${summary.totalBlocks} blocks (checked ${summary.checksUsed}/${summary.eligiblePositions} positions, estCoverage ${summary.estimatedCoveragePercent}%)${statusSuffix}`);

  return {
    blocks: result.blocks,
    summary
  }
}

/**
 * 近くのプレイヤー情報を取得
 * @param {Object} worldState - 既に取得済みの状態（省略時は自動取得）
 */
async function getNearbyPlayersInfo(bot, stateManager, worldState = null) {
  if (!worldState) {
    await stateManager.refresh(bot)
    worldState = await stateManager.getState(bot)
  }

  const players = []
  const botPosition = bot.entity.position

  // bot.players から全プレイヤー情報を取得
  for (const [username, player] of Object.entries(bot.players)) {
    // 自分自身は除外
    if (username === bot.username) continue

    // エンティティ情報が取得できない場合はスキップ
    if (!player.entity) continue

    const playerPosition = player.entity.position
    const distance = Math.floor(botPosition.distanceTo(playerPosition))

    players.push({
      username: username,
      position: {
        x: Math.floor(playerPosition.x),
        y: Math.floor(playerPosition.y),
        z: Math.floor(playerPosition.z)
      },
      distance: distance,
      health: player.entity.health || null
    })
  }

  // 距離順にソート
  players.sort((a, b) => a.distance - b.distance)

  // サマリー情報
  const summary = {
    totalPlayers: players.length,
    nearestPlayer: players.length > 0 ? players[0].username : null,
    nearestDistance: players.length > 0 ? players[0].distance : null
  }

  return {
    players: players,
    summary: summary
  }
}

/**
 * すべての基本情報を取得（inventory, position, locations, nearbyPlayers）
 */
async function getAllInfo(bot, stateManager) {
  // 一度だけrefreshを呼ぶ
  await stateManager.refresh(bot)
  const worldState = await stateManager.getState(bot)

  // 取得済みのworldStateを各関数に渡す
  const inventory = await getInventoryInfo(bot, stateManager, worldState)
  const position = await getPositionInfo(bot, stateManager, worldState)
  const locations = await getLocationsInfo(bot, stateManager)
  const nearbyPlayers = await getNearbyPlayersInfo(bot, stateManager, worldState)

  return {
    inventory: inventory,
    position: position,
    locations: locations,
    nearbyPlayers: nearbyPlayers
  }
}

/**
 * !info コマンドのメインハンドラ
 */
async function handleInfoCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()
  const parts = trimmed.split(' ')

  if (parts.length < 2) {
    throw new Error('使用方法: !info <type>\n利用可能: all, vision, scanBlocks')
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
  else if (infoType === 'scanBlocks') {
    data = await getScanBlocksInfo(bot, stateManager, params)
    bot.systemLog('[INFO] ScanBlocks data:')
    // ブロックリストは長いので要約のみ出力
    bot.systemLog(JSON.stringify({ summary: data.summary }, null, 2))
    if (data.blocks.length <= 10) {
      bot.systemLog(JSON.stringify({ blocks: data.blocks }, null, 2))
    } else {
      bot.systemLog(`[INFO] ${data.blocks.length} blocks found (showing first 10):`)
      bot.systemLog(JSON.stringify({ blocks: data.blocks.slice(0, 10) }, null, 2))
    }
  }
  else {
    throw new Error(
      `未知の情報タイプ: ${infoType}\n` +
      `利用可能: all, vision, scanBlocks`
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
