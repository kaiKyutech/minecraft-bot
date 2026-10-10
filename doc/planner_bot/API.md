# Planner Bot 関数API

2026-10-10、01リファクタリング＋02/03＋05 G/A/B＋06実行修正＋07非同期観測・計画＋08照度・松明＋09到達事実＋10地形API版。Minecraft 1.20.1で回帰検証した。
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

### Minecraft 1.21.4（⑭）

`createAIBot(..., { version: '1.21.4', ... })`、またはCLIの`MC_VERSION=1.21.4`で選ぶ。
接続後のbot.versionでカテゴリ・行動生成・観測・実行を切り替える。1.20.1のカテゴリ、生成行動、計画・コストは従来のまま。
1.21.4では新しい原木・板をカテゴリへ含め、全クラフトレシピの異なる材料を保持する。
全樹種で配置・出力が同じ板レシピはカテゴリとしてまとめ、実行時は所持する板（混合も可）で配置を組む。
樹種固有の成果物は具体材料を要求する。原木・板・作業台など、環境ブロックを資源として採る動作も維持する。

生成YAMLとmanifestは`.cache/minecraft-bot/actions/<version>/`に分かれる。
同一プロセスの計画workerは1版専用。切り替えはbotプロセスを停止・再起動し、1.20.1へ戻すときは`MC_VERSION=1.20.1`またはfactoryの`version:'1.20.1'`を指定する。
1.21.4のワールドを1.20.1のサーバーへ戻さず、版ごとに独立したサーバー・ワールドを使う。
1.21.4では草/カメの甲羅の名前は`short_grass`/`turtle_scute`。旧名の自動変換は行わない。

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

⑫以降、すべてのgather行動のcostは、既存の数量・道具別の基礎コストに
`0.5 × max(0, 最寄り対象までの直線距離 − 2) + 2 × 推定障害ブロック数`
を加える。対象が観測済みブロックで6方向とも囲まれている場合だけ、目の位置から対象中心への
直線上のブロックを重複なしで数える（空気・水・対象自身は除外、半ブロック間隔、最大512点）。
カテゴリも個別ブロックも同じ規則。採集数量は既存の基礎コストで扱い、接近費は最寄り1対象の推定。
位置とblocks.listを持たない数量だけの観測では基礎コストのまま。
経路探索・掘削時間・到達性の保証ではなく、実行時の候補変更や採集後の位置・資源減少は予測しない。
workerにもこの要約を送り、evaluateGoalsのcacheは数量状態に加えてこの要約を照合する。
観測の投影は短い区間でyieldし、予算・中断を計画と共有する。行動生成とクラフトのcostは従来どおり。

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
| executeGoal / executeSkill / executePrimitive / placeBlock / placeTorch / navigate（下記chest続行以外） | 中断・終了を待つ。follow/idle/watchも停止、チェストを閉じる |
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


### ⑧：持っている松明を近くへ置く

```js
const observed = await api.observeFast({ darkBelow: 8, torchRadius: 5 })
// 呼び出す側が必要と判断したときだけ実行する。
const placed = await api.placeTorch({ signal: controller.signal })
if (placed.ok) console.log(placed.data.position, placed.data.placement, placed.data.afterLight)
```

`placeTorch({ radius=3, placement='auto', darkBelow=8, torchRadius=5, signal }={})`。
radiusは1〜4の整数。placementはauto / floor / wall。後者2つは設置形式を限定する。darkBelow/torchRadiusはobserveFastと同じ意味で、返却するbeforeLight/afterLightに使う。

在庫の通常torchを1本だけ装備して設置する。作成・採集・自動点灯・移動は行わない。現在の床座標を中心とした半径radius、上下±1の読み込み済み空気（air/cave_air/void_air）を調べ、下面または水平の全面の固体を参照する。天井、草、水、葉、半ブロック等を参照しない。手が届く目から4.5ブロック以内の面に限定する。

自分のXZ列と身体に重なるマス、視線方向の最初の約2ブロックの通路（横幅約1.6）を除外する。背面・側面、低い位置、近距離を優先し、最大8候補を試す。未来の経路を予約する保証はない。正面しか置けない通路ではPLACEMENT_FAILEDになり得る。通常の設置で回る視線を終了前に元に戻す（data.viewRestoredで確認できる）。中断後は新しい視線操作を開始しない。

