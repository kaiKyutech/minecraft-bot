# Chat System Design

## 概要

ボットが距離ベースで近くのプレイヤーとコミュニケーションできるシステム。
外部LLMがボットを通じてプレイヤーと自然な会話を行うための機能。

---

## 既存の実装（確認済み）

### メッセージシステム（`ai_bot.js` に実装済み）

3つの独立したメッセージ機能:

1. **`bot.systemLog(message)`** - コンソール出力専用
   - デバッグ、進捗報告用

2. **`bot.speak(username, message)`** - Whisper送信
   - 内部で `bot.whisper(username, message)` を呼び出し
   - プレイヤーへのメッセージ送信用

3. **`bot.addMessage(speaker, content, type)`** - 会話履歴への追加
   - `content`: 文字列 or 構造化データ（オブジェクト）
   - `type`: `'conversation'` (会話) or `'system_info'` (システム情報)
   - 自動でロール判定（`assistant` = 自分、`user` = 他人）
   - 履歴上限: 100メッセージ（FIFOキュー）

### 会話履歴システム（実装済み）

- **取得コマンド**: `!history` または `!history <username>`
- **API**: `bot.getConversationHistory(options)`
  - `options.username`: 特定ユーザーの発言のみ
  - `options.usernames`: 複数ユーザーの発言のみ
  - `options.type`: 特定タイプのメッセージのみ

### Whisper受信（実装済み）

`ai_bot.js` で実装:
- `!`コマンド → `handleChatCommand()` へ
- 自然言語 → `bot.addMessage(username, message, 'conversation')` で会話履歴に自動追加

---

## 新規実装する機能

### 1. 近くのプレイヤー情報取得（`!info all` に追加）

**目的**: 会話可能な範囲にいるプレイヤーを把握

**実装内容**: `!info all` の返却データに `nearbyPlayers` フィールドを追加

**返却データ形式**:
```json
{
  "inventory": { /* 既存 */ },
  "position": { /* 既存 */ },
  "locations": { /* 既存 */ },
  "nearbyPlayers": {
    "players": [
      {
        "username": "Steve",
        "position": {"x": 105, "y": 64, "z": 210},
        "distance": 8,
        "health": 20
      }
    ],
    "summary": {
      "totalPlayers": 1,
      "nearestPlayer": "Steve",
      "nearestDistance": 8
    }
  }
}
```

**実装場所**: `planner_bot/src/commands/info_command.js`
- `getNearbyPlayersInfo()` 関数を新規作成
- `getAllInfo()` 関数に統合

---

### 2. Whisper送信コマンド（`!chat`）✅ 実装済み

**目的**: 距離チェック付きで指定したプレイヤーにwhisperでメッセージを送信する

**コマンド名**: `!chat`

**コマンド形式**:
```
# 簡易形式（デフォルト距離15ブロック）
!chat <username> <message>

# JSON形式（距離カスタマイズ可能、最大100ブロック）
!chat {"username": "PlayerName", "message": "Hello!", "maxDistance": 30}
```

**使用例**:
```
!chat RitsukaAlice hello!
!chat Steve How are you?
!chat {"username": "PlayerName", "message": "I found diamonds nearby!", "maxDistance": 50}
```

**動作**:
1. 対象プレイヤーの存在確認
2. エンティティ情報取得（距離計算に必要）
3. 距離チェック（デフォルト15ブロック、最大100ブロック）
4. 距離内なら `bot.speak(username, message)` でwhisper送信
5. **会話履歴に構造化データとして記録**（送信成功・失敗どちらも）
6. **相手がボットの場合**: 相手のwhisperイベントで受信 → 相手の会話履歴に `'conversation'` タイプで自動記録

**返却データ（成功時）**:
```json
{
  "success": true,
  "targetUsername": "RitsukaAlice",
  "distance": 12,
  "maxDistance": 15,
  "message": "hello!"
}
```

