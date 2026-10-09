# Planner Bot 関数API

2026-10-09、01リファクタリング版。Minecraft 1.20.1で回帰検証した。
公開入口は `planner_bot/api.js`（package の main）。読み込むだけでは接続・dotenv読込・viewer起動を行わない。
単体起動は従来どおり `node planner_bot/index.js`。

## 接続と基本操作

```js
const { once } = require('node:events')
const { createAIBot, createBotApi } = require('minecraft-bot')

async function main() {
const bot = createAIBot(1, {
  host: '127.0.0.1', port: 25567, username: 'Worker',
  version: '1.20.1', aiBotCount: 1
}, { autoHandleWhisper: false })
const api = createBotApi(bot, { logLevel: 'error' })
await once(bot, 'spawn')

const observed = await api.observe()
if (!observed.ok) throw new Error(observed.error.message)
const planned = await api.planGoal('inventory.stone_pickaxe:1', { worldState: observed.data })
if (!planned.ok) console.log(planned.error.code, planned.error.details)
else console.log(planned.data.plan)

const controller = new AbortController()
const running = api.executeGoal('inventory.stone_pickaxe:1', { signal: controller.signal })
// controller.abort() または await api.stop() で中断できる。
console.log(await running)
await api.stop()
bot.quit()
}
main().catch(console.error)
```

ローカル配置の場合は `require('/absolute/path/to/minecraft-bot')` とする。
ESMからは `import { createAIBot, createBotApi } from './minecraft-bot/planner_bot/api.js'`、または
`createRequire(import.meta.url)` でCommonJS入口を使える。
`createAIBot` は同期factoryで、接続完了を表すPromiseではない。`spawn` を待ってから使用する。
既存botにpathfinderとstateManagerがある場合、`createBotApi(bot, { stateManager })` で使える。
同じbotから複数のAPIを作っても操作管理は共有する。

## 結果契約

以下のAPIメソッドと `handleChatCommand` はすべて `Promise<Result>` を返す。
成功、失敗、中断、予期しない実行エラーを同じ形で受け取る。
factoryと内部の低レベル関数にはこの契約を適用しない。

```js
{ ok: true, data: /* 操作ごとのデータ、またはnull */, error: null }
{ ok: false, data: null, error: {
  code: 'CANCELLED', message: '...', details: /* objectまたはnull */
} }
```

プログラムの分岐には `error.code` を使う。`message` は表示用。
診断がある場合は `error.details.diagnosis` に入り、前提不足・環境不足・循環経路等の情報もdetailsに保持する。

| code | 意味 |
|---|---|
| `INVALID_ARGUMENT` | JSON形式、必須パラメータ、goal、Minecraft版等の不正 |
| `UNKNOWN_COMMAND`, `UNKNOWN_ACTION`, `UNKNOWN_SKILL`, `UNKNOWN_PRIMITIVE` | 未知の名前 |
| `BOT_NOT_READY` | spawn前、版・pathfinderが利用できない |
| `DOMAIN_NOT_READY`, `DOMAIN_PREPARATION_FAILED`, `VERSION_CONFLICT` | 行動定義が未準備、準備失敗、同一プロセスの版競合 |
| `PLAN_NOT_FOUND`, `ENVIRONMENT_MISSING` | 計画不能、必要な環境がない |
| `GOAL_CYCLE`, `GOAL_DEPTH_EXCEEDED`, `REPLAN_FAILED` | 補助目標の循環、深さ制限、実行途中の再計画失敗 |
| `REPEATED_FAILURE` | 同じ状態・行動・理由の失敗3回、または進展のない失敗/再計画10回で終了。detailsにgoal/action/params/code/reason/attempts/limit/limitKind |
| `ITEM_NOT_FOUND`, `RECIPE_NOT_FOUND`, `BLOCK_NOT_FOUND` | アイテム・レシピ・ブロック不足 |
| `PLAYER_NOT_FOUND`, `ENTITY_NOT_AVAILABLE`, `OUT_OF_RANGE` | 相手がいない、位置未取得、距離外 |
| `CHEST_NOT_OPEN`, `CHEST_NOT_FOUND`, `PLACEMENT_FAILED` | チェスト操作・設置の失敗 |
| `TIMEOUT`, `CANCELLED`, `OPERATION_CONFLICT` | 移動時間超過、中断、向き指定visionの競合 |
| `VISION_CAPTURE_FAILED`, `EXECUTION_FAILED`, `INTERNAL_ERROR` | 撮影失敗、その他の実行失敗、想定外エラー |

