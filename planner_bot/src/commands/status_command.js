/**
 * !status コマンドのハンドラ
 * 現在の状況をウィスパーで出力
 */
async function handleStatusCommand(bot, username, stateManager) {
  await stateManager.refresh(bot)
  const worldState = await stateManager.getState(bot)
  const { buildState } = require('../planner/state_builder')
  const goapState = buildState(worldState)

  const messages = []

  messages.push('=== 現在の状況 ===')

  // 1. 位置情報
  if (worldState.position) {
    const pos = worldState.position
    messages.push(`位置: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`)
    messages.push(`Y座標: ${Math.floor(pos.y)} (地表:~64, ダイヤ:-64~16)`)
  }

  // 2. 時間
  messages.push(`時間: ${worldState.isDay ? '昼' : '夜'}`)

  // 3. インベントリ
  const inventory = worldState.inventory?.counts || {}
  const inventoryItems = Object.keys(inventory)

  if (inventoryItems.length === 0) {
    messages.push('インベントリ: 空')
  } else {
    // ツール類を優先表示
    const tools = inventoryItems.filter(name =>
      name.includes('pickaxe') || name.includes('axe') ||
      name.includes('sword') || name.includes('shovel') || name.includes('hoe')
    )
    const materials = inventoryItems.filter(name => !tools.includes(name))

    if (tools.length > 0) {
      const toolList = tools.map(t => `${t}x${inventory[t]}`).join(', ')
      messages.push(`道具: ${toolList}`)
    }

    if (materials.length > 0) {
      const materialList = materials.map(m => `${m}x${inventory[m]}`).join(', ')
      messages.push(`素材: ${materialList}`)
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
    messages.push(`近くのリソース: ${nearbyResources.join(', ')}`)
  }
  if (nearbyStructures.length > 0) {
    messages.push(`構造物: ${nearbyStructures.join(', ')}`)
  }
  if (nearbyResources.length === 0 && nearbyStructures.length === 0) {
    messages.push('近くのリソース: 検出なし')
  }

  // 5. 登録済みの場所
  const locations = stateManager.getLocations()
  const locationNames = Object.keys(locations)

  if (locationNames.length > 0) {
    const locList = locationNames.map(name => {
      const loc = locations[name]
      return `${name}(${loc.x},${loc.y},${loc.z})`
    }).join(', ')
    messages.push(`登録済みの場所: ${locList}`)
  } else {
    messages.push('登録済みの場所: なし')
  }

  // 6. 利用可能なシステム
  messages.push('---')
  messages.push('システム: !goal (GOAP), !creative nav')
  messages.push('GOAP: 素材が近くにあるときに自動実行')
  messages.push('Creative: ナビゲーション（場所の登録・移動）')

  // 1つのメッセージにまとめてコンソールと会話履歴に追加
  const fullMessage = messages.join('\n')
  bot.systemLog(fullMessage)
  bot.addMessage(username, bot.username, fullMessage, 'system_info')

  bot.systemLog(`Status sent to ${username}`)
}

module.exports = handleStatusCommand
