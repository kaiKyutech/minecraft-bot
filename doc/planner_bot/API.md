# Planner Bot API Documentation

このドキュメントは、Planner Botを他のプロジェクトから使用する際のAPIリファレンスです。

## インストール

```bash
npm install /path/to/minecraft-bot/planner_bot
```

## 基本的な使い方

### ライブラリとして使用（推奨）

他のプロジェクトから直接インポートして使用できます。この場合、`.env` ファイルは不要です。

```javascript
const { createAIBot } = require('planner_bot/src/bot/ai_bot')

const bot = createAIBot(1, {
  host: 'localhost',
  port: 25565,
  username: 'MyBot',  // 任意の名前を指定可能
  version: false,     // 自動検出
  aiBotCount: 1       // 1の場合は番号を付けない
})
```

**パラメータ**:
- `id` (number): ボットID（複数ボット起動時に使用）
- `config` (Object):
  - `host` (string): サーバーホスト
  - `port` (number): サーバーポート
  - `username` (string): ボット名（自由に指定可能、`.env` に依存しない）
  - `version` (string | false): Minecraftバージョン（`false` で自動検出）
  - `aiBotCount` (number): ボット数（1の場合は `username` をそのまま使用、2以上の場合は `username1`, `username2` のように番号が付く）

### スタンドアロンで起動

```bash
npm install
node planner_bot/index.js
```

この場合のみ、`.env` ファイルから設定を読み込みます（`MC_HOST`, `MC_PORT`, `MC_USERNAME` など）。ライブラリとして使用する場合は `.env` ファイルは無視されます。

---

## 最近の改善点（2025-10-30）

### 1. 会話連番システム（Sequence Numbers）

タイムスタンプだけでは衝突の可能性があったため、単調増加する連番システムを追加しました。

**実装内容**:
- `bot.conversationSequence` カウンターを追加
- 各メッセージに `sequence` フィールドを追加
- `!history` コマンドの返り値に `latestSequence` を含めるように変更
- タイムスタンプをISO 8601形式に変更（より標準的で読みやすい）

**利点**:
- 重複や衝突が絶対に発生しない
- LLMプロジェクトで「どこまで処理したか」を確実に追跡できる
- オーバーフローの心配なし（`Number.MAX_SAFE_INTEGER` は約9京）

**使用例**:
```javascript
// LLMプロジェクトでの使用
let lastProcessedSequence = 0;

setInterval(() => {
  const history = bot.getConversationHistory();
  const newMessages = history.filter(msg => msg.sequence > lastProcessedSequence);

  if (newMessages.length > 0) {
    // 新しいメッセージを処理
    processMessages(newMessages);
    lastProcessedSequence = bot.conversationSequence;
  }
}, 1000);
```

### 2. シンプルなエラー報告（missingPreconditions）

従来の複雑な `executionHistory` を廃止し、シンプルな `missingPreconditions` 配列に置き換えました。

**変更内容**:
- `executionHistory` の複雑な構造（type, depth, reason など）を削除
- 満たされていない前提条件の目標名のみを配列で返す
- 3個以上の前提条件が満たされていない場合、自動的に分かりやすいエラーメッセージを生成

**例**:
```javascript
// Before（複雑）
{
  executionHistory: [
    { type: 'planning_failed', goal: '...', depth: 1, reason: 'no_plan_found' },
    { type: 'subgoal_attempt', parentGoal: '...', subgoal: '...', depth: 2 },
    ...
  ]
}

// After（シンプル）
{
  missingPreconditions: [
    "inventory.diamond:3",
    "inventory.iron_pickaxe:1"
  ]
}
```

### 3. 循環参照検出

GOAP プランニング中に同じ目標を繰り返し試行することを防止しました。

**実装内容**:
- `attemptedGoals` Set を追加して、試行済みの目標を追跡
- 循環参照を検出すると、分かりやすいエラーメッセージを返す

**効果**:
- 無限ループの防止
- プランニング失敗時のログが読みやすくなった
- より早く失敗を検出できる

### 4. 深度管理の最適化

数量削減（例: `inventory.cobblestone:10` → `inventory.cobblestone:5`）が不要に深度を消費していた問題を修正しました。

**変更内容**:
- 数量削減時に同じ深度で再帰するように変更（`depth + 1` → `depth`）
- 最大深度10が実質20になっていた問題を解決

**効果**:
- より複雑な目標でもプランニング可能に
- ログがシンプルになった

### 5. 統一された停止コマンド

`!stop` コマンドですべての実行中操作（GOAP、チェスト、follow）を停止できるようになりました。

**実装内容**:
- `stopAll()` 関数で GOAP、チェスト、follow を一括停止
- `bot.followTarget` フラグの修正（従来は `bot.isFollowing` を使用していたが、実際の実装と不一致）

**効果**:
- より直感的な操作
- 緊急停止が確実に動作する

---

## ログシステム API

Planner Botは3つの独立したログ関数を提供します。

### 1. `bot.systemLog(message)`

コンソール出力専用のログ関数。

**用途**: 開発者向けデバッグ情報

**引数**:
- `message` (string): ログメッセージ

**例**:
```javascript
bot.systemLog('Debug: ボットが起動しました')
```

**出力先**: コンソールのみ

---

### 2. `bot.speak(username, message)`

Minecraftチャットへのwhisper送信専用。

**用途**: ボットが自然言語で発話する（LLMプロジェクト用）

**引数**:
- `username` (string): 送信先ユーザー名
- `message` (string): メッセージ内容

**例**:
```javascript
await bot.speak('player1', 'こんにちは！木材を集めましょうか？')
```

**出力先**: Minecraftチャット（whisper）

**注意**: この関数を使用する場合は、`bot.addMessage()`も呼んで会話履歴に記録してください。

---

### 3. `bot.addMessage(speaker, content, type)`

会話履歴への追加（唯一の履歴追加ポイント）。

**用途**: 会話履歴にメッセージを記録する

**引数**:
- `speaker` (string): 発言者の実名（Bot1, Bot2, player など）
- `content` (string | Object): メッセージ内容（文字列 or 構造化データ）
- `type` (string): メッセージタイプ
  - `'conversation'` - 会話メッセージ（自然言語・発話試行）
  - `'system_info'` - システム情報（GOAP診断など）

**例**:
```javascript
// ユーザーの発言を記録（文字列）
bot.addMessage('player1', 'こんにちは', 'conversation')

// ボットの発話を記録（構造化データ）
bot.addMessage(bot.username, {
  message: 'こんにちは！',
  delivered: true,
  targetUsername: 'player1',
  distance: 5,
  maxDistance: 15
}, 'conversation')

// システム情報を記録（構造化データ）
bot.addMessage(bot.username, {
  goal: 'inventory.diamond_pickaxe:1',
  success: false,
  reason: 'planning_failed',
  missingRequirements: [...]
}, 'system_info')
```

**出力先**:
- 会話履歴（`bot.conversationHistory`配列）
- コンソール（`[HISTORY_ADD]`ログ）

**内部構造**:
各メッセージは以下の形式で保存されます：
```javascript
{
  sequence: 42,                 // 会話連番（単調増加、重複なし）
  speaker: "player1",           // 発言者の実名
  role: "user",                 // このボット視点での役割（assistant=自分, user=それ以外）
  content: "こんにちは",         // メッセージ内容（文字列 or オブジェクト）
  type: "conversation",         // メッセージタイプ
  timestamp: "2025-10-30T12:34:56.789Z"  // ISO 8601形式のタイムスタンプ
}
```

