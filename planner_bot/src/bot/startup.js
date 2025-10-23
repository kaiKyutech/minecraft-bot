/**
 * Startup Orchestrator
 * AI Botの起動を管理する
 */

const { createAIBot } = require('./ai_bot');

/**
 * 全ボットを起動
 * @param {Object} config - 設定
 * @returns {Object} { aiBots }
 */
async function startBots(config) {
  const aiBots = [];

  printStartupBanner(config);

  // AI Botを起動
  console.log(`\n[STARTUP] Creating ${config.aiBotCount} AI Bots...`);
  if (config.aiBotCount > 10) {
    console.log('(This may take a few minutes...)\n');
  }

  for (let i = 1; i <= config.aiBotCount; i++) {
    const bot = createAIBot(i, {
      host: config.host,
      port: config.port,
      version: config.version,
      username: config.username,
      aiBotCount: config.aiBotCount
    });
    aiBots.push(bot);

    // プログレス表示
    if (config.aiBotCount > 10 && (i % 10 === 0 || i === config.aiBotCount)) {
      console.log(`[AI-BOT] Created ${i}/${config.aiBotCount} bots`);
    }

    // 少し待つ（サーバー負荷軽減）
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  printCompletionBanner(aiBots.length);

  return { aiBots };
}

/**
 * 起動バナーを表示
 */
function printStartupBanner(config) {
  console.log('='.repeat(60));
  console.log('Planner Bot - GOAP AI System');
  console.log('='.repeat(60));
  console.log(`Server: ${config.host}:${config.port}`);
  console.log(`AI Bots: ${config.aiBotCount}`);
  console.log('='.repeat(60));
}

/**
 * 完了バナーを表示
 */
function printCompletionBanner(aiCount) {
  console.log('\n' + '='.repeat(60));
  console.log('All bots are now running!');
  console.log('='.repeat(60));
  console.log(`AI Bots: ${aiCount}`);
  console.log('\nCommands (via Minecraft chat):');
  console.log('  !creative vision capture {"yaw": 90, "pitch": 0}');
  console.log('  !creative navigation register {"name": "home"}');
  console.log('  !creative navigation goto {"name": "home"}');
  console.log('  !goal <goal_name>');
  console.log('  !status');
  console.log('  !skill <skill_name> [params]');
  console.log('  !primitive <primitive_name> [params]');
  console.log('='.repeat(60));
}

/**
 * シャットダウン処理
 */
async function shutdown(aiBots) {
  console.log('\n[SHUTDOWN] Shutting down...');

  console.log('[SHUTDOWN] Disconnecting AI Bots...');
  for (const bot of aiBots) {
    bot.quit();
  }

  console.log('[SHUTDOWN] Complete');
  process.exit(0);
}

module.exports = { startBots, shutdown };