成功dataの例：

```js
{
  position: { x: 200, y: 41, z: 199 },
  block: 'wall_torch', placement: 'wall',
  beforeLight: { block: 0, sky: 0, level: 0, dark: true, torchNearby: false },
  afterLight: { block: 0, sky: 0, level: 0, dark: false, torchNearby: true },
  attempts: 1, viewRestored: true
}
```

結果は通常のResult。設置後の指定マスがtorch / wall_torchなら、mineflayerが例外を返しても成功。空気・別ブロック・未読込は成功にしない。光の配信が遅れる場合はafterLightのlevelが0でもtorchNearby=trueとなる。torchRadiusを設置位置より小さくすると、そのフラグはtrueを保証しない。通常torchがなければITEM_NOT_FOUND、置ける面や確認済みの設置がなければPLACEMENT_FAILED、中断はCANCELLED。発行済み設置の中断では、実際には1本置かれる場合がある。

OperationManagerを通り、既存の実行・移動・follow/idle/watchを中断して終了を待つ。signal / stop / 新しい実行による中断でも、発行済みequip/place/lookの終了まで所有権を保持する。observeFastはこの操作を停止しない。引数不正・開始前にabort済みの要求は既存の操作を停止しない。

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

### ⑨：到達できる事実を全部返す（R1）

```js
const world = await api.observe()
if (!world.ok) throw new Error(world.error.message)
const reachable = await api.reachableFacts({
  worldState: world.data, maxMs: 1000, signal: controller.signal,
  goals: ['inventory.iron_ingot:3', 'inventory.category.log:4', 'nearby_workbench:true']
})
if (reachable.ok) {
  console.log(reachable.data.facts, reachable.data.goals)
}
```

`reachableFacts({ worldState, goals=[], maxMs=1000, signal }={})` は `Promise<Result>`。
worldState省略時は `observe()` と同じ独立した完全観測を行い、実行cacheを更新しない。
observeFast、complete=false、配列等はINVALID_ARGUMENT。goalsは空配列でもよく、既存GOAP形式（状態・カテゴリ・action名・action count指定）の文字列を受け付ける。個別の解析失敗・未知actionはその目標だけinvalid。maxMsは有限の非負数。

dataは以下を返す。木の種類等のフィルター・集約は一切行わない。

| フィールド | 意味 |
|---|---|
| facts | 到達する全キーの配列。各要素は `{ key, initial, round, firstAction, source, derivedFrom }` |
| goals | 入力順の `{ goal, status, provenImpossible, missingKeys, reason }` |
| complete / timedOut | 閉包を固定点まで完了したか / 時間予算で途中終了したか |
| observationComplete | 完全観測が返ったか（指定worldStateは完全観測として扱う）。予算内に観測が得られなければfalse |
| durationMs / observationMs / preparationMs / closureMs | 全体 / 内部観測 / domain準備待ち / worker内のfacts構築・閉包・結果整形の時間。worldState指定時observationMs=0 |
| rounds / actionCount | 実行した閉包の走査周回数（最後の変化なしの周も含む）/ 使用した全行動数。計算前の時間切れは0 / null |

initial=trueは現在のGOAP factsに正の数またはtruthy値があること。round=0、firstAction=null、source='initial'。
初期在庫・装備・環境・世界状態は、行動定義に登場しないキーも葉のドット記法で返す（例inventory.custom_item、equipment.custom_item、is_day）。値や個数自体はworldStateを参照する。
生成された事実はinitial=false、roundは既存の閉包がそのキーを初めて加えた周（1以上）、firstActionは最初の行動名、source='action'。computed状態はsource='computed'、derivedFromに最初の依存キーを返し、firstActionはその依存キーの生成元を引き継ぐ（初期値由来ならnull）。
同じ周の前の行動が加えたキーを後の行動が使う、従来の順番を維持する。このためroundは行動の並びに依存し、最短手数・必要行動数・所要時間ではない。firstActionとderivedFromも完全な計画や因果グラフではない。

