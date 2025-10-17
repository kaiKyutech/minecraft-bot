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

// ウィスパースパム対策: 最終送信時刻を記録
bot.lastWhisperTime = 0
bot.chatWithDelay = async (username, message) => {
  const MIN_WHISPER_INTERVAL = 550 // 0.55秒（余裕を持たせる）
  const now = Date.now()
  const timeSinceLastWhisper = now - bot.lastWhisperTime

  if (timeSinceLastWhisper < MIN_WHISPER_INTERVAL) {
    const waitTime = MIN_WHISPER_INTERVAL - timeSinceLastWhisper
    console.log(`[WHISPER] Waiting ${waitTime}ms before sending to ${username}: "${message}"`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }

  console.log(`[WHISPER] Sending to ${username}: "${message}"`)
  bot.whisper(username, message)
  bot.lastWhisperTime = Date.now()
}

bot.once('spawn', () => {
  console.log('[BOT] Spawned successfully, ready to receive commands')
  debugLog('bot spawned, ready to receive goals')
  mineflayerViewer(bot, { port: 3007, firstPerson: true })
})

// ウィスパー（/msg）でのみコマンドを受け付ける
bot.on('whisper', async (username, message) => {
  if (username === bot.username) return

  console.log(`[WHISPER RECEIVED] ${username}: ${message}`)
  debugLog(`whisper from ${username}: ${message}`)

  // コマンド以外は無視
  if (!message.startsWith('!')) {
    console.log(`[WHISPER] Ignoring non-command message: "${message}"`)
    return
  }

  try {
    // コマンド実行前に状態を更新
    await stateManager.refresh(bot)
    await handleChatCommand(bot, username, message, stateManager)
  } catch (error) {
    console.error('command execution error', error)
    await bot.chatWithDelay(username, `Error: ${error.message}`)
  }
})

// 公開チャットは完全に無視
bot.on('chat', (username, message) => {
  debugLog(`public chat ignored: ${username}: ${message}`)
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
