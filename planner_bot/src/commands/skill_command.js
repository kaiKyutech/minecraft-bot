const skills = require('../skills')

/**
 * !skill コマンドのハンドラ
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} message - チャットメッセージ全体
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleSkillCommand(bot, username, message, stateManager) {
  const body = message.replace(/^!skill\s*/, '').trim()

  if (!body) {
    const errorMsg = 'スキル名を指定してください'
    bot.systemLog(errorMsg)
    bot.addMessage(username, bot.username, errorMsg, 'system_info')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()

  const skillFn = skills[nameToken]
  if (typeof skillFn !== 'function') {
    const errorMsg = `未知のスキルです: ${nameToken}`
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

  bot.systemLog(`Executing skill: ${nameToken} with params: ${JSON.stringify(params)}`)
  await skillFn(bot, params, stateManager)
  await stateManager.refresh(bot)

  const completeMsg = 'スキルが完了しました'
  bot.systemLog(completeMsg)
  // await bot.speak(username, completeMsg)  // LLMプロジェクトで使用時にアンコメント
  // bot.addMessage(username, bot.username, completeMsg, 'bot_response')  // LLMプロジェクトで使用時にアンコメント
}

module.exports = handleSkillCommand
