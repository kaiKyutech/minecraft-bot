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
 * 統一されたログシステムを追加
 * @param {Object} bot - Mineflayerボット
 */
function addLoggingSystem(bot) {
  // 会話履歴を管理（username -> messages[]）
  bot.conversationHistory = new Map()

  /**
   * 1. システムログ（コンソール出力専用）
   * @param {string} message - ログメッセージ
   */
  bot.systemLog = (message) => {
    console.log(`[${bot.username}] ${message}`)
  }

  /**
   * 2. MCチャットへの発言（whisper送信専用）
   * このプロジェクトでは定義のみで使用しない（LLMプロジェクトで使用）
   * @param {string} username - 送信先ユーザー名
   * @param {string} message - メッセージ
   */
  bot.speak = async (username, message) => {
    bot.whisper(username, message)
  }

  /**
   * 3. 会話履歴への追加（唯一の履歴追加ポイント）
   * @param {string} username - 会話相手のユーザー名
   * @param {string} speaker - 発言者の実名（Bot1, Bot2, player など）
   * @param {string} content - メッセージ内容
   * @param {string} type - メッセージタイプ（'natural_language', 'bot_response', 'system_info' など）
   */
  bot.addMessage = (username, speaker, content, type) => {
    if (!bot.conversationHistory.has(username)) {
      bot.conversationHistory.set(username, [])
    }

    // role: このボット視点での役割
    // - assistant: 自分（bot.username）の発言
    // - user: それ以外の発言
    const role = speaker === bot.username ? 'assistant' : 'user'

    const history = bot.conversationHistory.get(username)
    history.push({
      speaker,     // 発言者の実名（Bot1, Bot2, player など）
      role,        // このボット視点での役割（assistant=自分, user=それ以外）
      content,     // メッセージ内容
      type,        // 'natural_language' | 'bot_response' | 'system_info' など
      timestamp: Date.now()
    })

    // 会話履歴の上限管理（ユーザーごとに100メッセージまで）
    const MAX_HISTORY_PER_USER = 100
    if (history.length > MAX_HISTORY_PER_USER) {
      // 古いメッセージから削除（FIFOキュー）
      history.shift()
    }
  }

  /**
   * 会話履歴を取得
   * @param {string} username - ユーザー名
   * @returns {Array} 会話履歴
   */
  bot.getConversationHistory = (username) => {
    return bot.conversationHistory.get(username) || []
  }

  /**
   * 後方互換性のため chatWithDelay を残す（deprecated）
   * @deprecated 新しいコードでは bot.speak() を使用してください
   */
  bot.chatWithDelay = async (username, message) => {
    console.warn('[DEPRECATED] bot.chatWithDelay is deprecated. Use bot.speak() instead.')
    await bot.speak(username, message)
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

  // 統一されたログシステムを追加
  addLoggingSystem(bot)

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

    bot.systemLog(`Whisper from ${username}: ${message}`)
    debugLog(`whisper from ${username}: ${message}`)

    // !で始まるメッセージ: コマンド（会話履歴に入れない）
    if (message.startsWith('!')) {
      try {
        await stateManager.refresh(bot)
        await handleChatCommand(bot, username, message, stateManager)
      } catch (error) {
        bot.systemLog(`Command error: ${error.message}`)
        bot.systemLog(`Stack trace: ${error.stack}`)
      }
      return
    }

    // 自然言語メッセージ: 会話履歴に追加
    bot.addMessage(username, username, message, 'natural_language')
    bot.systemLog(`Natural language message added to conversation history`)
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