**Sequence（会話連番）について**:
- `bot.conversationSequence` カウンターで管理される単調増加の整数
- メッセージが追加されるたびに1ずつ増加（`bot.addMessage()` 呼び出し時）
- タイムスタンプと異なり、重複や衝突が発生しない
- LLMプロジェクトで「どこまで処理したか」を追跡するのに最適
- `!history` コマンドの返り値に `latestSequence` として含まれる
- オーバーフローの心配なし（`Number.MAX_SAFE_INTEGER` は約9京で、100msg/秒でも2850年持つ）

**Timestamp（タイムスタンプ）について**:
- ISO 8601形式の文字列（例: `"2025-10-30T12:34:56.789Z"`）
- UTC タイムゾーン（常に `Z` サフィックス）
- 人間が読みやすく、標準的な形式
- `new Date().toISOString()` で生成

---

## 会話履歴 API

### `bot.getConversationHistory(options)`

会話履歴を取得（オプションでフィルタリング可能）。

**引数**:
- `options` (Object, optional): フィルタオプション
  - `username` (string): 特定ユーザーの発言のみ取得
  - `usernames` (Array<string>): 複数ユーザーの発言のみ取得
  - `type` (string): 特定タイプのメッセージのみ取得

**戻り値**: Array<Message> - メッセージオブジェクトの配列

**例**:

```javascript
// 全履歴を取得
const allHistory = bot.getConversationHistory()

// 特定ユーザーの発言のみ
const player1History = bot.getConversationHistory({ username: 'player1' })

// 複数ユーザーの発言のみ
const groupHistory = bot.getConversationHistory({
  usernames: ['player1', 'player2', 'Bot1']
})

// 特定タイプのメッセージのみ
const conversationOnly = bot.getConversationHistory({
  type: 'conversation'
})

const systemInfoOnly = bot.getConversationHistory({
  type: 'system_info'
})

// 組み合わせ
const player1Conversation = bot.getConversationHistory({
  username: 'player1',
  type: 'conversation'
})
```

---

## 使用パターン

### パターン1: ボットが発話する（LLMプロジェクト）

```javascript
// !chat コマンドを使用（推奨）
const result = await handleChatCommand(bot, 'system', '!chat player1 こんにちは！木材を集めましょうか？', stateManager)

// result.success で送信成功/失敗を確認
// 会話履歴には自動的に構造化データとして記録される
```

### パターン2: ユーザーの発言を記録

```javascript
// whisperイベントハンドラ内で（ai_bot.js で既に実装済み）
bot.on('whisper', (username, message) => {
  if (!message.startsWith('!')) {
    // 自然言語メッセージとして記録
    bot.addMessage(username, message, 'conversation')
  }
})
```

### パターン3: システム情報を記録

```javascript
// GOAP診断など（!goal コマンドで自動記録される）
const diagnosis = {
  goal: 'inventory.diamond_pickaxe:1',
  success: false,
  reason: 'planning_failed',
  missingRequirements: [
    { key: 'inventory.diamond', current: 0, required: 3 }
  ]
}

bot.addMessage(bot.username, diagnosis, 'system_info')  // 構造化データとして履歴に記録
```

### パターン4: LLM用に会話履歴を取得

```javascript
// 会話メッセージのみを取得（システム情報を除外）
const conversationHistory = bot.getConversationHistory({ type: 'conversation' })

// システム情報のみを取得
const systemInfo = bot.getConversationHistory({ type: 'system_info' })

// または、システム情報を除外
const allExceptSystem = bot.getConversationHistory()
  .filter(msg => msg.type !== 'system_info')
```

---

## 会話履歴の制限

- **最大メッセージ数**: 100メッセージ
- **制限方式**: FIFO（First In First Out）
- 100メッセージを超えると、古いメッセージから自動的に削除されます

---

## Message オブジェクト構造

```typescript
interface Message {
  sequence: number      // 会話連番（単調増加、重複なし）
  speaker: string       // 発言者の実名（Bot1, Bot2, player など）
  role: string          // このボット視点での役割（"assistant" | "user"）
  content: string | Object  // メッセージ内容（文字列 or 構造化データ）
  type: string          // メッセージタイプ（"conversation" | "system_info"）
  timestamp: string     // ISO 8601形式のタイムスタンプ（例: "2025-10-30T12:34:56.789Z"）
}
```

### `role` フィールドについて

- `"assistant"`: `speaker === bot.username`（ボット自身の発言）
- `"user"`: `speaker !== bot.username`（それ以外の発言）

これはOpenAI APIなどのLLM向けに、ボット視点での役割を示すために自動計算されます。

### `type` フィールドについて

| type | 説明 | 使用例 |
|------|------|--------|
| `conversation` | 会話メッセージ | プレイヤーの発言、ボットの発話試行 |
| `system_info` | システム診断情報 | GOAPエラー、デバッグ情報 |

---

## イベントシステム

### `bot.on('newNaturalMessage', callback)` - 自然言語メッセージの即時通知

LLMプロジェクトで使用する、自然言語メッセージの即時通知イベント。

**概要**:
- whisperで受信したメッセージのうち、`!`で始まらないもの（自然言語）のみを通知
- GOAP実行中でも並行して動作（非ブロッキング）
- ポーリング不要で即座に反応可能

**イベントデータ**:
```javascript
{
  from: string,        // 発言者のユーザー名
  content: string,     // メッセージ内容
  timestamp: number    // タイムスタンプ（ミリ秒）
}
```

**使用例（LLMプロジェクト）**:
```javascript
const { createAIBot } = require('./planner_bot/src/bot/ai_bot');
const { handleChatCommand } = require('./planner_bot/src/commands');
const createStateManager = require('./planner_bot/src/planner/state_manager');

const bot = createAIBot(1, config);
const stateManager = createStateManager();

// メッセージ受信時に即座に反応
bot.on('newNaturalMessage', async (data) => {
  console.log(`[NEW MESSAGE] ${data.from}: ${data.content}`);

  // LLMで処理（GOAP実行中でも並行して動作）
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

**メリット**:
- ✅ GOAP実行中でもメッセージに即座に反応
- ✅ ポーリング不要（効率的）
- ✅ 同一Nodeプロセス内で完結（HTTP不要）
- ✅ 既存の会話履歴システムと両立

**注意**:
- whisperイベントとは別に発火します（whisperは全メッセージ、newNaturalMessageは自然言語のみ）
- コマンド（`!`始まり）は会話履歴に入らず、このイベントも発火しません
- 会話履歴には自動的に追加されるため、手動で `bot.addMessage()` を呼ぶ必要はありません

---

## コマンドシステム

Planner Botは`!`で始まるコマンドを受け付けます。whisperでボットにコマンドを送信してください。

**プログラムからの使用**:
```javascript
const { handleChatCommand } = require('planner_bot/src/commands')

// コマンドを実行（!を含むメッセージ全体を渡す）
await handleChatCommand(bot, 'player1', '!goal inventory.wooden_pickaxe:1', stateManager)
await handleChatCommand(bot, 'player1', '!status', stateManager)

