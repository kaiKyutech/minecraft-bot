/**
 * Startup Orchestrator
 * AI Botの起動を管理する
 */

const { createAIBot } = require('./ai_bot');
const chalk = require('chalk');

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
  console.log('\nAvailable Commands (via Minecraft whisper):');
  console.log(chalk.gray('  必須パラメータ: 黄色 | オプション: グレー'));
  console.log('');
  console.log('  GOAP System:');
  console.log('    !goal ' + chalk.yellow('inventory.stick:4'));
  console.log('    !skill ' + chalk.yellow('gather') + ' ' + chalk.gray('{"blockType": "oak_log", "count": 5}'));
  console.log('    !status');
  console.log('');
  console.log('  Information (情報取得):');
  console.log('    !info all  ' + chalk.gray('# inventory + position + locations'));
  console.log('    !info vision ' + chalk.gray('{"yaw": 90, "pitch": 0, "renderWait": 5000}'));
  console.log('    !info scanBlocks ' + chalk.gray('{"range": 32, "types": ["diamond_ore"]}'));
  console.log('');
  console.log('  Navigation (移動):');
  console.log('    !navigation register ' + chalk.yellow('{"name": "home"}'));
  console.log('    !navigation goto ' + chalk.yellow('{"name": "home"}'));
  console.log('    !navigation moveInDirection {' + chalk.yellow('"distance": 10') + chalk.gray(', "yaw": 90, "verticalMode": "surface"') + '}');
  console.log('    !navigation follow ' + chalk.yellow('{"username": "PlayerName"}'));
  console.log('    !navigation stopFollow {}');
  console.log('');
  console.log('  Creative (建築など):');
  console.log(chalk.gray('    !creative  # 未実装（将来の拡張用）'));
  console.log('');
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
