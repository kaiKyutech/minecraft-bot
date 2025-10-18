# Planner Bot API Documentation

このドキュメントは、Planner Botを他のプロジェクトから使用する際のAPIリファレンスです。

## インストール

```bash
npm install /path/to/minecraft-bot/planner_bot
```

## 基本的な使い方

```javascript
const { createAIBot } = require('planner_bot/src/bot/ai_bot')

// Observer Poolは必要に応じて用意
const observerPool = null  // または実際のObserver Poolインスタンス

const bot = createAIBot(1, {
  host: 'localhost',
  port: 25565,
  username: 'Bot',
  version: false  // 自動検出
}, observerPool)
```

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
- `content` (string): メッセージ内容
- `type` (string): メッセージタイプ
  - `'natural_language'` - 人間の自然言語メッセージ
  - `'bot_response'` - ボットの発話（LLMが生成した応答）
  - `'system_info'` - システム情報（GOAPエラー診断など）

**例**:
```javascript
// ユーザーの発言を記録
bot.addMessage('player1', 'こんにちは', 'natural_language')

// ボットの発話を記録
bot.addMessage(bot.username, 'こんにちは！', 'bot_response')

// システム情報を記録
bot.addMessage(bot.username, 'GOAP診断: 材料不足', 'system_info')
```

**出力先**:
- 会話履歴（`bot.conversationHistory`配列）
- コンソール（`[HISTORY_ADD]`ログ）

**内部構造**:
各メッセージは以下の形式で保存されます：
```javascript
{
  speaker: "player1",           // 発言者の実名
  role: "user",                 // このボット視点での役割（assistant=自分, user=それ以外）
  content: "こんにちは",         // メッセージ内容
  type: "natural_language",     // メッセージタイプ
  timestamp: 1234567890         // タイムスタンプ（ミリ秒）
}
```

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
const naturalMessages = bot.getConversationHistory({
  type: 'natural_language'
})

// 組み合わせ
const player1Natural = bot.getConversationHistory({
  username: 'player1',
  type: 'natural_language'
})
```

---

## 使用パターン

### パターン1: ボットが発話する（LLMプロジェクト）

```javascript
const message = 'こんにちは！木材を集めましょうか？'

// 1. コンソールにログ出力
bot.systemLog(`-> player1: ${message}`)

// 2. Minecraftチャットに送信
await bot.speak('player1', message)

// 3. 会話履歴に記録
bot.addMessage(bot.username, message, 'bot_response')
```

### パターン2: ユーザーの発言を記録

```javascript
// whisperイベントハンドラ内で
bot.on('whisper', (username, message) => {
  if (!message.startsWith('!')) {
    // 自然言語メッセージとして記録
    bot.addMessage(username, message, 'natural_language')
  }
})
```

### パターン3: システム情報を記録

```javascript
// GOAPエラーなど
const errorMsg = 'GOAP診断: 材料不足\n必要: ダイヤモンド x2'

bot.systemLog(errorMsg)  // コンソール出力
bot.addMessage(bot.username, errorMsg, 'system_info')  // 履歴に記録
```

### パターン4: LLM用に会話履歴を取得

```javascript
// 自然言語メッセージとボット応答のみを取得
const naturalHistory = bot.getConversationHistory({ type: 'natural_language' })
const botResponses = bot.getConversationHistory({ type: 'bot_response' })

// 両方を結合して時系列順にソート
const llmHistory = [...naturalHistory, ...botResponses]
  .sort((a, b) => a.timestamp - b.timestamp)

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
  speaker: string        // 発言者の実名（Bot1, Bot2, player など）
  role: string          // このボット視点での役割（"assistant" | "user"）
  content: string       // メッセージ内容
  type: string          // メッセージタイプ（"natural_language" | "bot_response" | "system_info"）
  timestamp: number     // タイムスタンプ（ミリ秒）
}
```

### `role` フィールドについて

- `"assistant"`: `speaker === bot.username`（ボット自身の発言）
- `"user"`: `speaker !== bot.username`（それ以外の発言）

これはOpenAI APIなどのLLM向けに、ボット視点での役割を示すために自動計算されます。

### `type` フィールドについて

| type | 説明 | 使用例 |
|------|------|--------|
| `natural_language` | 人間の自然言語メッセージ | プレイヤーの発言 |
| `bot_response` | ボットの発話（LLM生成） | ボットの返答 |
| `system_info` | システム診断情報 | GOAPエラー、デバッグ情報 |

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

**エラー時**: 材料不足などの診断情報が`system_info`として会話履歴に記録されます

---

### `!creative <category> <action> [json_params]` - クリエイティブアクション

GOAPで扱えない創造的な行動を実行します。

**カテゴリ**:
- `nav` (navigation) - ナビゲーション
- `vis` (vision) - 視覚機能

**使用例**:
```
/w Bot1 !creative nav register {"name": "home"}
/w Bot1 !creative nav goto {"name": "home"}
/w Bot1 !creative nav gotoCoords {"x": 250, "y": 64, "z": -100}
/w Bot1 !creative nav list
/w Bot1 !creative vision capture {}
```

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
- それ以外のメッセージ → `natural_language`として会話履歴に自動追加

### 2. `bot.speak()`と`bot.addMessage()`の関係

`bot.speak()`はMinecraftチャットへの送信のみを行います。会話履歴には自動的に追加**されません**。

ボットが発話した内容を会話履歴に残したい場合は、必ず`bot.addMessage()`も呼んでください。

### 3. 会話履歴は揮発性

ボットを再起動すると会話履歴はクリアされます。永続化が必要な場合は、別途データベースやファイルに保存する必要があります。

---

## 例: LLMプロジェクトでの使用

```javascript
const { createAIBot } = require('planner_bot/src/bot/ai_bot')

const bot = createAIBot(1, config, observerPool)

// LLMに会話履歴を渡す
async function getResponseFromLLM(username) {
  // 自然言語メッセージのみ取得（システム情報を除外）
  const history = bot.getConversationHistory()
    .filter(msg => msg.type !== 'system_info')
    .map(msg => ({
      role: msg.role,
      content: msg.content
    }))

  // LLM APIに送信（例: OpenAI）
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: history
  })

  const reply = response.choices[0].message.content

  // ボットの応答を送信＆記録
  bot.systemLog(`-> ${username}: ${reply}`)
  await bot.speak(username, reply)
  bot.addMessage(bot.username, reply, 'bot_response')
}
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
