/**
 * LLMハンドラー
 * ユーザーメッセージを受け取り、LLMに送信
 */

const { buildFullPrompt } = require('./prompt_builder');
const llmClient = require('./client');

/**
 * !status の出力を取得
 * @param {Object} bot - Mineflayerボット
 * @param {Object} stateManager - 状態マネージャー
 * @returns {Promise<string>} status情報の文字列
 */
async function getStatusInfo(bot, stateManager) {
  const worldState = await stateManager.getState(bot);
  const { buildState } = require('../planner/state_builder');
  const goapState = buildState(worldState);

  const lines = [];

  lines.push('=== 現在の状況 ===');

  // Position
  if (worldState.position) {
    const pos = worldState.position;
    lines.push(`位置: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`);
  }

  // Time
  lines.push(`時間: ${worldState.isDay ? '昼' : '夜'}`);

  // Inventory
  const inventory = worldState.inventory?.counts || {};
  const inventoryItems = Object.keys(inventory);

  if (inventoryItems.length === 0) {
    lines.push('インベントリ: 空');
  } else {
    const tools = inventoryItems.filter(name =>
      name.includes('pickaxe') || name.includes('axe') ||
      name.includes('sword') || name.includes('shovel') || name.includes('hoe')
    );
    const materials = inventoryItems.filter(name => !tools.includes(name));

    if (tools.length > 0) {
      const toolList = tools.map(t => `${t} x${inventory[t]}`).join(', ');
      lines.push(`道具: ${toolList}`);
    }

    if (materials.length > 0) {
      const materialList = materials.map(m => `${m} x${inventory[m]}`).join(', ');
      lines.push(`素材: ${materialList}`);
    }
  }

  // Nearby resources and structures
  const nearbyResources = [];
  const nearbyStructures = [];

  for (const [key, value] of Object.entries(goapState)) {
    if (key.startsWith('nearby_') && value === true) {
      const resourceName = key.replace('nearby_', '');
      if (resourceName.includes('workbench') || resourceName.includes('furnace')) {
        nearbyStructures.push(resourceName);
      } else {
        nearbyResources.push(resourceName);
      }
    } else if (key.startsWith('visible_') && value === true) {
      const resourceName = key.replace('visible_', '');
      if (!nearbyStructures.includes(resourceName)) {
        nearbyStructures.push(resourceName + '(visible)');
      }
    }
  }

  if (nearbyResources.length > 0) {
    lines.push(`近くのリソース: ${nearbyResources.join(', ')}`);
  } else {
    lines.push('近くのリソース: なし');
  }

  if (nearbyStructures.length > 0) {
    lines.push(`構造物: ${nearbyStructures.join(', ')}`);
  } else {
    lines.push('構造物: なし');
  }

  // Registered locations (将来実装用 - v0.1ではコメントアウト)
  // const locations = stateManager.getLocations();
  // const locationNames = Object.keys(locations);
  // if (locationNames.length > 0) {
  //   const locList = locationNames.map(name => {
  //     const loc = locations[name];
  //     return `${name}(${loc.x},${loc.y},${loc.z})`;
  //   }).join(', ');
  //   lines.push(`登録済みの場所: ${locList}`);
  // } else {
  //   lines.push('登録済みの場所: なし');
  // }

  lines.push('---');
  lines.push('システム: !goal (GOAP)');
  lines.push('GOAP: 素材が近くにあるときに自動実行');
  // lines.push('Creative: ナビゲーション（場所の登録・移動）'); // v0.1では未使用

  return lines.map(line => `    ${line}`).join('\n');
}

/**
 * ユーザーメッセージを処理
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - ユーザー名
 * @param {string} message - ユーザーメッセージ
 * @param {Object} stateManager - 状態マネージャー
 * @param {Object} context - コンテキスト（履歴、前回結果など）
 * @param {AbortSignal} signal - キャンセル用シグナル（オプション）
 */
