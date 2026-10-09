# Planner Bot 関数API

2026-10-09、01リファクタリング＋02/03＋05 G/A/B＋06実行修正版。Minecraft 1.20.1で回帰検証した。
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
| `PLAN_NOT_FOUND`, `ENVIRONMENT_MISSING` | 計画未発見、必要な環境がない。未発見だけでは不能の証明にならない。details.reasonを参照 |
| `GOAL_CYCLE`, `GOAL_DEPTH_EXCEEDED`, `REPLAN_FAILED` | 補助目標の循環、深さ制限、実行途中の再計画失敗 |
| `REPEATED_FAILURE` | 同じ状態・行動・理由の失敗3回、または進展のない失敗/再計画10回で終了。detailsにgoal/action/params/code/reason/attempts/limit/limitKind |
| `ITEM_NOT_FOUND`, `RECIPE_NOT_FOUND`, `BLOCK_NOT_FOUND` | アイテム・レシピ・ブロック不足 |
| `PLAYER_NOT_FOUND`, `ENTITY_NOT_AVAILABLE`, `OUT_OF_RANGE` | 相手がいない、位置未取得、距離外 |
| `CHEST_NOT_OPEN`, `CHEST_NOT_FOUND`, `PLACEMENT_FAILED` | チェスト操作・設置の失敗 |
| `TIMEOUT`, `CANCELLED`, `OPERATION_CONFLICT` | 移動時間超過、中断、向き指定visionの競合 |
| `VISION_CAPTURE_FAILED`, `EXECUTION_FAILED`, `INTERNAL_ERROR` | 撮影失敗、その他の実行失敗、想定外エラー |
| `VISION_NOT_STARTED` | captureVision前にstartVisionが必要 |

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

通常の `planGoal` と実行中の計画・再計画も、消費・数量・負の制約を無視した閉包で事前判定する。不能は**与えられた観測と現在の行動モデル内**での証明であり、観測外の資源や実地の到達性の保証ではない。閉包で可能なだけでは計画成功にしない。

`planGoal` の未発見codeは従来どおり `PLAN_NOT_FOUND`。`executeGoal` の証明済み不能も `PLAN_NOT_FOUND`、再計画失敗は従来の `REPLAN_FAILED`。既存の補助目標の循環・環境不足等のcodeは維持する。計画由来の失敗では既存のdetailsに `goal`、`reason`、`provenImpossible`、`iterations`、`maxIterations` を保持する。

| details.reason | 意味 |
|---|---|
| `relaxed_unreachable` | 閉包でも必要な存在条件へ到達できない。provenImpossible=true、iterations=0 |
| `iteration_limit` | 最大200回で計画未発見。provenImpossible=false。不能とは判定しない |
| `frontier_exhausted` | 現行探索の候補が枯渇。provenImpossible=false。閉包による証明とは区別 |
| `invalid_goal` | 目標の形式・名前が不正。診断を参照 |

補助目標で失敗した場合のdetails.goalは、その計画対象を示す。goalChain等の既存情報も残す。道具準備・数量削減・補助目標は維持し、証明済み不能では同じ存在条件を解決できない数量再試行を省く。

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
通常は撮影ごとにviewer/browserを閉じる。startVisionの常設viewerを利用した場合は、そのviewerを維持し、一時browserだけを閉じる。同じbotの撮影は逐次実行する。
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
| `gather` | itemName、count=1、maxDistance=100、approachRange=2、collectRadius=30、collectDelayMs=200、maxAttempts=20（最大64）、collectItem=falseで回収省略。カテゴリ指定も維持。初回searchSampleSize=1、失敗後maxCandidates=64まで拡張。回避はmaxAvoidListSize=32（最大64）・avoidTtlMs=180000（最大300000）、移動はmoveTimeoutMs=30000（最大60000） |
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