内部依存の例外に独自codeがある場合は保持する。未知の失敗は汎用codeとmessageを受け取る。

## 観測と計画

| メソッド | 入力・data |
|---|---|
| `observe()` | 新しいworldState。実行用cacheを上書きしない |
| `refresh()` | 実行用cacheを更新。dataは `{ durationMs }` |
| `planGoal(goal, { worldState } = {})` | worldState省略時は独立観測。dataは `{ plan, diagnosis }` |
| `info(type, params = {})` | 下表の情報payloadが直接dataに入る |
| `status()` | 従来の状態表示をログへ出し、worldStateを返す |

worldStateはtimestamp、inventory.counts、equipment、position、isDay、inventory_space、
nearby_blocks、nearby、blocksを持つ。探索範囲とカテゴリ定義は既存のまま。
明示refreshは完了した観測だけをcacheへ公開し、古いrefreshの後着で新しい結果を上書きしない。
観測・計画は移動やGOAP実行を停止しない。必要なら同じworldStateを複数の計画に渡せる。

goalの例は `inventory.oak_planks:4`、`inventory.category.log:8`、`nearby_workbench:true`、
`craft_wooden_pickaxe`。数値目標は現在の在庫に指定量を加える。
既にstickを4個持つ状態で `inventory.stick:4` を実行すると8個が目標になる。
YAMLのaction名で指定する形式、`action count:8` の解析も維持している。
計画は観測入力を変更しない。planの各stepは `{ action, skill, params, cost }`。

| info type | params・data |
|---|---|
| `all` | inventory、position（rotation/time/health/food）、locations、players、nearby |
| `scanBlocks` | range=32、typeまたはtypes、maxChecks=25000（-1は全件）、minYOffset=-32、maxYOffset=32、yaw=current、coneAngle=360。dataはblocksとsummary |
| `recipesFor` | item（name別名）、count=1。dataはitem/count/recipes |
| `recipesUsing` | ingredientsまたはingredient、mode='and'（'or'も可）。dataはingredients/mode/results等 |
| `vision` | yaw/pitchは省略可、renderWait=10000ms。dataはimage（base64 PNG）、filepath、metadata |

方角は**北=0°（Z−）、西=90°（X−）、南=180°（Z＋）、東=270°または−90°（X＋）**。
scanBlocksとmoveInDirectionも同じyaw規約。
visionは1920×1080 PNGを取得し、`screenshots/screenshot_<username>.png` に保存する。
撮影ごとにviewer/browserを閉じる。同じbotの撮影は逐次実行する。
実行またはfollow中にyaw/pitchを指定すると `OPERATION_CONFLICT`。
向きを省略した撮影は実行と並行でき、botの向きを変更しない。
ChromeはPuppeteerのブラウザを使い、必要なら起動前に `PUPPETEER_EXECUTABLE_PATH` を指定する。

## 実行と停止

`executeGoal(goal, { signal, username = 'api' } = {})` は従来の!goal全体を実行する。
道具事前準備、数量削減、補助目標、再帰制限、前提の再検査、再計画を含む。
完了dataは `{ goal, message }`。計画だけを作る場合は `planGoal`。

`executeSkill(name, params = {}, { signal } = {})` と
`executePrimitive(name, params = {}, { signal } = {})` は実行前後にrefreshする。
dataは `{ name, result }`。内部の返り値がない場合resultはnull。
primitiveはcamelCaseとsnake_caseの両方を受け付ける。

| スキル名（9種類） | 主なparams・既定値 |
|---|---|
| `gather` | itemName、count=1、maxDistance=100、approachRange=2、collectRadius=30、collectDelayMs=200、maxAttempts=20、collectItem=falseで回収省略。カテゴリ指定も維持 |
| `collect_drops` | radius=12、maxAttempts=3 |
| `hand_craft` | recipe、count=1（クラフト回数）。動的な板レシピも維持 |
| `workbench_craft` | recipe、count=1。周囲の作業台を使う |
| `furnace_smelt` | input、fuel、output、fuel_count=1 |
| `place_block` | blockName。従来の同じ高さの東・西・南・北・南東・北西、下面参照を先に試す。失敗時は半径5の立体候補・6方向の固体参照へフォールバック。空気各種・草・雪の層を置換候補とする。creativeの探索は維持 |
| `equip_mainhand` | item |
| `equip_armor` | item、slot='helmet'/'chestplate'/'leggings'/'boots' |
| `move_to` | position、またはblockType |

