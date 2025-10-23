/**
 * Vision Creative Actions
 *
 * AI Botが自分自身の視界のスクリーンショットを取得する。
 * 必要な時だけViewerとPuppeteerを起動し、撮影後に閉じる。
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

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
    console.log(`[VISION] Using port ${port} for viewer`);

    // 2. Viewerを起動（必要な時だけ）
    if (!bot.viewer) {
      const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
      viewer = mineflayerViewer(bot, { port, firstPerson: true });
      console.log(`[VISION] Viewer started on port ${port}`);
    } else {
      viewer = bot.viewer;
      port = viewer.port;
    }

    // 3. 視線方向を設定（パラメータがあれば上書き）
    const position = bot.entity.position.clone();
    const yaw = params.yaw !== undefined ? params.yaw : (bot.entity.yaw * 180 / Math.PI);
    const pitch = params.pitch !== undefined ? params.pitch : (bot.entity.pitch * 180 / Math.PI);

    console.log(`[VISION] Capture from ${bot.username}`);
    console.log(`[VISION] Position: (${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)})`);
    console.log(`[VISION] Yaw: ${yaw.toFixed(2)}°, Pitch: ${pitch.toFixed(2)}°`);

    // 視線方向が指定されている場合はTPで調整
    if (params.yaw !== undefined || params.pitch !== undefined) {
      bot.chat(`/tp @s ${position.x} ${position.y} ${position.z} ${yaw} ${pitch}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 4. Puppeteerでスクリーンショット撮影
    browser = await puppeteer.launch({
      headless: false,  // ブラウザウィンドウを表示
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

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

    // 描画完了まで待機
    await new Promise(resolve => setTimeout(resolve, 3500));

    // オーバーレイ描画（位置・方角情報）
    await page.evaluate((yaw, pitch, position, username) => {
      const canvas = document.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '9999';

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(10, 10, 350, 100);

      ctx.fillStyle = 'white';
      ctx.font = '16px monospace';
      ctx.fillText(`Bot: ${username}`, 20, 35);
      ctx.fillText(`Yaw: ${yaw.toFixed(2)}°, Pitch: ${pitch.toFixed(2)}°`, 20, 55);
      ctx.fillText(`Pos: (${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)})`, 20, 75);
      ctx.fillText(`Time: ${new Date().toLocaleTimeString()}`, 20, 95);

      document.body.appendChild(canvas);
    }, yaw, pitch, position, bot.username);

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

    console.log(`[VISION] Screenshot saved: ${filepath}`);

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
    console.error('[VISION] Capture failed:', error);
    throw error;

  } finally {
    // 5. クリーンアップ
    if (browser) {
      await browser.close();
      console.log('[VISION] Browser closed');
    }

    // Viewerは一時的に起動したので閉じる
    if (viewer && viewer.close) {
      viewer.close();
      bot.viewer = null;
      console.log('[VISION] Viewer closed');
    }
  }
}

module.exports = {
  capture
};