06の採掘は開始前に最大1秒の着地待ちを行う。着地しなければ、飛行・水中等を含む現在の状態のmineflayerの採掘時間を使う。終了時のローカルの空気表示だけでは成功にせず、サーバーから対象位置の空気更新を最大1秒待つ。未確認なら直前の既知の状態へ戻して再試行し、合計3回で `BLOCK_NOT_FOUND` を返す。`createAIBot` では移動中のpathfinderの採掘にも適用する。移動時間切れ・中断時は待機中の採掘も終了させてから戻る。

`place_block` スキルは、mineflayerの例外の有無にかかわらず、設置先に指定名のブロックがあることを確認する。木（原木・葉等）だけの足場では、読み込み済みの半径6・2〜8段下で頭上2ブロックが空いた固体の足場へ、合計8秒・最大3候補で移動を試す。降りられなければ現在地の従来の設置候補を試す。GOAPの計画・環境の知識とcreative設置の候補policyは変更しない。

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

## 03：isgの判断ループ用API

### 候補をまとめて評価する（F1）

```js
const world = await api.observe()
if (!world.ok) throw new Error(world.error.message)
const evaluated = await api.evaluateGoals([
  'inventory.wooden_pickaxe:1', 'inventory.stone_pickaxe:1',
  'inventory.furnace:1', 'inventory.iron_pickaxe:1'
], { worldState: world.data, maxMs: 1000 })
if (evaluated.ok) {
  const choices = evaluated.data.results.filter(r =>
    r.status === 'plannable' && r.estimatedMs < 60000)
}
```

`evaluateGoals(goals, { worldState, maxMs=1000, perGoalMs, signal }={})`。
goalsは既存のgoal文字列の非空配列。worldStateは完全observeのdataを使う。
省略時は独立した完全観測を行う。observeFastのdataはINVALID_ARGUMENT。
観測・domain準備・資源要約・閉包・探索を全体の時間予算に含める。初回domain準備は同期処理もあり、予算の厳密な実時間保証ではない。毎回の判断には準備済みdomainと共有worldStateを使う。

候補あたりの既定予算はmax(20, maxMs / 候補数)ms。`perGoalMs` で変更できる。
重い1候補に全体の予算を使わせず、後続候補も試す。結果は入力順。
全体の期限前に短い返却用の余裕を設け、探索・観測自体を終了する。返却後に探索を裏で続けない。
signalは候補評価だけを中断し、実行中の移動/GOAPを停止しない。

data：`{ results, durationMs, observationMs, preparationMs, timedOut }`。

| resultsのフィールド | 意味 |
|---|---|
| goal / status | plannable / unplannable（閉包で証明済み） / unevaluated（探索上限等） / invalid |
| plan / stepCount | 通常planGoalと同じaction/skill/params/cost配列と手数。未評価/不能はnull |
| estimatedMs | 行動種類・個数・最寄りブロックの直線距離からの実行時間目安 |
| estimateDetails | モデル名、実測に基づく係数、step別内訳、distanceType、reachabilityKnown、資源要約の完全性 |
| resources | block、count、usage（consume/station）、category、nearestPosition、nearestDistance、selection |
| diagnosis | 通常plannerと同じ不足診断。探索上限の場合も返すが、不能の証明ではない。時間予算中断はnull |
| reason | unplannableはrelaxed_unreachable。unevaluatedはbudget_exceeded / iteration_limit / frontier_exhausted。成功・invalidはnull |

resourcesは計画が使う環境資源の見積もり。カテゴリ採集は最寄りの種類を参考として出しcategoryも併記する。
実行スキルのカテゴリキャッシュや到達性によって実際の種類・採集先は変わる。selectionはnearest_estimate。
同じ既存作業台/かまどの利用はstation・count=1としてまとめる。計画で新しく設置する設備は、既存の環境資源として数えない。
距離が不明ならnull。到達できることを保証する値ではない（reachabilityKnown:false）。
estimatedMsはGOAPのcostを変換した値ではなく、ライブ測定に基づく別のモデル。材料不足・地形・再計画によって差が出る。