// エラー診断は会話履歴から取得可能
const diagnostics = bot.getConversationHistory({ type: 'system_info' })
```

**会話履歴への影響**:
- `!`で始まるコマンド自体は会話履歴に**記録されません**
- エラー診断やシステム情報は`system_info`として記録されます

---

### `!goal <goal_state>` - GOAP自動プランニング

**このプロジェクトの真骨頂**である自動プランニングシステム。目標状態を指定すると、自動的にアクションシーケンスを生成して実行します。

**使用例**:
```
/w Bot1 !goal inventory.wooden_pickaxe:1
/w Bot1 !goal inventory.diamond_sword:1
/w Bot1 !goal inventory.iron_pickaxe:1
/w Bot1 !goal inventory.oak_planks:10
```

**形式**: `!goal <state_key>:<value>`
- `state_key`: 状態変数名（例: `inventory.wooden_pickaxe`）
- `value`: 目標値（例: `1`）

**動作**:
1. 現在の状態を分析（インベントリ、周辺環境など）
2. 目標達成に必要なアクションを自動計画
3. プランを実行（木を切る → 板を作る → 棒を作る → ピッケルを作る、など）
4. 失敗時は自動で再プランニング

**GOAP改善点**:
- **循環参照検出**: 同じ目標を繰り返し試行することを防止（`attemptedGoals` Set で管理）
- **深度管理の最適化**: 数量削減（例: `inventory.cobblestone:10` → `inventory.cobblestone:5`）は同じ深度で再帰するため、不要に深くならない
- **最大深度**: デフォルト10階層まで再帰可能
- **エラーメッセージ**: 3個以上の前提条件が満たされていない場合、自動的に分かりやすいメッセージを生成

**エラー時**: 材料不足などの診断情報が`system_info`として会話履歴に記録されます

**返却値**:
```javascript
// 成功時
{
  success: true,
  goal: "inventory.diamond_pickaxe:1",
  message: "目標「inventory.diamond_pickaxe:1」を完了しました"
}

// 失敗時
{
  success: false,
  goal: "inventory.diamond_pickaxe:1",
  error: "Planning failed: ...",
  missingPreconditions: [
    "inventory.diamond:3",
    "inventory.iron_pickaxe:1",
    "has_any_pickaxe:true"
  ]
}

// 失敗時（3個以上の前提条件が満たされていない場合）
{
  success: false,
  goal: "inventory.diamond_pickaxe:1",
  error: "目標が複雑すぎるか、近くに必要な材料がない可能性があります。より簡単な目標を試すか、材料を集めてください。",
  missingPreconditions: [
    "inventory.diamond:3",
    "inventory.iron_pickaxe:1",
    "has_any_pickaxe:true",
    "inventory.cobblestone:3"
  ]
}

// 中断時
{
  success: false,
  goal: "inventory.diamond_pickaxe:1",
  aborted: true,
  error: "Cancelled",
  missingPreconditions: [...]
}
```

**エラー報告について**:
- `missingPreconditions`: 満たされていない前提条件の目標名を配列で返します
- 3個以上の前提条件が満たされていない場合、より分かりやすいエラーメッセージを自動生成します
- 循環参照が検出された場合も同様のメッセージを返します
- LLMプロジェクトでは、このリストを使って「何が足りないか」を具体的に把握できます

---

### `!stop` - すべての実行中操作を停止

実行中のGOAPタスク、開いているチェスト、follow状態をすべて停止します。

**使用例**:
```
# GOAP実行中に
/w Bot1 !goal inventory.diamond_pickaxe:1

# 別のwhisperで中断
/w Bot1 !stop
```

**返却値**:
```javascript
// 停止成功
{
  success: true,
  stoppedActions: ["GOAP task", "chest", "follow (player1)"],
  message: "停止しました: GOAP task, chest, follow (player1)"
}

// 停止する操作がない場合
{
  success: true,
  stoppedActions: [],
  message: "停止する操作がありませんでした"
}
```

**停止される操作**:
1. **GOAP実行**: `bot.currentAbortController.abort()` で実行中のタスクを中断
2. **開いているチェスト**: `bot.currentChest.close()` でチェストを閉じる
3. **Follow状態**: `bot.followTarget` をクリアし、`bot.pathfinder.setGoal(null)` で追跡を停止

**動作**:
- すべての停止処理を順番に実行
- 停止した操作のリストを返却
- 各アクション実行前にキャンセルシグナルをチェック（GOAP）
- 中断された場合、`!goal`コマンドは`aborted: true`を返す

**用途**:
- 緊急時の停止
- プランが間違っていた場合の修正
- 優先度の高いタスクへの切り替え
- チェスト操作の中断
- プレイヤー追跡の停止

**注意**:
- `!stop`は汎用的な中断コマンドとして設計されています
- チェスト操作コマンド（`chestDeposit`, `chestWithdraw`, `chestClose`）の前には自動停止しません（チェストを開いたまま連続操作するため）
- それ以外のすべてのコマンド（`!goal`, `!skill`, `!primitive`, `!creative`, `!navigation`）の前には自動的に停止処理が実行されます

**LLMプロジェクトでの使用例**:
```javascript
// GOAP実行中に新しいメッセージが来た場合
bot.on('newNaturalMessage', async (data) => {
  // 優先度判断
  if (isUrgent(data.content)) {
    // 現在のタスクを中断
    await handleChatCommand(bot, 'system', '!stop', stateManager);

    // 新しいタスクを実行
    await handleGoalCommand(bot, 'system', newGoal, stateManager);
  }
});
```

---

### `!navigation <action> [json_params]` - 移動・場所管理

場所の登録と移動を管理します。

**コマンド形式**:
```
!navigation <action> [json_params]
```

**利用可能なアクション**: `register`, `goto`, `gotoCoords`, `moveInDirection`, `follow`, `stopFollow`

---

#### Navigation Actions

##### `register` - 場所を名前付きで登録

現在地、指定座標、または特定ブロックの位置を名前付きで登録します。

**パラメータ**:
- `name` (string, 必須): 場所の名前
- `coords` (array[x, y, z], 省略可): 登録する座標（配列形式）
- `blockType` (string, 省略可): 特定ブロックの位置を登録（例: "crafting_table"）

**使用例**:
```
# 現在地を登録
/w Bot1 !navigation register {"name": "home"}

# 座標を指定して登録
/w Bot1 !navigation register {"name": "mine_entrance", "coords": [100, 64, 200]}

