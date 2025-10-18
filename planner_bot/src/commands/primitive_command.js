const primitives = require('../primitives')

/**
 * !primitive コマンドのハンドラ
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} message - チャットメッセージ全体
 * @param {Object} stateManager - 状態マネージャー
 */
async function handlePrimitiveCommand(bot, username, message, stateManager) {
  const body = message.replace(/^!primitive\s*/, '').trim()

  if (!body) {
    const errorMsg = 'プリミティブ名を指定してください'
    bot.systemLog(errorMsg)
    bot.addMessage(username, bot.username, errorMsg, 'system_info')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()

  const primitiveName = snakeToCamel(nameToken)
  const primitiveFn = primitives[primitiveName]

  if (typeof primitiveFn !== 'function') {
    const errorMsg = `未知のプリミティブです: ${nameToken}`
    bot.systemLog(errorMsg)
    bot.addMessage(username, bot.username, errorMsg, 'system_info')
    return
  }

  let params = {}
  if (paramString) {
    try {
      params = JSON.parse(paramString)
    } catch (error) {
      const errorMsg = 'パラメータはJSON形式で指定してください'
      bot.systemLog(errorMsg)
      bot.addMessage(username, bot.username, errorMsg, 'system_info')
      return
    }
  }

  bot.systemLog(`Executing primitive: ${primitiveName} with params: ${JSON.stringify(params)}`)
  await primitiveFn(bot, params)
  await stateManager.refresh(bot)

  const completeMsg = '完了しました'
  bot.systemLog(completeMsg)
  // await bot.speak(username, completeMsg)  // LLMプロジェクトで使用時にアンコメント
  // bot.addMessage(username, bot.username, completeMsg, 'bot_response')  // LLMプロジェクトで使用時にアンコメント
}

/**
 * snake_case を camelCase に変換
 * @param {string} value - 変換する文字列
 * @returns {string} camelCase形式の文字列
 */
function snakeToCamel(value) {
  return value.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

module.exports = handlePrimitiveCommand
