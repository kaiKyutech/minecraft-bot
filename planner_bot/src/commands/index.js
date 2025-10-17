const handleGoalCommand = require('./goal_command')
const handleSkillCommand = require('./skill_command')
const handlePrimitiveCommand = require('./primitive_command')
const handleCreativeCommand = require('./creative_command')
const handleStatusCommand = require('./status_command')

async function handleChatCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()

  if (trimmed === '!status') {
    await handleStatusCommand(bot, username, stateManager)
    return
  }

  if (/^!primitive(\s|$)/.test(trimmed)) {
    await handlePrimitiveCommand(bot, username, trimmed, stateManager)
    return
  }

  if (/^!skill(\s|$)/.test(trimmed)) {
    await handleSkillCommand(bot, username, trimmed, stateManager)
    return
  }

  if (trimmed.startsWith('!goal ')) {
    const goalName = trimmed.replace('!goal ', '').trim()
    await handleGoalCommand(bot, username, goalName, stateManager)
    return
  }

  if (trimmed.startsWith('!creative ')) {
    const commandStr = trimmed.replace('!creative ', '').trim()
    await handleCreativeCommand(bot, username, commandStr, stateManager)
    return
  }
}

module.exports = {
  handleChatCommand
}