明らかな不足は、消費や負の制約・数量を無視して可能性を広げた資源依存の閉包から判定する。
この緩い条件でも到達できない場合だけ早期診断し、計画可能とは判定しない。
閉包で排除されない候補は従来A*を実行し、同じ計画を返す。通常planGoalにも同じ事前判定を適用するが、evaluateGoalsの時間予算は適用しない。
同一版・goal・GOAP factsの完了結果をbotごとに最大256件再利用する。状態内容が変わると別結果になり、距離の見積もりは毎回更新する。200回上限・候補枯渇まで探索した結果は、その理由もcacheする。時間予算中断はcacheしない。timedOutはbudget_exceededが1件以上あるときtrueで、探索回数上限だけではfalse。

### 軽い観測（F3）

`observeFast({ range=16, maxMs=50, maxChecks=12000, darkBelow=8, torchRadius=5 }={})`。
rangeは1〜64の整数。dataは `kind:'fast_observation'` で、完全worldStateとは別の契約。

- position、yaw/pitch（度）、health/food、time、inventory/equipment。
- resources：種類ごとのcount / nearestPosition / nearestDistance。categories：同じ形式のカテゴリ要約。
- players / drops：range内の名前・座標・距離と、取得可能な落下アイテム情報。
- skyVisible（true/false/null）、location（surface/underground/unknown）、light（block/sky/level/dark/torchNearby、不明はnull）。空の判定は読み込み済みの頭上の柱に基づく推定。
- complete / scanComplete / unloadedChecks / checksUsed / totalChecks / observedAt / ageMs / durationMs / range。

資源範囲は現在位置のfloorを中心とする球。座標・距離は実際の位置から計算する。
部分走査を次回へ持ち越し、同じ位置・範囲の観測を再利用する。移動、範囲変更、近傍blockUpdate、chunkのload/unloadで無効化する。実行cacheは上書きしない。
complete=falseの場合、countは走査済み部分の値であり、全範囲の総数や資源不存在を断定するために使わない。
ageMsは資源走査開始からの経過時間。位置・在庫等は呼出時に取得する。
完全観測は `observe()` を使い、F1へ同じdataを使い回す。


⑧L1のlightは目の高さ（足元+1.62）で読む。既存のblock/skyは変更せず、levelは両方既知ならmax(block, sky)、片方でも不明ならnull。skyはmineflayerの生のskylightで、時刻・雨・雷による減光補正は行わない（夜の地表でも高く見積もり得る）。描画の明るさや敵の出現判定を保証する値ではない。

torchNearbyは床座標を中心とした半径torchRadiusの球内のtorch / wall_torchのみを調べる。soul/redstoneのたいまつ、lantern等はこのフラグに含めないが、届いたblock lightはlevelに含まれる。darkBelowは0〜16、torchRadiusは0〜8の整数。既定の8はlevel < 8を暗いとする。torchNearby=trueならlight更新前のlevel=0でもdark=false。明るさが閾値以上でもdark=false。残りは照度・近傍がすべて既知の場合だけdark=true、未読込があればnull。

たいまつ検索は資源走査のrange・持越しcache・maxChecks/maxMsから独立し、呼出ごとに最大2109セル（半径8）を読む。maxMsは従来の資源・空の走査予算で、light等の固定上限の観測を含む厳密な全体期限ではない。これは情報を返すだけで、たいまつの作成・設置・GOAP変更は行わない。

### 時間内に座標へ近づく（F5）

```js
const result = await api.moveToward({ x: 120, z: -40 }, {
  maxMs: 3000, range: 2, signal: controller.signal
})
```

`moveToward({x,z,y?}, {maxMs=5000,range=2,signal}={})`。
y省略はGoalNearXZで水平移動、指定時はGoalNearで3D移動。pathfinderの通常の移動能力を使い、特定の地表高さを推測・固定しない。

