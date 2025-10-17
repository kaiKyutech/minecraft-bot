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
    await bot.chatWithDelay(username, 'プリミティブ名を指定してください')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()

  const primitiveName = snakeToCamel(nameToken)
  const primitiveFn = primitives[primitiveName]

  if (typeof primitiveFn !== 'function') {
    await bot.chatWithDelay(username, `未知のプリミティブです: ${nameToken}`)
    return
  }

  let params = {}
  if (paramString) {
    try {
      params = JSON.parse(paramString)
    } catch (error) {
      await bot.chatWithDelay(username, 'パラメータはJSON形式で指定してください')
      return
    }
  }

  await primitiveFn(bot, params)
  await stateManager.refresh(bot)
  await bot.chatWithDelay(username, '完了しました')
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