statusはpossible（届く可能性あり）、unreachable（閉包でも絶対に届かない）、unknown（時間切れで未判定）、invalid（目標不正）。unreachableだけprovenImpossible=true、reason='relaxed_unreachable'。missingKeysは必要な正の存在条件でまだ届いていないキー。
途中の閉包でも必要キーがすべて得られていればpossibleだが、未発見のキーがあるとunknown / budget_exceededとし、不能を証明しない。観測や計算開始前の時間切れではfacts=[]、goalsはすべてunknown、missingKeys=[]。中断はok:false / CANCELLED。

`evaluateGoals` と通常planが使う `reachability.js` の同じ閉包を、⑦の共有計画workerで実行する。新しい行動・計画・コスト・資源制限は追加しない。OperationManagerの所有権を取得せず、実行中のGOAP・移動・follow/idleを止めない。signalはこの要求だけを中断する。workerの待ち行列もmaxMsに含み、開始前の期限切れはスキップする。開始済み計算は期限・中断を確認して終了してから返す。

maxMsは観測・準備・worker待ち・閉包を含む予算。初回共有domain準備は完了を待つため、maxMs超過や中断の返却が遅れることがある。準備はworker内だがdomain転送・採用、入力転送・結果整形等の固定処理もあり、厳密な実時間上限ではない。繰り返し呼ぶ場合は準備済みdomainと同じ完全worldStateの共有を推奨する。返却後にこの要求の閉包を継続しない。

限界：数量・材料消費・負の条件を無視する存在だけの過大近似。例えば1本の原木があるだけでも原木999本の目標はpossibleになり得る。falseや0等、正の存在を要求しない条件も判定から外す。possibleはA*計画成功、在庫数、実地の移動・採掘・設置の成功を保証しない。
unreachableは**この観測と行動モデルの中だけ**での不能。「見えていないから届かない」と「本当に作れない」は区別できない。observationComplete=trueも全世界・全チャンクの読込や資源不存在を保証せず、既存observeの範囲・設定・未読込の制約を引き継ぐ。

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
reasonはarrived/timeout/no_path/no_progress。reachedはpathfinderのgoal_reached通知または床座標goalによる到着判定で、distanceは実座標での直線距離。水面等ではpathfinderが床座標+1で到着を通知する場合も到着とする。
no_pathはpathfinderが経路なし・探索期限切れ等を返した場合。no_progressは現在の探索/実行で動けていない場合で、到達不能の証明ではない。
追加のpathStatusは最後のpath_updateのstatus（更新前はnull）、walkingRetryは停止後に歩行で再探索したかを示す。

moveTowardだけで、斜め移動は同じ高さの候補を使い、上り下りは正面の段差を使う。上りの直前と空中ではダッシュを抑え、平地の着地後に戻す。水への落下・泳ぎ・掘削・足場の能力はpathfinderの既存設定を維持する。
100msごとに実座標を確認し、基準位置から水平0.75ブロックまたは垂直1.5ブロック進むと停止時計を更新する。迂回や後退も進展とする。
成功経路があるのに800ms進まなければ、この呼び出しで1回だけダッシュを無効にして再探索する。その後2秒進まなければno_progressを返す。まだ成功経路がない場合も2秒進まなければno_progress。
掘削/設置は待機猶予を設け、掘削はbot.digTime+1500ms（最低2秒）、設置は2秒を考慮する。maxMsが先に尽きればtimeout。後処理時間は別途必要。
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

## 周囲の地表格子（10 M1）

```js
const result = await api.observeTerrain({ radius: 64, maxMs: 1000, signal })
if (result.ok) {
  const d = result.data
  const row = 10, col = 20
  const cell = d.cells[row * d.width + col]
  if (cell) {
    const x = d.bounds.minX + col * d.step
    const z = d.bounds.minZ + row * d.step
    console.log(x, z, cell[0], d.names[cell[1]]) // 地面の床Yと名前
  }
}
```

