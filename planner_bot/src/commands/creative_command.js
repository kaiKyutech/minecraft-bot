const navigation = require('../creative_actions/navigation')

/**
 * !creative コマンドのハンドラ
 * GOAPで扱えない創造的な行動を実行する
 *
 * 使用例:
 *   !creative nav register {"name": "home"}
 *   !creative nav goto {"name": "home"}
 *   !creative nav gotoCoords {"x": 250, "y": 64, "z": -100}
 *   !creative nav list
 *
 * @param {Object} bot - Mineflayerボット
 * @param {string} commandStr - コマンド文字列（例: "nav register {...}"）
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleCreativeCommand(bot, commandStr, stateManager) {
  const parts = commandStr.trim().split(' ')

  if (parts.length < 2) {
    throw new Error('使用方法: !creative <category> <action> [params]')
  }

  const category = parts[0]  // navigation, exploration, etc.
  const action = parts[1]    // register, goto, explore, etc.

  let params = {}
  if (parts.length > 2) {
    const jsonStr = parts.slice(2).join(' ')
    try {
      params = JSON.parse(jsonStr)
    } catch (error) {
      throw new Error(`パラメータのJSON解析に失敗: ${error.message}`)
    }
  }

  console.log(`[CREATIVE] ${category}.${action}(${JSON.stringify(params)})`)

  let result

  // カテゴリの判定（navigation / nav）
  if (category === 'navigation' || category === 'nav') {
    if (!navigation[action]) {
      const available = Object.keys(navigation).join(', ')
      throw new Error(
        `未知のナビゲーション操作: ${action}\n` +
        `利用可能: ${available}`
      )
    }
    result = await navigation[action](bot, stateManager, params)
  } else {
    throw new Error(
      `未知のカテゴリ: ${category}\n` +
      `利用可能: nav (navigation)`
    )
  }

  // 成功メッセージをチャットに送信
  if (result.success) {
    await bot.chatWithDelay(result.message)
  }

  return result
}

module.exports = handleCreativeCommand
