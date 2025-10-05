const handleGoalCommand = require('./goal_command')
const handleSkillCommand = require('./skill_command')
const handlePrimitiveCommand = require('./primitive_command')

async function handleChatCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()

  if (/^!primitive(\s|$)/.test(trimmed)) {
    await handlePrimitiveCommand(bot, trimmed, stateManager)
    return
  }

  if (/^!skill(\s|$)/.test(trimmed)) {
    await handleSkillCommand(bot, trimmed, stateManager)
    return
  }

  if (trimmed.startsWith('!goal ')) {
    const goalName = trimmed.replace('!goal ', '').trim()
    await handleGoalCommand(bot, goalName, stateManager)
    return
  }
}

module.exports = {
  handleChatCommand
}
