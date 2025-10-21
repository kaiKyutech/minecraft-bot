/**
 * Vision Creative Actions
 *
 * AI Botが視覚情報を取得するためのアクション。
 * Observer Poolに視覚リクエストを送信し、画像を取得する。
 */

/**
 * 現在の視界のスクリーンショットを取得
 * @param {Object} bot - Mineflayerボット
 * @param {Object} stateManager - 状態マネージャー
 * @param {Object} params - パラメータ（空でOK）
 * @returns {Promise<Object>} 画像データとメタデータ
 */
async function capture(bot, stateManager, params = {}) {
  // Observer Poolインスタンスを取得
  // ※ グローバルまたはbot.observerPoolに保存されていると仮定
  const observerPool = global.observerPool || bot.observerPool

  if (!observerPool) {
    throw new Error('Observer Poolが初期化されていません')
  }

  // 現在の位置と視線方向を取得
  const position = bot.entity.position.clone()
  const yaw = bot.entity.yaw
  const pitch = bot.entity.pitch

  console.log(`[VISION] Capture request from ${bot.username}`)
  console.log(`[VISION] Position: (${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)})`)
  console.log(`[VISION] Yaw: ${yaw.toFixed(2)}, Pitch: ${pitch.toFixed(2)}`)

  // Observer Poolにリクエスト送信
  const result = await observerPool.requestCapture({
    botId: bot.username,
    position: {
      x: position.x,
      y: position.y,
      z: position.z
    },
    yaw,
    pitch
  })

  console.log(`[VISION] Capture completed by Camera-${result.metadata.cameraId}`)

  return {
    success: true,
    message: 'スクリーンショットを取得しました',
    data: result
  }
}

// TODO: 将来実装
// async function captureDirection(bot, stateManager, params) { ... }
// async function capturePanorama(bot, stateManager, params = {}) { ... }
// async function stats(bot, stateManager, params = {}) { ... }

module.exports = {
  capture
}