`observeTerrain({radius=64,step=1,maxMs=1000,signal}={})` は `Promise<Result>`。
radius は0〜128、stepは1〜32の整数。maxMsは0以上の有限値。通常の観測と同じく実行・移動の所有権を取らず、進行中の操作を停止しない。読み込み済みのbot.world/registryと次元のminY/heightが必要。spawn前・未準備・走査中のworld/次元変更はBOT_NOT_READY（spawn後に再試行）、不正入力はINVALID_ARGUMENT、中断はCANCELLED（data:null）。

中心は呼出開始時の足元の床座標 `center:{x,y,z}`。円ではなく正方形を、北（Z−）から南へ、西（X−）から東へ返す。`width=height=floor(2*radius/step)+1`。`bounds` のminX/minZはcenter−radius、maxX/maxZは最後の**採用された**格子座標。stepが2*radiusを割り切らなければ南端・東端は指定半径に届かず、中心も格子点に入らない場合がある。各列の全高度（minY〜maxY）を空から調べ、地下断面は作らない。

`cells` は長さwidth*heightの一次元配列。未読込・未処理はnull。それ以外は次の6要素の配列：

| index / fields | 意味 |
|---|---|
| 0 / groundY | 地面のブロックの床Y。見つからなければnull |
| 1 / groundName | 地面の名前の辞書index（`names[index]`、0はnull） |
| 2 / topY | air/cave_air/void_airだけを除いた最上部の床Y。植物・流体を含む |
| 3 / topName | 最上部の名前の辞書index |
| 4 / fluidY | 地面に至るまでに最初に見つかったwater/lavaブロックの床Y |
| 5 / fluidName | その流体の名前の辞書index（水か溶岩かを判別できる） |

高さはブロック座標であり、衝突形状や液面の小数高さではない。地面はminecraft-dataのboundingBoxがblockの最上部。ただしmaterialのplant、葉・原木・木材（`_wood`）・幹・菌糸・根・ネザーウォートブロック・カーペット（名前末尾の`_leaves/_log/_wood/_stem/_hyphae/_roots/_wart_block/_carpet`）、竹、サボテン、サトウキビ、雪層、sea_pickle、lily_pad、chorus_plant/flower、巨大キノコの3ブロック、azalea/flowering_azaleaを除く。草花などboundingBoxがemptyのものも除く。grass_block、石、土、砂、雪ブロック、氷、建築用の板・屋根等は地面に含む。自然地形と人工構造物を判別するAPIではない。地面を決めるためのこの分類はGOAPの環境知識には適用しない。

木の下ではground=土／top=葉、水上の植物があればground=湖底／top=植物／fluid=水を別々に返す。地面より下の地下水・溶岩は返さない。waterloggedな固体の内部の水も流体面には数えない。読み込み済みの空だけの列は6要素のnull/0配列で、未読込のnull列と区別できる。

dataには`radius/step/width/height/bounds/order/fields/names/cells`のほか、`known/unknown/unknownRatio/unloaded/pending/timedOut/complete/reads/cacheHits/durationMs`がある。unknown=unloaded+pending、unknownRatio=unknown/(width*height)。completeは全格子点を処理した意味で、未読込列があってもtrue。maxMsに達するとok:trueでtimedOut=trueと途中結果を返す（maxMs:0では全列pending）。完了した列と走査途中の列を次回に使い回す。再開は同じ中心・radius・stepが効率的。ただし返却用格子の投影も毎回予算を使うため、極小のmaxMsでは繰り返すだけで完了しない場合がある。必要ならmaxMsを増やすかstep/radiusを調整する。待機・yield・GCも予算を消費し、返却処理やOSの遅延で厳密な返却期限は保証しない。

ブロック状態IDを読み、重いblockAtのオブジェクト生成を避ける。最大約2msごとにsetImmediateで処理を譲り、キャッシュからの格子生成も分割する。blockUpdateでその列、chunkColumnLoad/Unloadでそのチャンクを無効化し、respawn/次元・world変更でリセット。bot終了で購読解除。botごとに最大512チャンク（各256列）のLRUキャッシュ。呼出し間で共有するが返却配列と辞書は独立している。世界を追加読み込みする副作用はない。

