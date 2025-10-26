# TODO - 必須実装項目

このファイルは **絶対に実装しなければならない機能** を管理します。

- **このファイル (TODO.md)**: 必須実装項目（優先度: 高）
- **ISSUES.md**: 気が向いたら実装する項目（優先度順）


---

## 2. GOAP実行中の中断機能

**目的**: GOAP (`!goal`) 実行中にタスクを中断できるようにする

**現状**:
- GOAP実行中は完了するまで止められない
- プレイヤーが話しかけても応答できない
- 緊急時に止める手段がない

**実装内容**:
```javascript
// GOAP実行を中断
!stop
```

**実装箇所**:
- `planner_bot/src/executor/goap_executor.js` - AbortController/AbortSignal 対応
- `planner_bot/src/commands/index.js` - `!stop` コマンド追加
- `planner_bot/src/bot/ai_bot.js` - 実行中のAbortControllerを保持

**技術的アプローチ**:

### Option 1: AbortController (推奨)
```javascript
// bot に AbortController を保持
bot.currentAbortController = null

// !goal 実行時
if (trimmed.startsWith('!goal ')) {
  const abortController = new AbortController()
  bot.currentAbortController = abortController

  try {
    await handleGoalCommand(bot, username, goalName, stateManager, abortController.signal)
  } finally {
    bot.currentAbortController = null
  }
}

// !stop 実行時
if (trimmed === '!stop') {
  if (bot.currentAbortController) {
    bot.currentAbortController.abort()
    bot.systemLog('GOAP execution aborted')
    return { success: true, message: 'Task cancelled' }
  } else {
    return { success: false, message: 'No task running' }
  }
}
```

### executor での対応
```javascript
async function executePlanWithReplanning(bot, goalName, plan, stateManager, signal) {
  for (const step of plan) {
    // シグナルチェック
    if (signal && signal.aborted) {
      throw new Error('Task cancelled by user')
    }

    await executeStep(bot, step, stateManager)

    // 各ステップ後もチェック
    if (signal && signal.aborted) {
      throw new Error('Task cancelled by user')
    }
  }
}
```

**必要な変更**:
1. `ai_bot.js` に `bot.currentAbortController` プロパティ追加
2. `!goal` 実行時に AbortController 作成・保持
3. `!stop` コマンド追加
4. `goap_executor.js` で signal.aborted をチェック
5. スキル実行中も定期的に signal チェック
6. 中断時のクリーンアップ処理

**返却値**:
```json
{
  "success": true,
  "message": "Task 'inventory.diamond_pickaxe:1' cancelled"
}
```

**実装状況**: ✅ 完了

**実装内容**:
1. ✅ `ai_bot.js` に `bot.currentAbortController` プロパティ追加
2. ✅ `!goal` 実行時に AbortController 作成・保持
3. ✅ `!stop` コマンド追加
4. ✅ `goap_executor.js` で各アクション実行前に signal.aborted チェック（既存実装を確認）
5. ✅ 中断時のエラーハンドリング（AbortError）
6. ✅ startup.js のコマンド例を更新

**使用例**:
```javascript
// GOAP実行
!goal inventory.diamond_pickaxe:1

// 別のwhisperで中断
!stop
```

**返却値**:
```json
// 中断成功
{ "success": true, "message": "タスクを中断しました" }

// タスクなし
{ "success": false, "message": "実行中のタスクがありません" }

// GOAP側の返却値（中断された場合）
{ "success": false, "goal": "...", "aborted": true, "error": "Cancelled" }
```

---

## 3. メッセージ受信の即時通知（イベント駆動）

**目的**: GOAP実行中でもプレイヤーからのメッセージに即座に反応できるようにする

**現状**:
- whisperを受信すると会話履歴に自動追加される ✅
- しかし、LLMプロジェクトは `!history` をポーリングしないと新着メッセージに気づけない
- GOAP実行中は他の処理ができず、メッセージに反応できない

**実装内容**:

### Phase 3-1: イベント発火（ボット側）