# 特定ブロックの位置を登録
/w Bot1 !navigation register {"name": "workbench", "blockType": "crafting_table"}
```

**戻り値**:
```javascript
{
  success: true,
  message: "場所「home」を登録しました",
  location: { x: 100, y: 64, z: 200 }
}
```

**座標指定について**:
- `coords`パラメータは `[x, y, z]` の配列形式で指定
- 3つの数値すべてが必須（省略不可）
- 座標を指定した場合、その場所に移動せずに登録のみ可能
- マップやスクリーンショットから座標を読み取って登録する際に便利

**優先順位**:
1. `coords` が指定されている → その座標を登録
2. `blockType` が指定されている → そのブロックの位置を登録
3. どちらも指定されていない → 現在地を登録

---

##### `goto` - 登録済みの場所に移動

**パラメータ**:
- `name` (string, 必須): 移動先の場所名

**使用例**:
```
/w Bot1 !navigation goto {"name": "home"}
```

**戻り値**:
```javascript
{
  success: true,
  message: "「home」に到着しました",
  location: { x: 100, y: 64, z: 200 }
}
```

**エラー**: 未登録の場所を指定すると、登録済みの場所一覧が表示されます

---

##### `gotoCoords` - 座標指定で移動

**パラメータ**:
- `coords` (array[x, y, z], 必須): 移動先の座標（配列形式）

**使用例**:
```
/w Bot1 !navigation gotoCoords {"coords": [250, 64, -100]}
```

**戻り値**:
```javascript
{
  success: true,
  message: "[250, 64, -100]に到着しました",
  location: { x: 250, y: 64, z: -100 }
}
```

---

##### `moveInDirection` - 方向と距離を指定して移動

Yaw角度と距離を指定して移動します。目標地点のY座標は自動的に地表の高さを検出します。

**パラメータ**:
- `yaw` (number, オプション): 移動方向（度数、北=0°、反時計回り）
  - 省略時は現在の視線方向に進む
- `distance` (number, 必須): 移動距離（ブロック数）
- `verticalMode` (string, オプション): 地表検出モード（デフォルト: `"nearest"`）
  - `"nearest"`: 現在地に最も近い地面（デフォルト）
  - `"below"`: 現在地より下の地面のみ（洞窟の床を目指す）
  - `"above"`: 現在地より上の地面のみ（洞窟から地上へ）
  - `"surface"`: 上空から探索して空が見える地表のみ（地上を歩きたい時）

**使用例**:
```
# 現在向いている方向に進む
/w Bot1 !navigation moveInDirection {"distance": 10}

# 方向を指定して移動
/w Bot1 !navigation moveInDirection {"yaw": 90, "distance": 10}

# 洞窟の床を目指す
/w Bot1 !navigation moveInDirection {"yaw": 0, "distance": 15, "verticalMode": "below"}

# 洞窟から地上へ
/w Bot1 !navigation moveInDirection {"yaw": 180, "distance": 5, "verticalMode": "above"}

# 地表を歩く（洞窟に潜らない）
/w Bot1 !navigation moveInDirection {"yaw": 90, "distance": 20, "verticalMode": "surface"}
```

**戻り値**:
```javascript
{
  success: true,
  message: "Yaw 90° 方向に 10 ブロック移動しました",
  targetPosition: { x: 110, y: 65, z: 200 },
  actualPosition: { x: 109, y: 65, z: 199 }
}
```

**動作**:
1. Yaw角度とdistanceから目標XZ座標を計算
2. 目標座標の地表高さを探索（verticalModeに応じて探索）
   - `nearest`: 現在地から±1, ±2, ±3... と上下交互に探索（最大50ブロック）
   - `below`: 現在地から下方向のみ探索（最大50ブロック）
   - `above`: 現在地から上方向のみ探索（最大50ブロック）
   - `surface`: Y=320から-64まで下方向に探索し、最初に見つかる地表
3. 見つかった地面の上に2ブロック分の空間があることを確認（全モード共通）
4. pathfinderで目標座標へ移動（range=3.0ブロック）

**座標系**: 北=0°、反時計回り（西=90°、南=180°、東=270°）

**利点**:
- LLMがスクリーンショットの視野角から方向を理解しやすく、正確な座標計算が不要
- `surface`モードで地上を歩き続けることができ、洞窟に潜り込むのを防げる

---

##### `follow` - プレイヤーを追跡

**パラメータ**:
- `username` (string, 必須): 追跡するプレイヤー名

**使用例**:
```
/w Bot1 !navigation follow {"username": "RitsukaAlice"}
```

**戻り値**:
```javascript
{
  success: true,
  message: "RitsukaAlice の追跡を開始しました",
  target: "RitsukaAlice"
}
```

**動作**: 指定したプレイヤーを3ブロックの距離を保って追跡します。

---

##### `stopFollow` - 追跡停止

**パラメータ**: なし

**使用例**:
```
/w Bot1 !navigation stopFollow {}
```

**戻り値**:
```javascript
{
  success: true,
  message: "RitsukaAlice の追跡を停止しました",
  previousTarget: "RitsukaAlice"
}
```

---

##### `dropItem` - プレイヤーの近くでアイテムをドロップ

対象プレイヤーの近くに移動して、指定したアイテムをドロップします。ボット間でのアイテム受け渡しに使用します。

**パラメータ**:
- `targetPlayer` (string, 必須): アイテムを渡す対象プレイヤー名
- `itemName` (string, 必須): ドロップするアイテム名
- `count` (number, オプション): ドロップする個数（デフォルト: 1）
- `maxDistance` (number, オプション): 最大移動距離（ブロック、デフォルト: 100）

**使用例**:
```
# 鉄インゴットを3個渡す（デフォルト100ブロック以内）
/w Bot1 !navigation dropItem {"targetPlayer": "Alice", "itemName": "iron_ingot", "count": 3}

# ダイヤモンドを1個渡す
/w Bot1 !navigation dropItem {"targetPlayer": "Bob", "itemName": "diamond"}

# 最大距離を200ブロックに設定
/w Bot1 !navigation dropItem {"targetPlayer": "Charlie", "itemName": "iron_ingot", "count": 5, "maxDistance": 200}
```

**戻り値**:
```javascript
{
  success: true,
  message: "Alice の近くに iron_ingot を 3個ドロップしました",
  targetPlayer: "Alice",
  itemName: "iron_ingot",
  droppedCount: 3,
  availableCount: 10
}
```

**動作**:
1. 距離チェック（`maxDistance`以内か確認）
2. インベントリから指定アイテムを確認
3. `GoalFollow` で追跡開始（プレイヤーが移動しても追いかける、2ブロック以内まで接近）
4. 2.5ブロック以内に入るまで待機（最大30秒）
5. 追跡停止
6. プレイヤーの方を向く（目の高さ）
7. 指定個数（または利用可能な最大個数）をドロップ

**エラー**:
- プレイヤーが見つからない場合
- プレイヤーが `maxDistance` より遠い場合
- アイテムがインベントリにない場合
- 30秒以内にプレイヤーに近づけなかった場合（タイムアウト）

**特徴**:
- ✅ プレイヤーが移動していても自動的に追いかける（`GoalFollow` 使用）
- ✅ 2ブロック以内まで近づく（確実にアイテムを渡せる距離）
- ✅ プレイヤーの方を向いてから渡すので、視覚的に分かりやすい

**用途**:
- ボット間でのアイテム受け渡し
- プレイヤーへのアイテム提供
- 協調作業での資源共有

**LLMプロジェクトでの使用例**:
```javascript
// Bot1が採掘、Bot2がクラフト担当
// Bot1: 鉄鉱石を採掘して精錬
await handleGoalCommand(bot1, 'system', 'inventory.iron_ingot:10', stateManager);

// Bot1: Bot2にアイテムを渡す
await handleChatCommand(bot1, 'system',
  '!navigation dropItem {"targetPlayer": "Bot2", "itemName": "iron_ingot", "count": 3}',
  stateManager
);

// Bot2: Bot1が近くに来るまで待つ
// Bot2: 地面のアイテムを自動的に拾う（Mineflayerのデフォルト動作）
// Bot2: 鉄のピッケルをクラフト
await handleGoalCommand(bot2, 'system', 'inventory.iron_pickaxe:1', stateManager);
```

---

##### `pickupItems` - 周囲のドロップアイテムを拾う

周囲に落ちているアイテムを自動的に拾います。ボット間でのアイテム受け渡し後や、採掘後の回収に使用します。

**パラメータ**:
- `range` (number, オプション): 拾う範囲（ブロック、デフォルト: 5）
- `itemName` (string, オプション): 特定のアイテムのみ拾う（省略時は全て）

**使用例**:
```
# 周囲5ブロック以内の全アイテムを拾う
/w Bot1 !navigation pickupItems {}