| primitive | 主なparams |
|---|---|
| `moveTo` / `move_to` | position={x,y,z} またはx/y/z、range=0、timeout（省略時max(30000,距離×1000)ms、nullで制限なし） |
| `digBlock` / `dig_block` | positionまたはx/y/z |
| `collectDrops` / `collect_drops` | radius=6、itemName、waitMs=50 |
| `craftItem` / `craft_item` | itemName、count=1、metadata、table |
| `placeBlock` / `place_block` | reference={x,y,z}、face={x:0,y:1,z:0}。先に装備する |
| `equipItem` / `equip_item` | itemName、destination='hand' |
| `findBlock` / `find_block` | match、maxDistance=32、count=1、useCube=true |
| `findBlocks` / `find_blocks` | 同上。matchは名前、名前配列、{equals:[...]}/{includes:'...'} |

道具補助 `primitives.findBestTool(bot, block)` / `equipBestToolForBlock(bot, block)` は直接関数も維持。
`primitives.js` 等の直接呼び出しは低レベル契約（throwや従来値）で、APIの所有権管理を通らない。
所有権・中断・Resultが必要な呼び出しはcreateBotApiを使う。

`stop()` は中断要求後、現在の非同期操作の終了と後処理を待ち、
`{ stoppedActions, message }` を返す。チェストを閉じ、追跡・idle・watchも停止する。
中断した実行は `CANCELLED`。abort時点でMinecraftへ発行済みの作用は取り消せないが、
完了を待ってから次の所有者へ移るため、古い処理が後から次の操作を止めない。

| 新しい呼び出し | 既存の実行・移動等への作用 |
|---|---|
| observe / planGoal / refresh / info（vision以外）/ status | 継続 |
| executeGoal / executeSkill / executePrimitive / placeBlock / navigate（下記chest続行以外） | 中断・終了を待つ。follow/idle/watchも停止、チェストを閉じる |
| chestDeposit / chestWithdraw / chestClose | 開いたセッション内で逐次実行。stop・置換後の未開始続行はCANCELLED |
| look / startIdle | 従来どおりカメラ操作を開始。実行の置換はしない |
| chat / echo / history / speak系 | 継続。chatは開いたチェストを閉じる |
| stop / 外部signal | 停止。開始前にabort済みの新しい要求は既存実行を止めない |

操作管理はbotごと。A→B→Cと短時間に置換すると、未開始で置換されたBはCANCELLEDになる。
watch/idleのカメラ動作と実行の関係は01では変更していない。

## 移動・設置

`navigate(action, params = {}, { signal } = {})` のaction一覧：

| action | params・data |
|---|---|
| `register` | name、coords=[x,y,z]またはblockType。省略時現在地。dataは登録結果 |
| `goto` | name。登録先へ移動 |
| `gotoCoords` | coords=[x,y,z] |
| `moveInDirection` | distance、yaw=current、verticalMode='nearest'。'below'/'above'/'surface'も維持 |
| `follow` | username。開始後も追跡を継続し、外部signalやstopで停止 |
| `stopFollow` | 自動停止を先に行う既存入口のため通常「追跡していません」を返す |
| `dropItem` | itemName、targetPlayer省略時その場、count=1、maxDistance=100 |
| `pickupItems` | range=5、itemName省略時全アイテム |
| `chestOpen` | coords省略時近くを探索。dataにはchestの内容・スロット情報 |
| `chestDeposit` / `chestWithdraw` | item、count=1。dataは転送数等 |
| `chestClose` | 開いたチェストを閉じる |

`placeBlock({ name, coords, allowSelfPosition = false }, { signal } = {})` はcreative設置。
coords省略時、半径5の3次元候補を距離順で探す。自分のXZ列は既定で除外。
上下東西南北の参照をこの順に試す。skillの6候補policyとは別に保持している。
dataは `{ block, position, message }`。置き場所探索は共通のplacement_searchにある。

chest count=-1は02で修正。転送元の全スタックを合算し、metadata/NBTごとに転送する。
withdrawはcontainer側のスロットだけを参照し、プレイヤー側の持ち物を含めない。
転送失敗はok:falseで、details.transferredCountに完了済みの転送グループの数を返す（失敗したグループ内の途中転送数は含まない）。

02のexecuteGoalは、関連状態が変わらない失敗を有限回で終了する。時刻・視線・微小な位置変化は進展と扱わない。
補助目標や道具準備も同じ実行の失敗記録を共有する。別のexecuteGoalは新しい記録から開始する。
通常の計画内容・再計画・環境ブロックを資源にする動作は維持する。

## カメラ・待機・会話

