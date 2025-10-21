/**
 * Observer Pool - Camera-Botプールマネージャ
 *
 * AI Bots (300体) は viewer を持たず、視覚が必要な時だけ
 * Camera-Bot (10体) にリクエストを送る。
 *
 * Camera-Botは常時起動しており、リクエストが来たら:
 * 1. AI Botの位置に瞬間移動
 * 2. AI Botの視線方向を向く
 * 3. スクリーンショット撮影
 * 4. 画像を返却
 */

const puppeteer = require('puppeteer')
const { EventEmitter } = require('events')

class ObserverPool extends EventEmitter {
  constructor(config = {}) {
    super()

    // Camera-Bot設定
    this.cameraCount = config.cameraCount || 10
    this.cameraStartPort = config.cameraStartPort || 3001

    // Camera-Botインスタンス管理
    this.cameras = []  // { id, bot, port, browser, busy, stats }

    // リクエストキュー
    this.requestQueue = []

    // 統計情報
    this.stats = {
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      averageWaitTime: 0,
      averageCaptureTime: 0
    }
  }

  /**
   * Observer Poolを初期化
   * @param {Array} cameraBots - Camera-Botインスタンスの配列
   */
  async initialize(cameraBots) {
    console.log('[OBSERVER POOL] Initializing with', this.cameraCount, 'camera bots')

    // 各Camera-Botをブラウザと紐付け
    for (let i = 0; i < cameraBots.length; i++) {
      const bot = cameraBots[i]
      const port = this.cameraStartPort + i

      // Puppeteerブラウザ起動
      const browser = await puppeteer.launch({
        headless: false
      })

      console.log(`[OBSERVER POOL] Camera-${i + 1} ready on port ${port}`)

      this.cameras.push({
        id: i + 1,
        bot,
        port,
        browser,
        busy: false,
        stats: {
          totalCaptures: 0,
          totalWaitTime: 0,
          totalCaptureTime: 0
        }
      })
    }

    console.log('[OBSERVER POOL] All cameras initialized')
  }

  /**
   * AI Botから視覚リクエストを受け付ける
   * @param {Object} request - リクエスト情報
   * @returns {Promise<Object>} 画像データとメタデータ
   */
  async requestCapture(request) {
    const requestId = ++this.stats.totalRequests
    const requestTime = Date.now()

    console.log(`[OBSERVER POOL] Request #${requestId} from ${request.botId}`)

    return new Promise((resolve, reject) => {
      // キューに追加
      this.requestQueue.push({
        id: requestId,
        botId: request.botId,
        position: request.position,
        yaw: request.yaw,
        pitch: request.pitch,
        requestTime,
        resolve,
        reject
      })

      // 処理開始
      this._processQueue()
    })
  }

  /**
   * キューを処理（空いているCamera-Botに割り当て）
   */
  async _processQueue() {
    // キューが空なら終了
    if (this.requestQueue.length === 0) return

    // 空いているCamera-Botを探す
    const availableCamera = this.cameras.find(cam => !cam.busy)

    if (!availableCamera) {
      // 全部埋まっている → キュー待ち
      console.log(`[OBSERVER POOL] All cameras busy, ${this.requestQueue.length} requests in queue`)
      return
    }

    // リクエストを取り出し
    const request = this.requestQueue.shift()

    // Camera-Botに割り当て
    await this._executeCapture(availableCamera, request)

    // 次のリクエストを処理
    this._processQueue()
  }

