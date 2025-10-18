/**
 * Camera-Bot Factory
 * 視覚専門のボットを作成する
 */

const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const { mineflayer: mineflayerViewer } = require('prismarine-viewer')

/**
 * Camera-Botを作成
 * @param {number} id - ボットID
 * @param {Object} config - 設定
 * @returns {Object} Mineflayerボットインスタンス
 */
function createCameraBot(id, config) {
  const botName = `Cam${id}`
  const port = config.startPort + (id - 1)

  console.log(`[CAMERA-BOT] Creating ${botName} on port ${port}...`)

  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: botName,
    version: config.version
  })

  bot.loadPlugin(pathfinder)

  // スポーン時にprismarine-viewerを起動
  bot.once('spawn', () => {
    console.log(`[CAMERA-BOT] ${botName} spawned`)
    mineflayerViewer(bot, { port, firstPerson: true })
    console.log(`[CAMERA-BOT] ${botName} viewer started on port ${port}`)
  })

  // エラーハンドリング
  bot.on('error', (err) => {
    console.error(`[CAMERA-BOT] ${botName} error:`, err.message)
  })

  bot.on('kicked', (reason) => {
    console.log(`[CAMERA-BOT] ${botName} kicked:`, reason)
  })

  bot.on('end', () => {
    console.log(`[CAMERA-BOT] ${botName} disconnected`)
  })

  return bot
}

module.exports = { createCameraBot }
