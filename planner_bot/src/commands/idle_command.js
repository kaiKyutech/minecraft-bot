const { createLogger } = require('../utils/logger')

const DEFAULT_INTERVAL_MS = 4000
const DEFAULT_PLAYER_RANGE = 8
const DEFAULT_YAW_JITTER = 45 // 度
const DEFAULT_PITCH_MIN = -20
const DEFAULT_PITCH_MAX = 10

/**
 * !idle_on コマンドハンドラ
 * 使い方:
 *   !idle_on                          // デフォルト設定で開始
 *   !idle_on {"intervalMs":5000,"playerRange":10}
 */
async function handleIdleCommand(bot, username, message) {
  const trimmed = message.trim()
  let params = {}

  const parts = trimmed.split(' ')
  if (parts.length > 1) {
    const jsonStr = parts.slice(1).join(' ')
    try {
      params = JSON.parse(jsonStr)
    } catch (error) {
      return {
        success: false,
        reason: 'invalid_json',
        error: error.message,
        usage: '!idle_on {"intervalMs":4000,"playerRange":8}'
      }
    }
  }

  const logger = createLogger({ bot, category: 'idle', commandName: bot.currentCommandName || 'idle' })
  startIdle(bot, params, logger)

  const intervalMs = params.intervalMs || DEFAULT_INTERVAL_MS
  const playerRange = params.playerRange || DEFAULT_PLAYER_RANGE

  logger.info(`[IDLE] idle_on: interval=${intervalMs}ms, playerRange=${playerRange}`)

  return {
    success: true,
    message: `idleモード開始（interval=${intervalMs}ms, playerRange=${playerRange}）`
  }
}

function startIdle(bot, options = {}, logger = null) {
  stopIdle(bot)

  const config = {
    intervalMs: Math.max(500, options.intervalMs || DEFAULT_INTERVAL_MS),
    playerRange: Math.max(1, options.playerRange || DEFAULT_PLAYER_RANGE),
    yawJitter: options.yawJitter !== undefined ? Number(options.yawJitter) : DEFAULT_YAW_JITTER,
    pitchMin: options.pitchMin !== undefined ? Number(options.pitchMin) : DEFAULT_PITCH_MIN,
    pitchMax: options.pitchMax !== undefined ? Number(options.pitchMax) : DEFAULT_PITCH_MAX
  }

  bot.idleConfig = config
  bot.idleActive = true
  bot.idleLogger = logger || createLogger({ bot, category: 'idle', commandName: bot.currentCommandName || 'idle' })

  bot.idleInterval = setInterval(() => {
    tickIdle(bot).catch((err) => {
      bot.idleLogger?.warn(`[IDLE] tick error: ${err.message}`)
    })
  }, config.intervalMs)
}

function stopIdle(bot) {
  if (bot.idleInterval) {
    clearInterval(bot.idleInterval)
    bot.idleInterval = null
  }
  bot.idleActive = false
}

async function tickIdle(bot) {
  if (!bot.idleActive) return
  if (bot._idleTicking) return

  // GOAPなど長い処理中は干渉を避ける
  if (bot.currentAbortController) return

  const { yawJitter, pitchMin, pitchMax, playerRange } = bot.idleConfig || {}
  if (!bot.entity || !bot.entity.position) return

  bot._idleTicking = true
  try {
    const targetPlayer = findNearestPlayer(bot, playerRange)
    if (targetPlayer) {
      const headPos = targetPlayer.entity.position.offset(0, targetPlayer.entity.height, 0)
      await bot.lookAt(headPos)
      bot.idleLogger?.info(`[IDLE] Looking at ${targetPlayer.username}`)
      return
    }

    // プレイヤー不在: 軽く首振り
    const currentYawDeg = bot.entity.yaw * 180 / Math.PI
    const yawDeg = normalizeDeg(currentYawDeg + randomRange(-yawJitter, yawJitter))
    const pitchDeg = clamp(randomRange(pitchMin, pitchMax), pitchMin, pitchMax)

    await bot.look(yawDeg * Math.PI / 180, pitchDeg * Math.PI / 180, true)
    bot.idleLogger?.info(`[IDLE] Looking around yaw=${yawDeg.toFixed(1)}°, pitch=${pitchDeg.toFixed(1)}°`)
  } finally {
    bot._idleTicking = false
  }
}

function findNearestPlayer(bot, range) {
  let nearest = null
  let nearestDist = Infinity

  for (const [name, player] of Object.entries(bot.players)) {
    if (!player || !player.entity) continue
    if (name === bot.username) continue

    const dist = bot.entity.position.distanceTo(player.entity.position)
    if (dist <= range && dist < nearestDist) {
      nearest = { username: name, entity: player.entity }
      nearestDist = dist
    }
  }

  return nearest
}

function randomRange(min, max) {
  return min + Math.random() * (max - min)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeDeg(deg) {
  let d = deg % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

module.exports = handleIdleCommand
module.exports.stopIdle = stopIdle
