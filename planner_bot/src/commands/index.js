const handleGoalCommand = require('./goal_command')
const handleSkillCommand = require('./skill_command')
const handlePrimitiveCommand = require('./primitive_command')

/**
 * チャットコマンドをルーティング
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - 発言者のユーザー名
 * @param {string} message - チャットメッセージ
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleChatCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()

  // !primitive コマンド
  if (/^!primitive(\s|$)/.test(trimmed)) {
    await handlePrimitiveCommand(bot, trimmed, stateManager)
    return
  }

  // !skill コマンド
  if (/^!skill(\s|$)/.test(trimmed)) {
    await handleSkillCommand(bot, trimmed, stateManager)
    return
  }

  // !goal コマンド
  if (trimmed.startsWith('!goal ')) {
    const goalName = trimmed.replace('!goal ', '').trim()
    await handleGoalCommand(bot, goalName, stateManager)
    return
  }

  // コマンドに該当しない場合は何もしない
}

module.exports = {
  handleChatCommand
}
