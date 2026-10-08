const { createBotApi } = require('../api')
const { json, action } = require('./parse')
const { failure, errorResult } = require('../utils/result')

async function handleChatCommand(bot, username, message, stateManager) {
  const trimmed = typeof message === 'string' ? message.trim() : ''
  const commandName = determineCommandName(trimmed)
  const api = createBotApi(bot, { stateManager })
  const token = Symbol(commandName)
  bot._commandToken = token
  bot.currentCommandName = commandName
  try {
    if (trimmed === '!status') return await api.status()
    if (trimmed === '!refresh') return await api.refresh()
    if (trimmed === '!stop') return await api.stop()
    if (['info', 'navigation', 'primitive', 'skill', 'look', 'creative'].includes(commandName)) {
      const parsed = action(trimmed, commandName)
      if (commandName === 'creative') {
        if (parsed.name !== 'placeBlock') throw failure('UNKNOWN_ACTION', `未知のアクション: ${parsed.name}`)
        return await api.placeBlock(parsed.params)
      }
      const method = { info: 'info', navigation: 'navigate', primitive: 'executePrimitive', skill: 'executeSkill', look: 'look' }[commandName]
      return await api[method](parsed.name, parsed.params)
    }
    if (commandName === 'goal') return await api.executeGoal(trimmed.replace('!goal ', '').trim(), { username })
    if (commandName === 'idle_on') return await api.startIdle(json(trimmed.split(' ').slice(1).join(' ')))
    if (commandName === 'history') {
      if (trimmed === '!history') return await api.history()
      const usernames = trimmed.replace('!history ', '').trim().split(',').map(x => x.trim())
      const result = await api.history(usernames.length === 1 ? { username: usernames[0] } : { usernames })
      if (result.ok) result.data.usernames = usernames
      return result
    }
    if (commandName === 'chat') {
      const args = trimmed.replace('!chat ', '').trim()
      const params = args.startsWith('{') ? json(args) : { username: args.split(' ')[0], message: args.split(' ').slice(1).join(' ') }
      return await api.chat(params)
    }
    if (commandName === 'echo') return await api.echo(username, trimmed.replace('!echo ', '').trim())
    throw failure('UNKNOWN_COMMAND', `未知のコマンド: ${trimmed}`)
  } catch (error) {
    return errorResult(error)
  } finally {
    bot.lastCommandName = commandName
    if (bot._commandToken === token) { bot.currentCommandName = null; bot._commandToken = null }
  }
}

function determineCommandName(trimmed) {
  if (trimmed === '!status') return 'status'
  if (trimmed === '!refresh') return 'refresh'
  for (const name of ['info', 'navigation', 'primitive', 'skill']) if (new RegExp(`^!${name}(\\s|$)`).test(trimmed)) return name
  if (trimmed.startsWith('!goal ')) return 'goal'
  if (trimmed === '!stop') return 'stop'
  if (trimmed.startsWith('!idle_on')) return 'idle_on'
  if (trimmed.startsWith('!look ')) return 'look'
  if (trimmed.startsWith('!creative ')) return 'creative'
  if (trimmed === '!history' || trimmed.startsWith('!history ')) return 'history'
  if (trimmed.startsWith('!chat ')) return 'chat'
  if (trimmed.startsWith('!echo ')) return 'echo'
  return null
}

module.exports = { handleChatCommand }
