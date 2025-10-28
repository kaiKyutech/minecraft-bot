const { performance } = require('perf_hooks')
const handleGoalCommand = require('./goal_command')
const handleSkillCommand = require('./skill_command')
const handlePrimitiveCommand = require('./primitive_command')
const handleCreativeCommand = require('./creative_command')
const handleStatusCommand = require('./status_command')
const handleInfoCommand = require('./info_command')
const handleNavigationCommand = require('./navigation_command')

/**
 * すべての実行中操作を停止
 * @param {Object} bot - Mineflayerボット
 * @returns {Object} 停止した操作のリスト
 */
function stopAll(bot) {
  const stoppedActions = []

  // 1. GOAP実行を中断
  if (bot.currentAbortController) {
    bot.systemLog('[STOP] Aborting GOAP task...')
    bot.currentAbortController.abort()
    bot.currentAbortController = null
    stoppedActions.push('GOAP task')
  }

  // 2. 開いているチェストを閉じる
  if (bot.currentChest) {
    bot.systemLog('[STOP] Closing chest...')
    bot.currentChest.close()
    bot.currentChest = null
    bot.currentChestPosition = null
    stoppedActions.push('chest')
  }

  // 3. follow状態を停止
  if (bot.isFollowing) {
    bot.systemLog('[STOP] Stopping follow...')
    bot.isFollowing = false
    stoppedActions.push('follow')
  }

  return {
    success: true,
    stoppedActions: stoppedActions,
    message: stoppedActions.length > 0
      ? `停止しました: ${stoppedActions.join(', ')}`
      : '停止する操作がありませんでした'
  }
}