# 周囲10ブロック以内の全アイテムを拾う
/w Bot1 !navigation pickupItems {"range": 10}

# 周囲5ブロック以内の鉄インゴットのみ拾う
/w Bot1 !navigation pickupItems {"itemName": "iron_ingot"}

# 周囲15ブロック以内のダイヤモンドのみ拾う
/w Bot1 !navigation pickupItems {"range": 15, "itemName": "diamond"}
```

**戻り値**:
```javascript
{
  success: true,
  message: "アイテムを拾いました",
  foundCount: 5  // 見つかったアイテム数
}

// アイテムが見つからない場合
{
  success: true,
  message: "拾うアイテムが見つかりませんでした",
  pickedUpCount: 0,
  items: []
}
```

**動作**:
1. 指定範囲内のドロップアイテムを検索
2. `itemName` 指定がある場合はフィルタリング
3. 最も近いアイテムに移動
4. 範囲内のアイテムが自動的に拾われる（500ms待機）

**注意**:
- Minecraftは近くのアイテムを自動的に吸い込むため、1つの位置に移動すれば周囲のアイテムも拾われます

**用途**:
- `dropItem` 後のアイテム回収
- 採掘後の鉱石回収
- 戦闘後のドロップアイテム回収

**LLMプロジェクトでの使用例**:
```javascript
// Bot1がBot2にアイテムを渡す
await handleChatCommand(bot1, 'system',
  '!navigation dropItem {"targetPlayer": "Bot2", "itemName": "iron_ingot", "count": 10}',
  stateManager
);

// Bot2が受け取る
await handleChatCommand(bot2, 'system',
  '!navigation pickupItems {"itemName": "iron_ingot"}',
  stateManager
);
```

#### チェスト操作コマンド

チェストの開閉や入出庫を管理します。`chestDeposit` / `chestWithdraw` を使う前に `chestOpen` で対象チェストを開いておく必要があります。

##### `chestOpen`
- パラメータ: `{ "coords": [x, y, z] }`（省略時は最寄りのチェストを自動検索）
- チェストに近づいて開き、内容・空きスロット・プレイヤーインベントリ一覧を返します。
- 成功時は `bot.currentChest` にハンドルを保持し、続く `chestDeposit` / `chestWithdraw` で利用できます。

##### `chestDeposit`
- パラメータ: `{ "item": "cobblestone", "count": 1 }`
- `count` 省略時は **1 個**、`count: -1` を指定するとプレイヤーの在庫分を全て預けます。
- その他の負数や 0 はエラー扱いです。`count` が在庫数を超える場合は在庫分だけ預けます。

##### `chestWithdraw`
- パラメータ: `{ "item": "cobblestone", "count": 1 }`
- `count` の扱いは `chestDeposit` と同様で、`-1` 指定時はチェスト内の該当アイテムを全て取り出します。
- 取り出し量がチェスト内在庫を超える場合は、在庫分だけ引き出します。

##### `chestClose`
- 開いているチェストを閉じ、`bot.currentChest` / `bot.currentChestPosition` をクリアします。
- チェストを開いたままだと `!info all` のインベントリ情報が古いままになることがあるため、必要に応じて `chestClose` 後に `!info all` を呼ぶ運用がおすすめです。

---

### `!creative <action> [json_params]` - 建築・ブロック操作

ブロックの設置など、建築関連の操作を行います。

**利用可能なアクション**: `placeBlock`

---

#### `placeBlock` - ブロックを設置

指定した座標、または周囲の空いている場所にブロックを設置します。

**パラメータ**:
- `name` (string, **必須**): 設置するブロック名（例: `"chest"`, `"cobblestone"`, `"crafting_table"`）
- `coords` (array, オプション): 設置座標 `[x, y, z]`。省略時は周囲5ブロック以内で最も近い設置可能な場所を自動選択
- `allowSelfPosition` (boolean, オプション): 自分の位置（XZ座標が同じ場所）への設置を許可するか（デフォルト: `false`）

**使用例**:

```javascript
// 座標指定でチェストを設置
!creative placeBlock {"name": "chest", "coords": [100, 64, 200]}

// 座標省略（周囲で最も近い場所に自動設置）
!creative placeBlock {"name": "cobblestone"}

// 自分の位置への設置を許可
!creative placeBlock {"name": "cobblestone", "allowSelfPosition": true}
```

**成功時の戻り値**:
```json
{
  "success": true,
  "message": "cobblestone を [100, 64, 200] に設置しました",
  "block": "cobblestone",
  "position": { "x": 100, "y": 64, "z": 200 }
}
```

**エラー時の戻り値**:
```json
{
  "success": false,
  "error": "設置できません: 既にブロック（stone）が存在します",
  "position": { "x": 100, "y": 64, "z": 200 }
}
```

**設置条件**:
- インベントリに指定したブロックが存在する
- 設置先の座標が空気ブロック（`air`）である
- 設置先の上下左右前後いずれかに隣接する固体ブロックが存在する
- ボットから設置先まで4.5ブロック以内（自動で移動）

**エラーの種類**:
- `インベントリに <ブロック名> がありません` - 指定したブロックを所持していない
- `座標が範囲外です（チャンクが読み込まれていません）` - 指定座標がロード範囲外
- `既にブロック（<ブロック名>）が存在します` - 設置先に既にブロックがある
- `周囲に設置可能なブロックがありません（空中の座標です）` - 隣接する固体ブロックがない
- `周囲5ブロック以内に設置可能な場所が見つかりませんでした` - 座標省略時、近くに設置可能な場所がない
- `移動に失敗しました: <理由>` - 設置位置への移動中にエラー

**LLMプロジェクトでの使用例**:

```javascript
const result = await handleCreativeCommand(bot, 'llm', 'placeBlock {"name": "chest"}', stateManager);

if (result.data.success) {
  console.log(`ブロック設置成功: ${result.data.position.x}, ${result.data.position.y}, ${result.data.position.z}`);
} else {
  console.log(`ブロック設置失敗: ${result.data.error}`);
}
```

---

### `!info <type> [json_params]` - 情報取得

現在の状況やブロック情報を取得します。

**利用可能なタイプ**: `all`, `vision`, `scanBlocks`

---

#### `!info vision` - スクリーンショット取得

AI Botが自分自身の視界のスクリーンショットを撮影します。画像には以下のオーバーレイ情報が含まれます：

**画面オーバーレイ:**
- **左上情報ボックス**: 位置座標、Yaw、Pitch、視線先ブロック情報
- **Yaw視野ガイド**: 画面左端・中央・右端に垂直線とYaw角度（±60° FOV）
- **ターゲットサークル**: 画面中央に緑の照準サークルと視線先ブロック情報

**パラメータ**:
- `yaw` (number, オプション): 水平方向の角度（度数）
- `pitch` (number, オプション): 垂直方向の角度（度数）
- `renderWait` (number, オプション): 描画待機時間（ミリ秒、デフォルト: 10000）
  - prismarine-viewerのメッシュ生成完了を待つ時間
  - 近距離のみ: 5000ms程度
  - 遠距離まで: 10000ms以上推奨

**使用例**:
```
# デフォルト（10秒待機）
/w Bot1 !info vision {}

