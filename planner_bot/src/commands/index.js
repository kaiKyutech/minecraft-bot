const handleGoalCommand = require('./goal_command')
const handleSkillCommand = require('./skill_command')
const handlePrimitiveCommand = require('./primitive_command')
const handleCreativeCommand = require('./creative_command')
const handleStatusCommand = require('./status_command')
const handleInfoCommand = require('./info_command')
const handleNavigationCommand = require('./navigation_command')

async function handleChatCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()

  if (trimmed === '!status') {
    await handleStatusCommand(bot, username, stateManager)
    return
  }

  if (/^!info(\s|$)/.test(trimmed)) {
    await handleInfoCommand(bot, username, trimmed, stateManager)
    return
  }

  if (/^!navigation(\s|$)/.test(trimmed)) {
    await handleNavigationCommand(bot, username, trimmed, stateManager)
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

  // 実験用: 会話履歴の確認
  if (trimmed === '!history') {
    const history = bot.getConversationHistory()
    console.log(`[${bot.username}] [HISTORY_DUMP] count=${history.length}`)
    console.log(JSON.stringify(history, null, 2))
    return
  }

  // 実験用: 会話履歴の確認（特定ユーザーのみ）
  if (trimmed.startsWith('!history ')) {
    const usernamesStr = trimmed.replace('!history ', '').trim()
    const usernames = usernamesStr.split(',').map(u => u.trim())

    let history
    if (usernames.length === 1) {
      // 単一ユーザー指定
      history = bot.getConversationHistory({ username: usernames[0] })
      console.log(`[${bot.username}] [HISTORY_DUMP] username=${usernames[0]}, count=${history.length}`)
    } else {
      // 複数ユーザー指定
      history = bot.getConversationHistory({ usernames: usernames })
      console.log(`[${bot.username}] [HISTORY_DUMP] usernames=${usernames.join(',')}, count=${history.length}`)
    }

    console.log(JSON.stringify(history, null, 2))
    return
  }

  // 実験用: オウム返し（LLM発話のシミュレーション）
  if (trimmed.startsWith('!echo ')) {
    const echoMessage = trimmed.replace('!echo ', '').trim()
    bot.systemLog(`Echo: ${echoMessage}`)
    await bot.speak(username, echoMessage)
    bot.addMessage(bot.username, echoMessage, 'bot_response')
    return
  }
}

module.exports = {
  handleChatCommand
}
