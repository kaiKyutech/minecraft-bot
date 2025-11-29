# Planner Bot - 使い方ガイド

## 基本的な使い方

### 1. スタンドアロンで実行（開発・実験用）

```bash
# .env ファイルを作成
cp .env.sample .env
# .env を編集して接続先を設定

# ボット起動
node planner_bot/index.js
```

デフォルトで whisper コマンドを自動処理します。

---

## 2. ライブラリとして使用

### パターンA: デフォルト動作（最もシンプル）

```javascript
const { createAIBot } = require('minecraft-bot/planner_bot/src/bot/ai_bot');

const bot = createAIBot(1, {
  host: 'localhost',
  port: 25565,
  username: 'MyBot',
  version: '1.20.1',
  aiBotCount: 1
});

// これだけで完全に動作！
// - !goal, !skill, !primitive などのコマンドを自動処理
// - 自然言語メッセージは 'newNaturalMessage' イベントが発火（会話履歴への追加は外部で制御）
```

### パターンB: LLM連携（カスタムハンドラー使用）

```javascript
const { createAIBot } = require('minecraft-bot/planner_bot/src/bot/ai_bot');
const { handleChatCommand } = require('minecraft-bot/planner_bot/src/commands');

const bot = createAIBot(1, {
  host: 'localhost',
  port: 25565,
  username: 'LLMBot',
  version: '1.20.1',
  aiBotCount: 1
}, {
  // 自然言語メッセージのカスタム処理
  onNaturalMessage: async (bot, username, message) => {
    // 会話履歴にユーザーメッセージを追加
    bot.addMessage(username, message, 'conversation');

    // LLMに会話履歴を送る
    const llmResponse = await queryLLM(bot.conversationHistory);

    // LLMがコマンドを返した場合は実行（ゲーム内からのコマンドと同じ挙動）
    if (llmResponse.startsWith('!')) {
      await handleChatCommand(bot, username, llmResponse, bot.stateManager);
      // コマンド実行結果は返り値で取得可能（会話履歴には自動保存されない）
      return;
    }

    // 普通の応答を送信
    bot.whisper(username, llmResponse);  // Mineflayer ネイティブ
    // または
    // await bot.speak(username, llmResponse);  // このプロジェクトのラッパー

    // LLM応答を会話履歴に追加
    bot.addMessage(bot.username, llmResponse, 'conversation');
  }
});

// コマンド（!goal など）は自動処理される
// 自然言語メッセージは LLM → コマンド変換 → 実行 の流れ
```

### パターンC: 完全カスタム（whisper を手動処理）

```javascript
const { createAIBot } = require('minecraft-bot/planner_bot/src/bot/ai_bot');
const { handleChatCommand } = require('minecraft-bot/planner_bot/src/commands');

const bot = createAIBot(1, {
  host: 'localhost',
  port: 25565,
  username: 'CustomBot',
  version: '1.20.1',
  aiBotCount: 1
}, {
  autoHandleWhisper: false  // 自動処理を無効化
});

// 完全にカスタム
bot.on('whisper', async (username, message) => {
  if (username === bot.username) return;

  bot.systemLog(`Whisper from ${username}: ${message}`);

  // コマンドは手動で処理
  if (message.startsWith('!')) {
    await handleChatCommand(bot, username, message, bot.stateManager);
    return;
  }

  // 完全にカスタムなロジック
  // ...
});
```

---

## 利用可能な機能

### コマンド

- `!goal <goal_name>` - GOAP プランニングでゴール達成
- `!skill <skill_name> [params]` - スキル直接実行
- `!primitive <primitive_name> [params]` - プリミティブ直接実行
- `!creative <action> [params]` - クリエイティブアクション実行
- `!status` - 現在の状態表示

### プロパティ

- `bot.stateManager` - 状態マネージャー（世界状態の取得・更新）
- `bot.conversationHistory` - 会話履歴配列（LLM連携用）
  - **このプロジェクト内では自動保存なし**: 完全に外部プロジェクト側で制御
  - **外部プロジェクトでの使用**: `bot.addMessage()` を使用して会話履歴を管理
  - **コマンド実行結果・エラー**: 会話履歴には保存せず、返り値で取得する設計
- `bot.systemLog(message)` - システムログ出力

### メソッド

- `bot.whisper(username, message)` - ゲーム内でwhisperを送信（Mineflayer ネイティブ）
  - 直接使用可能、同期的に送信