# 視線方向指定
/w Bot1 !info vision {"yaw": 0, "pitch": 0}

# 短距離用（5秒待機）
/w Bot1 !info vision {"yaw": 90, "renderWait": 5000}

# 超遠距離用（15秒待機）
/w Bot1 !info vision {"yaw": 0, "renderWait": 15000}
```

**戻り値**:
```javascript
{
  success: true,
  message: "スクリーンショットを取得しました",
  data: {
    image: "base64string...",  // Base64画像データ（data:image/png;base64,は含まない）
    filepath: "C:\\path\\to\\screenshots\\screenshot_Bot1.png",
    metadata: {
      botId: "Bot1",
      position: { x: 100, y: 64, z: 200 },
      yaw: 0,        // 度数
      pitch: 0,      // 度数
      timestamp: 1234567890
    }
  }
}
```

**座標系（重要）**:
実測に基づく座標系（Mineflayer公式ドキュメントとは異なります）：

- **Yaw（水平方向）**: 北を0°として反時計回り
  - 北 = 0°
  - 西 = 90°
  - 南 = 180°
  - 東 = 270° または -90°
  - 画面表示: 左端（青）= 現在Yaw + 60°、右端（赤）= 現在Yaw - 60°

- **Pitch（垂直方向）**:
  - 水平 = 0°
  - 上を向く（空を見る）= マイナス方向（例: -45°）
  - 下を向く（地面を見る）= プラス方向（例: +45°）

**注意**:
- Mineflayer公式ドキュメントには「東=0°」と記載されていますが、実際の動作では「北=0°」です
- Pitchは数値が増えると下を向きます（直感と逆なので注意）

**描画待機時間（renderWait）について**:
- prismarine-viewerは近いブロックから順番にメッシュ化します
- 待機時間が短いと遠くのブロックが描画されず、空の色だけが表示されます
- 目安:
  - 近距離（村の中など）: 5000ms
  - 中距離（村全体が見える）: 10000ms（デフォルト）
  - 遠距離（広範囲の地形）: 15000ms以上
- この待機時間はGPUではなく、CPUのメッシュ生成処理を待っています

**視線先ブロック情報**:
`bot.blockAtCursor()` で最大256ブロック先まで検出し、画面中央の緑のターゲットサークル下に表示されます：
- ブロック名（例: `oak_log`, `stone`）
- ブロック座標（例: `(130, 64, -240)`）
- ブロックが存在しない場合は `Target: none` と表示

**LLMプロジェクトでの使用時**:
「南を向いて」などの自然言語指示を受けた場合は、以下のように変換してください：
```javascript
const directions = {
  '北': 0,
  '西': 90,
  '南': 180,
  '東': -90  // または 270
}

// Pitchの指定（プロンプトで説明推奨）
// 「少し上を見て」 → pitch: -20
// 「水平に」 → pitch: 0
// 「少し下を見て」 → pitch: 20
```

**画面の見方（LLMへの説明用）**:
画面左右の青い線・赤い線に表示されているYaw角度を見れば、その方向にどれくらい回転すれば目的の物を中央に捉えられるかが分かります。例えば、画面左端（青線）に `Yaw: 150°` と表示されていて、そこに目的の物が見える場合、`{"yaw": 150}` を指定すれば中央に映ります。

---

#### `!info scanBlocks` - 周辺ブロック情報取得

`!info scanBlocks` で利用する周辺環境スキャン。ボットを中心とした立方体範囲を走査し、指定条件に合致したブロック情報を JSON で返します。Mineflayer の `bot.findBlocks` を多重呼び出しするのではなく、チャンクキャッシュを直接走査するため広範囲でも高速です。

**パラメータ**:
- `range` (number, オプション): スキャン半径（デフォルト `32`、最小 `0`）。中心ブロックからのユークリッド距離で判定します。
- `type` / `types` (string | string[], オプション): 取得対象のブロック名。単一指定は `type`、複数指定は配列または `types` で渡します。省略時は非空気ブロック全て。
- `maxChecks` (number, オプション): 探索する座標の最大数（デフォルト `25000`、最小 `1`）。上限に達すると走査を中断します。
- `minYOffset` / `maxYOffset` (number, オプション): 上下方向の探索範囲を中心ブロックからの相対値で制限します（単位: ブロック）。未指定時は `-range` / `+range`。負値で下方向、正値で上方向を指定します。`minYOffset` ≤ `maxYOffset` を守ってください。
- `yaw` (number, オプション): 探索の基準方位（度数法）。省略時はボットの現在 yaw。0° が北（Z-）、90° が東（X+）。値は任意ですが 0〜360° の範囲に正規化して利用するのが推奨です。
- `coneAngle` (number, オプション): `yaw` を中心にした水平扇形の開き角（度数法）。0〜360° を想定。0 の場合は一点方向、360 以上を指定すると実質的に全方向が対象になります。

**使用例**:
```
# 周囲32ブロックの状況を取得
/w Bot1 !info scanBlocks {}

# ダイアモンド鉱石だけを 64 ブロック以内で探す
/w Bot1 !info scanBlocks {"range": 64, "types": ["diamond_ore"]}

# クラフティングテーブルを近傍から探索（最大 5,000 ブロックをチェック）
/w Bot1 !info scanBlocks {"type": "crafting_table", "maxChecks": 5000}

# 高さ方向を ±5 に絞って平面付近のみ取得
/w Bot1 !info scanBlocks {"range": 48, "minYOffset": -5, "maxYOffset": 5}

# 視線方向±30°の扇形だけを探索
/w Bot1 !info scanBlocks {"range": 40, "coneAngle": 60}

# 北(0°)方向の狭い扇形で鉱石を探索
/w Bot1 !info scanBlocks {"range": 64, "yaw": 0, "coneAngle": 45, "types": ["iron_ore", "coal_ore"]}
```

##### 備考: `!info all` とインベントリ同期

- `!info all` 実行時は `stateManager.refresh(bot)` を通じてプレイヤーインベントリを取得しているが、チェストなどのコンテナを開いたままの状態では Mineflayer の仕様により `bot.inventory.items()` が即時更新されないことがある。
- そのためチェスト操作中に `!info all` を呼ぶと、預け入れ／取り出し前の在庫数が表示される場合がある。
- 最新のインベントリを確認したい場合は、`!navigation chestClose {}`（または手動でGUIを閉じる）→ `!info all` の順で実行すると確実。

**戻り値**:
```javascript
{
  success: true,
  type: "scanBlocks",
  data: {
    summary: {
      totalBlocks: 124,
      uniqueTypes: 5,
      typeCounts: {
        grass_block: 60,
        dirt: 55,
        bedrock: 8,
        furnace: 1
      },
      scanRange: 32,
      checksUsed: 8120,
      eligiblePositions: 12000,
      farthestDistance: 47,
      estimatedPositions: 18000,
      estimatedCoveragePercent: 45.0,
      maxChecks: 100000,
      scanCenter: { x: 9, y: -60, z: 8 }
    },
    blocks: [
      {
        name: "furnace",
        position: { x: 10, y: -60, z: 8 },
        relativePosition: { x: 1, y: 0, z: 0 },
        distance: 0
      },
      {
        name: "grass_block",
        position: { x: 9, y: -61, z: 8 },
        relativePosition: { x: 0, y: -1, z: 0 },
        distance: 1
      }
      // ...距離が近い順で続く
    ]
  }
}
```

**用途**:
- 鉱石や構造物の位置を高速に特定
- LLM 側で洞窟入口（空気ブロックの集まり）や資源分布を解析
- 周囲環境を丸ごと取得して戦略判断に利用

**補足**:
- `blocks` 配列はボットからの距離でソート済みです。`relativePosition` は中心ブロックからの差分座標。
- コンソールにはサマリーと先頭 10 件を出力しますが、戻り値には探索で検出したすべてのブロックが含まれます。
- `maxChecks` を増やすほど広範囲を探索できますが、処理時間も比例して伸びます。用途に応じて調整してください。
- サマリーの `checksUsed` / `eligiblePositions` / `farthestDistance` / `estimatedCoveragePercent` で走査状況と探索範囲の広がりを把握できます。
- `estimatedPositions` / `estimatedCoveragePercent` は幾何学的な近似値で、探索条件が広い場合の目安になります。

---

### `!status` - 現在の状況確認

現在の状況を表示します（位置、インベントリ、周辺環境など）。

**使用例**:
```
/w Bot1 !status
```

**注意**: ステータス情報は会話履歴に記録されません（コンソールのみ）

---

### `!history` - 会話履歴の確認

会話履歴をJSON形式でコンソール出力します。

**使用例**:
```
/w Bot1 !history                      # 全履歴
/w Bot1 !history player1              # player1のみ
/w Bot1 !history player1,player2      # 複数ユーザー
```

---

### `!chat` - メッセージ送信

指定したプレイヤーにwhisperでメッセージを送信します（距離チェック付き）。

**コマンド形式**:
```
# 簡易形式（デフォルト距離15ブロック）
!chat <username> <message>

