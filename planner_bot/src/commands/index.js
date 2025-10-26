const handleGoalCommand = require('./goal_command')
const handleSkillCommand = require('./skill_command')
const handlePrimitiveCommand = require('./primitive_command')
const handleCreativeCommand = require('./creative_command')
const handleStatusCommand = require('./status_command')
const handleInfoCommand = require('./info_command')
const handleNavigationCommand = require('./navigation_command')

async function handleChatCommand(bot, username, message, stateManager) {
  const trimmed = message.trim()

  if (trimmed === '!status') {
    await handleStatusCommand(bot, username, stateManager)
    return
  }

  if (/^!info(\s|$)/.test(trimmed)) {
    await handleInfoCommand(bot, username, trimmed, stateManager)
    return
  }

  if (/^!navigation(\s|$)/.test(trimmed)) {
    await handleNavigationCommand(bot, username, trimmed, stateManager)
    return
  }

  if (/^!primitive(\s|$)/.test(trimmed)) {
    await handlePrimitiveCommand(bot, username, trimmed, stateManager)
    return
  }

  if (/^!skill(\s|$)/.test(trimmed)) {
    await handleSkillCommand(bot, username, trimmed, stateManager)
    return
  }

  if (trimmed.startsWith('!goal ')) {
    const goalName = trimmed.replace('!goal ', '').trim()
    try {
      await handleGoalCommand(bot, username, goalName, stateManager)
      return {
        success: true,
        goal: goalName,
        message: `目標「${goalName}」を完了しました`
      }
    } catch (error) {
      return {
        success: false,
        goal: goalName,
        error: error.message,
        diagnosis: error.diagnosis || null
      }
    }
  }

  if (trimmed.startsWith('!creative ')) {
    const commandStr = trimmed.replace('!creative ', '').trim()
    await handleCreativeCommand(bot, username, commandStr, stateManager)
    return
  }

  // 実験用: 会話履歴の確認
  if (trimmed === '!history') {
    const history = bot.getConversationHistory()
    console.log(`[${bot.username}] [HISTORY_DUMP] count=${history.length}`)
    console.log(JSON.stringify(history, null, 2))
    return
  }

  // 実験用: 会話履歴の確認（特定ユーザーのみ）
  if (trimmed.startsWith('!history ')) {
    const usernamesStr = trimmed.replace('!history ', '').trim()
    const usernames = usernamesStr.split(',').map(u => u.trim())

    let history
    if (usernames.length === 1) {
      // 単一ユーザー指定
      history = bot.getConversationHistory({ username: usernames[0] })
      console.log(`[${bot.username}] [HISTORY_DUMP] username=${usernames[0]}, count=${history.length}`)
    } else {
      // 複数ユーザー指定
      history = bot.getConversationHistory({ usernames: usernames })
      console.log(`[${bot.username}] [HISTORY_DUMP] usernames=${usernames.join(',')}, count=${history.length}`)
    }

    console.log(JSON.stringify(history, null, 2))
    return
  }

  // チャット送信（whisper with distance check）
  if (trimmed.startsWith('!chat ')) {
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
          usage: '!chat {\"username\": \"PlayerName\", \"message\": \"Hello!\", \"maxDistance\": 15}'
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
        usage: '!chat <username> <message> or !chat {\"username\": \"PlayerName\", \"message\": \"Hello!\", \"maxDistance\": 15}'
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
      }, 'bot_response')

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
      }, 'bot_response')

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
      }, 'bot_response')

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
    }, 'bot_response')

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
    bot.addMessage(bot.username, echoMessage, 'bot_response')
    return
  }
}

module.exports = {
  handleChatCommand
}
