const skills = require('../skills')

/**
 * !skill コマンドのハンドラ
 * @param {Object} bot - Mineflayerボット
 * @param {string} message - チャットメッセージ全体
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleSkillCommand(bot, message, stateManager) {
  console.log(`[SKILL DEBUG] Raw command: "${message}"`)

  // !skill の後の部分を取得
  const body = message.replace(/^!skill\s*/, '').trim()

  console.log(`[SKILL DEBUG] Body after processing: "${body}"`)

  if (!body) {
    console.log('[SKILL DEBUG] Body is empty, sending error message')
    bot.chat('スキル名を指定してください')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()
  console.log(`[SKILL DEBUG] nameToken: "${nameToken}", paramString: "${paramString}"`)

  const skillFn = skills[nameToken]
  if (typeof skillFn !== 'function') {
    console.log(`[SKILL DEBUG] Skill not found: ${nameToken}`)
    bot.chat(`未知のスキルです: ${nameToken}`)
    return
  }

  let params = {}
  if (paramString) {
    try {
      params = JSON.parse(paramString)
    } catch (error) {
      bot.chat('スキルのパラメータは JSON 形式で指定してください')
      console.log(`[SKILL DEBUG] param parse error: ${error.message}`)
      return
    }
  }

  bot.chat(`スキル実行: ${nameToken}`)
  await skillFn(bot, params, stateManager)
  await stateManager.refresh(bot)
  bot.chat('スキルが完了しました')
}

module.exports = handleSkillCommand