  /**
   * Camera-Botでスクリーンショットを撮影
   */
  async _executeCapture(camera, request) {
    camera.busy = true
    const startTime = Date.now()

    try {
      // 待ち時間
      const waitTime = startTime - request.requestTime
      console.log(`[CAMERA-${camera.id}] Processing request #${request.id} (waited ${waitTime}ms)`)

      // 1. Camera-Botを移動
      await this._moveCameraBot(camera.bot, request.position, request.yaw, request.pitch)

      // 2. スクリーンショット撮影（描画完了待機で十分）
      const screenshot = await this._captureScreenshot(camera, request)

      // 4. 統計更新
      const captureTime = Date.now() - startTime
      camera.stats.totalCaptures++
      camera.stats.totalWaitTime += waitTime
      camera.stats.totalCaptureTime += captureTime
      this.stats.completedRequests++

      console.log(`[CAMERA-${camera.id}] Completed request #${request.id} in ${captureTime}ms`)

      // 5. 結果を返す
      request.resolve(screenshot)

    } catch (error) {
      console.error(`[CAMERA-${camera.id}] Failed request #${request.id}:`, error.message)
      this.stats.failedRequests++
      request.reject(error)

    } finally {
      camera.busy = false
    }
  }

  /**
   * Camera-Botを指定位置・視線方向に移動
   */
  async _moveCameraBot(bot, position, yaw, pitch) {
    // AI Botと同じ位置 + 視線方向にTPして視線を設定
    // yaw, pitchは既に度数で渡されている
    bot.chat(`/tp @s ${position.x} ${position.y} ${position.z} ${yaw} ${pitch}`)

    // 移動・視線設定完了まで待つ
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  /**
   * Puppeteerでスクリーンショットを撮影
   */
  async _captureScreenshot(camera, request) {
    const page = await camera.browser.newPage()

    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1
    })

    try {
      await page.goto(`http://localhost:${camera.port}`, {
        waitUntil: 'networkidle2',
        timeout: 5000
      })

      // 描画完了まで待機
      await new Promise(resolve => setTimeout(resolve, 3500))

      // オーバーレイ描画
      await page.evaluate((yaw, pitch, position) => {
        const canvas = document.createElement('canvas')
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
        canvas.style.position = 'absolute'
        canvas.style.top = '0'
        canvas.style.left = '0'
        canvas.style.pointerEvents = 'none'
        canvas.style.zIndex = '9999'

        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.fillRect(10, 10, 300, 80)

        ctx.fillStyle = 'white'
        ctx.font = '16px monospace'
        ctx.fillText(`Yaw: ${yaw.toFixed(2)}°`, 20, 35)
        ctx.fillText(`Pitch: ${pitch.toFixed(2)}°`, 20, 55)
        ctx.fillText(`Pos: (${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)})`, 20, 75)

        document.body.appendChild(canvas)
      }, request.yaw, request.pitch, request.position)

      // スクリーンショット撮影
      const screenshot = await page.screenshot({
        encoding: 'base64',
        type: 'png'
      })

      return {
        success: true,
        image: screenshot,
        metadata: {
          botId: request.botId,
          position: request.position,
          yaw: request.yaw,
          pitch: request.pitch,
          timestamp: Date.now(),
          cameraId: camera.id
        }
      }

    } finally {
      await page.close()
    }
  }

  /**
   * 統計情報を取得
   */
  getStats() {
    return {
      pool: {
        totalCameras: this.cameraCount,
        busyCameras: this.cameras.filter(c => c.busy).length,
        queueLength: this.requestQueue.length
      },
      requests: this.stats,
      cameras: this.cameras.map(cam => ({
        id: cam.id,
        port: cam.port,
        busy: cam.busy,
        totalCaptures: cam.stats.totalCaptures,
        avgWaitTime: cam.stats.totalCaptures > 0
          ? Math.round(cam.stats.totalWaitTime / cam.stats.totalCaptures)
          : 0,
        avgCaptureTime: cam.stats.totalCaptures > 0
          ? Math.round(cam.stats.totalCaptureTime / cam.stats.totalCaptures)
          : 0
      }))
    }
  }

  /**
   * 全Camera-Botとブラウザをシャットダウン
   */
  async shutdown() {
    console.log('[OBSERVER POOL] Shutting down all cameras...')

    for (const camera of this.cameras) {
      await camera.browser.close()
      camera.bot.quit()
    }

    console.log('[OBSERVER POOL] Shutdown complete')
  }
}

module.exports = ObserverPool
