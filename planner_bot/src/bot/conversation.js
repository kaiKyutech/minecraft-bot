async function chat(bot, params = {}) {
  const targetUsername = params.username
  const message = params.message
  const maxDistance = params.maxDistance !== undefined ? Math.min(params.maxDistance, 100) : 15
  if (!targetUsername || !message) return { success: false, reason: 'invalid_format' }
    // 対象プレイヤーの存在確認
    const targetPlayer = bot.players[targetUsername]
    if (!targetPlayer) {
      bot.systemLog(`[CHAT] Player ${targetUsername} not found`)
      return {
        success: false,
        reason: 'player_not_found',
        targetUsername: targetUsername
      }
    }

    // エンティティ情報の確認（距離計算に必要）
    if (!targetPlayer.entity) {
      bot.systemLog(`[CHAT] Player ${targetUsername} entity not available`)
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

    return {
      success: true,
      targetUsername: targetUsername,
      distance: distanceRounded,
      maxDistance: maxDistance,
      message: message
    }
}

module.exports = { chat }
