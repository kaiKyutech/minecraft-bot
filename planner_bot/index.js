const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')

const createStateManager = require('./src/planner/state_manager')
const { handleChatCommand } = require('./src/commands')

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

  try {
    // コマンド実行前に状態を更新
    await stateManager.refresh(bot)
    await handleChatCommand(bot, username, message, stateManager)
  } catch (error) {
    console.error('command execution error', error)
    bot.chat(`コマンドの実行中に失敗しました: ${error.message}`)
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
