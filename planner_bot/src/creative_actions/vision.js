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
      // Viewerのサーバー起動を待つ
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      viewer = bot.viewer;
      port = viewer.port;
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
    if (params.yaw !== undefined || params.pitch !== undefined) {
      const yawRadians = params.yaw !== undefined
        ? params.yaw * Math.PI / 180
        : bot.entity.yaw;
      const pitchRadians = params.pitch !== undefined
        ? params.pitch * Math.PI / 180
        : bot.entity.pitch;
      await bot.look(yawRadians, pitchRadians, true);
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // ログ出力用に度数で取得
    const yaw = bot.entity.yaw * 180 / Math.PI;
    const pitch = bot.entity.pitch * 180 / Math.PI;

    console.log(`[VISION] Capture from ${bot.username}`);
    console.log(`[VISION] Position: (${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)})`);
    console.log(`[VISION] Yaw: ${yaw.toFixed(2)}°, Pitch: ${pitch.toFixed(2)}°`);

    // 4. Puppeteerでスクリーンショット撮影
    browser = await puppeteer.launch({
      headless: true,  // ブラウザウィンドウを表示
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
    await page.evaluate((yaw, pitch, position) => {
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

      // 中央のラベル（背景付き） - 少し下にずらす
      const centerYawText = `Yaw: ${Math.floor(yaw)}°`;
      const centerYawMetrics = ctx.measureText(centerYawText);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(centerX + 5, height / 2 + 10, centerYawMetrics.width + 10, 40);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(centerYawText, centerX + 10, height / 2 + 42);

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

      // === 情報ボックス（左上、縦並び）===
      ctx.fillStyle = 'white';
      ctx.font = '24px monospace';

      const posStr = `Pos: ${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)}`;
      const yawInfoStr = `Yaw: ${Math.floor(yaw)}°`;
      const pitchInfoStr = `Pitch: ${Math.floor(pitch)}°`;

      // 背景ボックス
      const boxPadding = 10;
      const lineHeight = 35;
      const posMetrics = ctx.measureText(posStr);
      const yawInfoMetrics = ctx.measureText(yawInfoStr);
      const pitchInfoMetrics = ctx.measureText(pitchInfoStr);
      const maxWidth = Math.max(posMetrics.width, yawInfoMetrics.width, pitchInfoMetrics.width);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(10, 10, maxWidth + boxPadding * 2, lineHeight * 3 + boxPadding);

      // テキスト描画
      ctx.fillStyle = 'white';
      ctx.fillText(posStr, 20, 40);
      ctx.fillText(yawInfoStr, 20, 75);
      ctx.fillText(pitchInfoStr, 20, 110);

      document.body.appendChild(canvas);
    }, yaw, pitch, position);

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

    // Viewerをクローズ
    if (viewer && viewer.close) {
      viewer.close();
    }

    // bot.viewerは常にクリア（エラー時も確実に）
    bot.viewer = null;
    console.log('[VISION] Viewer closed');
  }
}

module.exports = {
  capture
};
