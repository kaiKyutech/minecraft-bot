const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')

const createStateManager = require('./src/planner/state_manager')
const goapPlanner = require('./src/planner/goap')
const skills = require('./src/skills')
const primitives = require('./src/primitives')

debugLog('initialising planner bot')

const stateManager = createStateManager()

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'PlannerBot',
  version: process.env.MC_VERSION || false
})

bot.loadPlugin(pathfinder)

bot.once('spawn', () => {
  debugLog('bot spawned, ready to receive goals')

  // remmychatプラグイン対策: 複数のチャンネル加入を試行
  setTimeout(() => {
    tryJoinGlobalChannel()
  }, 2000)
})

// remmychat対応: ローカルチャンネル参加
async function tryJoinGlobalChannel() {
  try {
    bot.chat('/remchat channel local')
    await delay(1500)
  } catch (error) {
    console.log('[CHANNEL] Failed to join local channel')
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  debugLog(`chat from ${username}: ${message}`)


  const trimmed = message.trim()

  if (/^!primitive(\s|$)/.test(trimmed)) {
    await handlePrimitiveCommand(trimmed)
    return
  }

  if (/^!skill(\s|$)/.test(trimmed)) {
    await handleSkillCommand(trimmed)
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
      // スキルがない場合は目標アクション（実行不要）
      if (!step.skill) {
        console.log(`目標達成: ${step.action}`)
        continue
      }

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
  // !primitive の後の部分を取得（スペースやタブを考慮して柔軟に処理）
  const body = raw.replace(/^!primitive\s*/, '').trim()
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
    const result = await primitiveFn(bot, params)
    await stateManager.refresh(bot)
    if (typeof result !== 'undefined') {
      debugLog(`primitive result: ${JSON.stringify(result)}`)
    }
    bot.chat('完了しました')
  } catch (error) {
    console.error('primitive execution error', error)
    bot.chat(`プリミティブ実行に失敗しました: ${error.message}`)
  }
}

function snakeToCamel(value) {
  return value.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

async function handleSkillCommand(raw) {
  console.log(`[SKILL DEBUG] Raw command: "${raw}"`)

  // !skill の後の部分を取得（スペースやタブを考慮して柔軟に処理）
  const body = raw.replace(/^!skill\s*/, '').trim()

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
      debugLog(`skill param parse error: ${error.message}`)
      return
    }
  }

  bot.chat(`スキル実行: ${nameToken}`)
  try {
    await skillFn(bot, params, stateManager)
    await stateManager.refresh(bot)
    bot.chat('スキルが完了しました')
  } catch (error) {
    console.error(`[SKILL ERROR] ${nameToken}:`, error)
    bot.chat(`スキル実行に失敗しました: ${error.message}`)
  }
}
