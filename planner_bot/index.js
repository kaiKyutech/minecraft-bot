require('dotenv').config()

const { mineflayer: mineflayerViewer } = require('prismarine-viewer')

const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')

const createStateManager = require('./src/planner/state_manager')
const { handleChatCommand } = require('./src/commands')

debugLog('initialising planner bot')

const stateManager = createStateManager()

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25566),
  username: process.env.MC_USERNAME || 'PlannerBot',
  version: process.env.MC_VERSION || false
})

bot.loadPlugin(pathfinder)

// チャットスパム対策: 最終送信時刻を記録
bot.lastChatTime = 0
bot.chatWithDelay = async (message) => {
  const MIN_CHAT_INTERVAL = 550 // 0.55秒（余裕を持たせる）
  const now = Date.now()
  const timeSinceLastChat = now - bot.lastChatTime

  if (timeSinceLastChat < MIN_CHAT_INTERVAL) {
    const waitTime = MIN_CHAT_INTERVAL - timeSinceLastChat
    console.log(`[CHAT] Waiting ${waitTime}ms before sending: "${message}"`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }

  console.log(`[CHAT] Sending: "${message}"`)
  bot.chat(message)
  bot.lastChatTime = Date.now()
}

bot.once('spawn', () => {
  console.log('[BOT] Spawned successfully, ready to receive commands')
  debugLog('bot spawned, ready to receive goals')
  mineflayerViewer(bot, { port: 3007, firstPerson: true })
})

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  console.log(`[CHAT RECEIVED] ${username}: ${message}`)
  debugLog(`chat from ${username}: ${message}`)

  // コマンド以外は無視
  if (!message.startsWith('!')) {
    console.log(`[CHAT] Ignoring non-command message: "${message}"`)
    return
  }

  try {
    // コマンド実行前に状態を更新
    await stateManager.refresh(bot)
    await handleChatCommand(bot, username, message, stateManager)
  } catch (error) {
    console.error('command execution error', error)
    await bot.chatWithDelay(`Error: ${error.message}`)
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
