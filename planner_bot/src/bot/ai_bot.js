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

  // 会話連番カウンター
  bot.conversationSequence = 0

  // コマンドログフィルタ（環境変数で制御）
  bot.logFilter = buildLogFilter()

  // GOAP実行中の中断用AbortController
  bot.currentAbortController = null

  /**
   * 1. システムログ（コンソール出力専用）
   * @param {string} message - ログメッセージ
   */
  bot.systemLog = (message) => {
    // コマンド実行中のみフィルタ判定（通常ログは常に表示）
    if (bot.currentCommandName && bot.logFilter.enabled) {
      if (!bot.logFilter.allowed.has(bot.currentCommandName)) {
        return
      }
    }
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
   * 2-2. 範囲内の全プレイヤーへの発言（whisper broadcast）
   * Minecraftセレクター構文を使用: /w @a[distance=..radius]
   * @param {string} message - メッセージ
   * @param {number} radius - 半径（ブロック単位）。デフォルト15
   */
  bot.speakNearby = async (message, radius = 15) => {
    const command = `/w @a[distance=..${radius}] ${message}`
    console.log(`[${bot.username}] [SPEAK_NEARBY] Sending command: ${command}`)
    bot.chat(command)
  }

  /**
   * 3. 会話履歴への追加（唯一の履歴追加ポイント）
   * @param {string} speaker - 発言者の実名（Bot1, Bot2, player など）
   * @param {string|Object} content - メッセージ内容（文字列 or 構造化データ）
   * @param {string} type - メッセージタイプ（'conversation' | 'system_info'）
   */
  bot.addMessage = (speaker, content, type) => {
    // role: このボット視点での役割
    // - assistant: 自分（bot.username）の発言
    // - user: それ以外の発言
    const role = speaker === bot.username ? 'assistant' : 'user'

    // 連番をインクリメント
    bot.conversationSequence++

    const messageObj = {
      sequence: bot.conversationSequence,  // 会話連番（単調増加）
      speaker,     // 発言者の実名（Bot1, Bot2, player など）
      role,        // このボット視点での役割（assistant=self, user=others）
      content,     // メッセージ内容（文字列 or 構造化データ）
      type,        // 'conversation' | 'system_info'
      timestamp: new Date().toISOString()  // ISO 8601形式（例: "2025-10-30T12:34:56.789Z"）
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
   * @param {string} options.type - 特定タイプのメッセージのみ取得（'conversation' | 'system_info'）
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

    // type指定（'conversation' | 'system_info'）
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

  /**
   * コマンド名に対してログを出すべきか判定
   * @param {string|null} commandName
   * @returns {boolean}
   */
  bot.shouldLogCommand = (commandName) => {
    if (!commandName) return true
    if (!bot.logFilter.enabled) return true
    return bot.logFilter.allowed.has(commandName)
  }
}

function buildLogFilter() {
  const env = process.env.LOG_COMMANDS
  if (!env || env.trim().length === 0) {
    return { enabled: false, allowed: new Set() }  // デフォルトは全ログ許可
  }

  const normalized = env.trim().toLowerCase()
  if (normalized === 'all') {
    return { enabled: false, allowed: new Set() }
  }
  if (normalized === 'none') {
    return { enabled: true, allowed: new Set() }  // 何も許可しない
  }

  const allowed = new Set(
    normalized
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  )

  return {
    enabled: true,
    allowed
  }
}

/**
 * AI Botを作成
 * @param {number} id - ボットID
 * @param {Object} config - Mineflayer設定 (host, port, username, version, aiBotCount)
 * @param {Object} options - オプション設定
 * @param {boolean} options.autoHandleWhisper - whisperイベントを自動処理するか（デフォルト: true）
 * @param {Function} options.onNaturalMessage - 自然言語メッセージのカスタムハンドラー (bot, username, message) => Promise<void>
 * @returns {Object} Mineflayerボットインスタンス（bot.stateManager を含む）
 */
function createAIBot(id, config, options = {}) {
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

  // stateManagerを外部からアクセス可能にする
  bot.stateManager = stateManager

  // スポーン時
  bot.once('spawn', () => {
    console.log(`[AI-BOT] ${botName} spawned`)
    debugLog(`${botName} spawned, ready to receive goals`)
  })

  // デフォルトでwhisperイベントを自動処理（無効化可能）
  if (options.autoHandleWhisper !== false) {
    bot.on('whisper', async (username, message) => {
      if (username === bot.username) return

      bot.systemLog(`Whisper from ${username}: ${message}`)
      debugLog(`whisper from ${username}: ${message}`)

      // !で始まるメッセージ: コマンド（会話履歴に入れない）
      if (message.startsWith('!')) {
        try {
          const result = await handleChatCommand(bot, username, message, stateManager)

          // コマンドの最終的な返り値をログ出力
          if (result !== undefined && bot.shouldLogCommand(bot.lastCommandName)) {
            console.log('='.repeat(80))
            console.log(`[${bot.username}] [COMMAND_RESULT] 最終的なコマンドの返り値:`)
            console.log(JSON.stringify(result, null, 2))
            console.log('='.repeat(80))
          }
        } catch (error) {
          // エラーをキャッチして統一的に出力
          const errorResult = {
            success: false,
            error: error.message,
            stack: error.stack
          }
          console.log('='.repeat(80))
          console.log(`[${bot.username}] [COMMAND_ERROR] 最終的なコマンドの返り値:`)
          console.log(JSON.stringify(errorResult, null, 2))
          console.log('='.repeat(80))
          bot.systemLog(`Command error: ${error.message}`)
          bot.systemLog(`Stack trace: ${error.stack}`)
        }
        return
      }

      // 自然言語メッセージ: 外部プロジェクトで処理
      // カスタムハンドラーが提供されていればそれを使う
      if (options.onNaturalMessage && typeof options.onNaturalMessage === 'function') {
        try {
          await options.onNaturalMessage(bot, username, message)
        } catch (error) {
          bot.systemLog(`Error in onNaturalMessage handler: ${error.message}`)
          console.error(`[AI-BOT] ${botName} onNaturalMessage error:`, error)
        }
      } else {
        // デフォルト: イベント発火のみ（LLMプロジェクトで購読可能）
        bot.emit('newNaturalMessage', {
          from: username,
          content: message,
          timestamp: Date.now()
        })
      }
    })
  }

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
