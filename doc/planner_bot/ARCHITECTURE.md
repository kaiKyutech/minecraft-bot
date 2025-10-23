# Planner Bot - アーキテクチャ

**最終更新**: 2025-10-24

このドキュメントは各システムの設計思想とフローを記述します。
使い方については [API.md](./API.md)、実装状況は [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) を参照してください。

---

## 目次

- [全体構成](#全体構成)
- [ボット起動フロー](#ボット起動フロー)
- [GOAP システム](#goap-システム)
- [Creative Actions](#creative-actions)
- [視覚システム](#視覚システム)
- [会話履歴システム](#会話履歴システム)
- [ログシステム](#ログシステム)

---

## 全体構成

### ボット種類

```
┌─────────────────────────────────────┐
│  Planner Bot Process                │
│                                     │
│  ┌─────────────┐                   │
│  │  AI Bot #1  │                   │
│  │  AI Bot #2  │                   │
│  │  AI Bot #3  │                   │
│  └─────────────┘                   │
│                                     │
└─────────────────────────────────────┘
```

- **AI Bot**: GOAP + Creative Actions でタスク実行
- 各AI Botが必要に応じて prismarine-viewer を起動してスクリーンショット撮影

### 設定

`.env` ファイルで起動するボット数を設定:

```bash
AI_BOT_COUNT=3        # AI Bot数
```

---

## ボット起動フロー

```
planner_bot/index.js
    │
    ├─ loadConfig()          # .env読み込み
    │
    └─ createAIBots()        # AI Bot起動 (AI_BOT_COUNT体)
        └─ createAIBot()
            ├─ mineflayer.createBot()
            ├─ addLoggingSystem()        # ログ・履歴システム追加
            ├─ setupSkillSystem()        # スキル登録
            ├─ setupPrimitives()         # プリミティブ登録
            ├─ setupCreativeActions()    # Creative Actions登録
            └─ setupEventHandlers()      # イベントハンドラ登録
                ├─ on('spawn')           # 起動時にコマンド例を表示
                └─ on('whisper')         # コマンド処理
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

GOAP では扱えない「探索」「建築」「視覚」「追跡」などの創造的な行動を実装するカテゴリです。

### 構成

```
src/creative_actions/
  ├─ navigation.js    # ナビゲーション (場所登録、移動、追跡)
  ├─ vision.js        # 視覚 (スクリーンショット)
  ├─ exploration.js   # 探索 (未実装)
  └─ building.js      # 建築 (未実装)
```

### Navigation アクション

```
┌──────────────────────────────────────┐
│  Named Locations (stateManager)      │
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
    follow()              stopFollow()
```

- **register**: 現在地を名前付きで保存
- **goto**: 保存した場所に移動 (mineflayer-pathfinder 使用)
- **gotoCoords**: 座標指定で移動
- **list**: 保存済み場所一覧
- **follow**: プレイヤーを追跡（3ブロック距離を保つ）
- **stopFollow**: 追跡停止

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
│  vision.capture()                   │
│  - 動的ポート取得 (get-port)        │
│  - prismarine-viewer起動            │
│  - 視線方向設定 (bot.look)          │
└─────────────────────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│  Puppeteer                          │
│  - ブラウザ起動 (headless)          │
│  - スクリーンショット撮影           │
│  - オーバーレイ描画                 │
└─────────────────────────────────────┘
              │
              v
┌─────────────────────────────────────┐
│  後処理                             │
│  - Base64データ取得                 │
│  - ファイル保存                     │
│  - Viewer/Browser クローズ          │
└─────────────────────────────────────┘
```

- **capture**: 現在視点のスクリーンショット（yaw/pitch指定可能）
- 必要な時だけViewerを起動し、撮影後は即座にクローズ
- 動的ポート割り当てで複数ボット同時撮影可能

---

## 視覚システム

### 設計思想の変遷

**旧設計（Observer Pool）:**
- 専用のCamera-Botを用意してプール管理
- 複数AI Botで共有する設計
- 300AI Botが頻繁にスクリーンショットを撮る想定

**現在の設計（シンプル化）:**
- AI Bot自身が必要な時だけViewerを起動
- スクリーンショットは数秒〜数分に1回程度
- リソース共有は不要（YAGNI原則）

### 実装詳細

```javascript
async function capture(bot, stateManager, params) {
  // 1. 動的ポート取得
  const port = await getPort()

  // 2. Viewer起動
  const viewer = mineflayerViewer(bot, { port, firstPerson: true })

  // 3. 視線方向設定（オプション）
  if (params.yaw !== undefined || params.pitch !== undefined) {
    await bot.look(yawRadians, pitchRadians, true)
  }

  // 4. Puppeteerでスクリーンショット
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`http://localhost:${port}`)

  // 5. オーバーレイ描画
  await page.evaluate((yaw, pitch, position, targetInfo) => {
    // Canvas描画: ヒートマップ、ターゲットサークル、座標情報
  })

  const screenshot = await page.screenshot({ encoding: 'base64' })

  // 6. クリーンアップ
  await browser.close()
  viewer.close()
  bot.viewer = null

  return { image: screenshot, ... }
}
```

### オーバーレイ情報

**左上情報ボックス:**
- `Pos: x, y, z`
- `Yaw: 90°`
- `Pitch: 10°`
- `Target: oak_log at (130, 64, -50)` （視線先ブロック）

**Yaw視野ガイド:**
- 画面左端（青）: 現在Yaw + 60°
- 画面中央（白）: 現在Yaw
- 画面右端（赤）: 現在Yaw - 60°

**ターゲットサークル（緑）:**
- 画面中央に十字線とサークル
- 視線先ブロック情報を表示（`bot.blockAtCursor(256)`）

### 座標系

- **Yaw**: 北=0°, 反時計回り（西=90°, 南=180°, 東=270°）
- **Pitch**: 0°=水平, マイナス=上, プラス=下

**注意**: Mineflayer公式ドキュメント（東=0°）とは異なる実測値

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

## 将来の拡張計画

### topDownMap（俯瞰ヒートマップ）

周囲の地形を俯瞰視点でヒートマップ画像として生成する機能。

**仕様:**
- 相対高度を色で表現（赤=高い、緑=同じ、青=低い）
- 重要オブジェクトをマーク（🌲木、⚙️建材、"Stone"）
- 常に北が上、グリッド線で座標表示
- ボット位置を中央の×印で表示

**技術課題:**
- ブロックのクラスタリング
- Canvas での絵文字/テキスト描画
- パフォーマンス最適化

詳細は [API.md - topDownMap](./API.md#topdownmap) を参照。

---

## 関連ドキュメント

- [API.md](./API.md) - 使い方・コマンドリファレンス
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - 実装状況チェックリスト
- [ISSUES.md](./ISSUES.md) - 現在の課題・未解決問題
