# Planner Bot - 実装状況

このドキュメントはPlanner Botの現在の実装状況を開発者向けにまとめたものです。

**最終更新**: 2025-10-19

---

## 目次

- [アーキテクチャ概要](#アーキテクチャ概要)
- [GOAP システム](#goap-システム)
- [Creative アクション](#creative-アクション)
- [視覚システム (Observer Pool)](#視覚システム-observer-pool)
- [会話履歴システム](#会話履歴システム)
- [未実装機能](#未実装機能)

---

## アーキテクチャ概要

### ボット構成

```
┌─────────────────────────────────────────┐
│          1つのプロセス                     │
│  (node planner_bot/index.js)            │
├─────────────────────────────────────────┤
│                                         │
│  AI Bot 1, 2, 3, ..., N                │
│    ├─ GOAP Planner                     │
│    ├─ Skills                           │
│    ├─ Primitives                       │
│    ├─ State Manager                    │
│    └─ Conversation History             │
│                                         │
│  Camera-Bot 1, 2, ..., M               │
│    └─ prismarine-viewer                │
│                                         │
│  Observer Pool                          │
│    └─ Camera-Bot Pool Manager          │
│       └─ Puppeteer Browsers            │
└─────────────────────────────────────────┘
```

### ボット数の設定

`.env`ファイルで設定：
```env
AI_BOT_COUNT=5        # AI Bot数（デフォルト: 1）
CAMERA_COUNT=1        # Camera-Bot数（デフォルト: 1）
```

**想定スケール**:
- AI Bot: 1〜300体程度
- Camera-Bot: 1〜10体程度
- Camera-BotはAI Bot間で共有（プーリング）

---

## GOAP システム

### 実装状況: ✅ 完成

#### コア機能

| 機能 | 状態 | 説明 |
|------|------|------|
| A* プランニング | ✅ | 目標状態から逆算してアクションシーケンスを生成 |
| 状態管理 | ✅ | インベントリ、周辺環境、装備状態を管理 |
| アクション定義 | ✅ | YAML形式で600+のアクションを定義 |
| スキルシステム | ✅ | gather, craft, equipなどの高レベル行動 |
| プリミティブ | ✅ | moveTo, digBlock, craftItemなどの低レベル操作 |
| リプランニング | ✅ | 実行失敗時に自動で再計画 |
| 診断システム | ✅ | 失敗時に不足している材料や条件を表示 |

#### アクション定義ファイル

- `config/actions/gather_actions.yaml` - リソース採集
- `config/actions/hand_craft_actions.yaml` - 手持ちクラフト
- `config/actions/workbench_craft_actions.yaml` - 作業台クラフト
- `config/actions/movement_actions.yaml` - 移動・設置

#### 状態管理

- `config/state_schema.yaml` - 全状態変数の定義
- `config/block_categories.yaml` - ブロック分類（logs, planks, stonesなど）

#### コマンド

```
!goal inventory.wooden_pickaxe:1
!goal inventory.diamond_sword:1
!goal inventory.oak_planks:10
```

### 制限事項

- ブロック設置の座標計算が不完全（pathfinder障害物問題）
- 遠距離移動時のチャンクロード待機なし
- 敵対Mobとの戦闘アクションなし

---

## Creative アクション

GOAPで扱えない創造的な行動を提供。

### Navigation - 実装状況: ✅ 完成

| アクション | 状態 | 説明 |
|-----------|------|------|
| `register` | ✅ | 現在地を名前付きで登録 |
| `goto` | ✅ | 登録済みの場所に移動 |
| `gotoCoords` | ✅ | 座標指定で移動 |
| `list` | ✅ | 登録済み場所の一覧表示 |

**使用例**:
```
!creative nav register {"name": "home"}
!creative nav goto {"name": "home"}
!creative nav gotoCoords {"x": 250, "y": 64, "z": -100}
!creative nav list
```

**実装ファイル**: `planner_bot/src/creative_actions/navigation.js`

---

### Vision - 実装状況: ⚠️ 未テスト

| アクション | 状態 | 説明 |
|-----------|------|------|
| `capture` | ⚠️ | 現在の視界のスクリーンショット |
| `captureDirection` | ⚠️ | 指定方向を向いてスクリーンショット |
| `capturePanorama` | ⚠️ | 周囲4方向のパノラマ撮影 |
| `stats` | ✅ | Observer Pool統計情報 |

**使用例**:
```
!creative vision capture {}
!creative vision capturePanorama {}
!creative vision stats {}
```

**実装ファイル**: `planner_bot/src/creative_actions/vision.js`

**未テスト項目**:
- prismarine-viewerの起動確認
- Puppeteerでのスクリーンショット撮影
- 画像データの保存・利用

---

## 視覚システム (Observer Pool)

### 実装状況: ⚠️ コードあり・未テスト

### アーキテクチャ

```
AI Bot 1 ─┐
AI Bot 2 ─┤
AI Bot 3 ─┼─> Observer Pool ─┬─> Camera-Bot 1 + Puppeteer
  ...     │                  ├─> Camera-Bot 2 + Puppeteer
AI Bot N ─┘                  └─> Camera-Bot M + Puppeteer
```

### 動作フロー

1. **AI Botが視覚リクエスト送信**
   ```javascript
   const result = await bot.observerPool.requestCapture({
     botId: bot.username,
     position: { x, y, z },
     yaw: 0,
     pitch: 0
   })
   ```

2. **Observer Poolがリクエストをキューイング**
   - 空いているCamera-Botを探す
   - 全部使用中ならキュー待ち

3. **Camera-Botに割り当て**
   - Camera-BotがAI Botの位置にTP
   - 視線方向を設定
   - 500ms待機（チャンクロード）

4. **Puppeteerでスクリーンショット撮影**
   - prismarine-viewerのポート（例: 3007）にアクセス
   - 位置・方角情報をオーバーレイ
   - PNG画像をBase64で取得

5. **画像データを返却**
   ```javascript
   {
     success: true,
     image: "data:image/png;base64,...",
     metadata: {
       botId: "Bot1",
       position: { x, y, z },
       yaw: 0,
       pitch: 0,
       timestamp: 1234567890,
       cameraId: 1
     }
   }
   ```

### 実装ファイル

- `planner_bot/src/vision/observer_pool.js` - Observer Pool実装
- `planner_bot/src/bot/camera_bot.js` - Camera-Bot定義
- `planner_bot/src/bot/startup.js` - 起動オーケストレーション

### 未確認項目

- [ ] Camera-Botにprismarine-viewerが起動しているか
- [ ] Puppeteerでアクセスできるか
- [ ] スクリーンショットが撮れるか
- [ ] 画像データが正しく返ってくるか
- [ ] 複数リクエストの並列処理

### 統計情報

```javascript
const stats = observerPool.getStats()
// {
//   pool: { totalCameras: 1, busyCameras: 0, queueLength: 0 },
//   requests: { totalRequests: 0, completedRequests: 0, failedRequests: 0 },
//   cameras: [{ id: 1, port: 3007, busy: false, totalCaptures: 0, ... }]
// }
```

---

## 会話履歴システム

### 実装状況: ✅ 完成

### 設計

**目的**: 複数プレイヤーとボット間の協力的な会話を管理

**データ構造**:
```javascript
bot.conversationHistory = [
  {
    speaker: "player1",           // 発言者の実名
    role: "user",                 // このボット視点での役割
    content: "こんにちは",         // メッセージ内容
    type: "natural_language",     // メッセージタイプ
    timestamp: 1234567890
  },
  {
    speaker: "Bot1",
    role: "assistant",
    content: "こんにちは！",
    type: "bot_response",
    timestamp: 1234567891
  },
  {
    speaker: "Bot1",
    role: "assistant",
    content: "GOAP診断: 材料不足",
    type: "system_info",
    timestamp: 1234567892
  }
]
```

### API

#### `bot.systemLog(message)`
- **用途**: コンソール出力専用
- **出力先**: コンソールのみ

#### `bot.speak(username, message)`
- **用途**: MCチャットへのwhisper送信
- **出力先**: Minecraftチャット
- **注意**: 会話履歴には自動追加されない（`bot.addMessage()`を別途呼ぶ）

#### `bot.addMessage(speaker, content, type)`
- **用途**: 会話履歴への追加（唯一の履歴追加ポイント）
- **引数**:
  - `speaker`: 発言者名
  - `content`: メッセージ内容
  - `type`: `'natural_language'` | `'bot_response'` | `'system_info'`

#### `bot.getConversationHistory(options)`
- **用途**: 会話履歴を取得（フィルタリング可能）
- **オプション**:
  - `username`: 特定ユーザーの発言のみ
  - `usernames`: 複数ユーザーの発言のみ
  - `type`: 特定タイプのメッセージのみ

### 使用例

```javascript
// LLM用に自然言語のみ取得
const llmHistory = bot.getConversationHistory()
  .filter(msg => msg.type !== 'system_info')

// 特定ユーザーとの会話
const conversation = bot.getConversationHistory({ username: 'player1' })

// 複数ユーザーのグループ会話
const group = bot.getConversationHistory({
  usernames: ['player1', 'player2', 'Bot1']
})
```

### 制限

- **最大メッセージ数**: 100（FIFO）
- **永続化**: なし（ボット再起動で消える）

---

## 未実装機能

### 探索システム

- [ ] ランダム探索
- [ ] 特定ブロック探索
- [ ] マッピング（訪問済みチャンク記録）
- [ ] 帰還アルゴリズム

### 建築システム

- [ ] 設計図読み込み
- [ ] ブロック配置計画
- [ ] 建築実行

### 戦闘システム

- [ ] 敵対Mob検出
- [ ] 攻撃アクション
- [ ] 回避・防御

### LLM統合

- [ ] 画像をLLMに送信
- [ ] LLMからのコマンド受信
- [ ] 自然言語による目標設定
- [ ] 会話履歴をLLMに渡す

### その他

- [ ] インベントリ整理
- [ ] アイテムドロップ/拾得
- [ ] チェスト操作
- [ ] 村人取引
- [ ] レッドストーン回路

---

## 次のステップ

### 優先度: 高

1. **視覚システムのテスト**
   - Camera-Botのviewer起動確認
   - スクリーンショット撮影テスト
   - 画像保存機能

2. **探索システムの実装**
   - Creative actionとして実装
   - ランダム探索から開始

3. **建築システムの設計**
   - 設計図フォーマット決定
   - ブロック配置アルゴリズム

### 優先度: 中

- LLM統合準備（画像送信API設計）
- 会話履歴の永続化
- 戦闘システムの基本設計

### 優先度: 低

- チェスト操作
- 村人取引
- レッドストーン回路

---

## 関連ドキュメント

- [API.md](./API.md) - 外部利用者向けAPIリファレンス
- [../design/llm-civilization-architecture.md](../design/llm-civilization-architecture.md) - LLM文明シミュレーション設計
- [../implementation/bot-specification.ja.md](../implementation/bot-specification.ja.md) - プロジェクト仕様書
