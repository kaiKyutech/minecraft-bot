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
  // 会話履歴を管理（全員の発言を時系列に保存）
  bot.conversationHistory = []

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
   * @param {string} speaker - 発言者の実名（Bot1, Bot2, player など）
   * @param {string} content - メッセージ内容
   * @param {string} type - メッセージタイプ（'natural_language', 'bot_response', 'system_info' など）
   */
  bot.addMessage = (speaker, content, type) => {
    // role: このボット視点での役割
    // - assistant: 自分（bot.username）の発言
    // - user: それ以外の発言
    const role = speaker === bot.username ? 'assistant' : 'user'

    const messageObj = {
      speaker,     // 発言者の実名（Bot1, Bot2, player など）
      role,        // このボット視点での役割（assistant=self, user=others）
      content,     // メッセージ内容
      type,        // 'natural_language' | 'bot_response' | 'system_info' など
      timestamp: Date.now()
    }

    bot.conversationHistory.push(messageObj)

    // 履歴追加をコンソールに出力（生データ）
    console.log(`[${bot.username}] [HISTORY_ADD] ${JSON.stringify(messageObj)}`)

    // 会話履歴の上限管理（全体で100メッセージまで）
    const MAX_HISTORY = 100
    if (bot.conversationHistory.length > MAX_HISTORY) {
      // 古いメッセージから削除（FIFOキュー）
      bot.conversationHistory.shift()
    }
  }

  /**
   * 会話履歴を取得（オプションでフィルタリング可能）
   * @param {Object} options - フィルタオプション
   * @param {string} options.username - 特定ユーザーの発言のみ取得
   * @param {Array<string>} options.usernames - 複数ユーザーの発言のみ取得
   * @param {string} options.type - 特定タイプのメッセージのみ取得
   * @returns {Array} 会話履歴
   */
  bot.getConversationHistory = (options = {}) => {
    let history = bot.conversationHistory

    // username指定があればフィルタ
    if (options.username) {
      history = history.filter(msg => msg.speaker === options.username)
    }

    // 複数username指定
    if (options.usernames && Array.isArray(options.usernames)) {
      history = history.filter(msg => options.usernames.includes(msg.speaker))
    }

    // type指定（natural_language, bot_response, system_infoなど）
    if (options.type) {
      history = history.filter(msg => msg.type === options.type)
    }

    return history
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
 * @returns {Object} Mineflayerボットインスタンス
 */
function createAIBot(id, config) {
  // AI_BOT_COUNT=1の場合は番号を付けない（マルチプロセス対応）
  const botName = config.aiBotCount === 1 ? config.username : `${config.username}${id}`

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
        await handleChatCommand(bot, username, message, stateManager)
      } catch (error) {
        bot.systemLog(`Command error: ${error.message}`)
        bot.systemLog(`Stack trace: ${error.stack}`)
      }
      return
    }

    // 自然言語メッセージ: 会話履歴に追加
    bot.addMessage(username, message, 'natural_language')
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