async function handleUserMessage(bot, username, message, stateManager, context, signal = null) {
  console.log(`\n[LLM_HANDLER] Received message from ${username}: "${message}"`);

  // 1. !status を自動実行（出力はしない）
  console.log('[LLM_HANDLER] Getting status info...');
  const statusInfo = await getStatusInfo(bot, stateManager);

  // 2. プロンプトを生成
  console.log('[LLM_HANDLER] Building prompt...');
  const { systemPrompt, userPrompt } = buildFullPrompt(
    statusInfo,
    context.lastCommandResult || null,
    context.chatHistory || []
  );

  // 3. プロンプト表示（常時表示）
  console.log('\n' + '='.repeat(80));
  console.log('SYSTEM PROMPT:');
  console.log('='.repeat(80));
  console.log(systemPrompt);
  console.log('\n' + '='.repeat(80));
  console.log('USER PROMPT:');
  console.log('='.repeat(80));
  console.log(userPrompt);
  console.log('='.repeat(80) + '\n');

  // 4. LLM APIを呼び出す
  try {
    const { thought, speech, command } = await llmClient.generateResponse(systemPrompt, userPrompt);

    // speechをチャットに送信（改行で分割して複数メッセージとして送信）
    const speechLines = speech.split('\n').filter(line => line.trim() !== '');
    for (const line of speechLines) {
      await bot.chatWithDelay(line);
    }

    // 会話履歴にBotの発話を追加
    const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    context.chatHistory.push(`[${timestamp}] <Bot> ${speech}`);

    // commandがあれば実行
    if (command && command !== 'null') {
      const goalCommand = convertToGoalCommand(command);
      const handleGoalCommand = require('../commands/goal_command');

      console.log(`[LLM_HANDLER] Executing command: !goal ${goalCommand}`);

      try {
        // signalを goal_command に渡す
        await handleGoalCommand(bot, goalCommand, stateManager, signal);
        // 成功時は結果をcontextに保存（具体的なゴール名を含める）
        context.lastCommandResult = `${command} の作成を完了しました`;
        console.log('[LLM_HANDLER] Command succeeded');

        // チャットに表示
        await bot.chatWithDelay(context.lastCommandResult);
      } catch (error) {
        // キャンセルエラーの場合は再スロー
        if (error.name === 'AbortError') {
          throw error;
        }
        // 失敗時はエラーメッセージをcontextに保存
        context.lastCommandResult = `${command} の作成に失敗しました: ${error.message || String(error)}`;
        console.error('[LLM_HANDLER] Command failed:', context.lastCommandResult);

        // チャットに表示
        await bot.chatWithDelay(context.lastCommandResult);
      }

      // システムメッセージを会話履歴に追加
      context.chatHistory.push(`[${timestamp}] <System> ${context.lastCommandResult}`);

      // コマンド実行後、自動的に次のアクションをLLMに決めさせる
      console.log('[LLM_HANDLER] Command completed, asking LLM for next action...');
      // signalを再帰呼び出しにも渡す
      await handleUserMessage(bot, 'System', '', stateManager, context, signal);
    } else {
      // コマンドなしの場合は会話のみ
      context.lastCommandResult = null; // リセット
    }

    // 直近50件に制限
    if (context.chatHistory.length > 50) {
      context.chatHistory = context.chatHistory.slice(-50);
    }

    console.log('[LLM_HANDLER] Processing completed successfully');

  } catch (error) {
    console.error('[LLM_HANDLER] Error:', error.message);
    await bot.chatWithDelay(`エラーが発生しました: ${error.message}`);
  }
}

/**
 * コマンドを変換（将来実装）
 * @param {string} command - LLMからのコマンド（例: "iron_ingot:1"）
 * @returns {string} GOAPコマンド（例: "inventory.iron_ingot:1"）
 */
function convertToGoalCommand(command) {
  // 正規表現: アイテム名:個数
  const match = command.match(/^(\w+):(\d+)$/);
  if (!match) {
    throw new Error(`Invalid command format: ${command}`);
  }

  const [, itemName, count] = match;
  return `inventory.${itemName}:${count}`;
}

module.exports = {
  handleUserMessage,
  getStatusInfo,
  convertToGoalCommand
};
