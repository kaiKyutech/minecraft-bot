const skills = require('../skills')

/**
 * !skill コマンドのハンドラ
 * @param {Object} bot - Mineflayerボット
 * @param {string} message - チャットメッセージ全体
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleSkillCommand(bot, message, stateManager) {
  const body = message.replace(/^!skill\s*/, '').trim()

  if (!body) {
    bot.chat('スキル名を指定してください')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()

  const skillFn = skills[nameToken]
  if (typeof skillFn !== 'function') {
    bot.chat(`未知のスキルです: ${nameToken}`)
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

  await skillFn(bot, params, stateManager)
  await stateManager.refresh(bot)
  bot.chat('スキルが完了しました')
}

module.exports = handleSkillCommand