# JSON形式（距離カスタマイズ可能、最大100ブロック）
!chat {"username": "PlayerName", "message": "Hello!", "maxDistance": 30}
```

**使用例**:
```
/w Bot1 !chat Steve Hello!
/w Bot1 !chat {"username": "Alice", "message": "I found diamonds!", "maxDistance": 50}
```

**返却値**:
- 成功時: `{success: true, targetUsername, distance, maxDistance, message}`
- 失敗時: `{success: false, reason, targetUsername, distance, maxDistance}`

**会話履歴への記録**:
送信成功・失敗に関わらず、発話試行の事実が構造化データとして `type: 'conversation'` で記録されます。

**失敗理由**:
- `out_of_range`: 距離外
- `player_not_found`: プレイヤーが見つからない
- `entity_not_available`: エンティティ情報が取得できない
- `invalid_format`: 入力形式が不正

---

### その他のコマンド

以下のコマンドも利用可能ですが、通常は内部的に使用されます：

#### `!skill <skill_name> [json_params]`

特定のスキルを直接実行します。

```
/w Bot1 !skill gatherWood {"count": 10}
/w Bot1 !skill craftItem {"item": "wooden_pickaxe"}
```

#### `!primitive <primitive_name> [json_params]`

低レベルのプリミティブアクションを実行します。

```
/w Bot1 !primitive moveTo {"x": 100, "y": 64, "z": 200}
/w Bot1 !primitive digBlock {"x": 10, "y": 63, "z": 5}
```

#### `!echo <message>` - 実験用

オウム返し（ボット発話のシミュレーション）。LLM機能のテスト用。

```
/w Bot1 !echo こんにちは
```

---

## 注意事項

### 1. whisperイベントは自動処理される

`createAIBot()`で作成されたボットは、以下の処理が自動的に行われます：

- `!`で始まるメッセージ → コマンドとして実行（会話履歴に入らない）
- それ以外のメッセージ → `type: 'conversation'`として会話履歴に自動追加

### 2. `!chat`コマンドを使用すれば自動的に記録される

`!chat`コマンドを使用すれば、以下が自動的に行われます：

- 距離チェック
- whisper送信（範囲内の場合）
- 会話履歴への記録（構造化データとして）

直接 `bot.speak()` を呼ぶ場合は、`bot.addMessage()` も手動で呼ぶ必要があります。

### 3. 会話履歴は揮発性

ボットを再起動すると会話履歴はクリアされます。永続化が必要な場合は、別途データベースやファイルに保存する必要があります。

---

## LLMプロジェクトでの使用方法

Planner Botは**ライブラリとして他のプロジェクトから直接使用できます**。Minecraftチャット経由ではなく、コマンドハンドラを直接呼び出すことで、高速かつ型安全にボットを制御できます。

### アーキテクチャ

```
┌─────────────────────────────────────┐
│  LLMプロジェクト（別リポジトリ）      │
│  - Claude / GPT-4 Vision            │
│  - LangChain / 独自実装              │
│  - 戦略的判断・意思決定              │
├─────────────────────────────────────┤
│  ↓ 直接関数呼び出し                  │
├─────────────────────────────────────┤
│  planner_bot (ライブラリとして使用)   │
│  - handleGoalCommand()              │
│  - handleSkillCommand()             │
│  - handleCreativeCommand()          │
│  - handleStatusCommand()            │
└─────────────────────────────────────┘
```

---

### 基本的な使い方

```javascript
// LLMプロジェクトのメインファイル
const { createAIBot } = require('./planner_bot/src/bot/ai_bot');
const { handleGoalCommand } = require('./planner_bot/src/commands/goal_command');
const { handleCreativeCommand } = require('./planner_bot/src/commands/creative_command');
const createStateManager = require('./planner_bot/src/planner/state_manager');

// ボット作成
const bot = createAIBot(1, {
  host: 'localhost',
  port: 25565,
  username: 'LLM_Bot',
  version: false
});

const stateManager = createStateManager();

// 準備完了まで待つ
bot.once('spawn', async () => {
  console.log('Bot ready!');
});
```

---

### パターン1: Vision + LLM判断 + GOAP実行

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function analyzeAndAct(bot, stateManager) {
  // 1. スクリーンショット撮影
  const visionResult = await handleChatCommand(
    bot,
    'llm_agent',
    '!info vision {}',
    stateManager
  );

  const base64Image = visionResult.data.image;  // ← base64文字列

  // 2. Claude Vision APIで状況分析
  const analysisResponse = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: base64Image
          }
        },
        {
          type: "text",
          text: "この画像を分析してください。近くに木はありますか？何をすべきですか？"
        }
      ]
    }]
  });

  const analysis = analysisResponse.content[0].text;
  console.log('Claude分析:', analysis);

  // 3. 分析結果に基づいてGOAPコマンド実行
  if (analysis.includes("木が見える")) {
    console.log('木を発見。木のつるはしを作成します...');

    try {
      await handleGoalCommand(
        bot,
        'llm_agent',
        'inventory.wooden_pickaxe:1',
        stateManager
      );
      console.log('木のつるはし作成完了！');
    } catch (error) {
      console.error('失敗:', error.message);
      // エラー診断は会話履歴から取得可能
      const diagnostics = bot.getConversationHistory({ type: 'system_info' });
      console.log('診断情報:', diagnostics);
    }
  }
}
```

---

### パターン2: コマンドハンドラの直接使用

