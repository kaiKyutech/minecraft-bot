/**
 * AI Bot Factory
 * GOAP・スキル・視覚機能を持つボットを作成する
 */

const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const createStateManager = require('../planner/state_manager')
const { handleChatCommand } = require('../commands')

/**
 * デバッグログ関数
 */
function debugLog(message) {
  if (process.env.PLANNER_DEBUG === '1') {
    console.log(`[planner] ${message}`)
  }
}

/**
 * ウィスパースパム対策関数を追加
 * @param {Object} bot - Mineflayerボット
 */
function addChatWithDelay(bot) {
  bot.lastWhisperTime = 0
  bot.chatWithDelay = async (username, message) => {
    const MIN_WHISPER_INTERVAL = 550
    const now = Date.now()
    const timeSinceLastWhisper = now - bot.lastWhisperTime

    if (timeSinceLastWhisper < MIN_WHISPER_INTERVAL) {
      const waitTime = MIN_WHISPER_INTERVAL - timeSinceLastWhisper
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    bot.whisper(username, message)
    bot.lastWhisperTime = Date.now()
  }
}

/**
 * AI Botを作成
 * @param {number} id - ボットID
 * @param {Object} config - 設定
 * @param {Object} observerPool - Observer Poolインスタンス
 * @returns {Object} Mineflayerボットインスタンス
 */
function createAIBot(id, config, observerPool) {
  const botName = `${config.username}${id}`

  console.log(`[AI-BOT] Creating ${botName}...`)

  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: botName,
    version: config.version
  })

  bot.loadPlugin(pathfinder)

  // 状態マネージャー
  const stateManager = createStateManager()

  // ウィスパースパム対策
  addChatWithDelay(bot)

  // Observer Poolへの参照を保持
  bot.observerPool = observerPool

  // スポーン時
  bot.once('spawn', () => {
    console.log(`[AI-BOT] ${botName} spawned`)
    debugLog(`${botName} spawned, ready to receive goals`)
  })

  // ウィスパーコマンド受付
  bot.on('whisper', async (username, message) => {
    if (username === bot.username) return

    console.log(`[WHISPER RECEIVED] ${botName} <- ${username}: ${message}`)
    debugLog(`whisper from ${username}: ${message}`)

    if (!message.startsWith('!')) {
      console.log(`[WHISPER] Ignoring non-command message: "${message}"`)
      return
    }

    try {
      await stateManager.refresh(bot)
      await handleChatCommand(bot, username, message, stateManager)
    } catch (error) {
      console.error(`[AI-BOT] ${botName} command error:`, error.message)
      await bot.chatWithDelay(username, `Error: ${error.message}`)
    }
  })

  // 公開チャット無視
  bot.on('chat', (username, message) => {
    debugLog(`${botName} public chat ignored: ${username}: ${message}`)
  })

  // エラーハンドリング
  bot.on('error', (err) => {
    console.error(`[AI-BOT] ${botName} error:`, err.message)
  })

  bot.on('kicked', (reason) => {
    console.log(`[AI-BOT] ${botName} kicked:`, reason)
  })

  bot.on('end', () => {
    console.log(`[AI-BOT] ${botName} disconnected`)
  })

  return bot
}

module.exports = { createAIBot }