**返却データ（失敗時）**:
```json
{
  "success": false,
  "reason": "out_of_range",
  "targetUsername": "PlayerName",
  "distance": 47,
  "maxDistance": 15
}
```

**会話履歴の記録形式**:
```json
{
  "speaker": "Bot1",
  "role": "assistant",
  "content": {
    "message": "hello!",
    "delivered": true,
    "targetUsername": "RitsukaAlice",
    "distance": 12,
    "maxDistance": 15
  },
  "type": "conversation",
  "timestamp": 1234567890
}
```

**実装場所**: `planner_bot/src/commands/index.js`

---

### メッセージ受信の即時通知（イベント駆動）

**問題**: `!history` コマンドを実行しない限り、話しかけられても気づかない

**解決策**: イベント駆動アーキテクチャで即座に通知

#### 仕組み

**ボット側（Planner Bot）**:
```javascript
// planner_bot/src/bot/ai_bot.js
bot.on('whisper', async (username, message) => {
  if (username === bot.username) return

  if (message.startsWith('!')) {
    // コマンド処理
    await handleChatCommand(bot, username, message, stateManager)
    return
  }

  // 自然言語メッセージ
  bot.addMessage(username, message, 'conversation')

  // 即時通知イベントを発火（新規）
  bot.emit('newNaturalMessage', {
    from: username,
    content: message,
    timestamp: Date.now()
  })
})
```

**外部LLMプロジェクト側（同一Nodeプロセス内）**:
```javascript
const { createAIBot } = require('./planner_bot/src/bot/ai_bot')
const { handleChatCommand } = require('./planner_bot/src/commands')

const bot = createAIBot(1, config)
const stateManager = createStateManager()

// メッセージ受信時に即座に反応
bot.on('newNaturalMessage', async (data) => {
  console.log(`[NEW MESSAGE] ${data.from}: ${data.content}`)

  // LLMで処理
  const response = await processWithLLM(data.content)

  // 返答を送信
  await handleChatCommand(bot, 'system', `!chat ${data.from} ${response}`, stateManager)
})
```

#### メリット

- ✅ **即座に反応**: whisper受信と同時に処理開始
- ✅ **ポーリング不要**: `!history` を定期的にチェックする必要なし
- ✅ **同一プロセス内**: HTTP通信不要、直接イベントリスナーで処理
- ✅ **既存システムと両立**: 会話履歴システムはそのまま動作

#### 通信方式の比較

| 方式 | 用途 | メリット | デメリット |
|------|------|---------|-----------|
| **イベント駆動** | 同一Nodeプロセス | 即座、シンプル | 同一プロセス必須 |
| HTTP Webhook | 別プロセス/別マシン | プロセス分離可能 | 複雑、遅延 |
| ポーリング (`!history`) | 任意 | 実装済み、汎用的 | 遅延、効率悪い |

**結論**: 同一Nodeプロジェクトから使用する場合は **イベント駆動** が最適。HTTP通信は不要。

---

#### ボット間通信の例

**シナリオ**: Bot1がBot2に話しかける

1. 外部LLM: `!chat Bot2 Hello!` をBot1に送信
2. Bot1: 距離チェック → `bot.speak('Bot2', 'Hello!')` でwhisper送信 → 構造化データとして会話履歴に記録
3. Bot2: whisperイベントで受信 → `bot.addMessage('Bot1', 'Hello!', 'conversation')`
4. Bot2: `bot.emit('newNaturalMessage', {...})` で即座に通知（Phase 3で実装予定）
5. 外部LLM: Bot2の `newNaturalMessage` イベントをリッスン → 即座に処理

このように、ボット同士でもwhisperを使って会話が可能で、各ボットの会話履歴に自動的に記録される。

---

## 実装順序

### Phase 1: `!info all` にプレイヤー情報追加 ✅ 完了
1. ✅ `getNearbyPlayersInfo(bot, stateManager, worldState)` 関数実装
   - `bot.players` を使用してプレイヤー情報取得
   - 距離計算
   - サマリー生成
