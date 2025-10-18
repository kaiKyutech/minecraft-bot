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

/**
 * 指定方向を向いてスクリーンショットを取得
 * @param {Object} bot - Mineflayerボット
 * @param {Object} stateManager - 状態マネージャー
 * @param {Object} params - { yaw, pitch }
 */
async function captureDirection(bot, stateManager, params) {
  if (params.yaw === undefined || params.pitch === undefined) {
    throw new Error('yaw と pitch を指定してください')
  }

  // 指定方向を向く
  await bot.look(params.yaw, params.pitch, false)

  // 少し待つ
  await new Promise(resolve => setTimeout(resolve, 200))

  // 通常のcaptureを実行
  return await capture(bot, stateManager, {})
}

/**
 * 周囲4方向のスクリーンショットを取得（パノラマ風）
 * @param {Object} bot - Mineflayerボット
 * @param {Object} stateManager - 状態マネージャー
 * @param {Object} params - パラメータ（空でOK）
 */
async function capturePanorama(bot, stateManager, params = {}) {
  const directions = [
    { name: '北', yaw: 0 },
    { name: '東', yaw: Math.PI / 2 },
    { name: '南', yaw: Math.PI },
    { name: '西', yaw: 3 * Math.PI / 2 }
  ]

  const screenshots = []

  for (const dir of directions) {
    console.log(`[VISION] Capturing ${dir.name}...`)

    const result = await captureDirection(bot, stateManager, {
      yaw: dir.yaw,
      pitch: 0
    })

    screenshots.push({
      direction: dir.name,
      yaw: dir.yaw,
      image: result.data.image,
      metadata: result.data.metadata
    })

    // 次の撮影まで少し待つ
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  console.log(`[VISION] Panorama capture completed (${screenshots.length} images)`)

  return {
    success: true,
    message: `パノラマ撮影完了（${screenshots.length}枚）`,
    data: {
      screenshots,
      position: bot.entity.position.clone(),
      timestamp: Date.now()
    }
  }
}

/**
 * Observer Poolの統計情報を取得
 */
async function stats(bot, stateManager, params = {}) {
  const observerPool = global.observerPool || bot.observerPool

  if (!observerPool) {
    throw new Error('Observer Poolが初期化されていません')
  }

  const stats = observerPool.getStats()

  console.log('[VISION] Observer Pool Stats:')
  console.log(`  Total cameras: ${stats.pool.totalCameras}`)
  console.log(`  Busy cameras: ${stats.pool.busyCameras}`)
  console.log(`  Queue length: ${stats.pool.queueLength}`)
  console.log(`  Total requests: ${stats.requests.totalRequests}`)
  console.log(`  Completed: ${stats.requests.completedRequests}`)
  console.log(`  Failed: ${stats.requests.failedRequests}`)

  return {
    success: true,
    message: 'Observer Pool統計情報',
    data: stats
  }
}

module.exports = {
  capture,
  captureDirection,
  capturePanorama,
  stats
}