```javascript
// 各コマンドハンドラをインポート
const { handleChatCommand } = require('./planner_bot/src/commands');
const { handleGoalCommand } = require('./planner_bot/src/commands/goal_command');
const { handleSkillCommand } = require('./planner_bot/src/commands/skill_command');
const { handleCreativeCommand } = require('./planner_bot/src/commands/creative_command');
const { handleStatusCommand } = require('./planner_bot/src/commands/status_command');

// GOAP自動プランニング
await handleGoalCommand(bot, 'llm', 'inventory.wooden_pickaxe:1', stateManager);

// スキル直接実行
await handleSkillCommand(bot, 'llm', 'skill gatherWood {"count": 10}', stateManager);

// Navigation（ナビゲーション）
await handleChatCommand(bot, 'llm', '!navigation register {"name": "home"}', stateManager);
await handleChatCommand(bot, 'llm', '!navigation register {"name": "mine", "coords": [100, 12, 200]}', stateManager);
await handleChatCommand(bot, 'llm', '!navigation goto {"name": "home"}', stateManager);

// Info（情報取得）
const screenshot = await handleChatCommand(bot, 'llm', '!info vision {}', stateManager);
const blocks = await handleChatCommand(bot, 'llm', '!info scanBlocks {"range": 32}', stateManager);

// ステータス確認
await handleStatusCommand(bot, 'llm', stateManager);

// または統一インターフェース（内部で上記を呼び出す）
await handleChatCommand(bot, 'llm', '!goal inventory.wooden_pickaxe:1', stateManager);
await handleChatCommand(bot, 'llm', '!creative vision capture', stateManager);
```

---

### パターン3: base64画像データの取得と利用

```javascript
// Vision capture の結果構造
const result = await handleChatCommand(bot, 'llm', '!info vision {}', stateManager);

console.log(result);
// {
//   success: true,
//   message: 'スクリーンショットを取得しました',
//   data: {
//     image: 'iVBORw0KGgoAAAANS...',  // ← base64文字列（そのままLLMに送信可能）
//     filepath: 'C:\\...\\screenshots\\screenshot_Bot1.png',  // ファイルパス
//     metadata: {
//       botId: 'Bot1',
//       position: { x: 10, y: 64, z: 20 },
//       yaw: 90,
//       pitch: 0,
//       timestamp: 1729671234567
//     }
//   }
// }

// base64をそのままLLM APIに送信
const base64Image = result.data.image;

// Claude
await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  messages: [{
    role: "user",
    content: [{
      type: "image",
      source: { type: "base64", media_type: "image/png", data: base64Image }
    }]
  }]
});

// OpenAI GPT-4 Vision
await openai.chat.completions.create({
  model: "gpt-4-vision-preview",
  messages: [{
    role: "user",
    content: [{
      type: "image_url",
      image_url: { url: `data:image/png;base64,${base64Image}` }
    }]
  }]
});
```

---

### パターン4: 会話履歴をLLMに渡す

```javascript
async function chatWithLLM(bot, username, userMessage, stateManager) {
  // 1. ユーザーメッセージは既に会話履歴に追加されている（whisperイベントで自動）

  // 2. 会話履歴を取得（会話のみ、システム情報を除外）
  const history = bot.getConversationHistory({ type: 'conversation' })
    .map(msg => {
      // 構造化データの場合はメッセージ本文を抽出
      const content = typeof msg.content === 'object' && msg.content.message
        ? msg.content.message
        : msg.content;

      return {
        role: msg.role,      // "assistant" or "user"
        content: content     // 文字列のみ
      };
    });

  // 3. LLM APIに送信
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    system: "あなたはMinecraftボットです。ユーザーの指示に従って行動してください。",
    messages: history
  });

  const reply = response.content[0].text;

  // 4. ボットの応答を送信（!chat コマンドを使用）
  bot.systemLog(`-> ${username}: ${reply}`);
  const result = await handleChatCommand(
    bot,
    'system',
    `!chat ${username} ${reply}`,
    stateManager
  );

  // result.success で送信成功/失敗を確認可能
  if (!result.success) {
    bot.systemLog(`Failed to send message: ${result.reason}`);
  }

  return reply;
}
```

---

### Minecraftチャット経由 vs 直接関数呼び出し

| 方法 | メリット | デメリット | 用途 |
|------|---------|-----------|------|
| **Minecraftチャット** | ボット独立動作、設定不要 | 文字列パース、遅い | 手動テスト、デモ |
| **直接関数呼び出し** | 高速、型安全、base64直接取得 | 同一プロセス必要 | LLM統合、本番運用 |

---

### 注意事項

#### 1. botインスタンスの共有
LLMプロジェクトとplanner_botは**同じプロセス内で動作**する必要があります。

#### 2. エラーハンドリング
コマンドハンドラは失敗時に`throw`します。必ず`try-catch`で囲んでください。

```javascript
try {
  await handleGoalCommand(bot, 'llm', 'inventory.wooden_pickaxe:1', stateManager);
} catch (error) {
  console.error('GOAPコマンド失敗:', error.message);
  // 診断情報は会話履歴から取得
  const diagnostics = bot.getConversationHistory({ type: 'system_info' });
}
```

#### 3. base64画像データのサイズ
スクリーンショットは約500KB-2MBのbase64文字列になります。LLM APIのサイズ制限に注意してください。

---

### 完全な例: LLMボット統合

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const { createAIBot } = require('./planner_bot/src/bot/ai_bot');
const { handleCreativeCommand } = require('./planner_bot/src/commands/creative_command');
const { handleGoalCommand } = require('./planner_bot/src/commands/goal_command');
const createStateManager = require('./planner_bot/src/planner/state_manager');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ボット作成
const bot = createAIBot(1, {
  host: 'localhost',
  port: 25565,
  username: 'ClaudeBot',
  version: false
});

const stateManager = createStateManager();

bot.once('spawn', async () => {
  console.log('ClaudeBot起動！');

  // 定期的に周囲を観察して行動
  setInterval(async () => {
    try {
      // 1. スクリーンショット撮影
      const screenshot = await handleChatCommand(
        bot,
        'system',
        '!info vision {}',
        stateManager
      );

      // 2. Claudeに状況判断を依頼
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: screenshot.data.image
              }
            },
            {
              type: "text",
              text: "この画像を見て、次に何をすべきか判断してください。木を切る、石を掘る、クラフトするなど。具体的なGOAP目標を教えてください。"
            }
          ]
        }]
      });

      const decision = response.content[0].text;
      console.log('Claude判断:', decision);

      // 3. Claudeの判断に基づいて行動
      if (decision.includes("wooden_pickaxe")) {
        await handleGoalCommand(bot, 'system', 'inventory.wooden_pickaxe:1', stateManager);
      } else if (decision.includes("stone_pickaxe")) {
        await handleGoalCommand(bot, 'system', 'inventory.stone_pickaxe:1', stateManager);
      }
      // ... 他の判断処理

    } catch (error) {
      console.error('エラー:', error.message);
    }
  }, 30000);  // 30秒ごと
});
```

---

## トラブルシューティング

### 会話履歴が記録されない

- `bot.addMessage()`を呼んでいますか？
- `!`で始まるメッセージは自動的に除外されます

### LLMに渡すと混乱する

- `type: 'system_info'`を除外してください
- フィルタリング例: `.filter(msg => msg.type !== 'system_info')`

### 会話履歴が消える

- 100メッセージを超えると古いものから削除されます
- 必要に応じて外部に保存してください

---

## 関連ドキュメント

- [CLAUDE.md](../CLAUDE.md) - 開発者向けガイド
- [planner_bot/src/bot/ai_bot.js](src/bot/ai_bot.js) - 実装コード
