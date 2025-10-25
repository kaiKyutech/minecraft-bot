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

---

#### Navigation (`nav`) - 場所の登録と移動

##### `register` - 現在地を名前付きで登録

**パラメータ**:
- `name` (string, 必須): 場所の名前
- `blockType` (string, 省略可): 特定ブロックの位置を登録（例: "crafting_table"）

**使用例**:
```
/w Bot1 !creative navigation register {"name": "home"}
/w Bot1 !creative navigation register {"name": "workbench", "blockType": "crafting_table"}
```

**戻り値**:
```javascript
{
  success: true,
  message: "場所「home」を登録しました",
  location: { x: 100, y: 64, z: 200 }
}
```

---

##### `goto` - 登録済みの場所に移動

**パラメータ**:
- `name` (string, 必須): 移動先の場所名

**使用例**:
```
/w Bot1 !creative navigation goto {"name": "home"}
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
- `x` (number, 必須): X座標
- `y` (number, 必須): Y座標
- `z` (number, 必須): Z座標

**使用例**:
```
/w Bot1 !creative navigation gotoCoords {"x": 250, "y": 64, "z": -100}
```

**戻り値**:
```javascript
{
  success: true,
  message: "(250, 64, -100)に到着しました",
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
/w Bot1 !creative navigation moveInDirection {"distance": 10}

# 方向を指定して移動
/w Bot1 !creative navigation moveInDirection {"yaw": 90, "distance": 10}

# 洞窟の床を目指す
/w Bot1 !creative navigation moveInDirection {"yaw": 0, "distance": 15, "verticalMode": "below"}

# 洞窟から地上へ
/w Bot1 !creative navigation moveInDirection {"yaw": 180, "distance": 5, "verticalMode": "above"}

# 地表を歩く（洞窟に潜らない）
/w Bot1 !creative navigation moveInDirection {"yaw": 90, "distance": 20, "verticalMode": "surface"}
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
/w Bot1 !creative navigation follow {"username": "RitsukaAlice"}
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
/w Bot1 !creative navigation stopFollow {}
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

##### `list` - 登録済み場所の一覧

**パラメータ**: なし

**使用例**:
```
/w Bot1 !creative navigation list {}
```

**戻り値**:
```javascript
{
  success: true,
  message: "3個の場所が登録されています",
  locations: {
    "home": { x: 100, y: 64, z: 200 },
    "mine": { x: 50, y: 12, z: -30 },
    "workbench": { x: 102, y: 64, z: 198 }
  }
}
```

---

#### Vision (`vis` / `vision`) - 視覚システム

##### `capture` - 現在の視界のスクリーンショット

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
/w Bot1 !creative vision capture {}

# 視線方向指定
/w Bot1 !creative vision capture {"yaw": 0, "pitch": 0}

# 短距離用（5秒待機）
/w Bot1 !creative vision capture {"yaw": 90, "renderWait": 5000}

# 超遠距離用（15秒待機）
/w Bot1 !creative vision capture {"yaw": 0, "renderWait": 15000}
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

#### Chat (`chat`) - チャット・発話システム

##### `broadcast` - 範囲内プレイヤーへ発話（実装予定）

指定範囲内のプレイヤー全員にメッセージを送信します（`/w @a[distance=..N]`を使用）。

**パラメータ**:
- `message` (string, 必須): 発話内容
- `range` (number, オプション): 範囲（ブロック、デフォルト: 100）

**使用例**:
```
# 100ブロック内の全員に発話
/w Bot1 !creative chat broadcast {"message": "ダイアモンドを見つけました！"}

# 50ブロック内の全員に発話
/w Bot1 !creative chat broadcast {"message": "助けが必要です", "range": 50}
```

**戻り値**:
```javascript
{
  success: true,
  message: "範囲100ブロック内のプレイヤーに発話しました",
  broadcast: {
    content: "ダイアモンドを見つけました！",
    range: 100
  }
}
```

**用途**:
- LLMの出力をゲーム内で発話
- 発見した情報を周囲に共有
- マルチプレイヤーとの協調

---

##### `say` - 公開チャット発話（実装予定）

サーバー全体の公開チャットにメッセージを送信します。

**パラメータ**:
- `message` (string, 必須): 発話内容

**使用例**:
```
/w Bot1 !creative chat say {"message": "探索を開始します"}
```

**戻り値**:
```javascript
{
  success: true,
  message: "公開チャットに発話しました",
  content: "探索を開始します"
}
```

**注意**:
- サーバー全員に見えるため、スパム防止に注意
- 重要な通知のみに使用推奨

---

#### Exploration (`exploration`) - 探索システム

##### `scanBlocks` - 周辺ブロック情報取得

`!info scanBlocks` で利用する周辺環境スキャン。ボットを中心とした立方体範囲を走査し、指定条件に合致したブロック情報を JSON で返します。Mineflayer の `bot.findBlocks` を多重呼び出しするのではなく、チャンクキャッシュを直接走査するため広範囲でも高速です。

**パラメータ**:
- `range` (number, オプション): スキャン半径（デフォルト `32`、最小 `0`）。中心ブロックからのユークリッド距離で判定します。
- `type` / `types` (string | string[], オプション): 取得対象のブロック名。単一指定は `type`、複数指定は配列または `types` で渡します。省略時は非空気ブロック全て。
- `limit` (number, オプション): 収集するブロック数の上限（デフォルト `1000`、最小 `1`）。複数種類を指定した場合も合計件数で打ち切ります。
- `minYOffset` / `maxYOffset` (number, オプション): 上下方向の探索範囲を中心ブロックからの相対値で制限します（単位: ブロック）。未指定時は `-range` / `+range`。負値で下方向、正値で上方向を指定します。`minYOffset` ≤ `maxYOffset` を守ってください。
- `yaw` (number, オプション): 探索の基準方位（度数法）。省略時はボットの現在 yaw。0° が北（Z-）、90° が東（X+）。値は任意ですが 0〜360° の範囲に正規化して利用するのが推奨です。
- `coneAngle` (number, オプション): `yaw` を中心にした水平扇形の開き角（度数法）。0〜360° を想定。0 の場合は一点方向、360 以上を指定すると実質的に全方向が対象になります。

**使用例**:
```
# 周囲32ブロックの状況を取得
/w Bot1 !info scanBlocks {}

# ダイアモンド鉱石だけを 64 ブロック以内で探す
/w Bot1 !info scanBlocks {"range": 64, "types": ["diamond_ore"]}

# クラフティングテーブルを 1 件だけ取得
/w Bot1 !info scanBlocks {"type": "crafting_table", "limit": 1}

# 高さ方向を ±5 に絞って平面付近のみ取得
/w Bot1 !info scanBlocks {"range": 48, "minYOffset": -5, "maxYOffset": 5}

# 視線方向±30°の扇形だけを探索
/w Bot1 !info scanBlocks {"range": 40, "coneAngle": 60}

# 北(0°)方向の狭い扇形で鉱石を探索
/w Bot1 !info scanBlocks {"range": 64, "yaw": 0, "coneAngle": 45, "types": ["iron_ore", "coal_ore"]}
```

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
      // ...最大 limit 件まで距離が近い順で続く
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
- コンソールにはサマリーと先頭 10 件を出力しますが、戻り値には `limit` 件分が含まれます。
- `limit` を上げるとデータ量と処理時間が増えるため、外部 API として消費する際は用途に応じて調整してください。

---

##### `topDownMap` - 俯瞰ヒートマップ生成（実装予定）

周囲の地形を俯瞰視点でヒートマップ画像として生成します。

**パラメータ**:
- `range` (number, オプション): スキャン半径（デフォルト: 50ブロック）
- `resolution` (number, オプション): 解像度（1=全ブロック、2=2ブロック間隔、デフォルト: 1）

**画像の構成**:
1. **ヒートマップ**: 相対高度を色で表現（自分の位置を基準）
   - 赤/黄 = 高い（+10〜+20ブロック）
   - 緑 = 同じ高さ（±5ブロック）
   - 青 = 低い（-10〜-20ブロック）

2. **オブジェクトマーク**: 重要な物体を絵文字/ラベルで表示
   - 木の塊 → 🌲 "Oak"
   - 石エリア → "Stone"
   - 建材 → ⚙️ "Table"
   - 範囲を白枠で囲む

3. **座標系**: 常に北（Z-）が上
   - グリッド線 + 座標表示
   - ボット位置 = 中央の×印
   - 方位（N/E/S/W）表示

**戻り値**:
```javascript
{
  success: true,
  message: "俯瞰マップを生成しました",
  data: {
    image: "base64string...",
    metadata: {
      botPosition: { x: 100, y: 64, z: 200 },
      range: 50,
      resolution: 1,
      scannedBlocks: 10000
    }
  }
}
```

**LLMでの使い方**:
画像から視覚的に地形を把握し、座標を特定して移動コマンドを実行：
```javascript
// 画像を見て「北東（右上）に木の塊がある。座標は (125, -45) あたり」
!creative navigation gotoCoords {"x": 125, "y": 70, "z": -45}
```

**技術的課題**:
- ブロックのクラスタリング（近接ブロックのグループ化）
- Canvas での絵文字/テキスト描画
- パフォーマンス最適化（resolution で間引き）

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
  const visionResult = await handleCreativeCommand(
    bot,
    'llm_agent',
    'vision capture',
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

// クリエイティブアクション
const screenshot = await handleCreativeCommand(bot, 'llm', 'vision capture', stateManager);
await handleCreativeCommand(bot, 'llm', 'navigation register {"name": "home"}', stateManager);
await handleCreativeCommand(bot, 'llm', 'navigation goto {"name": "home"}', stateManager);

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
const result = await handleCreativeCommand(bot, 'llm', 'vision capture', stateManager);

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
async function chatWithLLM(bot, username, userMessage) {
  // 1. ユーザーメッセージを会話履歴に追加
  bot.addMessage(username, userMessage, 'natural_language');

  // 2. 会話履歴を取得（システム情報を除外）
  const history = bot.getConversationHistory()
    .filter(msg => msg.type !== 'system_info')
    .map(msg => ({
      role: msg.role,      // "assistant" or "user"
      content: msg.content
    }));

  // 3. LLM APIに送信
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    system: "あなたはMinecraftボットです。ユーザーの指示に従って行動してください。",
    messages: history
  });

  const reply = response.content[0].text;

  // 4. ボットの応答を送信＆記録
  bot.systemLog(`-> ${username}: ${reply}`);
  await bot.speak(username, reply);
  bot.addMessage(bot.username, reply, 'bot_response');

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
      const screenshot = await handleCreativeCommand(
        bot,
        'system',
        'vision capture',
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
