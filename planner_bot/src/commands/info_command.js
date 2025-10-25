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

const { Vec3 } = require("vec3");
const vision = require('../vision/capture')

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
  const range = params.range !== undefined ? params.range : 32;
  let filterTypes = params.types !== undefined ? params.types : params.type;
  const maxChecks = params.maxChecks !== undefined ? params.maxChecks : 100000;
  const minYOffset = params.minYOffset !== undefined ? params.minYOffset : -range;
  const maxYOffset = params.maxYOffset !== undefined ? params.maxYOffset : range;
  const yawDegrees = params.yaw !== undefined
    ? params.yaw
    : params.directionYaw !== undefined
      ? params.directionYaw
      : null;
  const coneAngleDegrees = params.coneAngle !== undefined ? params.coneAngle : null;

  if (typeof filterTypes === "string") {
    filterTypes = [filterTypes];
  }

  bot.systemLog(`[INFO] Scanning blocks within ${range} blocks (maxChecks=${maxChecks})...`);
  if (filterTypes) {
    bot.systemLog(`[INFO] Filtering by types: ${filterTypes.join(", ")}`);
  }

  const typeFilterSet = (() => {
    if (!filterTypes || filterTypes.length === 0) return null;

    const set = new Set();
    for (const typeName of filterTypes) {
      const blockDef = bot.registry.blocksByName[typeName];
      if (!blockDef) {
        throw new Error(`指定されたブロックタイプが見つかりません: ${typeName}`);
      }
      set.add(typeName);
    }
    return set;
  })();

  const centerPos = bot.entity.position;
  const centerFloor = new Vec3(
    Math.floor(centerPos.x),
    Math.floor(centerPos.y),
    Math.floor(centerPos.z)
  );

  const gameMinY = typeof bot.game?.minY === "number" ? bot.game.minY : centerFloor.y - range;
  const gameMaxY = typeof bot.game?.height === "number"
    ? gameMinY + bot.game.height - 1
    : centerFloor.y + range;

  const minX = centerFloor.x - range;
  const maxX = centerFloor.x + range;
  const minY = Math.max(centerFloor.y + minYOffset, gameMinY);
  const maxY = Math.min(centerFloor.y + maxYOffset, gameMaxY);
  const minZ = centerFloor.z - range;
  const maxZ = centerFloor.z + range;

  const xOrder = buildAxisOrder(minX, maxX, centerFloor.x);
  const yOrder = buildAxisOrder(minY, maxY, centerFloor.y);
  const zOrder = buildAxisOrder(minZ, maxZ, centerFloor.z);

  const blocks = [];
  const typeCounts = {};
  let checkedCount = 0;
  let eligibleTotal = 0;
  let limitReached = false;
  let farthestCheckedDistance = 0;

  const directionYawRad = yawDegrees !== null
    ? degreesToRadians(yawDegrees)
    : bot.entity?.yaw ?? 0;
  const coneHalfAngleRad = coneAngleDegrees !== null
    ? Math.max(0, degreesToRadians(coneAngleDegrees) / 2)
    : null;
  const forward2D = new Vec3(
    -Math.sin(directionYawRad),
    0,
    -Math.cos(directionYawRad)
  );
  const forwardLen = Math.hypot(forward2D.x, forward2D.z) || 1;
  forward2D.x /= forwardLen;
  forward2D.z /= forwardLen;

  outer: for (const x of xOrder) {
    for (const y of yOrder) {
      for (const z of zOrder) {
        const pos = new Vec3(x, y, z);
        const distance = centerPos.distanceTo(pos);
        if (distance > range) continue;

        const offsetX = pos.x - centerFloor.x;
        const offsetZ = pos.z - centerFloor.z;
        if (coneHalfAngleRad !== null) {
          const horizontalDist = Math.hypot(offsetX, offsetZ);
          if (horizontalDist !== 0) {
            const dirX = offsetX / horizontalDist;
            const dirZ = offsetZ / horizontalDist;
            const dot = clampDot(forward2D.x * dirX + forward2D.z * dirZ);
            const angle = Math.acos(dot);
            if (angle > coneHalfAngleRad) continue;
          }
        }

        eligibleTotal++;
        if (checkedCount >= maxChecks) {
          limitReached = true;
          break outer;
        }

        checkedCount++;
        if (distance > farthestCheckedDistance) {
          farthestCheckedDistance = distance;
        }

        const block = bot.blockAt(pos, false);
        if (!block) continue;
        if (block.name.includes("air")) continue;
        if (typeFilterSet && !typeFilterSet.has(block.name)) continue;

        const distanceInt = Math.floor(distance);
        const relativePos = {
          x: offsetX,
          y: pos.y - centerFloor.y,
          z: offsetZ
        };

        blocks.push({
          name: block.name,
          position: { x: pos.x, y: pos.y, z: pos.z },
          relativePosition: relativePos,
          distance: distanceInt
        });

        typeCounts[block.name] = (typeCounts[block.name] || 0) + 1;
      }
    }
  }

  const estimatedEligible = estimateEligiblePositions(range, minYOffset, maxYOffset, coneAngleDegrees);
  const estimatedCoverage = estimatedEligible > 0 ? Math.min(checkedCount / estimatedEligible, 1) : 1;
  const estimatedCoveragePercent = Number((estimatedCoverage * 100).toFixed(2));
  const statusSuffix = limitReached ? ' (maxChecks reached)' : '';
  const farthestDistance = Math.floor(farthestCheckedDistance);
  bot.systemLog(`[INFO] Found ${blocks.length} blocks (checked ${checkedCount}/${eligibleTotal} positions, estCoverage ${estimatedCoveragePercent}%)${statusSuffix}`);

  blocks.sort((a, b) => a.distance - b.distance);

  // サマリー情報
  const summary = {
    totalBlocks: blocks.length,
    uniqueTypes: Object.keys(typeCounts).length,
    typeCounts: typeCounts,
    checksUsed: checkedCount,
    maxChecks: maxChecks,
    eligiblePositions: eligibleTotal,
    estimatedPositions: estimatedEligible,
    estimatedCoveragePercent: estimatedCoveragePercent,
    farthestDistance: farthestDistance,
    scanRange: range,
    scanCenter: {
      x: centerFloor.x,
      y: centerFloor.y,
      z: centerFloor.z
    }
  }

  return {
    blocks: blocks,
    summary: summary
  }
}