async function handleChatCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()

  if (trimmed === '!status') {
    return await handleStatusCommand(bot, username, stateManager)
  }

  if (trimmed === '!refresh') {
    const start = performance.now()
    await stateManager.refresh(bot)
    const elapsed = performance.now() - start
    bot.systemLog(`[REFRESH] Completed in ${elapsed.toFixed(1)}ms`)
    return {
      success: true,
      durationMs: elapsed
    }
  }

  if (/^!info(\s|$)/.test(trimmed)) {
    // 情報取得は停止不要
    return await handleInfoCommand(bot, username, trimmed, stateManager)
  }

  if (/^!navigation(\s|$)/.test(trimmed)) {
    // チェスト操作の続きコマンドかチェック
    const parts = trimmed.split(' ')
    const action = parts[1]
    const chestContinuationActions = ['chestDeposit', 'chestWithdraw', 'chestClose']

    // チェスト操作の続きでなければ自動停止
    if (!chestContinuationActions.includes(action)) {
      stopAll(bot)
    }

    return await handleNavigationCommand(bot, username, trimmed, stateManager)
  }

  if (/^!primitive(\s|$)/.test(trimmed)) {
    stopAll(bot)
    return await handlePrimitiveCommand(bot, username, trimmed, stateManager)
  }

  if (/^!skill(\s|$)/.test(trimmed)) {
    stopAll(bot)
    return await handleSkillCommand(bot, username, trimmed, stateManager)
  }

  if (trimmed.startsWith('!goal ')) {
    stopAll(bot)

    const goalName = trimmed.replace('!goal ', '').trim()

    // AbortController を作成して保持
    const abortController = new AbortController()
    bot.currentAbortController = abortController

    try {
      await handleGoalCommand(bot, username, goalName, stateManager, abortController.signal)
      return {
        success: true,
        goal: goalName,
        message: `目標「${goalName}」を完了しました`
      }
    } catch (error) {
      // 中断エラーかどうかを判定
      if (error.name === 'AbortError') {
        return {
          success: false,
          goal: goalName,
          aborted: true,
          error: error.message
        }
      }

      return {
        success: false,
        goal: goalName,
        error: error.message,
        diagnosis: error.diagnosis || null
      }
    } finally {
      // 完了・失敗・中断いずれの場合もクリア
      bot.currentAbortController = null
    }
  }

  if (trimmed === '!stop') {
    return stopAll(bot)
  }

  if (trimmed.startsWith('!creative ')) {
    stopAll(bot)
    const commandStr = trimmed.replace('!creative ', '').trim()
    return await handleCreativeCommand(bot, username, commandStr, stateManager)
  }

  // 実験用: 会話履歴の確認
  if (trimmed === '!history') {
    const history = bot.getConversationHistory()
    return {
      success: true,
      count: history.length,
      history: history
    }
  }

  // 実験用: 会話履歴の確認（特定ユーザーのみ）
  if (trimmed.startsWith('!history ')) {
    const usernamesStr = trimmed.replace('!history ', '').trim()
    const usernames = usernamesStr.split(',').map(u => u.trim())

    let history
    if (usernames.length === 1) {
      // 単一ユーザー指定
      history = bot.getConversationHistory({ username: usernames[0] })
    } else {
      // 複数ユーザー指定
      history = bot.getConversationHistory({ usernames: usernames })
    }

    return {
      success: true,
      usernames: usernames,
      count: history.length,
      history: history
    }
  }

  // チャット送信（whisper with distance check）
  if (trimmed.startsWith('!chat ')) {
    // チャット送信前にチェストが開いていれば閉じる（会話履歴との一貫性のため）
    if (bot.currentChest) {
      bot.currentChest.close()
      bot.currentChest = null
      bot.currentChestPosition = null
    }

    const args = trimmed.replace('!chat ', '').trim()

    // JSON形式のパラメータをパース
    let targetUsername, message, maxDistance = 15

    // JSON形式かどうかをチェック
    if (args.startsWith('{')) {
      try {
        const params = JSON.parse(args)
        targetUsername = params.username
        message = params.message
        if (params.maxDistance !== undefined) {
          maxDistance = Math.min(params.maxDistance, 100) // 最大100に制限
        }
      } catch (error) {
        return {
          success: false,
          reason: 'invalid_format',
          error: 'JSON parse error',
          usage: '!chat {"username": "PlayerName", "message": "Hello!", "maxDistance": 15}'
        }
      }
    } else {
      // 簡易形式: !chat username message
      const parts = args.split(' ')
      targetUsername = parts[0]
      message = parts.slice(1).join(' ')
    }

    if (!targetUsername || !message) {
      return {
        success: false,
        reason: 'invalid_format',
        usage: '!chat <username> <message> or !chat {"username": "PlayerName", "message": "Hello!", "maxDistance": 15}'
      }
    }

    // 対象プレイヤーの存在確認
    const targetPlayer = bot.players[targetUsername]
    if (!targetPlayer) {
      bot.systemLog(`[CHAT] Player ${targetUsername} not found`)

      // 会話履歴に記録（発話を試みた事実として）
      bot.addMessage(bot.username, {
        message: message,
        delivered: false,
        reason: 'player_not_found',
        targetUsername: targetUsername,
        maxDistance: maxDistance
      }, 'conversation')

      return {
        success: false,
        reason: 'player_not_found',
        targetUsername: targetUsername
      }
    }

    // エンティティ情報の確認（距離計算に必要）
    if (!targetPlayer.entity) {
      bot.systemLog(`[CHAT] Player ${targetUsername} entity not available`)

      // 会話履歴に記録（発話を試みた事実として）
      bot.addMessage(bot.username, {
        message: message,
        delivered: false,
        reason: 'entity_not_available',
        targetUsername: targetUsername,
        maxDistance: maxDistance
      }, 'conversation')

      return {
        success: false,
        reason: 'entity_not_available',
        targetUsername: targetUsername
      }
    }

    // 距離チェック
    const distance = bot.entity.position.distanceTo(targetPlayer.entity.position)
    const distanceRounded = Math.floor(distance)

    if (distance > maxDistance) {
      bot.systemLog(`[CHAT] ${targetUsername} is too far (${distanceRounded} blocks, max=${maxDistance})`)

      // 送信失敗でも会話履歴に記録（発話を試みた事実として）
      bot.addMessage(bot.username, {
        message: message,
        delivered: false,
        reason: 'out_of_range',
        targetUsername: targetUsername,
        distance: distanceRounded,
        maxDistance: maxDistance
      }, 'conversation')

      return {
        success: false,
        reason: 'out_of_range',
        targetUsername: targetUsername,
        distance: distanceRounded,
        maxDistance: maxDistance
      }
    }

    // 距離内なので送信
    bot.systemLog(`[CHAT] Sending to ${targetUsername} (${distanceRounded} blocks): ${message}`)
    await bot.speak(targetUsername, message)

    // 会話履歴に構造化データとして記録
    bot.addMessage(bot.username, {
      message: message,
      delivered: true,
      targetUsername: targetUsername,
      distance: distanceRounded,
      maxDistance: maxDistance
    }, 'conversation')

    return {
      success: true,
      targetUsername: targetUsername,
      distance: distanceRounded,
      maxDistance: maxDistance,
      message: message
    }
  }

  // 実験用: オウム返し（LLM発話のシミュレーション）- 後方互換性のため残す
  if (trimmed.startsWith('!echo ')) {
    const echoMessage = trimmed.replace('!echo ', '').trim()
    bot.systemLog(`Echo: ${echoMessage}`)
    await bot.speak(username, echoMessage)
    bot.addMessage(bot.username, echoMessage, 'conversation')
    return {
      success: true,
      message: echoMessage
    }
  }
}

module.exports = {
  handleChatCommand
}
