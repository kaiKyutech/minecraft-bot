# Minecraft GOAPボット - プロジェクト仕様書

## プロジェクトの目的

このボットは**コマンド専用のMinecraft GOAPボット**です。

- **ユーザーモード**: 人間が直接使う（スタンドアロン実行）
- **システムモード**: 他のプロジェクトから`npm install`してライブラリとして使う

---

## 動作モード

### 1. ユーザーモード（user mode）

**用途:** 人間が直接ボットを使う

**実行方法:**
```bash
node planner_bot/index.js
```

**動作:**
- ✅ Minecraftサーバーに接続
- ✅ ウィスパーで`!`コマンドを受け付ける
- ✅ コンソールに詳細ログ出力（GOAP情報全て）
- ✅ Minecraftチャット（ウィスパー）に結果を返信
  - 成功時: 成功メッセージ
  - 失敗時: 失敗メッセージ + なぜ失敗したのか（診断情報）

**通信方式:**
```
人間 → Minecraftチャット（/msg PlannerBot !goal ...）
       ↓
    GOAPボット
       ↓
    Minecraftチャット（ウィスパー返信）→ 人間
```

---

### 2. システムモード（system mode）

**用途:** 他のプロジェクト（LLMエージェント等）から`npm install`してライブラリとして使う

**実行方法:**
```javascript
// 他のプロジェクト（LLMエージェント等）
const { createGoapBot } = require('minecraft-goap-bot')

const bot = await createGoapBot({
  host: 'localhost',
  port: 25566,
  username: 'GoapBot1',
  mode: 'system'
})

// 内部でコマンド実行（Minecraftチャット経由ではない）
const result = await bot.executeGoal('inventory.iron_ingot:1')
console.log(result)
```

**動作:**
- ✅ Minecraftサーバーに接続
- ❌ ウィスパー/チャット入力を完全無視
- ✅ コンソールに詳細ログ出力（GOAP情報全て）
- ❌ Minecraftチャットには一切出力しない
  - アクション完了メッセージも出さない
  - 成功/失敗メッセージも出さない
  - 完全無音
- ✅ プログラマティックAPIで制御
  - `bot.executeGoal(goal)` - Promise を返す
  - `bot.executeSkill(skill, params)` - Promise を返す
  - `bot.getStatus()` - Promise を返す

**通信方式:**
```
LLMエージェント（別プロジェクト）
    ↓ npm install minecraft-goap-bot
    ↓ const bot = require('minecraft-goap-bot')
    ↓ await bot.executeGoal(...)
    ↓
GOAPボット（ライブラリとして動作）
    ↓
Minecraftサーバー（アクション実行）
    ↓
結果を Promise で返す → LLMエージェント
```

---

## コマンド一覧（ユーザーモード）

### 1. `!goal <goal_state>`
GOAP目標を実行

**例:**
```
!goal inventory.iron_ingot:1
!goal inventory.diamond_pickaxe:1
!goal equipment.diamond_helmet:true
```

### 2. `!skill <skill_name> [json_params]`
スキルを直接実行

（詳細は実装により異なる）

### 3. `!status`
ボットの現在状態を取得

**出力内容:**
- 位置（座標）
- 時間（昼/夜）
- インベントリ（道具・素材）
- 近くのリソース・構造物

### 4. `!primitive <primitive_name> [json_params]`
プリミティブアクションを実行

（詳細は実装により異なる）

### 5. `!creative <action> [json_params]`
Creative Actions（非決定論的タスク）を実行

（詳細は実装により異なる）

---

## プログラマティックAPI（システムモード）

```javascript
const { createGoapBot } = require('minecraft-goap-bot')

// ボット作成
const bot = await createGoapBot({
  host: 'localhost',
  port: 25566,
  username: 'GoapBot1',
  mode: 'system'
})

// 目標実行
try {
  const result = await bot.executeGoal('inventory.iron_ingot:1')
  console.log('成功:', result)
  // { success: true, goal: 'inventory.iron_ingot:1', steps: 8, ... }
} catch (error) {
  console.error('失敗:', error.message)
  console.error('診断:', error.diagnosis)
}

// 状態取得
const status = await bot.getStatus()
console.log(status)

// スキル実行
await bot.executeSkill('gather', { block: 'oak_log', count: 10 })

// プリミティブ実行
await bot.executePrimitive('moveTo', { x: 100, y: 64, z: 100 })
```

---

## ログ出力

### コンソール出力（両モード共通）

**常に詳細なログを出力:**
- GOAPプラン生成過程
- 各アクションの実行状況
- スキル実行の詳細
- エラー・診断情報

