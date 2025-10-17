# リファクタリング計画: LLM部分削除・ボット専用化

**ブランチ**: `botonly`
**目的**: このリポジトリをGOAPボット（コマンド制御）専用にする
**日付**: 2025-10-17

---

## 🎯 目標

このリポジトリを **!コマンドで制御するMinecraft GOAPボット専用** にする。

### 対象コマンド
- `!goal <goal_string>` - GOAP目標実行
- `!skill <skill_name> [params]` - スキル直接実行
- `!status` - 状態確認
- `!primitive <primitive_name> [params]` - プリミティブ実行

### 削除対象
- LLM関連コード全て
- 自然言語処理機能
- LLMプロバイダ連携

---

## 📋 削除対象ファイル・ディレクトリ

### 完全削除
```
planner_bot/src/llm/                        # LLM関連全て
├── client.js
├── command_handler.js
├── gemini_client.js
├── llm_handler.js
├── prompt_builder.js
├── providers/
│   ├── base_provider.js
│   ├── gemini_provider.js
│   └── index.js
└── tools/
    └── item_database.js
```

### 保持（重要）
```
planner_bot/src/commands/creative_command.js  # ✅ ボットのコア機能として保持
planner_bot/src/creative_actions/            # ✅ Navigation等のCreative Actions
```

**理由**: `!creative` コマンドは、Navigation/Exploration/Building などボットの重要機能を担当。
LLMが使うコマンドとして、開発者が直接使うコマンドとして必要。

### package.json から削除する依存関係
```json
"@google/generative-ai": "^0.21.0"  # Gemini SDK
"dotenv": "^16.4.7"                 # 環境変数（必要なら残す）
```

---

## ✏️ 修正対象ファイル

### 1. `planner_bot/index.js` (メインエントリーポイント)

**削除する機能:**
- LLMハンドラの初期化（10-11行目、36-51行目）
- LLM関連のチャットイベントハンドラ（108-136行目）
- `llmContext`, `chatHistory` の管理（17-21行目、83-91行目）
- `currentAbortController` の管理（24行目、102-106行目、109-135行目）

**残す機能:**
- Mineflayer接続
- !コマンドのパース（100-107行目）
- コマンドハンドラへのディスパッチ
- `bot.chatWithDelay` ヘルパー（54-69行目）

**修正例:**
```javascript
// ❌ 削除（10-11行目）
const { handleUserMessage } = require('./src/llm/llm_handler')
const llmClient = require('./src/llm/client')

// ❌ 削除（17-21行目）
const llmContext = {
  chatHistory: [],
  lastCommandResult: null
}

// ❌ 削除（24行目）
let currentAbortController = null

// ❌ 削除（36-51行目）
const llmProvider = process.env.LLM_PROVIDER || 'gemini'
// ... LLM初期化コード

// ✅ 修正後（77-107行目を簡略化）
bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  console.log(`[CHAT RECEIVED] ${username}: ${message}`)

  // コマンド以外は無視
  if (!message.startsWith('!')) {
    console.log(`[CHAT] Ignoring non-command message: "${message}"`)
    return
  }

  try {
    await stateManager.refresh(bot)
    await handleChatCommand(bot, username, message, stateManager)
  } catch (error) {
    console.error('command execution error', error)
    await bot.chatWithDelay(`Error: ${error.message}`)
  }
})
```

---

### 2. `planner_bot/src/commands/index.js`

**修正不要:**
- `creative_command` は保持（ボットのコア機能）
- 全てのコマンドハンドラはそのまま

---

### 3. `README.md` / `CLAUDE.md`

**更新内容:**
- LLM機能の説明を削除
- コマンド制御の説明を強化
- **ボットの位置づけを明確化**:
  - 「このボットはコマンド専用」
  - 「LLMと連携する場合は別リポジトリで実装」
- 環境変数から `GEMINI_API_KEY`, `LLM_PROVIDER` などを削除
- ボットの設計思想（3層アーキテクチャ）は保持

### 4. `.env.example`

**更新内容:**
- LLM関連の環境変数を削除:
  - `GEMINI_API_KEY`
  - `LLM_PROVIDER`
  - `LLM_MODEL`
- Minecraft接続設定のみ残す

---

## 🔧 リファクタリング手順

### Phase 1: 削除（破壊的変更）

**ステップ:**
1. `planner_bot/src/llm/` ディレクトリを完全削除
2. `planner_bot/src/commands/creative_command.js` を削除
3. `package.json` から不要な依存関係を削除
4. Git コミット: `"Remove LLM components - convert to command-only bot"`

### Phase 2: index.js の修正

**ステップ:**
1. LLM関連のimportを削除（10-11行目）
2. LLM初期化コードを削除（36-51行目）
3. `llmContext`, `currentAbortController` を削除（17-21, 24行目）
4. チャットイベントを簡略化（77-141行目 → 簡潔なコマンド処理のみ）
5. 会話履歴管理を削除（83-91行目）
6. 動作確認
7. Git コミット: `"Refactor index.js - command-only mode"`

