const primitives = require('../primitives')

/**
 * !primitive コマンドのハンドラ
 * @param {Object} bot - Mineflayerボット
 * @param {string} message - チャットメッセージ全体
 * @param {Object} stateManager - 状態マネージャー
 */
async function handlePrimitiveCommand(bot, message, stateManager) {
  const body = message.replace(/^!primitive\s*/, '').trim()

  if (!body) {
    bot.chat('プリミティブ名を指定してください')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()

  const primitiveName = snakeToCamel(nameToken)
  const primitiveFn = primitives[primitiveName]

  if (typeof primitiveFn !== 'function') {
    bot.chat(`未知のプリミティブです: ${nameToken}`)
    return
  }

  let params = {}
  if (paramString) {
    try {
      params = JSON.parse(paramString)
    } catch (error) {
      bot.chat('パラメータはJSON形式で指定してください')
      return
    }
  }

  await primitiveFn(bot, params)
  await stateManager.refresh(bot)
  bot.chat('完了しました')
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