- `bot.speak(username, message)` - whisper送信のラッパー（このプロジェクト提供）
  - 内部で `bot.whisper()` を呼ぶ
  - 将来的な拡張（遅延、キュー、ログなど）を想定した抽象化
  - **どちらを使ってもOK**

- `bot.speakNearby(message, radius)` - 範囲内の全プレイヤーへwhisper送信
  - Minecraftセレクター構文 `/w @a[distance=..radius]` を使用
  - `message`: string - 送信するメッセージ
  - `radius`: number - 半径（ブロック単位、デフォルト15）
  - 使用例: `bot.speakNearby('みんな聞いて！', 20)` - 20ブロック以内の全員に送信

- `bot.addMessage(speaker, content, type)` - 会話履歴に手動追加（外部プロジェクト用）
  - `speaker`: string - 発言者名
  - `content`: string | Object - メッセージ内容
  - `type`: 'conversation' | 'system_info'
  - **使用例**:
    ```javascript
    // ユーザーメッセージを追加
    bot.addMessage(username, userMessage, 'conversation')
    // LLM応答を追加
    bot.addMessage(bot.username, llmResponse, 'conversation')
    // システム情報を追加
    bot.addMessage('system', { error: 'connection lost' }, 'system_info')
    ```
  - **このプロジェクト内では自動呼び出しなし**: 完全に外部プロジェクト側で制御

### イベント

- `'newNaturalMessage'` - 自然言語メッセージ受信時（onNaturalMessage を使わない場合）
  ```javascript
  bot.on('newNaturalMessage', ({ from, content, timestamp }) => {
    console.log(`Natural message from ${from}: ${content}`);
  });
  ```

---

## オプション詳細

### `createAIBot(id, config, options)`

**config (必須)**:
- `host`: string - サーバーホスト
- `port`: number - サーバーポート
- `username`: string - ボット名
- `version`: string | false - バージョン（false で自動検出）
- `aiBotCount`: number - ボット数（1の場合は番号なし）

**options (オプション)**:
- `autoHandleWhisper`: boolean - whisper 自動処理（デフォルト: true）
- `onNaturalMessage`: (bot, username, message) => Promise<void> - 自然言語ハンドラー

---

## 会話履歴の管理

### このプロジェクトでの設計方針

**会話履歴は完全に外部プロジェクト側で管理**

- ✅ このプロジェクト内では `bot.addMessage()` の自動呼び出しは一切なし
- ✅ コマンド実行結果・エラーは全て返り値で取得可能
- ✅ 外部プロジェクトが `bot.addMessage()` を使って会話履歴を完全制御

### 会話履歴管理の例

```javascript
// LLM連携プロジェクトでの典型的な使用例
onNaturalMessage: async (bot, username, message) => {
  // 1. ユーザーメッセージを履歴に追加
  bot.addMessage(username, message, 'conversation');

  // 2. LLMに会話履歴を送信
  const llmResponse = await queryLLM(bot.conversationHistory);

  // 3. LLM応答を履歴に追加
  bot.addMessage(bot.username, llmResponse, 'conversation');

  // 4. 応答を送信
  bot.whisper(username, llmResponse);
}
```

### コマンド実行結果の取得

```javascript
// コマンド実行結果は返り値で取得（会話履歴には保存されない）
const result = await handleChatCommand(bot, username, '!goal inventory.wooden_pickaxe:1', bot.stateManager);

if (result.success) {
  console.log('Goal completed:', result.goal);
} else {
  console.log('Goal failed:', result.error);
  console.log('Missing:', result.missingPreconditions);
}
```

---

## 推奨される使い方

### 開発・実験
→ **パターンA（デフォルト動作）** を使用

### LLM連携
→ **パターンB（onNaturalMessage）** を使用
  - コマンド処理は自動
  - LLMロジックだけに集中できる

### 高度なカスタマイズ
→ **パターンC（autoHandleWhisper: false）** を使用
  - 完全な制御が必要な場合のみ

---

## トラブルシューティング

### ログが重複する

**原因**: 外部プロジェクトで `bot.on('whisper')` を追加している

**解決策**: `autoHandleWhisper: false` を使用するか、whisper リスナーを削除する

### stateManager が undefined

**原因**: 古いバージョンの `createAIBot` を使用している

**解決策**: 最新版では `bot.stateManager` で自動的にアクセス可能