`planner_bot/src/bot/ai_bot.js` を修正:

```javascript
bot.on('whisper', async (username, message) => {
  if (username === bot.username) return

  bot.systemLog(`Whisper from ${username}: ${message}`)

  // コマンド処理
  if (message.startsWith('!')) {
    try {
      await handleChatCommand(bot, username, message, stateManager)
    } catch (error) {
      bot.systemLog(`Command error: ${error.message}`)
    }
    return
  }

  // 自然言語メッセージ: 会話履歴に追加
  bot.addMessage(username, message, 'conversation')
  bot.systemLog(`Natural language message added to conversation history`)

  // ★ 新規追加: 即時通知イベントを発火
  bot.emit('newNaturalMessage', {
    from: username,
    content: message,
    timestamp: Date.now()
  })
})
```

### Phase 3-2: LLMプロジェクト側での受信

```javascript
const { createAIBot } = require('./planner_bot/src/bot/ai_bot')
const { handleChatCommand } = require('./planner_bot/src/commands')
const stateManager = require('./planner_bot/src/planner/state_manager')()

const bot = createAIBot(1, config)

// メッセージ受信時に即座に反応
bot.on('newNaturalMessage', async (data) => {
  console.log(`[NEW MESSAGE] ${data.from}: ${data.content}`)

  // LLMで処理（GOAP実行中でも並行して動作）
  const response = await processWithLLM(data.content, bot)

  // 返答を送信
  await handleChatCommand(
    bot,
    'system',
    `!chat ${data.from} ${response}`,
    stateManager
  )
})
```

**メリット**:
- ✅ GOAP実行中でもメッセージに即座に反応
- ✅ ポーリング不要（効率的）
- ✅ 同一Nodeプロセス内で完結（HTTP不要）
- ✅ 既存の会話履歴システムと両立

**必要な変更**:
1. `ai_bot.js` の whisperイベントハンドラに `bot.emit('newNaturalMessage', {...})` を追加
2. API.md / CHAT_SYSTEM.md のドキュメント更新
3. 外部LLMプロジェクトでの使用例を追加

**実装箇所**: `planner_bot/src/bot/ai_bot.js` (5行追加のみ)

**実装状況**: ✅ 完了

**実装内容**:
1. ✅ `ai_bot.js` の whisperイベントハンドラに `bot.emit('newNaturalMessage', {...})` を追加（5行のみ）

**使用例（LLMプロジェクト側）**:
```javascript
const bot = createAIBot(1, config)

// ★ イベントリスナーを登録
bot.on('newNaturalMessage', async (data) => {
  console.log(`[MESSAGE] ${data.from}: ${data.content}`)

  // LLMで処理
  const decision = await callLLM(data.content)

  // 返答 or タスク実行
  await handleChatCommand(bot, 'system', `!chat ${data.from} ${decision.reply}`, stateManager)
})
```

**関連ドキュメント**: CHAT_SYSTEM.md に設計詳細あり

---

## 実装優先順位

1. ✅ **座標指定による場所登録** - 完了
2. ✅ **メッセージ受信の即時通知** - 完了
3. ✅ **GOAP中断機能** - 完了

---

## 完了チェックリスト

- [x] 座標指定による場所登録機能
  - [x] navigation/actions.js 修正
  - [x] startup.js 更新
  - [x] TODO.md 更新

- [x] メッセージ受信の即時通知
  - [x] ai_bot.js に `bot.emit('newNaturalMessage')` 追加
  - [x] TODO.md 更新

- [x] GOAP実行中の中断機能
  - [x] ai_bot.js に AbortController 保持機能追加
  - [x] `!stop` / `!cancel` コマンド追加
  - [x] goap_executor.js で signal チェック（既存実装を確認）
  - [x] エラーハンドリング追加
  - [x] startup.js 更新
  - [x] TODO.md 更新

---

## 🎉 全ての必須実装項目が完了しました！

planner_bot プロジェクトの基本機能は全て実装されました。
次のステップは LLMプロジェクトでの統合です。