格子全体を単一時点へ固定しない。各列の読み取り中に更新が届いた場合はその列をやり直すが、既に返却用配列へ採用した列の後の更新は次回に反映する。移動中も中心は呼出開始時に固定し、格子にはその後の読み込み／更新が反映され得る。既存observe/observeFastの結果とキャッシュは変更しない。同期のJSON.stringifyは呼出側の処理であり、このAPIの分割処理には含まれない。

step=1・全列既知の模擬地形のJSONサイズは半径32/64/96で約81/317/708KB（名前辞書込み）。ブロック名と高さで変わる。実測時間・イベントループ遅延・ライブ例は`requests/2026-10-09_from-isg/10_report.md`、再実行は`node tests/study10/benchmark.cjs`、`./tests/study10/live.ps1`。

## 07 O1：完全観測の差分更新

observe/refreshはbotごとの同じブロックキャッシュを使う。初回は読み込み済みの全範囲を走査し、以降はblockUpdate、chunkColumnLoad/Unload、移動による境界部分だけをbot.blockAtから読み直す。respawnでリセットし、endでイベント購読を解除する。

返却時には実座標を基準に、従来と同じ球・高度範囲・air除外・カテゴリ・整数距離順（同距離は従来のx/y/z走査順）で全一覧を作る。同期済みキャッシュの一時点を完全な観測として返し、その後に到着した更新は次の同期で取り込む。更新が続く間も返却でき、未完の初回/境界走査を完全な観測として返すことはない。予算やsignalで走査を中断した場合は次回に完全走査し直す。

在庫・装備等の公開形と実行cacheの公開規則は維持する。STATE_SCAN_MAX_CHECKSを明示した有限prefix設定は従来scannerを使い、観測内容を変えない。通常の完全観測とobserveFastは短い単位でイベントループへ制御を返す。ただし大きなブロック一覧の割当て/GCと、O1段階の同期計画は残り、最大停止時間の保証はしない。

## 07 O2：計画worker

planGoal、evaluateGoals、executeGoal/runner内の計画・再計画は、プロセスごとの常設worker_threads workerで計算する。既存のA*、閉包、行動順序、探索上限、診断をそのまま使う。ドメインはworkerでMinecraft版に応じて従来どおり生成・準備し、実行の前提検査で使う同じ行動定義をメイン側へ渡す。

workerにはbuildStateが使うworldStateの全項目をデータとして渡す。完全observeの公開内容は減らさない。評価の距離要約は全blocks.listから従来と同じ最寄り位置を短い単位で集計し、その要約を渡す。大きな一覧の同期structuredCloneを避け、推定値・資源・同距離時の選択を維持する。

maxMsには観測、準備、距離集計、workerの待ち行列と探索を含める。perGoalMsと入力順、返却形、cache上限256件/内容キー/時間切れをcacheしない規則は維持する。cacheはbotごとにworkerで保持し、endまたはbotのGCで解放する。異なるMinecraft版のVERSION_CONFLICTも維持する。

中断は共有フラグをworkerの探索チェックから読み、workerの終了応答を待ってからCANCELLEDを返す。planGoalにも任意のsignalを渡せる。評価や計画のsignalは実行中の別操作を停止しない。期限切れの評価は従来どおりunevaluated/budget_exceeded。workerが異常終了した場合はPLANNER_WORKER_FAILEDとし、メインスレッドで重い探索へ切り替えず、次回の呼出しでworkerを再準備する。idleのworkerはプロセス終了を妨げない。

低レベルgoap.planはbotの実行文脈ではworkerを使う。独立した呼出しは従来のメイン側計画も使え、追加options.worker=trueでworkerを指定できる。options.worker=falseは照合用のメイン側計画を指定する。公開Result/plan/diagnosisの形は変わらない。ログは呼出しごとのloggerに渡す。

毎回の判断には完全observeのworldStateを共有し、初回のドメイン準備を先に済ませる。大きな観測一覧の割当て、GC、Mineflayer/pathfinderやOSのスケジュールによる停止は残り、最大50msの保証をAPI契約にはしていない。実測はrequests/2026-10-09_from-isg/07_report.mdを参照。
