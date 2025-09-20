const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')

const stateManager = require('./src/planner/state_manager')
const goapPlanner = require('./src/planner/goap')
const skills = require('./src/skills')
const primitives = require('./src/primitives')

debugLog('initialising planner bot')

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'PlannerBot',
  version: process.env.MC_VERSION || false
})

bot.loadPlugin(pathfinder)

bot.once('spawn', () => {
  debugLog('bot spawned, ready to receive goals')
})

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  debugLog(`chat from ${username}: ${message}`)

  const trimmed = message.trim()

  if (trimmed.startsWith('!primitive ')) {
    await handlePrimitiveCommand(trimmed)
    return
  }

  if (!trimmed.startsWith('!goal ')) return

  const goalName = trimmed.replace('!goal ', '').trim()
  bot.chat(`受信した目標: ${goalName}`)

  try {
    const worldState = await stateManager.getState(bot)
    const plan = goapPlanner.plan(goalName, worldState)

    if (!plan) {
      bot.chat('実行可能なプランが見つかりませんでした。')
      return
    }

    bot.chat(`計画されたアクション: ${plan.map((step) => step.action).join(' -> ')}`)

    for (const step of plan) {
      const skill = skills[step.skill]
      if (typeof skill !== 'function') {
        throw new Error(`スキル ${step.skill} が見つかりません`)
      }

      bot.chat(`実行: ${step.action}`)
      await skill(bot, step.params || {}, stateManager)
      await stateManager.refresh(bot)
    }

    bot.chat('目標を完了しました!')
  } catch (error) {
    console.error('goal execution error', error)
    bot.chat(`目標の実行中に失敗しました: ${error.message}`)
  }
})

bot.on('error', (err) => {
  console.error('bot error', err)
})

bot.on('end', () => {
  debugLog('bot connection ended')
})

function debugLog(message) {
  if (process.env.PLANNER_DEBUG === '1') {
    console.log(`[planner] ${message}`)
  }
}

async function handlePrimitiveCommand(raw) {
  const body = raw.replace('!primitive ', '').trim()
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
      bot.chat('パラメータは JSON 形式で指定してください')
      debugLog(`primitive param parse error: ${error.message}`)
      return
    }
  }

  bot.chat(`プリミティブ実行: ${nameToken}`)
  try {
    await primitiveFn(bot, params)
    await stateManager.refresh(bot)
    bot.chat('完了しました')
  } catch (error) {
    console.error('primitive execution error', error)
    bot.chat(`プリミティブ実行に失敗しました: ${error.message}`)
  }
}

function snakeToCamel(value) {
  return value.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
