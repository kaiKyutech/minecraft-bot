# Minecraft Bot with GOAP

Mineflayerベースのマインクラフトボット。GOAP（Goal-Oriented Action Planning）による自動プランニングと実行機能を備えています。
※このプロジェクトはclaude codeを使用しています。

## 概要

このプロジェクトは、目標を指定するだけで必要なアクションを自動的に計画・実行するマインクラフトボットです。LLMプロジェクトからライブラリとして使用することを想定して設計されており、Claude/GPT-4などのAIエージェントのツールとして機能します。

### 主な特徴

- **GOAP自動プランニング**: 目標状態を指定すると、必要なアクションシーケンスを自動生成
- **リアクティブ再プランニング**: 実行中に失敗した場合、自動的に新しいプランを生成
- **循環参照検出**: 無限ループを防ぐ安全機構
- **会話履歴管理**: LLMプロジェクトでの使用を想定した構造化された会話ログ
- **ライブラリとして使用可能**: 他のプロジェクトから直接関数呼び出し可能

## できること

### 1. GOAP自動プランニング（`!goal`）
```
/w Bot1 !goal inventory.wooden_pickaxe:1
```
木のつるはしを作成するために必要なすべてのステップを自動実行：
1. 近くの木を探す
2. 木を伐採
3. 原木を板に変換
4. 板から棒を作成
5. 作業台を作成
6. 木のつるはしをクラフト

### 2. ナビゲーション（`!navigation`）
- **場所の登録**: `!navigation register {"name": "home"}`
- **座標指定で登録**: `!navigation register {"name": "mine", "coords": [100, 64, 200]}`
- **登録した場所へ移動**: `!navigation goto {"name": "home"}`
- **方向指定で移動**: `!navigation moveInDirection {"yaw": 90, "distance": 10}`
- **プレイヤー追跡**: `!navigation follow {"username": "player1"}`

### 3. 情報取得（`!info`）
- **スクリーンショット**: `!info vision {}`
  - Base64画像データを返却（LLM Vision APIに直接送信可能）
  - Yaw/Pitch情報付き
- **周辺ブロックスキャン**: `!info scanBlocks {"range": 32}`
  - 高速な環境探索
  - 鉱石や構造物の位置を特定

### 4. チェスト操作
```
!navigation chestOpen {"coords": [100, 64, 200]}
!navigation chestDeposit {"item": "cobblestone", "count": 10}
!navigation chestWithdraw {"item": "iron_ingot", "count": 5}
!navigation chestClose {}
```

### 5. その他
- **スキル実行**: `!skill gatherWood {"count": 10}`
- **プリミティブ操作**: `!primitive moveTo {"x": 100, "y": 64, "z": 200}`
- **ステータス確認**: `!status`
- **緊急停止**: `!stop`

## セットアップ

### 1. インストール

```bash
npm install
```

### 2. 環境変数の設定（オプション）

```bash
# .env.local（または環境変数で設定）
MC_HOST=localhost
MC_PORT=25565
MC_USERNAME=PlannerBot
MC_VERSION=false  # 自動検出
PLANNER_DEBUG=1   # デバッグログ有効化（オプション）
```

### 3. ボットの起動

#### プランナーボット（GOAP機能付き）
```bash
node planner_bot/index.js
```

#### シンプルボット（テスト用）
```bash
node test.js
```

## LLMプロジェクトでの使用

### ライブラリとして使用

```javascript
const { createAIBot } = require('./planner_bot/src/bot/ai_bot');
const { handleChatCommand } = require('./planner_bot/src/commands');
const createStateManager = require('./planner_bot/src/planner/state_manager');

// ボット作成
const bot = createAIBot(1, {
  host: 'localhost',
  port: 25565,
  username: 'ClaudeBot',
  version: false
});

const stateManager = createStateManager();

bot.once('spawn', async () => {
  // GOAPでアイテムを作成
  await handleChatCommand(bot, 'system', '!goal inventory.wooden_pickaxe:1', stateManager);

  // スクリーンショット取得
  const result = await handleChatCommand(bot, 'system', '!info vision {}', stateManager);
  const base64Image = result.data.image;

  // Claude Vision APIに送信
  // ... LLM処理
});
```

### 自然言語メッセージの即時通知

```javascript
bot.on('newNaturalMessage', async (data) => {
  console.log(`[NEW MESSAGE] ${data.from}: ${data.content}`);

  // LLMで処理
  const response = await processWithLLM(data.content, bot);

  // 返答を送信
  await handleChatCommand(
    bot,
    'system',
    `!chat ${data.from} ${response}`,
    stateManager
  );
});
```

### 会話履歴の取得

```javascript
// 会話メッセージのみ取得（システム情報を除外）
const history = bot.getConversationHistory({ type: 'conversation' });

// 新しいメッセージのみ取得（sequence番号で追跡）
const newMessages = history.filter(msg => msg.sequence > lastProcessedSequence);
```

## アーキテクチャ

```
┌─────────────────────────────────────┐
│  LLMプロジェクト（別リポジトリ）      │
│  - Claude / GPT-4 Vision            │
│  - 戦略的判断・意思決定              │
├─────────────────────────────────────┤
│  ↓ 直接関数呼び出し                  │
├─────────────────────────────────────┤
│  planner_bot (このプロジェクト)       │
│  - GOAP自動プランニング              │
│  - スキル・プリミティブ実行           │
│  - 環境認識・情報取得                │
└─────────────────────────────────────┘
```

### 3層アーキテクチャ

1. **GOAPレイヤー**: 決定的なタスク自動化（クラフト、近くの資源採集）
2. **Creative Actionsレイヤー**: 非決定的なタスク（探索、ナビゲーション、建築）
3. **LLM統合レイヤー（外部）**: 戦略的意思決定

## ドキュメント

- **[doc/planner_bot/API.md](doc/planner_bot/API.md)**: 詳細なAPIリファレンス

## 技術スタック

- **Mineflayer** (v4.33.0): Minecraftボットフレームワーク
- **mineflayer-pathfinder**: パスファインディング
- **Node.js**: JavaScript実行環境
