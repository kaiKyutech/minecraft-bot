const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')

const createStateManager = require('./src/planner/state_manager')
const { handleChatCommand } = require('./src/commands')
const { handleUserMessage } = require('./src/llm/llm_handler')

debugLog('initialising planner bot')

const stateManager = createStateManager()

// LLM用のコンテキスト（会話履歴、前回のコマンド結果など）
const llmContext = {
  chatHistory: [], // 直近50件の会話履歴
  lastCommandResult: null // 前回のコマンド結果
}

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25565),
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
})

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  console.log(`[CHAT RECEIVED] ${username}: ${message}`)
  debugLog(`chat from ${username}: ${message}`)

  // 会話履歴に追加（タイムスタンプ付き）
  const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  const chatLine = `[${timestamp}] <${username}> ${message}`;
  llmContext.chatHistory.push(chatLine);

  // 直近50件に制限
  if (llmContext.chatHistory.length > 50) {
    llmContext.chatHistory.shift();
  }

  try {
    // コマンド実行前に状態を更新
    await stateManager.refresh(bot)

    // メッセージが "!" で始まる場合は従来のコマンドハンドラ
    if (message.startsWith('!')) {
      await handleChatCommand(bot, username, message, stateManager)
    } else {
      // それ以外はLLMハンドラ（今回はプロンプト表示のみ）
      await handleUserMessage(bot, username, message, stateManager, llmContext)
    }
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
