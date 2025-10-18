/**
 * Startup Orchestrator
 * Camera-Bot、Observer Pool、AI Botの起動を管理する
 */

const ObserverPool = require('../vision/observer_pool')
const { createCameraBot } = require('./camera_bot')
const { createAIBot } = require('./ai_bot')

/**
 * 全ボットを起動
 * @param {Object} config - 設定
 * @returns {Object} { cameraBots, aiBots, observerPool }
 */
async function startBots(config) {
  const cameraBots = []
  const aiBots = []

  printStartupBanner(config)

  // 1. Camera-Botを起動
  console.log('\n[STEP 1] Creating Camera-Bots...')
  for (let i = 1; i <= config.cameraCount; i++) {
    const bot = createCameraBot(i, {
      host: config.host,
      port: config.port,
      version: config.version,
      startPort: config.cameraStartPort
    })
    cameraBots.push(bot)

    // 少し待つ（サーバー負荷軽減）
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // Camera-Botのスポーン待ち
  console.log('\n[STEP 2] Waiting for Camera-Bots to spawn...')
  await waitForSpawn(cameraBots)

  // 2. Observer Pool初期化
  console.log('\n[STEP 3] Initializing Observer Pool...')
  const observerPool = new ObserverPool({
    cameraCount: config.cameraCount,
    cameraStartPort: config.cameraStartPort
  })

  await observerPool.initialize(cameraBots)
  global.observerPool = observerPool

  console.log('[OBSERVER POOL] Ready!\n')

  // 3. AI Botを起動
  console.log(`[STEP 4] Creating ${config.aiBotCount} AI Bots...`)
  if (config.aiBotCount > 10) {
    console.log('(This may take a few minutes...)\n')
  }

  for (let i = 1; i <= config.aiBotCount; i++) {
    const bot = createAIBot(i, {
      host: config.host,
      port: config.port,
      version: config.version,
      username: config.username
    }, observerPool)
    aiBots.push(bot)

    // プログレス表示
    if (config.aiBotCount > 10 && (i % 10 === 0 || i === config.aiBotCount)) {
      console.log(`[AI-BOT] Created ${i}/${config.aiBotCount} bots`)
    }

    // 少し待つ（サーバー負荷軽減）
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  printCompletionBanner(cameraBots.length, aiBots.length)

  return { cameraBots, aiBots, observerPool }
}

/**
 * 全ボットのスポーンを待つ
 */
async function waitForSpawn(bots) {
  await Promise.all(bots.map(bot =>
    new Promise(resolve => {
      if (bot.entity) {
        resolve()
      } else {
        bot.once('spawn', resolve)
      }
    })
  ))
}

/**
 * 起動バナーを表示
 */
function printStartupBanner(config) {
  console.log('='.repeat(60))
  console.log('Planner Bot with Observer Pool')
  console.log('='.repeat(60))
  console.log(`Server: ${config.host}:${config.port}`)
  console.log(`Camera-Bots: ${config.cameraCount} (ports ${config.cameraStartPort}-${config.cameraStartPort + config.cameraCount - 1})`)
  console.log(`AI Bots: ${config.aiBotCount}`)
  console.log('='.repeat(60))
}

/**
 * 完了バナーを表示
 */
function printCompletionBanner(cameraCount, aiCount) {
  console.log('\n' + '='.repeat(60))
  console.log('All bots are now running!')
  console.log('='.repeat(60))
  console.log(`Camera-Bots: ${cameraCount}`)
  console.log(`AI Bots: ${aiCount}`)
  console.log('\nCommands (via /msg):')
  console.log('  !creative vision capture {}')
  console.log('  !creative vision capturePanorama {}')
  console.log('  !creative vision stats {}')
  console.log('  !goal <goal_name>')
  console.log('  !creative nav register {"name": "home"}')
  console.log('  !status')
  console.log('  !skill <skill_name> [params]')
  console.log('  !primitive <primitive_name> [params]')
  console.log('='.repeat(60))
}

/**
 * シャットダウン処理
 */
async function shutdown(observerPool, cameraBots, aiBots) {
  console.log('\n[SHUTDOWN] Shutting down...')

  if (observerPool) {
    await observerPool.shutdown()
  }

  console.log('[SHUTDOWN] Disconnecting AI Bots...')
  for (const bot of aiBots) {
    bot.quit()
  }

  console.log('[SHUTDOWN] Complete')
  process.exit(0)
}

module.exports = { startBots, shutdown }