2. ✅ `getAllInfo()` に統合
3. ✅ テスト

### Phase 2: `!chat` コマンド実装 ✅ 完了
1. ✅ `commands/index.js` に `!chat` コマンド実装
   - 簡易形式: `!chat <username> <message>`
   - JSON形式: `!chat {"username": "...", "message": "...", "maxDistance": 30}`
   - 距離チェック（デフォルト15、最大100ブロック）
   - `bot.speak(username, message)` でwhisper送信
   - 構造化データとして会話履歴に記録（`type: 'conversation'`）
2. ✅ `startup.js` のコマンド例を更新
3. ✅ 会話履歴の `type` を `'conversation'` と `'system_info'` の2種類に統一

### Phase 3: メッセージ受信即時通知 ⏸️ 保留
1. ⏸️ `bot/ai_bot.js` のwhisperイベントハンドラに追加
   - 自然言語メッセージ受信時に `bot.emit('newNaturalMessage', {...})` を発火
2. ⏸️ ドキュメント更新（API.md）
3. ⏸️ 外部LLMプロジェクトでの使用例を追加

---

## ディレクトリ構造

```
planner_bot/
├── src/
│   ├── commands/
│   │   ├── chat_command.js       (新規)
│   │   ├── info_command.js       (更新)
│   │   └── index.js              (更新)
│   └── bot/
│       └── ai_bot.js             (既存 - 変更不要)
└── doc/planner_bot/
    ├── API.md                    (更新予定)
    └── CHAT_SYSTEM.md            (このファイル)
```

---

## 使用例シナリオ

### シナリオ1: プレイヤーがボットに話しかける

1. プレイヤー: `/w PlannerBot Hey, can you find some wood?`
2. ボット: whisperイベント検知 → `bot.addMessage(username, message, 'conversation')` で会話履歴に追加（**実装済み**）
3. 外部LLM: `!history` で新着メッセージ取得（**実装済み**）
4. 外部LLM: 内容を理解して返答を生成
5. 外部LLM: `!chat Steve Sure! I'll gather wood for you.`
6. ボット: 距離チェック → 範囲内なら `bot.speak('Steve', message)` で whisper送信 → 構造化データとして会話履歴に追加

### シナリオ2: ボットが周囲のプレイヤーに話しかける

1. 外部LLM: `!info all` で周囲を確認（プレイヤー情報含む）
2. 外部LLM: Steveが8ブロック先にいることを確認
3. 外部LLM: `!chat Steve Hi Steve! Need any help?`
4. ボット: 距離チェック（8ブロック < 15ブロック） → `/w Steve Hi Steve! Need any help?` を送信

---

## 技術的考慮事項

### プレイヤー情報の取得

Mineflayerの `bot.players` オブジェクトを使用:
```javascript
const player = bot.players[username]
if (player && player.entity) {
  const distance = bot.entity.position.distanceTo(player.entity.position)
  const position = player.entity.position
  const health = player.entity.health  // 可能な場合
}
```

### 距離計算

ユークリッド距離:
```javascript
const distance = Math.sqrt(
  Math.pow(pos1.x - pos2.x, 2) +
  Math.pow(pos1.y - pos2.y, 2) +
  Math.pow(pos1.z - pos2.z, 2)
)
```

### エラーハンドリング

- プレイヤーが存在しない: `{success: false, reason: "Player not found"}`
- プレイヤーのエンティティが取得できない: `{success: false, reason: "Player entity not available"}`
- 距離外: `{success: false, reason: "Player is too far away"}`

---

## 将来の拡張案

- **グループ送信**: `target: "all"` で範囲内の全プレイヤーに送信
- **音量レベル**: `volume: "loud"` で距離制限を拡大（例: 32ブロック）
- **公開チャット**: `bot.chat()` を使用した全体発言
- **自動応答**: 特定キーワードに対する自動返信

---

## API.md への追記内容

`!chat say` コマンドを API.md の「コマンドシステム」セクションに追記予定。
