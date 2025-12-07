const { createLogger } = require('../utils/logger')

/**
 * !look コマンドハンドラ
 * 使い方:
 *   !look direction {"yaw": 90, "pitch": 0}  // 度数指定（片方だけでも可）
 *   !look player {"username": "PlayerName"}   // プレイヤーの頭付近を見る
 */
async function handleLookCommand(bot, username, message) {
  const trimmed = message.trim()
  const parts = trimmed.split(' ')

  if (parts.length < 2) {
    return usageError()
  }

  const action = parts[1]
  let params = {}

  if (parts.length > 2) {
    const jsonStr = parts.slice(2).join(' ')
    try {
      params = JSON.parse(jsonStr)
    } catch (error) {
      return {
        success: false,
        reason: 'invalid_json',
        error: error.message,
        usage: usageText()
      }
    }
  }

  const logger = createLogger({ bot, category: 'look', commandName: bot.currentCommandName || 'look' })

  if (action === 'direction' || action === 'dir') {
    if (params.yaw === undefined && params.pitch === undefined) {
      return {
        success: false,
        reason: 'missing_params',
        error: 'yaw または pitch を指定してください（度数）',
        usage: usageText()
      }
    }

    const yawDeg = params.yaw !== undefined ? Number(params.yaw) : bot.entity.yaw * 180 / Math.PI
    const pitchDeg = params.pitch !== undefined ? Number(params.pitch) : bot.entity.pitch * 180 / Math.PI

    const yawRad = yawDeg * Math.PI / 180
    const pitchRad = pitchDeg * Math.PI / 180

    await bot.look(yawRad, pitchRad, true)
    logger.info(`[LOOK] yaw=${yawDeg.toFixed(2)}°, pitch=${pitchDeg.toFixed(2)}° に視線を設定`)

    return {
      success: true,
      yaw: yawDeg,
      pitch: pitchDeg
    }
  }

  if (action === 'player' || action === 'at') {
    const targetName = params.username || params.name
    if (!targetName) {
      return {
        success: false,
        reason: 'missing_username',
        error: 'username を指定してください',
        usage: usageText()
      }
    }

    const target = bot.players[targetName]
    if (!target || !target.entity) {
      return {
        success: false,
        reason: 'player_not_found',
        error: `プレイヤー「${targetName}」が見つかりません`,
        target: targetName
      }
    }

    const headPos = target.entity.position.offset(0, target.entity.height, 0)
    await bot.lookAt(headPos)
    logger.info(`[LOOK] プレイヤー ${targetName} を注視`)

    return {
      success: true,
      target: targetName,
      distance: bot.entity.position.distanceTo(target.entity.position)
    }
  }

  if (action === 'watch') {
    const targetName = params.username || params.name
    const intervalMs = params.intervalMs ? Math.max(200, Number(params.intervalMs)) : 1000

    if (!targetName) {
      return {
        success: false,
        reason: 'missing_username',
        error: 'username を指定してください',
        usage: usageText()
      }
    }

    const target = bot.players[targetName]
    if (!target || !target.entity) {
      return {
        success: false,
        reason: 'player_not_found',
        error: `プレイヤー「${targetName}」が見つかりません`,
        target: targetName
      }
    }

    startLookWatch(bot, targetName, intervalMs, logger)
    logger.info(`[LOOK] プレイヤー ${targetName} を継続監視 (interval=${intervalMs}ms)`)

    return {
      success: true,
      target: targetName,
      intervalMs
    }
  }

  return usageError()
}

module.exports = handleLookCommand
module.exports.stopLookWatch = stopLookWatch

function usageText() {
  return '!look direction {"yaw":90,"pitch":0} / !look player {"username":"PlayerName"} / !look watch {"username":"PlayerName","intervalMs":1000}'
}

function usageError() {
  return {
    success: false,
    reason: 'invalid_usage',
    usage: usageText()
  }
}

function startLookWatch(bot, targetName, intervalMs, logger) {
  stopLookWatch(bot)
  bot.lookWatchTarget = targetName
  bot.lookWatchInterval = setInterval(async () => {
    try {
      const target = bot.players[targetName]
      if (!target || !target.entity) return
      const headPos = target.entity.position.offset(0, target.entity.height, 0)
      await bot.lookAt(headPos)
    } catch (err) {
      logger?.warn?.(`[LOOK] watch tick error: ${err.message}`)
    }
  }, intervalMs)
}

function stopLookWatch(bot) {
  if (bot.lookWatchInterval) {
    clearInterval(bot.lookWatchInterval)
    bot.lookWatchInterval = null
  }
  bot.lookWatchTarget = null
}
