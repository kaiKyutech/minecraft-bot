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
    await bot.chatWithDelay(username, 'スキル名を指定してください')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()

  const skillFn = skills[nameToken]
  if (typeof skillFn !== 'function') {
    await bot.chatWithDelay(username, `未知のスキルです: ${nameToken}`)
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

  await skillFn(bot, params, stateManager)
  await stateManager.refresh(bot)
  await bot.chatWithDelay(username, 'スキルが完了しました')
}

module.exports = handleSkillCommand
