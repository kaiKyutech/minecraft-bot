const navigation = require('../creative_actions/navigation')
const vision = require('../creative_actions/vision')
const fs = require('fs')
const path = require('path')

/**
 * !creative コマンドのハンドラ
 * GOAPで扱えない創造的な行動を実行する
 *
 * 使用例:
 *   !creative navigation register {"name": "home"}
 *   !creative navigation goto {"name": "home"}
 *   !creative navigation gotoCoords {"x": 250, "y": 64, "z": -100}
 *   !creative navigation list
 *   !creative vision capture
 *
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} commandStr - コマンド文字列（例: "nav register {...}"）
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleCreativeCommand(bot, username, commandStr, stateManager) {
  const parts = commandStr.trim().split(' ')

  if (parts.length < 2) {
    throw new Error('使用方法: !creative <category> <action> [params]')
  }

  const category = parts[0]  // navigation, vision, exploration, etc.
  const action = parts[1]    // register, goto, capture, etc.

  let params = {}
  if (parts.length > 2) {
    const jsonStr = parts.slice(2).join(' ')
    try {
      params = JSON.parse(jsonStr)
    } catch (error) {
      throw new Error(`パラメータのJSON解析に失敗: ${error.message}`)
    }
  }

  bot.systemLog(`Creative action: ${category}.${action}(${JSON.stringify(params)})`)

  let result

  // カテゴリの判定
  if (category === 'navigation') {
    if (!navigation[action]) {
      const available = Object.keys(navigation).join(', ')
      throw new Error(
        `未知のナビゲーション操作: ${action}\n` +
        `利用可能: ${available}`
      )
    }
    result = await navigation[action](bot, stateManager, params)
  }
  else if (category === 'vision') {
    if (!vision[action]) {
      const available = Object.keys(vision).join(', ')
      throw new Error(
        `未知のvision操作: ${action}\n` +
        `利用可能: ${available}`
      )
    }
    result = await vision[action](bot, stateManager, params)
  }
  else {
    throw new Error(
      `未知のカテゴリ: ${category}\n` +
      `利用可能: navigation, vision`
    )
  }

  // 成功メッセージを送信（LLMプロジェクトで使用する場合は bot.speak() も呼ぶ）
  if (result.success) {
    bot.systemLog(result.message)
    // await bot.speak(username, result.message)  // LLMプロジェクトで使用時にアンコメント
    // bot.addMessage(bot.username, result.message, 'bot_response')  // LLMプロジェクトで使用時にアンコメント
  }

  // Vision capture の場合、画像をPNG保存（ボット名ごと）
  if (category === 'vision' && action === 'capture' && result.data && result.data.image) {
    const filename = `screenshot_${bot.username}.png`
    const outputPath = path.join(__dirname, '..', '..', filename)
    const imageBuffer = Buffer.from(result.data.image, 'base64')
    fs.writeFileSync(outputPath, imageBuffer)
    bot.systemLog(`Screenshot saved to ${outputPath}`)
  }

  return result
}

module.exports = handleCreativeCommand