**例:**
```
[GOAP] Planning for goal: inventory.iron_ingot:1
=== GOAP PLAN DETAILS ===
目標: inventory.iron_ingot:1
プラン長: 8 ステップ
詳細:
  1. gather_logs
     スキル: gather
     パラメータ: {"block": "oak_log", "count": 3}
     コスト: 10
  2. craft_planks
     スキル: craft
     ...
総コスト: 85
========================
[EXECUTOR] Executing step 1/8: gather_logs
[SKILL] Gathering oak_log...
[EXECUTOR] Step 1/8 completed
...
```

### Minecraftチャット出力

**ユーザーモード:**
- ✅ ウィスパーで送信元に返信
- ✅ 成功時: 成功メッセージ
- ✅ 失敗時: 失敗メッセージ + 診断情報

**システムモード:**
- ❌ 完全無音（一切出力しない）

---

## 設定ファイル（config/bot_settings.yaml）

```yaml
# モード: user（スタンドアロン） / system（ライブラリ）
mode: "user"

# ユーザーモード設定
user_mode:
  # Minecraftチャット入力を受け付ける
  accept_chat_commands: true

  # Minecraftチャット出力
  chat_output: true
  chat_on_success: true   # 成功時にメッセージを送る
  chat_on_failure: true   # 失敗時にメッセージ + 診断を送る

  # コンソール出力
  console_output: true

# システムモード設定
system_mode:
  # Minecraftチャット入力を無視
  accept_chat_commands: false

  # Minecraftチャット出力なし
  chat_output: false

  # コンソール出力のみ
  console_output: true
```

---

## package.json 構成

```json
{
  "name": "minecraft-goap-bot",
  "version": "1.0.0",
  "main": "planner_bot/lib.js",
  "bin": {
    "goap-bot": "planner_bot/index.js"
  },
  "exports": {
    ".": "./planner_bot/lib.js"
  }
}
```

**使い分け:**
- **スタンドアロン実行**: `node planner_bot/index.js` または `npx goap-bot`
- **ライブラリとして使用**: `const bot = require('minecraft-goap-bot')`

---

## LLMエージェント側の使用例

```javascript
// llm-agent/index.js
const { createGoapBot } = require('minecraft-goap-bot')

async function main() {
  // GOAPボットをライブラリとして起動
  const goapBot = await createGoapBot({
    host: 'localhost',
    port: 25566,
    username: 'GoapWorker1',
    mode: 'system'  // システムモード
  })

  // LLMが判断した目標を実行
  const goal = llmDecision()  // 例: 'inventory.iron_ingot:1'

  try {
    const result = await goapBot.executeGoal(goal)
    console.log('成功:', result)
  } catch (error) {
    console.error('失敗:', error.message)
    console.error('診断:', error.diagnosis)
  }
}

main()
```

---

## 環境変数

```bash
# ボット設定
BOT_MODE=user           # user / system
BOT_NAME=PlannerBot

# サーバー接続
MC_HOST=localhost
MC_PORT=25566
MC_USERNAME=PlannerBot
```

---

## 実装の優先順位

### Phase 1（完了済み）
- [x] LLMコードの削除
- [x] コマンド専用モードへの変更
- [x] ドキュメント更新

### Phase 2（次）
- [ ] ユーザーモード実装
  - [ ] `bot.on('whisper')` イベント処理
  - [ ] `bot.whisper()` による返信
  - [ ] 公開チャット無視
- [ ] システムモード実装
  - [ ] プログラマティックAPI (`executeGoal`, `getStatus`, etc.)
  - [ ] チャット入力完全無視
  - [ ] チャット出力完全無効化
- [ ] 設定システム
  - [ ] `config/bot_settings.yaml` 作成
  - [ ] モード切り替え機能

### Phase 3（将来）
- [ ] APIドキュメント作成
  - [ ] `doc/bot-api.md` (English)
  - [ ] `doc/bot-api.ja.md` (Japanese)
- [ ] npm package 化
  - [ ] `package.json` 整備
  - [ ] エクスポート設定

---

## 設計哲学

### 1. デュアルモード設計
- **ユーザーモード** = スタンドアロン実行（人間向け）
- **システムモード** = ライブラリ実行（プログラム向け）

### 2. 分離の原則
- **ボット** = コマンド実行エンジン（このリポジトリ）
- **LLMエージェント** = 戦略的判断（別リポジトリ）
- npm パッケージとして疎結合

### 3. 透明性
- コンソールログは常に詳細（両モード共通）
- Minecraftチャット出力はモードで制御
- 失敗原因は必ず報告（コンソールまたはAPIレスポンス）

---

## まとめ

このボットは：

1. **デュアルモード対応** - ユーザーモード（人間向け）とシステムモード（ライブラリ）
2. **ウィスパー専用（ユーザーモード）** - `/msg`でのみコマンド受付
3. **プログラマティックAPI（システムモード）** - `npm install`して直接関数呼び出し
4. **設定可能な出力** - モードに応じて制御
5. **完全な透明性** - コンソールログは常に詳細
