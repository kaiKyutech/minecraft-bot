/**
 * Vision Creative Actions
 *
 * AI Botが自分自身の視界のスクリーンショットを取得する。
 * 必要な時だけViewerとPuppeteerを起動し、撮影後に閉じる。
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const { createLogger } = require('../utils/logger');

/**
 * 現在の視界のスクリーンショットを取得
 * @param {Object} bot - Mineflayerボット
 * @param {Object} stateManager - 状態マネージャー
 * @param {Object} params - パラメータ
 * @param {number} params.yaw - 視線方向（度数、オプション）
 * @param {number} params.pitch - 視線角度（度数、オプション）
 * @returns {Promise<Object>} 画像データとメタデータ
 */
async function capture(bot, stateManager, params = {}) {
  let viewer = null;
  let browser = null;
  let port = null;

  try {
    // 1. 空きポートを取得（動的インポート）
    const getPort = (await import('get-port')).default;
    port = await getPort();
    logger.info(`[VISION] Using port ${port} for viewer`);

    // 2. Viewerを起動（必要な時だけ）
    logger.info('[VISION] Step 1: Starting viewer...');
    const viewerStartTime = Date.now();
    if (!bot.viewer) {
      const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
      viewer = mineflayerViewer(bot, { port, firstPerson: true });
      logger.info(`[VISION] Viewer started on port ${port}`);
      // Viewerのサーバー起動を待つ
      await new Promise(resolve => setTimeout(resolve, 1000));
      logger.info(`[VISION] Viewer initialization completed (${Date.now() - viewerStartTime}ms)`);
    } else {
      viewer = bot.viewer;
      port = viewer.port;
      logger.info('[VISION] Reusing existing viewer');
    }

    // ポートが有効か確認
    if (!port || typeof port !== 'number') {
      throw new Error(`Invalid port: ${port}`);
    }

    // 3. 視線方向を設定（パラメータがあれば上書き）
    const position = bot.entity.position.clone();

    // 視線方向が指定されている場合はbot.look()で調整
    // 座標系: 北=0°, 反時計回り（西=90°, 南=180°, 東=270°または-90°）
    // 注意: Mineflayer公式ドキュメントには「東=0°」と記載されているが実際は「北=0°」
    logger.info('[VISION] Step 2: Setting view direction...');
    if (params.yaw !== undefined || params.pitch !== undefined) {
      const yawRadians = params.yaw !== undefined
        ? params.yaw * Math.PI / 180
        : bot.entity.yaw;
      const pitchRadians = params.pitch !== undefined
        ? params.pitch * Math.PI / 180
        : bot.entity.pitch;
      await bot.look(yawRadians, pitchRadians, true);
      await new Promise(resolve => setTimeout(resolve, 200));
      logger.info('[VISION] View direction set');
    } else {
      logger.info('[VISION] Using current view direction');
    }

    // ログ出力用に度数で取得
    const yaw = bot.entity.yaw * 180 / Math.PI;
    const pitch = bot.entity.pitch * 180 / Math.PI;

    // 視線先のブロック情報を取得
    const targetBlock = bot.blockAtCursor(256);
    let targetInfo = null;
    if (targetBlock) {
      targetInfo = {
        name: targetBlock.name,
        position: {
          x: targetBlock.position.x,
          y: targetBlock.position.y,
          z: targetBlock.position.z
        }
      };
    }

    logger.info(`[VISION] Capture from ${bot.username}`);
    logger.info(`[VISION] Position: (${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)})`);
    logger.info(`[VISION] Yaw: ${yaw.toFixed(2)}°, Pitch: ${pitch.toFixed(2)}°`);
    if (targetInfo) {
      logger.info(`[VISION] Target: ${targetInfo.name} at (${targetInfo.position.x}, ${targetInfo.position.y}, ${targetInfo.position.z})`);
    } else {
      logger.info(`[VISION] Target: none`);
    }

    // 4. Puppeteerでスクリーンショット撮影
    logger.info('[VISION] Step 3: Launching browser...');
    const browserStartTime = Date.now();
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    logger.info(`[VISION] Browser launched (${Date.now() - browserStartTime}ms)`);

    logger.info('[VISION] Step 4: Loading page...');
    const pageStartTime = Date.now();
    const page = await browser.newPage();
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1
    });

    await page.goto(`http://localhost:${port}`, {
      waitUntil: 'networkidle2',
      timeout: 10000
    });
    logger.info(`[VISION] Page loaded (${Date.now() - pageStartTime}ms)`);

    // 描画完了まで待機
    const renderWait = params.renderWait !== undefined ? params.renderWait : 10000;
    logger.info(`[VISION] Step 5: Waiting for render completion (${renderWait}ms)...`);
    const renderStartTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, renderWait));
    logger.info(`[VISION] Render wait completed (${Date.now() - renderStartTime}ms)`);

    // オーバーレイ描画（位置・方角情報）
    await page.evaluate((yaw, pitch, position, targetInfo) => {
      const canvas = document.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '9999';

      const ctx = canvas.getContext('2d');

      // FOV設定（実測値に基づく）
      const fovHorizontal = 60;  // ±60° (中心から片側)

      // 視野範囲を計算
      // Yaw: 反時計回り（北=0°, 西=90°）なので：
      // 左（反時計回り）= Yaw + fov
      // 右（時計回り）= Yaw - fov
      const yawLeft = Math.floor(yaw + fovHorizontal);   // 左端（反時計回り）
      const yawRight = Math.floor(yaw - fovHorizontal);  // 右端（時計回り）

      // 画面サイズ
      const width = window.innerWidth;
      const height = window.innerHeight;
      const centerX = width / 2;
      const centerY = height / 2;

      // === 垂直線（Yaw）を描画 ===
      ctx.lineWidth = 3;

      // 左端の線（青） - 反時計回り方向
      ctx.strokeStyle = 'rgba(0, 100, 255, 0.8)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, height);
      ctx.stroke();

      // 左端のラベル（背景付き）
      const leftText = `Yaw: ${yawLeft}°`;
      ctx.font = 'bold 28px monospace';
      const leftMetrics = ctx.measureText(leftText);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(5, height / 2 - 32, leftMetrics.width + 10, 40);
      ctx.fillStyle = 'rgba(0, 100, 255, 0.9)';
      ctx.fillText(leftText, 10, height / 2);

      // 中央の線（白）
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, height);
      ctx.stroke();

      // 中央のラベル（背景付き） - ターゲット情報を避けて下にずらす
      const centerYawText = `Yaw: ${Math.floor(yaw)}°`;
      const centerYawMetrics = ctx.measureText(centerYawText);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(centerX + 5, height / 2 + 110, centerYawMetrics.width + 10, 40);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(centerYawText, centerX + 10, height / 2 + 142);

      // 右端の線（赤） - 時計回り方向
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
      ctx.beginPath();
      ctx.moveTo(width - 1, 0);
      ctx.lineTo(width - 1, height);
      ctx.stroke();

      // 右端のラベル（背景付き）
      const rightText = `Yaw: ${yawRight}°`;
      const rightMetrics = ctx.measureText(rightText);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(width - rightMetrics.width - 15, height / 2 - 32, rightMetrics.width + 10, 40);
      ctx.fillStyle = 'rgba(255, 50, 50, 0.9)';
      ctx.fillText(rightText, width - rightMetrics.width - 10, height / 2);

      // === ターゲットサークル（画面中央）===
      // 外側のサークル（緑）
      ctx.strokeStyle = 'rgba(50, 255, 50, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 20, 0, Math.PI * 2);
      ctx.stroke();

      // 十字線（緑）
      ctx.lineWidth = 2;
      ctx.beginPath();
      // 横線
      ctx.moveTo(centerX - 30, centerY);
      ctx.lineTo(centerX - 20, centerY);
      ctx.moveTo(centerX + 20, centerY);
      ctx.lineTo(centerX + 30, centerY);
      // 縦線
      ctx.moveTo(centerX, centerY - 30);
      ctx.lineTo(centerX, centerY - 20);
      ctx.moveTo(centerX, centerY + 20);
      ctx.lineTo(centerX, centerY + 30);
      ctx.stroke();

      // 中央の点（緑）
      ctx.fillStyle = 'rgba(50, 255, 50, 0.9)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
      ctx.fill();

      // ターゲット情報をサークル下に表示
      if (targetInfo) {
        ctx.font = 'bold 22px monospace';
        const targetName = targetInfo.name;
        const targetPos = `(${targetInfo.position.x}, ${targetInfo.position.y}, ${targetInfo.position.z})`;

        const nameMetrics = ctx.measureText(targetName);
        const posMetrics = ctx.measureText(targetPos);

        // 背景（名前）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(centerX - nameMetrics.width / 2 - 5, centerY + 35, nameMetrics.width + 10, 30);
        // テキスト（名前）
        ctx.fillStyle = 'rgba(50, 255, 50, 0.9)';
        ctx.fillText(targetName, centerX - nameMetrics.width / 2, centerY + 57);

        // 背景（座標）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(centerX - posMetrics.width / 2 - 5, centerY + 68, posMetrics.width + 10, 30);
        // テキスト（座標）
        ctx.fillStyle = 'rgba(50, 255, 50, 0.9)';
        ctx.fillText(targetPos, centerX - posMetrics.width / 2, centerY + 90);
      }

      // === 情報ボックス（左上、縦並び）===
      ctx.fillStyle = 'white';
      ctx.font = '24px monospace';

      const posStr = `Pos: ${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)}`;
      const yawInfoStr = `Yaw: ${Math.floor(yaw)}°`;
      const pitchInfoStr = `Pitch: ${Math.floor(pitch)}°`;

      // ターゲットブロック情報
      let targetStr;
      if (targetInfo) {
        targetStr = `Target: ${targetInfo.name} at (${targetInfo.position.x}, ${targetInfo.position.y}, ${targetInfo.position.z})`;
      } else {
        targetStr = `Target: none`;
      }

      // 背景ボックス
      const boxPadding = 10;
      const lineHeight = 35;
      const posMetrics = ctx.measureText(posStr);
      const yawInfoMetrics = ctx.measureText(yawInfoStr);
      const pitchInfoMetrics = ctx.measureText(pitchInfoStr);
      const targetMetrics = ctx.measureText(targetStr);
      const maxWidth = Math.max(posMetrics.width, yawInfoMetrics.width, pitchInfoMetrics.width, targetMetrics.width);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(10, 10, maxWidth + boxPadding * 2, lineHeight * 4 + boxPadding);

      // テキスト描画
      ctx.fillStyle = 'white';
      ctx.fillText(posStr, 20, 40);
      ctx.fillText(yawInfoStr, 20, 75);
      ctx.fillText(pitchInfoStr, 20, 110);
      ctx.fillText(targetStr, 20, 145);

      document.body.appendChild(canvas);
    }, yaw, pitch, position, targetInfo);

    // スクリーンショット撮影
    const screenshot = await page.screenshot({
      encoding: 'base64',
      type: 'png'
    });

    // ファイルに保存（ボットごとに上書き）
    const filename = `screenshot_${bot.username}.png`;
    const filepath = path.join(process.cwd(), 'screenshots', filename);

    // screenshotsディレクトリがなければ作成
    await fs.mkdir(path.join(process.cwd(), 'screenshots'), { recursive: true });
    await fs.writeFile(filepath, screenshot, 'base64');

    logger.info(`[VISION] Screenshot saved: ${filepath}`);

    return {
      success: true,
      message: 'スクリーンショットを取得しました',
      data: {
        image: screenshot,
        filepath: filepath,
        metadata: {
          botId: bot.username,
          position: {
            x: Math.floor(position.x),
            y: Math.floor(position.y),
            z: Math.floor(position.z)
          },
          yaw: yaw,
          pitch: pitch,
          timestamp: Date.now()
        }
      }
    };

  } catch (error) {
    logger.error('[VISION] Capture failed:', error);
    throw error;

  } finally {
    // 5. クリーンアップ
    if (browser) {
      await browser.close();
      logger.info('[VISION] Browser closed');
    }

    // Viewerをクローズ
    if (viewer && viewer.close) {
      viewer.close();
    }

    // bot.viewerは常にクリア（エラー時も確実に）
    bot.viewer = null;
    logger.info('[VISION] Viewer closed');
  }
}

module.exports = {
  capture
};