**注意:**
- `bot.chatWithDelay` は保持（コマンド実行で使用）
- `stateManager` は保持
- `handleChatCommand` は保持

### Phase 3: ドキュメント更新

**ステップ:**
1. `README.md` を更新
2. `CLAUDE.md` を更新
3. `.env.example` を更新（LLM関連の環境変数削除）
4. Git コミット: `"Update documentation for command-only bot"`

### Phase 4: クリーンアップ

**ステップ:**
1. 未使用コードのチェック
2. import文の整理
3. コメントの更新
4. Git コミット: `"Code cleanup and final adjustments"`

---

## ✅ 完了基準

### テスト項目
- [ ] `!goal inventory.iron_ingot:1` が動作する
- [ ] `!skill gather` が動作する
- [ ] `!status` が動作する
- [ ] `!primitive moveTo {"x": 100, "y": 64, "z": 100}` が動作する
- [ ] 自然言語メッセージを送っても何も起こらない（無視される）
- [ ] `npm install` でエラーが出ない
- [ ] `node planner_bot/index.js` でボットが起動する

### コード品質
- [ ] LLM関連のimportが残っていない
- [ ] 使われていない依存関係がない
- [ ] README.mdが正確

---

## 🚨 注意事項

### Git 管理
- 作業は `botonly` ブランチで実施
- 各Phase終了後にコミット
- 問題があれば `master` に戻せる

### 依存関係
- `dotenv` は環境変数管理に使うので、必要なら残す
- `yaml` はconfig読み込みに必要（削除しない）
- `mineflayer` 関連は全て残す

### 互換性
- 既存の !コマンドの動作は維持
- GOAP機能には一切影響を与えない
- config/ の YAML ファイルは変更しない

---

## 📝 進捗記録

| Phase | 状態 | 完了日 | 備考 |
|-------|------|--------|------|
| Phase 1: 削除 | ✅ 完了 | 2025-10-17 | planner_bot/src/llm/ 削除完了 |
| Phase 2: index.js修正 | ✅ 完了 | 2025-10-17 | コマンド専用モードに変更 |
| Phase 3: ドキュメント更新 | ✅ 完了 | 2025-10-17 | CLAUDE.md 更新完了 |
| Phase 4: package.json更新 | ✅ 完了 | 2025-10-17 | @google/genai 削除完了 |

---

## 🔄 ロールバック手順

万が一問題が発生した場合:

```bash
# botonly ブランチを破棄して master に戻る
git checkout master
git branch -D botonly

# または特定のコミットに戻る
git reset --hard <commit-hash>
```

---

## 📚 参考情報

### 保持するコアコンポーネント
- `src/planner/goap.js` - GOAPプランナー
- `src/planner/state_builder.js` - 状態構築
- `src/planner/state_manager.js` - 状態管理
- `src/executor/goap_executor.js` - プラン実行
- `src/skills/` - 全スキル
- `src/primitives.js` - プリミティブアクション
- `src/commands/goal_command.js` - ゴールコマンド
- `src/commands/skill_command.js` - スキルコマンド
- `src/commands/status_command.js` - ステータスコマンド
- `src/commands/primitive_command.js` - プリミティブコマンド
- `config/` - YAML設定ファイル

---

## 設計方針: ボットとLLMの分離

### ボット側（このリポジトリ）
**責任**: コマンド実行専門
- `!goal` - GOAP実行
- `!creative` - Navigation/Exploration/Building
- `!skill` - スキル直接実行
- `!status` - 状態取得
- `!primitive` - プリミティブ実行

**使用者**:
1. 開発者が直接コマンドをテスト
2. LLMエージェント（別リポジトリ）がコマンドを発行

**特徴**:
- ✅ コマンド専用（自然言語は無視）
- ✅ LLM依存なし
- ✅ 単体でテスト可能
- ✅ `doc/llm-civilization-architecture.md` の設計思想を保持

---

### LLM側（別リポジトリで実装）
**責任**: 戦略的判断
- 自然言語を理解
- 状況を分析
- コマンドを生成（`!goal`, `!creative` など）
- ボットに送信

**実装方針**:
- LangChain Tool Calling
- このボットを「ツール」として使用
- ボット側のコードに一切依存しない

**例**:
```javascript
const agent = new LangChainAgent({
  tools: [
    { name: 'goal', func: (goal) => bot.chat(`!goal ${goal}`) },
    { name: 'creative', func: (action, params) => bot.chat(`!creative ${action} ${JSON.stringify(params)}`) }
  ]
})
```

---

## 次のステップ

このリファクタリング完了後:
1. ボットのコマンド仕様をドキュメント化
2. 使用例の充実化（コマンド使用例）
3. （別リポジトリで）LangChain版LLMエージェントの開発
   - このボットを import せずに、Minecraft チャット経由で使用