/**
 * すべての基本情報を取得（inventory, position, locations）
 */
async function getAllInfo(bot, stateManager) {
  // 一度だけrefreshを呼ぶ
  await stateManager.refresh(bot)
  const worldState = await stateManager.getState(bot)

  // 取得済みのworldStateを各関数に渡す
  const inventory = await getInventoryInfo(bot, stateManager, worldState)
  const position = await getPositionInfo(bot, stateManager, worldState)
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

function buildAxisOrder(min, max, center) {
  const order = []
  const lowerSteps = center - min
  const upperSteps = max - center

  if (center >= min && center <= max) {
    order.push(center)
  }

  const maxStep = Math.max(lowerSteps, upperSteps)
  for (let step = 1; step <= maxStep; step++) {
    const below = center - step
    const above = center + step

    if (below >= min) {
      order.push(below)
    }
    if (above <= max) {
      order.push(above)
    }
  }

  return order
}

function degreesToRadians(deg) {
  return (deg * Math.PI) / 180
}

function clampDot(value) {
  if (value > 1) return 1
  if (value < -1) return -1
  return value
}

function estimateEligiblePositions(range, minYOffset, maxYOffset, coneAngleDegrees) {
  if (maxYOffset < minYOffset) return 0

  const angle = coneAngleDegrees !== null ? Math.abs(coneAngleDegrees) : 360
  const normalizedAngle = Math.min(angle % 360 || angle, 360)
  const coneFraction = normalizedAngle / 360
  if (coneFraction === 0) return 0

  const minY = Math.ceil(Math.max(-range, minYOffset))
  const maxY = Math.floor(Math.min(range, maxYOffset))
  if (maxY < minY) return 0

  let total = 0
  for (let dy = minY; dy <= maxY; dy++) {
    const layerRadiusSquared = range * range - dy * dy
    if (layerRadiusSquared <= 0) continue
    total += Math.PI * layerRadiusSquared * coneFraction
  }

  return Math.max(0, Math.round(total))
}
