# Planner Bot - アーキテクチャ

**最終更新**: 2025-10-19

このドキュメントは各システムの設計思想とフローを記述します。
使い方については [API.md](./API.md)、実装状況は [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) を参照してください。

---

## 目次

- [全体構成](#全体構成)
- [ボット起動フロー](#ボット起動フロー)
- [GOAP システム](#goap-システム)
- [Creative Actions](#creative-actions)
- [視覚システム (Observer Pool)](#視覚システム-observer-pool)
- [会話履歴システム](#会話履歴システム)
- [ログシステム](#ログシステム)

---

## 全体構成

### ボット種類

```
┌─────────────────────────────────────┐
│  Planner Bot Process                │
│                                     │
│  ┌─────────────┐  ┌──────────────┐ │
│  │  AI Bot #1  │  │ Camera-Bot#1 │ │
│  │  AI Bot #2  │  │ Camera-Bot#2 │ │
│  │  AI Bot #3  │  │ Camera-Bot#3 │ │
│  └─────────────┘  └──────────────┘ │
│                                     │
│  ┌─────────────────────────────────┐│
│  │     Observer Pool               ││
│  │  (Camera-Bot管理)               ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

- **AI Bot**: GOAP + Creative Actions でタスク実行
- **Camera-Bot**: prismarine-viewer 起動し、AI Bot の視点でスクリーンショット撮影
- **Observer Pool**: Camera-Bot のプール管理、リクエストキューイング

### 設定

`.env` ファイルで起動するボット数を設定:

```bash
AI_BOT_COUNT=3        # AI Bot数
CAMERA_COUNT=3        # Camera-Bot数
```

---

## ボット起動フロー

```
planner_bot/index.js
    │
    ├─ loadConfig()          # .env読み込み
    │
    ├─ createObserverPool()  # Observer Pool初期化
    │
    ├─ createAIBots()        # AI Bot起動 (AI_BOT_COUNT体)
    │   └─ createAIBot()
    │       ├─ mineflayer.createBot()
    │       ├─ addLoggingSystem()        # ログ・履歴システム追加
    │       ├─ setupSkillSystem()        # スキル登録
    │       ├─ setupPrimitives()         # プリミティブ登録
    │       ├─ setupCreativeActions()    # Creative Actions登録
    │       └─ setupEventHandlers()      # イベントハンドラ登録
    │           ├─ on('spawn')
    │           └─ on('whisper')         # コマンド処理
    │
    └─ createCameraBots()    # Camera-Bot起動 (CAMERA_COUNT体)
        └─ createCameraBot()
            ├─ mineflayer.createBot()
            └─ Observer Pool に登録
```

---

## GOAP システム

### 概要

**GOAP (Goal-Oriented Action Planning)** は A* アルゴリズムを使って目標達成のための最適なアクションシーケンスを自動生成します。

### コンポーネント

```
┌─────────────────────────────────────────────┐
│  GOAP Planner                               │
│                                             │
│  Input:                                     │
│    - Current State (現在の状態)             │
│    - Goal State (目標状態)                  │
│    - Available Actions (利用可能なアクション) │
│                                             │
│  Output:                                    │
│    - Action Sequence (アクション列)         │
│                                             │
│  Algorithm: A* with heuristic cost         │
└─────────────────────────────────────────────┘
```

### フロー

```
1. ユーザーが !goal コマンドを送信
   │
   v
2. State Manager が現在の状態を収集
   │  ├─ インベントリ (bot.inventory)
   │  ├─ 周辺ブロック (bot.findBlocks)
   │  └─ 装備 (bot.entity.equipment)
   │
   v
3. State Builder がYAMLスキーマに従って状態を構築
   │  (config/state_schema.yaml)
   │
   v
4. GOAP Planner がアクション列を生成
   │  (A* pathfinding)
   │
   v
5. アクション実行ループ
   │  ├─ 前提条件チェック
   │  │    ├─ OK → アクション実行
   │  │    └─ NG → リプランニング
   │  │
   │  └─ 効果を状態に反映
   │
   v
6. 目標達成 or 失敗
```

### アクション定義

アクションは YAML ファイルで定義:

```yaml
# config/actions/gather_actions.yaml 例
- name: gather_oak_log
  cost: 10
  preconditions:
    nearby_oak_log: true
  effects:
    inventory_oak_log: 1
  skill: gather
  skill_params:
    target: oak_log
    count: 1
```

- **preconditions**: アクション実行前に満たすべき条件
- **effects**: アクション実行後に状態に反映される変化
- **skill**: 実際に実行するスキル関数
- **cost**: プランニング時のコスト (低いほど優先)

### リプランニング

実行中にアイテムをドロップした場合など、前提条件が崩れた場合は自動的に再計画:

```
Action: craft_sticks
  │
  ├─ Preconditions check:
  │    - inventory_oak_planks >= 2
  │
  ├─ 前提条件が満たされない
  │    (アイテムが落ちた等)
  │
  v
Replanning...
  │
  ├─ 現在の状態を再取得
  │
  ├─ 新しいプランを生成
  │    (gather_oak_log から始まる)
  │
  v
新しいプラン実行
```

### 診断システム

失敗時に詳細な診断情報を表示:

```
目標を実行できません:
プラン生成に失敗しました

診断:
  現在の状態:
    inventory_oak_log: 0
    nearby_oak_log: false

  目標状態:
    inventory_wooden_pickaxe: 1

  欠けている前提条件:
    - nearby_oak_log が必要ですが false です

  提案:
    - oak_log を探してください
```

---

## Creative Actions

### 概要

GOAP では扱えない「探索」「建築」「視覚」などの創造的な行動を実装するカテゴリです。

### 構成

```
src/creative_actions/
  ├─ navigation.js    # ナビゲーション (場所登録、移動)
  ├─ vision.js        # 視覚 (スクリーンショット、Observer Pool連携)
  ├─ exploration.js   # 探索 (未実装)
  └─ building.js      # 建築 (未実装)
```

### Navigation アクション

```
┌──────────────────────────────────────┐
│  Named Locations (bot._namedLocations) │
│                                      │
│  {                                   │
│    "home": { x: 100, y: 64, z: 200 } │
│    "mine": { x: 50, y: 32, z: 150 }  │
│  }                                   │
└──────────────────────────────────────┘
         │                    │
         v                    v
    register()            goto()
    gotoCoords()          list()
```

- **register**: 現在地を名前付きで保存
- **goto**: 保存した場所に移動 (mineflayer-pathfinder 使用)
- **gotoCoords**: 座標指定で移動
- **list**: 保存済み場所一覧

### Vision アクション

```
┌─────────────────────────────────────┐
│  AI Bot                             │
│  - 現在位置                         │
│  - 視線方向 (yaw, pitch)            │
└─────────────────────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│  Observer Pool                      │
│  - Camera-Bot割り当て               │
│  - リクエストキューイング           │
└─────────────────────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│  Camera-Bot                         │
│  - AI Botの位置にTP                 │
│  - 視線方向設定                     │
│  - prismarine-viewer起動            │
└─────────────────────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│  Puppeteer                          │
│  - ブラウザ起動                     │
│  - スクリーンショット撮影           │
│  - Base64データ取得                 │
└─────────────────────────────────────┘
              │
              v
        画像データ返却
```

- **capture**: 現在視点のスクリーンショット
- **captureDirection**: 指定方向のスクリーンショット
- **capturePanorama**: 4方向 (N, E, S, W) のパノラマ撮影
- **stats**: Observer Pool統計情報

---

## 視覚システム (Observer Pool)

### 設計思想

AI Bot が直接 prismarine-viewer を起動すると負荷が高いため、専用の **Camera-Bot** を用意してプール管理します。

### Observer Pool の役割

```
┌─────────────────────────────────────┐
│  Observer Pool                      │
│                                     │
│  - Camera-Bot 登録管理              │
│  - リクエストキューイング           │
│  - Camera-Bot 割り当て              │
│  - 統計情報収集                     │
└─────────────────────────────────────┘
```

### リクエストフロー

```
AI Bot: capture()
    │
    v
Observer Pool: requestCamera()
    │
    ├─ 空きCamera-Botあり
    │   └─> 即座に割り当て
    │
    └─ 空きCamera-Botなし
        └─> キュー待機
            └─> 空きができたら処理
```

### Camera-Bot の責務

```
1. prismarine-viewer 起動
   │
   v
2. AI Botの位置にTP
   │  /tp @s x y z yaw pitch
   │
   v
3. Puppeteer でスクリーンショット撮影
   │  - ブラウザ起動
   │  - 指定URL (http://localhost:3000) にアクセス
   │  - オーバーレイ描画 (位置・方角情報)
   │  - スクリーンショット
   │
   v
4. Base64データ取得
   │
   v
5. Observer Pool に返却
   │
   v
6. AI Bot に画像データ返却
```

### 統計情報

Observer Pool は以下の統計を収集:

```javascript
{
  total: 3,                    // Camera-Bot総数
  available: 2,                // 空きCamera-Bot数
  busy: 1,                     // 使用中Camera-Bot数
  queueLength: 0,              // キュー待ちリクエスト数
  requestsProcessed: 42,       // 処理済みリクエスト数
  averageWaitTime: 0.3         // 平均待機時間 (秒)
}
```

---

## 会話履歴システム

### 設計思想

将来的に LLM を統合する際、複数のボットと複数のプレイヤーが協調して会話できるように、**全員の発言を時系列で保存**します。

### データ構造

```javascript
bot.conversationHistory = [
  {
    speaker: "PlayerA",
    role: "user",
    content: "木を切ってきて",
    type: "natural_language",
    timestamp: 1609459200000
  },
  {
    speaker: "AI_Bot_1",
    role: "assistant",
    content: "目標を実行できません",
    type: "system_info",
    timestamp: 1609459201000
  },
  {
    speaker: "PlayerB",
    role: "user",
    content: "石を集めて",
    type: "natural_language",
    timestamp: 1609459202000
  }
]
```

### メッセージタイプ

- **natural_language**: 自然言語メッセージ (! で始まらない)
- **bot_response**: ボットの発話 (LLM 応答)
- **system_info**: システム情報 (GOAP エラー、診断情報)

### Role の決定

```javascript
const role = speaker === bot.username ? 'assistant' : 'user'
```

- **assistant**: ボット自身の発言
- **user**: それ以外の全員 (プレイヤー、他ボット)

### FIFO (100メッセージ上限)

```javascript
bot.conversationHistory.push(messageObj)

if (bot.conversationHistory.length > 100) {
  bot.conversationHistory.shift()  // 古いメッセージを削除
}
```

### フィルタリング

```javascript
// 特定ユーザーの発言のみ
bot.getConversationHistory({ username: "PlayerA" })

// 複数ユーザーの発言
bot.getConversationHistory({ usernames: ["PlayerA", "PlayerB"] })

// 特定タイプの発言
bot.getConversationHistory({ type: "natural_language" })
```

### whisper イベントフロー

```
bot.on('whisper', async (username, message) => {
    │
    ├─ message.startsWith('!')
    │   │
    │   ├─ YES: コマンド処理
    │   │   └─> handleChatCommand()
    │   │       (履歴には追加しない)
    │   │
    │   └─ NO: 自然言語メッセージ
    │       └─> bot.addMessage(username, message, 'natural_language')
    │           (履歴に追加)
    │
    v
})
```

---

## ログシステム

### 設計思想

ログ出力、MC チャット、会話履歴を**完全に分離**します。

### 3つの関数

```javascript
// 1. コンソール出力のみ
bot.systemLog(message)
  └─> console.log(`[${bot.username}] ${message}`)

// 2. MC whisper送信のみ
bot.speak(username, message)
  └─> bot.whisper(username, message)

// 3. 会話履歴追加のみ (自動でコンソール出力)
bot.addMessage(speaker, content, type)
  └─> bot.conversationHistory.push(messageObj)
  └─> console.log(`[${bot.username}] [HISTORY_ADD] ${JSON.stringify(messageObj)}`)
```

### 使い分け

| 用途                       | 使用関数         |
|----------------------------|------------------|
| デバッグログ               | `systemLog()`    |
| GOAPプラン表示             | `systemLog()`    |
| ユーザーへの通知 (MC)      | `speak()`        |
| LLM用の会話履歴記録        | `addMessage()`   |
| GOAP診断情報の記録         | `addMessage()`   |

### 例: GOAPコマンドの処理

```javascript
// planner_bot/src/commands/goal_command.js

// プランニング開始
bot.systemLog(`Planning for goal: ${goalName}`)  // コンソールのみ

// 失敗時の診断
const diagnostics = generateDiagnostics(...)
const fullMessage = `目標を実行できません:\n${reason}\n\n診断:\n${diagnostics}`

bot.systemLog(fullMessage)                      // コンソール出力
bot.addMessage(bot.username, fullMessage, 'system_info')  // 履歴記録
```

---

## 関連ドキュメント

- [API.md](./API.md) - 使い方・コマンドリファレンス
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - 実装状況チェックリスト
- [ISSUES.md](./ISSUES.md) - 現在の課題・未解決問題
