/**
 * Planner Bot - Main Entry Point
 *
 * 設定は .env ファイルで行います。
 * .env.sample をコピーして .env を作成し、設定を編集してください。
 *
 * 設定項目:
 *   MC_HOST - サーバーホスト
 *   MC_PORT - サーバーポート
 *   MC_USERNAME - AI Bot名
 *   MC_VERSION - バージョン（空欄で自動検出）
 *   AI_BOT_COUNT - AI Bot数
 *   PLANNER_DEBUG - デバッグログ有効化 (1で有効)
 */

require('dotenv').config();

const { startBots, shutdown } = require('./src/bot/startup');

// .env ファイルから設定を読み込み（必須）
if (!process.env.MC_HOST || !process.env.MC_PORT) {
  console.error('ERROR: .env file is not configured properly.');
  console.error('Please copy .env.sample to .env and configure it.');
  process.exit(1);
}

const config = {
  host: process.env.MC_HOST,
  port: Number(process.env.MC_PORT),
  username: process.env.MC_USERNAME,
  version: process.env.MC_VERSION || false,
  aiBotCount: parseInt(process.env.AI_BOT_COUNT) || 1
};

// ボット起動
let aiBots = [];

startBots(config)
  .then(result => {
    aiBots = result.aiBots;
  })
  .catch(error => {
    console.error('[FATAL ERROR]', error);
    process.exit(1);
  });

// シャットダウンハンドリング
process.on('SIGINT', () => shutdown(aiBots));
process.on('SIGTERM', () => shutdown(aiBots));
