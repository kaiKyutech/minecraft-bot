const navigation = require('../navigation/actions')

/**
 * !navigation コマンドのハンドラ
 * 場所の登録と移動を管理する
 *
 * 使用例:
 *   !navigation register {"name": "home"}
 *   !navigation goto {"name": "home"}
 *   !navigation gotoCoords {"x": 250, "y": 64, "z": -100}
 *   !navigation moveInDirection {"distance": 10}
 *   !navigation follow {"username": "PlayerName"}
 *   !navigation stopFollow {}
 *
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} message - コマンド文字列全体
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleNavigationCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()
  const parts = trimmed.split(' ')

  if (parts.length < 2) {
    throw new Error('使用方法: !navigation <action> [params]\n利用可能: register, goto, gotoCoords, moveInDirection, follow, stopFollow')
  }

  const action = parts[1]
  let params = {}

  if (parts.length > 2) {
    const jsonStr = parts.slice(2).join(' ')
    try {
      params = JSON.parse(jsonStr)
    } catch (error) {
      throw new Error(`パラメータのJSON解析に失敗: ${error.message}`)
    }
  }

  bot.systemLog(`Navigation action: ${action}(${JSON.stringify(params)})`)

  if (!navigation[action]) {
    const available = Object.keys(navigation).join(', ')
    throw new Error(
      `未知のナビゲーション操作: ${action}\n` +
      `利用可能: ${available}`
    )
  }

  const result = await navigation[action](bot, stateManager, params)

  // 結果メッセージを送信（成功・失敗どちらも情報として扱う）
  if (result.message) {
    bot.systemLog(result.message)
    // await bot.speak(username, result.message)  // LLMプロジェクトで使用時にアンコメント
    // bot.addMessage(bot.username, result.message, 'conversation')  // LLMプロジェクトで使用時にアンコメント
  }

  return result
}

module.exports = handleNavigationCommand