`look(action, params = {})` はdirection/dir（yawまたはpitch）、player/at（username/name）、
watch（username/name、intervalMs=1000）を受け付ける。
`startIdle(params = {})` はintervalMs=4000（最小500）、playerRange=8（最小1）、
yawJitter=45、pitchMin=-20、pitchMax=10、playerLookChance=0.6で開始する。
watch/idleはstopで停止し、実行済みtickの完了も待つ。

`chat({ username, message, maxDistance = 15 })` は距離内の相手へwhisperする。
maxDistanceの上限は100。距離判定は実距離、返すdistanceは切り捨て。
`echo(username, message)` / `speak(username, message)` は直接whisper。
`speakNearby(message, radius = 15)` は `/w @a[distance=..radius]` を送る。

履歴への追加は**手動**。受信・送信だけでは履歴に入らない。
`addMessage(speaker, content, type = 'conversation')` と `history({username, usernames, type} = {})` を使う。
履歴は全体100件のFIFOで、sequenceは単調増加。
history dataは `{ history, count, latestSequence }`。
bot.addMessage/getConversationHistory/speak/speakNearby/chatWithDelayも従来どおり使用できる。

autoHandleWhisper=true（既定）では!コマンドを自動処理し、自然言語は
`onNaturalMessage(bot, username, message)` または `newNaturalMessage` イベントへ渡す。
autoHandleWhisper=falseならその自動処理を止め、外部側がwhisperを購読できる。

## チャット入口と変更した公開API

`handleChatCommand(bot, username, message, stateManager)` は解析して同じ関数APIを呼ぶ。
!goal、!skill、!primitive、!navigation、!creative placeBlock、!info、!status、!refresh、!stop、
!look、!idle_on、!chat、!echo、!historyの文法は維持している。
すべてResultを返すようになったため、旧success/undefined/throwを使う呼び出し側は移行する。

| 変更点 | 移行先 |
|---|---|
| package mainが存在しないindex.js | planner_bot/api.jsのcreateAIBot/createBotApi |
| 文字列経由での操作 | createBotApiの各メソッド |
| success、undefined、throwの混在 | ok/data/error。従来payloadはdataへ |
| skill/primitiveが返り値を捨てる | data.resultに実際の値を保持 |
| statusがログだけ | worldStateがdataに入る |
| goal_command内の診断export | planner/diagnosis.js |
| goap.plan/collectShortagesの未準備domain | 計画入口でprepareDomainを実行。第4引数 `{version}`、または先にprepareDomain(version) |
| loadDomain/getAllActionsの暗黙読込 | prepareDomain完了後に同期取得 |

直接plannerを使う場合：

```js
const goap = require('./planner_bot/src/planner/goap')
await goap.prepareDomain('1.20.1')
const { plan, diagnosis } = await goap.plan('inventory.stick:4', worldState)
const shortages = await goap.collectShortages('inventory.stick:4', worldState)
```

この低レベルplannerは従来の `{plan, diagnosis}` 契約。Resultが必要ならapi.planGoalを使う。
接続したbotの版を優先する。直接plannerの版省略は準備済み版→MC_VERSION→1.20.1。
同一プロセスは1つのMinecraft版を使用し、異なる版はVERSION_CONFLICT。
生成物は `.cache/minecraft-bot/actions/<version>/` に置き、追跡YAMLを上書きしない。
手書きYAML形式・カテゴリ・アクション順序・探索コストは維持している。

## ログと検証

`createBotApi(bot, { logLevel: 'error' })` はそのbotのレベルを設定する。
error/warn/info/debug（既定info）、環境変数LOG_LEVELも使用できる。
LOG_COMMANDSとLOG_CATEGORIESはall/none/カンマ区切りで絞る。
PLANNER_DEBUG=1はレベル未指定時のdebug既定値。
探索の各イテレーションと状態詳細はdebug。非同期のコマンド・計画ごとに文脈を保持する。
`bot.logWriter = message => ...` で出力先を差し替えられる。
stateManager.silentRefreshとbot.logFilterは既存の互換用に残すが、公開入口のログ制御は共通loggerを使う。
単体CLIの開始案内は引き続き標準出力へ出る。

`npm test` はサーバーなしの回帰検証。goldenを更新しない。
`npm run test:live` はフラット/自然の許可済みテストサーバーを必要とする。
`npm run test:vision` はGPU撮影と後処理、競合を検証する。
詳しい実行条件は `tests/README.md`、変更・残件は `requests/2026-10-09_from-isg/01_report.md`。