到着・時間切れ・道なしはok:trueで、dataにtarget、startPosition/endPosition、startDistance/endDistance、distanceReduced、reached、reason、distanceTypeを返す。
reasonはarrived/timeout/no_path。reachedはpathfinderの床座標goalによる到着判定で、distanceは実座標での直線距離。
途中まで進んだtimeoutも正常な探索結果。進展0も距離で分かる。
中断はok:false、error.code=CANCELLED、detailsに同じ移動結果とreason:cancelledを保持する。
すでにabort済みの要求など、開始前に中断された場合は従来のOperationManagerのCANCELLED契約でdetailsがないこともある。

予算は呼出から計測し、前の実行の停止待ちで期限に達した場合は新しい移動を始めない。
発行済み作用のdrain・後処理は予算後にも待つ。終了時には目的地を解除し、次の所有者へ古い処理を残さない。
観測・候補評価・撮影は移動と並行できる。従来gotoCoords/moveInDirectionは維持する。

### 常設の一人称撮影（F4）

```js
await api.startVision({ port: 3108, width: 640, height: 360 })
try {
  const shot = await api.captureVision({ type: 'jpeg', quality: 80 })
  if (shot.ok) console.log(shot.data.format, shot.data.durationMs)
} finally {
  await api.stopVision()
}
```

startVisionの既定はwidth=640/height=360/viewDistance=4。port省略は空きポート。
dataはurl/port/width/height/viewDistance/durationMs/alreadyStarted。デモにはurlを表示できる。
初回だけviewer/browser起動と描画待ち（renderWait=4000ms）を行う。重複startは現在のセッションを返し、サイズ変更はstop後に再startする。
ChromeはPUPPETEER_EXECUTABLE_PATH、またはWindowsの既知のChrome/Edge配置を使用できる。executablePath指定も可能。

captureVisionはtype=jpeg/png、quality=0〜100（jpeg既定80）。PNGではqualityを使わない。
dataはimage（base64）、format、width/height、metadata（position/yaw/pitch/timestamp）、durationMs。
描画済みpageを撮り、首を動かさない。別方向のカメラ撮影は今回追加していない。
ディスクには自動保存しない。保存が必要ならimageをBufferへ変換して書き込む。

start/capture/stopと旧info visionはbotごとに逐次化する。使っていないときはGPUを起動しない。
stopVisionは冪等でdata.stoppedを返す。通常stopは実行/移動だけを止め、常設撮影は維持する。
botのend、CLIのshutdown、SIGINT/SIGTERMの通常終了経路でも解放する。強制的なOS終了ではJSの後処理を実行できない。
ホスト側が独自の終了ハンドラを持つ場合、そのfinallyでstopVisionをawaitする。
旧info visionのPNG/1920×1080/ファイル保存/方向指定の契約は維持する。常設viewerを閉じない。

### 実行の進捗（F2）

```js
await api.executeGoal('inventory.stone_pickaxe:1', {
  signal: controller.signal,
  onProgress(event) { console.log(event.type, event.goal, event.stepIndex) }
})
```

通知はgoal_start、plan、step_start/step_success/step_failure/step_skipped、replan、subgoal_enter/subgoal_exit、goal_end。
共通フィールドはoperationId、sequence（単調増加）、timestamp、type、goal、depth。
plan/replanにはplanId、plan、stepCount。stepにはplanId、0始まりstepIndex、stepCount、step（action/skill/params/cost）。
失敗通知にはcode/messageまたはmissing、補助目標通知には親との関係・終了のok、goal_endにはok/code。
道具準備と補助目標も通知し、再計画は新しいplanIdを使う。置換された実行の通知はoperationIdで識別する。
完了Resultの契約は変わらない。callbackの戻り値は待たず、throw/rejectはログに記録して実行を続ける。
callbackへ渡したplan/eventを書き換えても実行内容には影響しない。通知からAPIを呼ぶ場合は、そのAPIの所有権規則に従う。

03の実測値・完了検証・残件は `requests/2026-10-09_from-isg/03_report.md`。
