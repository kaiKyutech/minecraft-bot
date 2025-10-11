/**
 * !status コマンドのハンドラ
 * 現在の状況をLLMが理解しやすい形式でチャット欄に出力
 */
async function handleStatusCommand(bot, stateManager) {
  const worldState = await stateManager.getState(bot)
  const { buildState } = require('../planner/state_builder')
  const goapState = buildState(worldState)

  const messages = []

  messages.push('=== STATUS ===')

  // 1. 位置情報
  if (worldState.position) {
    const pos = worldState.position
    messages.push(`Pos: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`)
    messages.push(`Y-Level: ${Math.floor(pos.y)} (Surface:~64, Diamond:-64~16)`)
  }

  // 2. 時間
  messages.push(`Time: ${worldState.isDay ? 'Day' : 'Night'}`)

  // 3. インベントリ
  const inventory = worldState.inventory?.counts || {}
  const inventoryItems = Object.keys(inventory)

  if (inventoryItems.length === 0) {
    messages.push('Inventory: Empty')
  } else {
    // ツール類を優先表示
    const tools = inventoryItems.filter(name =>
      name.includes('pickaxe') || name.includes('axe') ||
      name.includes('sword') || name.includes('shovel') || name.includes('hoe')
    )
    const materials = inventoryItems.filter(name => !tools.includes(name))

    if (tools.length > 0) {
      const toolList = tools.map(t => `${t}x${inventory[t]}`).join(', ')
      messages.push(`Tools: ${toolList}`)
    }

    if (materials.length > 0) {
      const materialList = materials.map(m => `${m}x${inventory[m]}`).join(', ')
      messages.push(`Materials: ${materialList}`)
    }
  }

  // 4. 周辺環境（近くにあるリソース）
  const nearbyResources = []
  const nearbyStructures = []

  for (const [key, value] of Object.entries(goapState)) {
    if (key.startsWith('nearby_') && value === true) {
      const resourceName = key.replace('nearby_', '')
      if (resourceName.includes('workbench') || resourceName.includes('furnace')) {
        nearbyStructures.push(resourceName)
      } else {
        nearbyResources.push(resourceName)
      }
    } else if (key.startsWith('visible_') && value === true) {
      const resourceName = key.replace('visible_', '')
      if (!nearbyStructures.includes(resourceName)) {
        nearbyStructures.push(resourceName + '(visible)')
      }
    }
  }

  if (nearbyResources.length > 0) {
    messages.push(`Nearby: ${nearbyResources.join(', ')}`)
  }
  if (nearbyStructures.length > 0) {
    messages.push(`Structures: ${nearbyStructures.join(', ')}`)
  }
  if (nearbyResources.length === 0 && nearbyStructures.length === 0) {
    messages.push('Nearby: None detected')
  }

  // 5. 登録済みの場所
  const locations = stateManager.getLocations()
  const locationNames = Object.keys(locations)

  if (locationNames.length > 0) {
    const locList = locationNames.map(name => {
      const loc = locations[name]
      return `${name}(${loc.x},${loc.y},${loc.z})`
    }).join(', ')
    messages.push(`Locations: ${locList}`)
  } else {
    messages.push('Locations: None registered')
  }

  // 6. 利用可能なシステム
  messages.push('---')
  messages.push('Systems: !goal (GOAP), !creative (nav/explore/build), !skill')
  messages.push('GOAP: auto-execute when materials nearby')
  messages.push('Creative: navigation, exploration, building')

  // チャットに送信（複数行を分割して送信）
  for (const msg of messages) {
    bot.chat(msg)
    await delay(100) // チャット送信の間隔を空ける
  }

  // コンソールには簡潔なログ
  console.log('[STATUS] Status sent to chat')
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = handleStatusCommand
