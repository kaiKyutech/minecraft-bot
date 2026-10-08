# ① 調査・特性テストの記録

2026-10-09（日本時間）。基準 master `db2b29e`、作業ブランチ `refactor/isg-2026-10-09`。
**本体コード・YAML・API.md の挙動は変更していない。** 追加はテスト/補助スクリプト/観察文書と package scripts。
`.gitignore` は変更せず、この引き継ぎ文書は force-add で追跡する。master の操作・merge・push はしていない。

## 実験条件と証拠

Node v24.2.0、Mineflayer の接続版 1.20.1、Windows。
両サーバーが起動していないことをポートで確認し、Java を独立プロセス・Hidden で起動。
メモリは各 Xmx2G/Xms1G。設定ファイル・他プロジェクトのソースは変更していない。
フラット25565/RCON25575、自然25567/RCON25577。テストワールドの変更は依頼で許可済み。
RCONの秘密はserver.propertiesから読むだけで、文書・ログ・コミットには含めていない。
ユーザーのMinecraftクライアントには触れていない。
初めはGPU実験を禁止されたが、途中でユーザーが許可した。許可後にvisionを実際に呼び出した結果は下記。

完全な返り値とログは `tests/fixtures/{flat,natural}-observations.json.gz`。
配列の各要素に `input / returned または thrown / durationMs / before / after / logs` がある。
undefined は JSON に書けないため `{$undefined:true}` として保存した。
state のクラスインスタンスは JSON 化して保存。inventory、equipment、flags、nearby、blocks.list を省かず格納。
大きい !info/all/レシピの返り値も原データ側で確認できる。末尾の実行一覧は読みやすさのため短縮表示する。
再実行可能なチェックと手順は [tests/README.md](../../tests/README.md)。
後段のライブテストではフラット(300,-60,300)、自然(500,80,500)の再現区画を使用する。

## GOAP（最重要）

ライブラリ：`require('./planner_bot/src/planner/goap').plan(goal, worldState)` は `{plan, diagnosis}`。
実行：`handleChatCommand(bot, who, '!goal inventory.stick:4', bot.stateManager)`。
成功例は `{"success":true,"goal":"inventory.stick:4","message":"目標「inventory.stick:4」を完了しました"}`。
失敗は goal ハンドラの入口で捕捉して `success:false,error,missingPreconditions`。
中断は `!stop` と内部 AbortController。実測は
`{"success":false,"goal":"inventory.wooden_pickaxe:1","aborted":true,"error":"Cancelled","missingPreconditions":[]}`。
未存在目標も診断して返る。`!goal`（末尾引数なし）はハンドラに入らず undefined。

設置済みの板・作業台・チェストを壊して材料にする計画を確認した。
例えば flat empty の chest は `auto_gather_chest_x1` の1手、oak_planks:4 は環境の板4枚採集の1手。
これを「建築物保護」等で制限してはいけない。
numeric 目標は **現 inventory に追加で指定数を得る**。持っている4枚へ planks:4 はさらに4枚。
この点もサーバーなしで固定した。計画の手順はコストで決まり、人の直感と異なる順序も正しい。

元の自然地形、Surveynatural、開始時持ち物なしから各目標を実行：

| 目標 | 結果 | 所要時間 | 作用 |
|---|---|---:|---|
| wooden_pickaxe:1 | 成功 | 37.6秒 | アカシア採集、板/棒、既存作業台使用。持ち物に木ツルハシ |
| stone_pickaxe:1 | 成功 | 67.5秒 | 木ツルハシ準備、基本石採集、石ツルハシ |
| furnace:1 | 90秒の観察上限で !stop | 90.5秒 | 木ツルハシ・丸石9個などを取得。作業台の補助ゴールを実行している途中で中断 |

成功例の木ツルハシ最終手順：
`auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`。
isg 既測の手数（石12/松明11）と今回（石9/松明9）は異なる。今回のワールドには既存作業台があり、
開始環境が同一ではない。どちらかを誤りと扱わず、**保存した状態ごとの結果**を基準にする。

再現用自然区画では、空inventoryから木・石ツルハシ・かまどの全目標が成功した。
元地形での中断とこの結果は別の条件として扱う。数値は末尾の最終検証結果を参照。
補助ゴール・再計画の単体テストも加えたが、循環依存で診断が壊れる経路は既知の失敗に分離した。

## 状態と14目標の固定

| snapshot | 採取条件 | 内容 |
|---|---|---|
| flat-empty | (10,-60,6)周辺、clear | 近くの設置済み板/作業台/chest を含む |
| flat-stocked | 同じ場所、oak_log 3、木ツルハシ1、coal2 | 所持素材と環境を合わせた計画 |
| flat-underground | (202,-62,202)の狭い地下区画 | 石・近隣構造物あり。届かない移動も別途試した |
| natural-empty | 既存自然ワールドのspawn、clear | アカシアなど、石・地下鉱石、既存作業台 |
| natural-stocked | 同じ場所、oak_log 3、木ツルハシ1、coal2 | 所持素材を追加 |

各 snapshot の全 worldState は `.json.gz`、facts は `-facts.json`、14目標の戻り値は `-plans.json`。
plan の action/skill/params/cost の並びと diagnosis 全体を比較し、入力状態が変化しないことも検証。
70目標結果＋5factsを固定。探索時間は性能測定値として記録し、テストの厳密な閾値にはしない。
初回のdomain読み込みも時間に含む。今回はflat refresh約0.5秒、natural約1.6〜1.9秒。
raw の大量 blocks をJSON化する時間も記録補助のdurationに含む。
元isgの数字と比較するときは、採取範囲・ブロック数・マシンの同時CPU負荷も考慮する。

## 機能別の実測

| 機能 | 呼び方・成功時の形 | 観察・代表時間・失敗 |
|---|---|---|
| skill 9種 | `!skill <name> {json}` | gather/hand_craft/workbench_craft/move_to/place_block/furnace_smelt/collect_drops/equip_armor/equip_mainhand を実行。成功は全てundefined。前後にrefresh。craft約1秒、採集約9秒、smelt約11秒 |
| primitive 8種と道具helper | `!primitive move_to {"x":...,"y":...,"z":...}` 等 | moveTo/digBlock/collectDrops/craftItem/placeBlock/equipItem/findBlock/findBlocksを実行。snake_case→camelCase。関数の結果をコマンドは捨てる。findBestTool/equipBestToolForBlockはliveで直接呼び出し |
| register | `!navigation register {"name":"home"}` / coords / blockType | `{success:true,message,location:{x,y,z}}`。場所はfloor。現在地/座標/ブロック検索の3種を確認 |
| goto/gotoCoords | 名前または `{"coords":[x,y,z]}` | `{success:true,message,location}`。goto未登録は失敗値。gotoCoordsでx/y/zのみはthrow。既定許容範囲3なので近距離では座標が変わらないこともある |
| direction | `!navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"nearest"}` | targetPosition/actualPositionを返す。4modeを呼んだ。flat aboveは地面なしでthrow。nearest/below/surfaceは成功。yaw90は西。整数境界ではcos丸め+floorでZが1小さくなる特性も単体で記録 |
| follow/stopFollow | username / `{}` | follow成功でtarget。コマンドstopFollowは先にstopAllがfollowを止めるため `{"success":true,"message":"追跡していません"}`。直接navigation.stopFollowならpreviousTargetを返す |
| dropItem | itemName,count,targetPlayer任意 | 手元とプレイヤー近くでdrop成功。`droppedCount,availableCount`。持っていないitemはthrow。countは先頭スタックまでに制限 |
| pickupItems | range,itemName任意 | 空なら `success:true,pickedUpCount:0,items:[]`。見つかるとfoundCount。召喚したdiamondの実回収をliveで確認。空/存在時の戻り値キーが異なる |
| chestOpen | coords または最寄り | `success:true,position,chest:{items,totalSlots,usedSlots,emptySlots},inventory`。27スロット。開いたままbot.currentChestに保持。非chestは失敗値 |
| chestDeposit/Withdraw/Close | item,count任意 / `{}` | 続行3種はstopAllを呼ばない。deposit3、withdraw1、close成功。未open・未item・count0等は失敗値。count=-1で一部試行が失敗（後述） |
| creative | `!creative placeBlock {"name":"oak_planks","coords":[... ]}` | 座標あり/なしとも成功。すでに埋まった位置は失敗値。周囲5半径の設置探索。primitiveは装備中itemを使うため、別itemを持っていると5秒timeoutになった試行も記録 |
| info all | `!info all` | `{success:true,type:"all",data:{inventory,position,locations,players,nearby}}`。1回refresh。約0.4秒。nearbyも含む |
| scanBlocks | range,type(s),maxChecks,yaw,coneAngle等 | `{success:true,type:"scanBlocks",data:{blocks,summary}}`。range6のwest coneでX差<=0、31ブロック/73checks。未知typeだけのフィルタは無フィルタに戻る |
| recipesFor/Using | itemまたはname、count / ingredientsまたはingredient、mode | minecraft-dataからinventoryなしでもレシピ表示。約1〜10ms。and/or両方。未知item/引数なしはthrow |
| status | `!status` | コンソールのみ、undefined。refresh後に位置/時間/素材/周辺/登録位置のログ。約0.4秒 |
| refresh | `!refresh` | `ReferenceError: setCommand is not defined`。refresh前に失敗する。stateManager.refresh直接は成功 |
| look | `!look direction` / player / watch | 度数→radian、direction成功はyaw/pitch。playerは頭を見る。watchのintervalを保持し!stopで解除。入力不足/未プレイヤーは失敗値 |
| idle | `!idle_on {"intervalMs":200}` | ループ開始、!stopでidle解除。近くのプレイヤーを見る/ランダム首振り。`!idle`は認識されずundefined |
| natural whisper | peer.whisper(botName,'natural-test') | `newNaturalMessage`にfrom/content/timestamp。イベントのみで履歴追加なし。custom onNaturalMessageはイベントを置き換え、autoHandleWhisper:falseで自動処理しない |
| command whisper | peer.whisper(botName,'!history') | 自動コマンド実行とCOMMAND_RESULTログを実測。履歴追加なし。自分のwhisperは無視 |
| chat/echo | `!chat Peer hello` / JSON / `!echo hello` | speakによるwhisper。chatは距離チェック、上限100。成功値にtargetUsername,distance,maxDistance,message。失敗reason。自動history追加なし |
| history APIs | addMessage/getConversationHistory、!history、ユーザー名列 | 構造化content、selfはassistant、他はuser、sequence単調、100件FIFO。username/usernames/typeのフィルタ。送信APIのspeak/speakNearby/chatWithDelayも単体で実行 |
| standalone/multiple | `node planner_bot/index.js`、dotenv設定、count1/2 | SurveyStart/SurveyStart1/SurveyStart2のspawn確認。起動案内を保存。設定なしはexit1とERROR/コピー案内。起動確認後botプロセスを終了 |
| vision | `!info vision {"yaw":90,"pitch":0,"renderWait":1000}` | GPU許可後に実行。`ReferenceError: logger is not defined`。viewer/Chrome起動前に失敗、PNG/画像内容/後処理は未確認 |

## 失敗と文書との差（本体は修正しない）

1. **循環依存**：commands→goal_command→executor→goal_command。startupに警告2つ。
   executorが初期化前のdiagnosis関数を固定してしまう。実行skill失敗→replan診断で
   `buildStructuredDiagnosis is not a function` を、独立Nodeプロセスで再現。test:knownのTODO。
2. **!refresh**：commands/indexのsetCommandは未定義。実サーバーでも同じReferenceError。TODO。
3. **vision**：createLoggerをimportしているがlogger変数を作っていない。最初のlogger使用、catch/finallyでも失敗。
   実際に返った例外はfinallyの行。test:visionのTODO。画像の実験成功を主張しない。
4. **chestWithdraw -1**：deposit→withdraw1→withdraw全部で、一部試行が
   `Can't find oak_planks in slots [0 - 27]` を返した。currentChest.items()にプレイヤー側inventoryが含まれる例もログにある。
   サーバー更新の待機を挟む通常1個のliveテストは成功。まだ確定原因/一般性を断定しない。
5. **自然かまどの遅延**：元地形の90秒上限で中断。再現区画では成功。ワールド条件の違いを保持して記録する。
6. **方角**：API.md scanBlocks の90°東は実測と異なり西。direction/visionの北0/西90説明はコードと一致。
7. **会話履歴**：API.md「自然whisper/!chatで自動追加」は実測と異なる。手動addMessageだけが追加する。
8. **skill名と例**：API.md gatherWood/craftItem のskill例は実exportにない。現在の9個の名前は上記。
   primitive移動のx/y/zは使えるが、navigation gotoCoordsはcoords配列が必要。
9. **export例**：goal_command/creative_command/skill_command等はfunctionを直接module.exports。
   API.mdの `{handleGoalCommand}=require(...)` 等では関数を取り出せない。正しいライブラリ入口はcommandsのhandleChatCommand、ai_botのcreateAIBot。
10. **エラー契約**：未技能/未primitive/JSON不正はログ+undefined、info/navigationは多くがthrow、goal/chat/creative/chestは失敗値。
    一律throwとした文書は実態と異なる。自然言語whisperイベントは会話履歴APIから独立。
11. **停止契約**：stopはGOAP/chest/follow/idle/watch。通常primitive単独移動はGOAP controllerを持たず、stopAllは一般gotoを常に止めるわけではない。
    地下でprimitive moveTo timeout1000ms後に!stopは「停止する操作なし」。timeout時にpathfinderを必ずキャンセルする実装にもなっていない。
12. **生成とキャッシュ**：1.20.1のgeneratedはgather1130/hand275/workbench482/equipment1252。
    静的movement4/furnace10/equipment24を加えdomain3177。先にplanでdomainをキャッシュすると後の生成が自動再loadされない。
    初回フラグもversion単位ではない。計画入口による準備差は01のFの対象。
13. **配置/RCON準備**：未ロードchunkのfill/setblockは成功しない。再現テストはtp→chunk待機→配置→tpを分けた。
    同じ高さの原木/丸石/近い作業台で自然3目標が成功。縦の資源や足元の石の区画では中断例が出たが、これだけで本体バグとは断定しない。
14. **参照**：API.mdのCLAUDE.mdはリポジトリにない。

これらは①の調査結果であり、①が修正の許可を推定する材料ではない。
01で修正が許されているA/H/E以外は、②の計画で質問にするか02へ回す。
range3で移動が起きない、未知typeフィルタが解除される、stopFollowの自動停止、数値目標の加算等は、
依頼の原則に従い **現時点の正しい動作** としてテスト固定した。

## 検証範囲と残り

依頼READMEの全機能を呼び出し、未文書のwatch/idle、blockType登録、speakNearby、deprecated chatWithDelay、
state cache/location APIs、道具helperも調査した。
全Minecraft版・全レシピ/素材・液体/戦闘/死亡・ネット切断・同時GOAPの網羅はしていない。
visionのコードは呼んだが、既知失敗のため実際のWebGL/画像は未確認。
元地形でのfurnace完遂も90秒以内には確認できていない。
リファクタリング案は [00_refactor_proposal.md](00_refactor_proposal.md)。①はここで止まり②の本体改変には進まない。

## 最終検証結果

`npm test` は157件成功・40.2秒。`npm run test:live` は2群成功・181.0秒。
`test:known` 2件と `test:vision` 1件は既知失敗のTODOであり、成功とは数えない。
テスト基盤とgoldenのコミットは `a27be58`。終了時に本体ディレクトリ、API.md、.gitignore、lockfile の master 差分がないことを確認。
今回起動した両サーバーは RCON の save-all→stop で保存して正常停止した。

（以下に検証後の結果と全実測一覧を追加する。）

### 検証コマンドの結果

- offline-run.log: ℹ tests 157 / ℹ pass 157 / ℹ fail 0 / ℹ todo 0 / ℹ duration_ms 40192.7899
- live-final-run.log: ✔ flat: repeatable command, skill, primitive and GOAP features (50604.5831ms) / ✔ natural: repeatable empty-inventory wooden pickaxe, stone pickaxe, furnace (102352.7576ms) / ℹ tests 2 / ℹ pass 2 / ℹ fail 0 / ℹ todo 0 / ℹ duration_ms 180952.1243
- vision-run.log: ℹ tests 1 / ℹ pass 0 / ℹ fail 0 / ℹ todo 1 / ℹ duration_ms 2974.6188
- known-run.log: ℹ tests 2 / ℹ pass 0 / ℹ fail 0 / ℹ todo 2 / ℹ duration_ms 1802.622

`test:known` の2件と `test:vision` の1件は TODO なので、失敗を表示しても終了コード0。通常テストの成功と区別する。
自然liveの各目標の詳細ログは `tests/fixtures/live-natural.json.gz`、フラットliveは `live-flat.json.gz`。

| 最終自然live目標 | success | 秒 | 最終持ち物 |
|---|---|---:|---|
| !goal inventory.wooden_pickaxe:1 | true | 22.91 | [{"name":"oak_log","count":1},{"name":"stick","count":2},{"name":"oak_planks","count":3},{"name":"wooden_pickaxe","count":1}] |
| !goal inventory.stone_pickaxe:1 | true | 28.58 | [{"name":"stone_pickaxe","count":1},{"name":"oak_planks","count":3},{"name":"wooden_pickaxe","count":1}] |
| !goal inventory.furnace:1 | true | 42.93 | [{"name":"oak_log","count":1},{"name":"stick","count":2},{"name":"oak_planks","count":3},{"name":"furnace","count":1},{"name":"wooden_pickaxe","count":1}] |

### 14目標×5状態の計画手数

null は plan が見つからなかった結果。失敗理由と suggestions の全体は各 -plans.json に格納。

| 目標 | flat-empty | flat-stocked | flat-underground | natural-empty | natural-stocked |
|---|---:|---:|---:|---:|---:|
| inventory.oak_planks:4 | 1 | 1 | 1 | 2 | 1 |
| inventory.stick:4 | 2 | 2 | 2 | 3 | 2 |
| inventory.crafting_table:1 | 1 | 1 | 1 | 1 | 1 |
| inventory.wooden_pickaxe:1 | 4 | 4 | 3 | 6 | 5 |
| inventory.wooden_sword:1 | 5 | 5 | 4 | 5 | 4 |
| inventory.stone_pickaxe:1 | null | null | 6 | 9 | 5 |
| inventory.furnace:1 | null | null | 4 | 8 | 3 |
| inventory.torch:4 | null | 3 | null | 9 | 3 |
| inventory.iron_ingot:3 | null | null | null | null | null |
| inventory.iron_pickaxe:1 | null | null | null | null | null |
| inventory.diamond_pickaxe:1 | null | null | null | null | null |
| inventory.chest:1 | 1 | 1 | 1 | 5 | 4 |
| inventory.bread:1 | null | null | null | null | null |
| inventory.cake:1 | null | null | null | null | null |

### 元ワールドでの実行一覧

返り値欄はJSONの短縮表示。各行の番号は元ファイル配列の0始まりindexで、返り値・前後状態・ログ全文を辿れる。
ログ欄はprefixのみ。省略は成功/未確認を意味しない。

#### flat — 149記録 (flat-observations.json.gz)

| index | 入力 | ms | 返り値/例外 | 前後の変化 | ログprefix |
|---:|---|---:|---|---|---|
| 0 | generate gather 1.20.1 | 106.9 | [{"name":"auto_gather_log_category_barehand_x1","preconditions":{"inventory_space":true,"nearby.category.log":">= 1"},"effects":{"inventory.category.log":"+1"},"cost":3,"skill":"gather","params":{"itemName":"log","cou… | なし/対象外 | [AUTO-GATHER] |
| 1 | generate craft 1.20.1 | 108.7 | {"hand":[{"name":"auto_hand_craft_granite","preconditions":{"inventory.diorite":">= 1","inventory.quartz":">= 1"},"effects":{"inventory.diorite":"-1","inventory.quartz":"-1","inventory.granite":"+1"},"cost":10,"skill"… | なし/対象外 | [AUTO-CRAFT] |
| 2 | generate equipment 1.20.1 | 71.0 | [{"name":"auto_equip_mainhand_stone","preconditions":{"inventory.stone":">= 1"},"effects":{"equipment.stone":true},"cost":1,"skill":"equip_mainhand","params":{"item":"stone"}},{"name":"auto_equip_mainhand_granite","pr… | なし/対象外 | [AUTO-EQUIP] |
| 3 | stateManager.refresh / empty | 494.5 | worldState全文（snapshotと元JSON参照） | なし/対象外 |  |
| 4 | goap.plan empty inventory.oak_planks:4 | 700.1 | {"plan":[{"action":"auto_gather_oak_planks_barehand_x8","skill":"gather","params":{"itemName":"oak_planks","count":8},"cost":10}],"diagnosis":null} | なし/対象外 |  |
| 5 | goap.plan empty inventory.stick:4 | 22.5 | {"plan":[{"action":"auto_gather_plank_category_barehand_x3","skill":"gather","params":{"itemName":"plank","count":3},"cost":5},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 6 | goap.plan empty inventory.crafting_table:1 | 19.8 | {"plan":[{"action":"auto_gather_crafting_table_x1","skill":"gather","params":{"itemName":"crafting_table","count":1},"cost":5}],"diagnosis":null} | なし/対象外 |  |
| 7 | goap.plan empty inventory.wooden_pickaxe:1 | 37.4 | {"plan":[{"action":"auto_gather_plank_category_barehand_x8","skill":"gather","params":{"itemName":"plank","count":8},"cost":8},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 8 | goap.plan empty inventory.wooden_sword:1 | 30.2 | {"plan":[{"action":"auto_gather_plank_category_barehand_x3","skill":"gather","params":{"itemName":"plank","count":3},"cost":5},{"action":"move_to_workbench","skill":"move_to","params":{"blockType":"crafting_table","ma… | なし/対象外 |  |
| 9 | goap.plan empty inventory.stone_pickaxe:1 | 233.3 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.stone_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.stone_pickaxe","action":"auto_workbench_craft_stone_pick… | なし/対象外 |  |
| 10 | goap.plan empty inventory.furnace:1 | 222.2 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.furnace","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.furnace","action":"auto_gather_furnace_x1","cost":1,"allSatisf… | なし/対象外 |  |
| 11 | goap.plan empty inventory.torch:4 | 264.9 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.torch","current":"なし","target":"4個","deficit":4}],"suggestions":[{"target":"inventory.torch","action":"auto_gather_torch_x1","cost":5,"allSatisfied":f… | なし/対象外 |  |
| 12 | goap.plan empty inventory.iron_ingot:3 | 352.4 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_ingot","current":"なし","target":"3個","deficit":3}],"suggestions":[{"target":"inventory.iron_ingot","action":"auto_hand_craft_iron_ingot","cost":10… | なし/対象外 |  |
| 13 | goap.plan empty inventory.iron_pickaxe:1 | 343.2 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.iron_pickaxe","action":"auto_workbench_craft_iron_pickaxe… | なし/対象外 |  |
| 14 | goap.plan empty inventory.diamond_pickaxe:1 | 371.2 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.diamond_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.diamond_pickaxe","action":"auto_workbench_craft_diamon… | なし/対象外 |  |
| 15 | goap.plan empty inventory.chest:1 | 14.3 | {"plan":[{"action":"auto_gather_chest_x1","skill":"gather","params":{"itemName":"chest","count":1},"cost":5}],"diagnosis":null} | なし/対象外 |  |
| 16 | goap.plan empty inventory.bread:1 | 203.4 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.bread","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.bread","action":"auto_workbench_craft_bread","cost":10,"allSatis… | なし/対象外 |  |
| 17 | goap.plan empty inventory.cake:1 | 186.6 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.cake","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.cake","action":"auto_gather_cake_x1","cost":5,"allSatisfied":fals… | なし/対象外 |  |
| 18 | stateManager.refresh / stocked | 473.8 | worldState全文（snapshotと元JSON参照） | なし/対象外 |  |
| 19 | goap.plan stocked inventory.oak_planks:4 | 1.4 | {"plan":[{"action":"auto_gather_oak_planks_barehand_x8","skill":"gather","params":{"itemName":"oak_planks","count":8},"cost":10}],"diagnosis":null} | なし/対象外 |  |
| 20 | goap.plan stocked inventory.stick:4 | 3.4 | {"plan":[{"action":"auto_gather_plank_category_barehand_x3","skill":"gather","params":{"itemName":"plank","count":3},"cost":5},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 21 | goap.plan stocked inventory.crafting_table:1 | 1.5 | {"plan":[{"action":"auto_gather_crafting_table_x1","skill":"gather","params":{"itemName":"crafting_table","count":1},"cost":5}],"diagnosis":null} | なし/対象外 |  |
| 22 | goap.plan stocked inventory.wooden_pickaxe:1 | 24.7 | {"plan":[{"action":"auto_gather_plank_category_barehand_x8","skill":"gather","params":{"itemName":"plank","count":8},"cost":8},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 23 | goap.plan stocked inventory.wooden_sword:1 | 13.5 | {"plan":[{"action":"auto_gather_plank_category_barehand_x3","skill":"gather","params":{"itemName":"plank","count":3},"cost":5},{"action":"move_to_workbench","skill":"move_to","params":{"blockType":"crafting_table","ma… | なし/対象外 |  |
| 24 | goap.plan stocked inventory.stone_pickaxe:1 | 184.7 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.stone_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.stone_pickaxe","action":"auto_workbench_craft_stone_pick… | なし/対象外 |  |
| 25 | goap.plan stocked inventory.furnace:1 | 168.2 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.furnace","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.furnace","action":"auto_gather_furnace_x1","cost":1,"allSatisf… | なし/対象外 |  |
| 26 | goap.plan stocked inventory.torch:4 | 5.1 | {"plan":[{"action":"auto_gather_plank_category_barehand_x3","skill":"gather","params":{"itemName":"plank","count":3},"cost":5},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 27 | goap.plan stocked inventory.iron_ingot:3 | 351.5 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_ingot","current":"なし","target":"3個","deficit":3}],"suggestions":[{"target":"inventory.iron_ingot","action":"auto_hand_craft_iron_ingot","cost":10… | なし/対象外 |  |
| 28 | goap.plan stocked inventory.iron_pickaxe:1 | 356.3 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.iron_pickaxe","action":"auto_workbench_craft_iron_pickaxe… | なし/対象外 |  |
| 29 | goap.plan stocked inventory.diamond_pickaxe:1 | 314.3 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.diamond_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.diamond_pickaxe","action":"auto_workbench_craft_diamon… | なし/対象外 |  |
| 30 | goap.plan stocked inventory.chest:1 | 2.6 | {"plan":[{"action":"auto_gather_chest_x1","skill":"gather","params":{"itemName":"chest","count":1},"cost":5}],"diagnosis":null} | なし/対象外 |  |
| 31 | goap.plan stocked inventory.bread:1 | 135.1 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.bread","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.bread","action":"auto_workbench_craft_bread","cost":10,"allSatis… | なし/対象外 |  |
| 32 | goap.plan stocked inventory.cake:1 | 135.2 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.cake","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.cake","action":"auto_gather_cake_x1","cost":5,"allSatisfied":fals… | なし/対象外 |  |
| 33 | !status | 409.8 | {"$undefined":true} | なし/対象外 |  |
| 34 | !refresh | 0.1 | throw ReferenceError: setCommand is not defined | なし/対象外 |  |
| 35 | !info all | 411.6 | {"success":true,"type":"all","data":{"inventory":{"items":[],"summary":{"totalItems":0,"totalCount":0,"tools":0,"materials":0,"isEmpty":true}},"position":{"position":{"x":200,"y":-60,"z":200},"rotation":{"yaw":180,"pi… | なし/対象外 |  |
| 36 | !info | 0.1 | throw Error: 使用方法: !info <type> 利用可能: all, vision, scanBlocks, recipesFor, recipesUsing | なし/対象外 |  |
| 37 | !info absent | 0.1 | throw Error: 未知の情報タイプ: absent 利用可能: all, vision, scanBlocks, recipesFor, recipesUsing | なし/対象外 |  |
| 38 | !info all { | 0.3 | throw Error: パラメータのJSON解析に失敗: Expected property name or '}' in JSON at position 1 (line 1 column 2) | なし/対象外 |  |
| 39 | !info recipesFor {"item":"wooden_pickaxe"} | 1.6 | {"success":true,"type":"recipesFor","data":{"item":"wooden_pickaxe","count":1,"recipes":[{"station":"crafting_table","shaped":true,"outputs":[{"name":"wooden_pickaxe","count":1}],"inputs":[{"name":"oak_planks","count"… | なし/対象外 |  |
| 40 | !info recipesFor {"item":"absent"} | 0.1 | throw Error: item に指定されたアイテムが見つかりません: absent | なし/対象外 |  |
| 41 | !info recipesUsing {"ingredients":["oak_planks","stick"]} | 8.8 | {"success":true,"type":"recipesUsing","data":{"ingredients":["oak_planks","stick"],"mode":"and","results":[{"item":"oak_fence","station":"crafting_table","shaped":true,"outputs":[{"name":"oak_fence","count":3}],"input… | なし/対象外 |  |
| 42 | !info recipesUsing {"ingredient":"stick","mode":"or"} | 8.5 | {"success":true,"type":"recipesUsing","data":{"ingredients":["stick"],"mode":"or","results":[{"item":"torch","station":"hand","shaped":true,"outputs":[{"name":"torch","count":4}],"inputs":[{"name":"coal","count":1},{"… | なし/対象外 |  |
| 43 | !info recipesFor {} | 0.1 | throw Error: recipesFor には item パラメータが必要です | なし/対象外 |  |
| 44 | !info scanBlocks {"range":6,"maxChecks":-1,"yaw":90,"coneAngle":30} | 0.6 | {"success":true,"type":"scanBlocks","data":{"blocks":[{"name":"grass_block","position":{"x":200,"y":-61,"z":200},"relativePosition":{"x":0,"y":-1,"z":0},"distance":1},{"name":"glass","position":{"x":199,"y":-60,"z":20… | なし/対象外 |  |
| 45 | !navigation | 0.4 | throw Error: 使用方法: !navigation <action> [params] 利用可能: register, goto, gotoCoords, moveInDirection, follow, stopFollow | なし/対象外 |  |
| 46 | !navigation absent {} | 0.1 | throw Error: 未知のナビゲーション操作: absent 利用可能: register, goto, gotoCoords, follow, stopFollow, moveInDirection, dropItem, pickupItems, chestOpen, chestDeposit, chestWithdraw, chestClose | なし/対象外 |  |
| 47 | !navigation gotoCoords {"x":1,"y":2,"z":3} | 0.2 | throw Error: 座標（coords）が必要です | なし/対象外 |  |
| 48 | !navigation goto {"name":"absent"} | 0.2 | {"success":false,"message":"場所「absent」は登録されていません。登録済み: なし","registeredLocations":[]} | なし/対象外 | [NAVIGATION] |
| 49 | !navigation register {"name":"home"} | 0.3 | {"success":true,"message":"場所「home」を登録しました","location":{"x":200,"y":-60,"z":200}} | なし/対象外 | [NAVIGATION] |
| 50 | !navigation register {"name":"table","blockType":"crafting_table"} | 4.3 | {"success":true,"message":"場所「table」を登録しました","location":{"x":204,"y":-60,"z":200}} | なし/対象外 | [NAVIGATION] |
| 51 | !navigation register {"name":"point","coords":[206,-60,200]} | 0.1 | {"success":true,"message":"場所「point」を登録しました","location":{"x":206,"y":-60,"z":200}} | なし/対象外 | [NAVIGATION] |
| 52 | !navigation goto {"name":"point"} | 797.8 | {"success":true,"message":"「point」に到着しました","location":{"x":206,"y":-60,"z":200}} | 位置変化、視線変化 | [NAVIGATION] |
| 53 | !navigation gotoCoords {"coords":[200,-60,200]} | 77.6 | {"success":true,"message":"[200, -60, 200]に到着しました","location":{"x":200,"y":-60,"z":200}} | なし/対象外 | [NAVIGATION] |
| 54 | !navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"nearest"} | 61.1 | {"success":true,"message":"Yaw 90° 方向に 2 ブロック移動しました","targetPosition":{"x":198,"y":-60,"z":200},"actualPosition":{"x":200,"y":-60,"z":200}} | なし/対象外 | [NAVIGATION] |
| 55 | !navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"above"} | 0.3 | throw Error: 現在地より上に立てる地面が見つかりません (探索範囲: 50ブロック) | なし/対象外 | [NAVIGATION] |
| 56 | !navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"below"} | 76.9 | {"success":true,"message":"Yaw 90° 方向に 2 ブロック移動しました","targetPosition":{"x":198,"y":-60,"z":200},"actualPosition":{"x":200,"y":-60,"z":200}} | なし/対象外 | [NAVIGATION] |
| 57 | !navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"surface"} | 76.8 | {"success":true,"message":"Yaw 90° 方向に 2 ブロック移動しました","targetPosition":{"x":198,"y":-60,"z":200},"actualPosition":{"x":200,"y":-60,"z":200}} | なし/対象外 | [NAVIGATION] |
| 58 | !navigation follow {"username":"SurveyPeer"} | 0.8 | {"success":true,"message":"SurveyPeer の追跡を開始しました","target":"SurveyPeer"} | なし/対象外 | [NAVIGATION] |
| 59 | !navigation stopFollow {} | 0.1 | {"success":true,"message":"追跡していません"} | なし/対象外 |  |
| 60 | !navigation stopFollow {} | 0.0 | {"success":true,"message":"追跡していません"} | なし/対象外 |  |
| 61 | !navigation follow {"username":"absent"} | 0.1 | throw Error: プレイヤー「absent」が見つかりません | なし/対象外 |  |
| 62 | !look direction {"yaw":90,"pitch":15} | 0.3 | {"success":true,"yaw":90,"pitch":15} | 視線変化 | [LOOK] |
| 63 | !look player {"username":"SurveyPeer"} | 588.6 | {"success":true,"target":"SurveyPeer","distance":4} | 視線変化 | [LOOK] |
| 64 | !look watch {"username":"SurveyPeer","intervalMs":200} | 0.5 | {"success":true,"target":"SurveyPeer","intervalMs":200} | なし/対象外 | [LOOK] |
| 65 | !stop | 0.1 | {"success":true,"stoppedActions":["look_watch"],"message":"停止しました: look_watch"} | なし/対象外 |  |
| 66 | !look direction {} | 0.1 | {"success":false,"reason":"missing_params","error":"yaw または pitch を指定してください（度数）","usage":"!look direction {\"yaw\":90,\"pitch\":0} / !look player {\"username\":\"PlayerName\"} / !look watch {\"username\":\"PlayerName\… | なし/対象外 |  |
| 67 | !look player {"username":"absent"} | 0.1 | {"success":false,"reason":"player_not_found","error":"プレイヤー「absent」が見つかりません","target":"absent"} | なし/対象外 |  |
| 68 | !idle_on {"intervalMs":200,"playerLookChance":1} | 0.5 | {"success":true,"message":"idleモード開始（interval=200ms, playerRange=8, playerLookChance=1）"} | なし/対象外 | [IDLE] |
| 69 | !stop | 0.0 | {"success":true,"stoppedActions":["idle"],"message":"停止しました: idle"} | なし/対象外 |  |
| 70 | !stop | 0.0 | {"success":true,"stoppedActions":[],"message":"停止する操作がありませんでした"} | なし/対象外 |  |
| 71 | !chat SurveyPeer hello | 1.2 | {"success":true,"targetUsername":"SurveyPeer","distance":4,"maxDistance":15,"message":"hello"} | なし/対象外 | [CHAT] |
| 72 | !chat {"username":"SurveyPeer","message":"hello json","maxDistance":150} | 0.3 | {"success":true,"targetUsername":"SurveyPeer","distance":4,"maxDistance":100,"message":"hello json"} | なし/対象外 | [CHAT] |
| 73 | !chat absent hello | 0.1 | {"success":false,"reason":"player_not_found","targetUsername":"absent"} | なし/対象外 | [CHAT] |
| 74 | !chat { | 0.1 | {"success":false,"reason":"invalid_format","error":"JSON parse error","usage":"!chat {\"username\": \"PlayerName\", \"message\": \"Hello!\", \"maxDistance\": 15}"} | なし/対象外 |  |
| 75 | !chat SurveyPeer | 0.0 | {"success":false,"reason":"invalid_format","usage":"!chat <username> <message> or !chat {\"username\": \"PlayerName\", \"message\": \"Hello!\", \"maxDistance\": 15}"} | なし/対象外 |  |
| 76 | !echo echo-test | 0.3 | {"success":true,"message":"echo-test"} | なし/対象外 |  |
| 77 | !history | 0.2 | {"success":true,"count":0,"latestSequence":0,"history":[]} | なし/対象外 |  |
| 78 | !history SurveyPeer,Surveyflat | 0.1 | {"success":true,"usernames":["SurveyPeer","Surveyflat"],"count":0,"latestSequence":0,"history":[]} | なし/対象外 |  |
| 79 | !idle | 0.0 | {"$undefined":true} | なし/対象外 |  |
| 80 | !goal | 0.0 | {"$undefined":true} | なし/対象外 |  |
| 81 | !unknown | 0.0 | {"$undefined":true} | なし/対象外 |  |
| 82 | natural whisper / event | 19.2 | {"from":"SurveyPeer","content":"natural-test","timestamp":1791485274540} | なし/対象外 |  |
| 83 | command whisper auto handling | 500.6 | {"history":[],"lastCommandName":"history"} | なし/対象外 | [COMMAND_RESULT] |
| 84 | addMessage / filters / FIFO | 1.2 | {"filtered":[{"sequence":1,"speaker":"SurveyPeer","role":"user","content":"human","type":"conversation","timestamp":"2026-10-08T18:47:55.041Z"}],"count":100,"first":{"sequence":4,"speaker":"Surveyflat","role":"assista… | なし/対象外 | [HISTORY_ADD] |
| 85 | !navigation chestDeposit {"item":"oak_planks"} | 0.2 | {"success":false,"error":"先に chestOpen コマンドでチェストを開いてください"} | なし/対象外 |  |
| 86 | !navigation chestOpen {"coords":[200,-61,200]} | 0.3 | {"success":false,"error":"指定座標はチェストではありません（grass_block）","position":{"x":200,"y":-61,"z":200},"blockName":"grass_block"} | なし/対象外 | [NAVIGATION] |
| 87 | !navigation chestOpen {"coords":[202,-60,200]} | 564.9 | {"success":true,"message":"チェストを開きました","position":{"x":202,"y":-60,"z":200},"chest":{"itemCount":0,"items":[],"totalSlots":27,"usedSlots":0,"emptySlots":27},"inventory":{"itemCount":6,"items":[{"name":"oak_planks","co… | 視線変化 | [NAVIGATION] |
| 88 | !navigation chestDeposit {"item":"oak_planks","count":3} | 2.7 | {"success":true,"message":"oak_planks x 3 をチェストに預けました","position":{"x":202,"y":-60,"z":200},"item":"oak_planks","count":3} | なし/対象外 | [NAVIGATION] |
| 89 | !navigation chestWithdraw {"item":"oak_planks","count":1} | 0.4 | {"success":true,"message":"oak_planks x 1 をチェストから取り出しました","position":{"x":202,"y":-60,"z":200},"item":"oak_planks","count":1} | なし/対象外 | [NAVIGATION] |
| 90 | !navigation chestWithdraw {"item":"oak_planks","count":-1} | 0.3 | {"success":false,"error":"アイテムを取り出せませんでした: Can't find oak_planks in slots [0 - 27], (item id: 23)","position":{"x":202,"y":-60,"z":200},"item":"oak_planks"} | なし/対象外 | [NAVIGATION] |
| 91 | !navigation chestWithdraw {"item":"diamond"} | 0.1 | {"success":false,"error":"チェストに diamond がありません","position":{"x":202,"y":-60,"z":200},"chestItems":[{"name":"oak_planks","count":32},{"name":"cobblestone","count":4},{"name":"iron_helmet","count":1},{"name":"coal","cou… | なし/対象外 | [NAVIGATION] |
| 92 | !navigation chestClose {} | 0.3 | {"success":true,"message":"チェストを閉じました","position":{"x":202,"y":-60,"z":200}} | なし/対象外 | [NAVIGATION] |
| 93 | !navigation chestClose {} | 0.0 | {"success":false,"error":"開いているチェストがありません"} | なし/対象外 |  |
| 94 | !navigation dropItem {"itemName":"cobblestone","count":1} | 0.5 | {"success":true,"message":"その場で cobblestone を 1個ドロップしました","itemName":"cobblestone","droppedCount":1,"availableCount":4} | 持ち物変化 | [NAVIGATION] |
| 95 | !navigation pickupItems {"range":6} | 0.2 | {"success":true,"message":"拾うアイテムが見つかりませんでした","pickedUpCount":0,"items":[]} | なし/対象外 | [NAVIGATION] |
| 96 | !navigation pickupItems {"range":1,"itemName":"diamond"} | 0.2 | {"success":true,"message":"拾うアイテムが見つかりませんでした","pickedUpCount":0,"items":[]} | なし/対象外 | [NAVIGATION] |
| 97 | !navigation dropItem {"itemName":"cobblestone","targetPlayer":"SurveyPeer"} | 532.0 | {"success":true,"message":"SurveyPeer の近くに cobblestone を 1個ドロップしました","targetPlayer":"SurveyPeer","itemName":"cobblestone","droppedCount":1,"availableCount":3} | 位置変化、持ち物変化、視線変化 | [NAVIGATION] |
| 98 | !navigation dropItem {"itemName":"diamond"} | 0.1 | throw Error: アイテム「diamond」がインベントリにありません | なし/対象外 |  |
| 99 | !creative placeBlock {"name":"oak_planks","coords":[200,-60,198]} | 1062.2 | {"success":true,"action":"placeBlock","data":{"success":true,"message":"oak_planks を [200, -60, 198] に設置しました","block":"oak_planks","position":{"x":200,"y":-60,"z":198}}} | 位置変化、持ち物変化、視線変化 |  |
| 100 | !creative placeBlock {"name":"oak_planks","coords":[200,-61,198]} | 0.1 | {"success":true,"action":"placeBlock","data":{"success":false,"error":"設置できません: 既にブロック（grass_block）が存在します","position":{"x":200,"y":-61,"z":198}}} | なし/対象外 |  |
| 101 | !creative placeBlock {"name":"oak_planks"} | 67.2 | {"success":true,"action":"placeBlock","data":{"success":true,"message":"oak_planks を [200, -60, 201] に設置しました","block":"oak_planks","position":{"x":200,"y":-60,"z":201}}} | 持ち物変化、視線変化 |  |
| 102 | !creative placeBlock {} | 0.0 | {"success":true,"action":"placeBlock","data":{"success":false,"error":"ブロック名（name）が必要です"}} | なし/対象外 |  |
| 103 | !creative absent {} | 0.1 | throw Error: 未知のアクション: absent 利用可能: placeBlock | なし/対象外 |  |
| 104 | !skill | 0.2 | {"$undefined":true} | なし/対象外 |  |
| 105 | !skill absent | 0.0 | {"$undefined":true} | なし/対象外 |  |
| 106 | !skill gather { | 0.0 | {"$undefined":true} | なし/対象外 |  |
| 107 | !primitive | 0.1 | {"$undefined":true} | なし/対象外 |  |
| 108 | !primitive absent | 0.1 | {"$undefined":true} | なし/対象外 |  |
| 109 | !primitive move_to { | 0.1 | {"$undefined":true} | なし/対象外 |  |
| 110 | !skill hand_craft {"recipe":"stick","count":1} | 1024.8 | {"$undefined":true} | 持ち物変化 | [HAND_CRAFT] |
| 111 | !skill workbench_craft {"recipe":"wooden_pickaxe","count":1} | 1199.9 | {"$undefined":true} | 位置変化、持ち物変化、視線変化 | [WORKBENCH_CRAFT] |
| 112 | !skill equip_mainhand {"item":"wooden_pickaxe"} | 863.6 | {"$undefined":true} | なし/対象外 |  |
| 113 | !skill equip_armor {"item":"iron_helmet","slot":"head"} | 409.7 | throw Error: 装備に失敗しました: 不明な装備スロット: head | なし/対象外 |  |
| 114 | !skill move_to {"blockType":"furnace"} | 969.8 | {"$undefined":true} | なし/対象外 |  |
| 115 | !skill furnace_smelt {"input":"raw_iron","fuel":"coal","output":"iron_ingot"} | 11142.5 | {"$undefined":true} | 持ち物変化、視線変化 | [FURNACE_SMELT] |
| 116 | !skill place_block {"blockName":"oak_planks"} | 1759.0 | {"$undefined":true} | 持ち物変化、視線変化 | [PLACE_BLOCK] |
| 117 | !skill gather {"itemName":"oak_log","count":1,"maxDistance":8,"maxAttempts":2} | 325.1 | throw Error: 近くに対象ブロックが見つかりません | なし/対象外 |  |
| 118 | !skill collect_drops {"radius":3,"maxAttempts":1} | 1154.0 | {"$undefined":true} | 位置変化、持ち物変化、視線変化 |  |
| 119 | !primitive find_block {"match":"crafting_table","maxDistance":12} | 691.7 | {"$undefined":true} | なし/対象外 |  |
| 120 | !primitive find_blocks {"match":["furnace","chest"],"count":2,"maxDistance":12} | 1072.3 | {"$undefined":true} | なし/対象外 |  |
| 121 | !primitive equip_item {"itemName":"wooden_pickaxe"} | 1022.4 | {"$undefined":true} | なし/対象外 |  |
| 122 | !primitive craft_item {"itemName":"stick"} | 945.0 | {"$undefined":true} | 持ち物変化 |  |
| 123 | !primitive move_to {"x":200,"y":-60,"z":200,"range":2,"timeout":2000} | 1000.6 | {"$undefined":true} | なし/対象外 |  |
| 124 | !primitive collect_drops {"radius":3} | 831.9 | {"$undefined":true} | なし/対象外 |  |
| 125 | !primitive dig_block {"x":200,"y":-60,"z":198} | 4331.7 | {"$undefined":true} | 視線変化 | [DIG] |
| 126 | !primitive place_block {"reference":{"x":199,"y":-61,"z":198}} | 5595.0 | throw Error: Event blockUpdate:(199, -60, 198) did not fire within timeout of 5000ms | 視線変化 |  |
| 127 | !skill gather {"itemName":"oak_log","count":1,"maxDistance":8,"maxAttempts":2} | 9040.1 | {"$undefined":true} | 位置変化、持ち物変化、視線変化 | [DIG] |
| 128 | !goal inventory.stick:4 | 7895.7 | {"success":true,"goal":"inventory.stick:4","message":"目標「inventory.stick:4」を完了しました"} | 位置変化、持ち物変化、視線変化 | [STATE] [GOAP] [GOAP Iter 1] [GOAP Iter 2] [GOAP Iter 3] [EXECUTION] |
| 129 | !goal absent_goal | 473.6 | {"success":false,"goal":"absent_goal","error":"目標「absent_goal」を実行できません","missingPreconditions":["absent_goal"]} | なし/対象外 | [STATE] |
| 130 | !goal inventory.cake:1 | 873.0 | {"success":false,"goal":"inventory.cake:1","error":"目標「nearby.cake:1」を実行できません","missingPreconditions":["inventory.cake:1","nearby.cake:1"]} | なし/対象外 | [STATE] [GOAP] [GOAP Iter 1] [GOAP Iter 2] [GOAP Iter 3] [GOAP Iter 4] |
| 131 | !goal inventory.wooden_pickaxe:1 + !stop (300ms) | 446.2 | {"stopped":{"success":true,"stoppedActions":["GOAP task"],"message":"停止しました: GOAP task"},"goalResult":{"success":false,"goal":"inventory.wooden_pickaxe:1","aborted":true,"error":"Cancelled","missingPreconditions":[]}} | なし/対象外 | [STATE] [GOAP] [GOAP Iter 1] [GOAP Iter 2] [GOAP Iter 3] [GOAP Iter 4] |
| 132 | stateManager.refresh / underground | 440.6 | worldState全文（snapshotと元JSON参照） | なし/対象外 |  |
| 133 | goap.plan underground inventory.oak_planks:4 | 11.8 | {"plan":[{"action":"auto_gather_oak_planks_barehand_x8","skill":"gather","params":{"itemName":"oak_planks","count":8},"cost":10}],"diagnosis":null} | なし/対象外 |  |
| 134 | goap.plan underground inventory.stick:4 | 9.1 | {"plan":[{"action":"auto_gather_plank_category_barehand_x3","skill":"gather","params":{"itemName":"plank","count":3},"cost":5},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 135 | goap.plan underground inventory.crafting_table:1 | 15.6 | {"plan":[{"action":"auto_gather_crafting_table_x1","skill":"gather","params":{"itemName":"crafting_table","count":1},"cost":5}],"diagnosis":null} | なし/対象外 |  |
| 136 | goap.plan underground inventory.wooden_pickaxe:1 | 15.4 | {"plan":[{"action":"auto_gather_plank_category_barehand_x8","skill":"gather","params":{"itemName":"plank","count":8},"cost":8},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 137 | goap.plan underground inventory.wooden_sword:1 | 21.7 | {"plan":[{"action":"auto_gather_plank_category_barehand_x3","skill":"gather","params":{"itemName":"plank","count":3},"cost":5},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 138 | goap.plan underground inventory.stone_pickaxe:1 | 22.2 | {"plan":[{"action":"auto_gather_plank_category_barehand_x3","skill":"gather","params":{"itemName":"plank","count":3},"cost":5},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 139 | goap.plan underground inventory.furnace:1 | 40.9 | {"plan":[{"action":"auto_gather_plank_category_barehand_x8","skill":"gather","params":{"itemName":"plank","count":8},"cost":8},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"stick","count":… | なし/対象外 |  |
| 140 | goap.plan underground inventory.torch:4 | 135.5 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.torch","current":"なし","target":"4個","deficit":4}],"suggestions":[{"target":"inventory.torch","action":"auto_gather_torch_x1","cost":5,"allSatisfied":f… | なし/対象外 |  |
| 141 | goap.plan underground inventory.iron_ingot:3 | 175.4 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_ingot","current":"なし","target":"3個","deficit":3}],"suggestions":[{"target":"inventory.iron_ingot","action":"auto_hand_craft_iron_ingot","cost":10… | なし/対象外 |  |
| 142 | goap.plan underground inventory.iron_pickaxe:1 | 193.9 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.iron_pickaxe","action":"auto_workbench_craft_iron_pickaxe… | なし/対象外 |  |
| 143 | goap.plan underground inventory.diamond_pickaxe:1 | 166.5 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.diamond_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.diamond_pickaxe","action":"auto_workbench_craft_diamon… | なし/対象外 |  |
| 144 | goap.plan underground inventory.chest:1 | 10.0 | {"plan":[{"action":"auto_gather_chest_x1","skill":"gather","params":{"itemName":"chest","count":1},"cost":5}],"diagnosis":null} | なし/対象外 |  |
| 145 | goap.plan underground inventory.bread:1 | 1.3 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.bread","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.bread","action":"auto_workbench_craft_bread","cost":10,"allSatis… | なし/対象外 |  |
| 146 | goap.plan underground inventory.cake:1 | 36.2 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.cake","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.cake","action":"auto_gather_cake_x1","cost":5,"allSatisfied":fals… | なし/対象外 |  |
| 147 | !primitive move_to {"x":202,"y":-60,"z":202,"timeout":1000} | 1434.0 | throw Error: moveTo timeout (1000ms) | 視線変化 |  |
| 148 | !stop | 0.0 | {"success":true,"stoppedActions":[],"message":"停止する操作がありませんでした"} | なし/対象外 |  |

#### natural — 36記録 (natural-observations.json.gz)

| index | 入力 | ms | 返り値/例外 | 前後の変化 | ログprefix |
|---:|---|---:|---|---|---|
| 0 | generate gather 1.20.1 | 144.5 | [{"name":"auto_gather_log_category_barehand_x1","preconditions":{"inventory_space":true,"nearby.category.log":">= 1"},"effects":{"inventory.category.log":"+1"},"cost":3,"skill":"gather","params":{"itemName":"log","cou… | なし/対象外 | [AUTO-GATHER] |
| 1 | generate craft 1.20.1 | 100.2 | {"hand":[{"name":"auto_hand_craft_granite","preconditions":{"inventory.diorite":">= 1","inventory.quartz":">= 1"},"effects":{"inventory.diorite":"-1","inventory.quartz":"-1","inventory.granite":"+1"},"cost":10,"skill"… | なし/対象外 | [AUTO-CRAFT] |
| 2 | generate equipment 1.20.1 | 88.8 | [{"name":"auto_equip_mainhand_stone","preconditions":{"inventory.stone":">= 1"},"effects":{"equipment.stone":true},"cost":1,"skill":"equip_mainhand","params":{"item":"stone"}},{"name":"auto_equip_mainhand_granite","pr… | なし/対象外 | [AUTO-EQUIP] |
| 3 | stateManager.refresh / empty | 1919.5 | worldState全文（snapshotと元JSON参照） | なし/対象外 |  |
| 4 | goap.plan empty inventory.oak_planks:4 | 584.3 | {"plan":[{"action":"auto_gather_oak_log_barehand_x1","skill":"gather","params":{"itemName":"oak_log","count":1},"cost":5},{"action":"auto_hand_craft_oak_planks","skill":"hand_craft","params":{"recipe":"oak_planks","co… | なし/対象外 |  |
| 5 | goap.plan empty inventory.stick:4 | 37.3 | {"plan":[{"action":"auto_gather_log_category_barehand_x1","skill":"gather","params":{"itemName":"log","count":1},"cost":3},{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":… | なし/対象外 |  |
| 6 | goap.plan empty inventory.crafting_table:1 | 11.8 | {"plan":[{"action":"auto_gather_crafting_table_x1","skill":"gather","params":{"itemName":"crafting_table","count":1},"cost":5}],"diagnosis":null} | なし/対象外 |  |
| 7 | goap.plan empty inventory.wooden_pickaxe:1 | 103.0 | {"plan":[{"action":"auto_gather_log_category_barehand_x3","skill":"gather","params":{"itemName":"log","count":3},"cost":5},{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":… | なし/対象外 |  |
| 8 | goap.plan empty inventory.wooden_sword:1 | 40.5 | {"plan":[{"action":"auto_gather_log_category_barehand_x1","skill":"gather","params":{"itemName":"log","count":1},"cost":3},{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":… | なし/対象外 |  |
| 9 | goap.plan empty inventory.stone_pickaxe:1 | 112.2 | {"plan":[{"action":"auto_gather_log_category_barehand_x1","skill":"gather","params":{"itemName":"log","count":1},"cost":3},{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":… | なし/対象外 |  |
| 10 | goap.plan empty inventory.furnace:1 | 128.4 | {"plan":[{"action":"move_to_workbench","skill":"move_to","params":{"blockType":"crafting_table","maxDistance":100,"range":3},"cost":5},{"action":"auto_gather_log_category_barehand_x3","skill":"gather","params":{"itemN… | なし/対象外 |  |
| 11 | goap.plan empty inventory.torch:4 | 104.0 | {"plan":[{"action":"auto_gather_log_category_barehand_x1","skill":"gather","params":{"itemName":"log","count":1},"cost":3},{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":… | なし/対象外 |  |
| 12 | goap.plan empty inventory.iron_ingot:3 | 1912.7 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_ingot","current":"なし","target":"3個","deficit":3}],"suggestions":[{"target":"inventory.iron_ingot","action":"auto_hand_craft_iron_ingot","cost":10… | なし/対象外 |  |
| 13 | goap.plan empty inventory.iron_pickaxe:1 | 1579.1 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.iron_pickaxe","action":"auto_workbench_craft_iron_pickaxe… | なし/対象外 |  |
| 14 | goap.plan empty inventory.diamond_pickaxe:1 | 177.9 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.diamond_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.diamond_pickaxe","action":"auto_workbench_craft_diamon… | なし/対象外 |  |
| 15 | goap.plan empty inventory.chest:1 | 23.6 | {"plan":[{"action":"move_to_workbench","skill":"move_to","params":{"blockType":"crafting_table","maxDistance":100,"range":3},"cost":5},{"action":"auto_gather_log_category_barehand_x3","skill":"gather","params":{"itemN… | なし/対象外 |  |
| 16 | goap.plan empty inventory.bread:1 | 222.4 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.bread","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.bread","action":"auto_workbench_craft_bread","cost":10,"allSatis… | なし/対象外 |  |
| 17 | goap.plan empty inventory.cake:1 | 218.3 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.cake","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.cake","action":"auto_gather_cake_x1","cost":5,"allSatisfied":fals… | なし/対象外 |  |
| 18 | stateManager.refresh / stocked | 1645.9 | worldState全文（snapshotと元JSON参照） | なし/対象外 |  |
| 19 | goap.plan stocked inventory.oak_planks:4 | 1.4 | {"plan":[{"action":"auto_hand_craft_oak_planks","skill":"hand_craft","params":{"recipe":"oak_planks","count":1},"cost":10}],"diagnosis":null} | なし/対象外 |  |
| 20 | goap.plan stocked inventory.stick:4 | 1.2 | {"plan":[{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":"log_to_planks","count":1},"cost":10},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"s… | なし/対象外 |  |
| 21 | goap.plan stocked inventory.crafting_table:1 | 1.3 | {"plan":[{"action":"auto_gather_crafting_table_x1","skill":"gather","params":{"itemName":"crafting_table","count":1},"cost":5}],"diagnosis":null} | なし/対象外 |  |
| 22 | goap.plan stocked inventory.wooden_pickaxe:1 | 8.3 | {"plan":[{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":"log_to_planks","count":1},"cost":10},{"action":"move_to_workbench","skill":"move_to","params":{"blockType":"craft… | なし/対象外 |  |
| 23 | goap.plan stocked inventory.wooden_sword:1 | 4.6 | {"plan":[{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":"log_to_planks","count":1},"cost":10},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"s… | なし/対象外 |  |
| 24 | goap.plan stocked inventory.stone_pickaxe:1 | 33.0 | {"plan":[{"action":"auto_gather_basic_stone_category_pickaxe_x3","skill":"gather","params":{"itemName":"basic_stone","count":3},"cost":1},{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","par… | なし/対象外 |  |
| 25 | goap.plan stocked inventory.furnace:1 | 8.5 | {"plan":[{"action":"auto_gather_basic_stone_category_pickaxe_x8","skill":"gather","params":{"itemName":"basic_stone","count":8},"cost":2},{"action":"move_to_workbench","skill":"move_to","params":{"blockType":"crafting… | なし/対象外 |  |
| 26 | goap.plan stocked inventory.torch:4 | 4.4 | {"plan":[{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":"log_to_planks","count":1},"cost":10},{"action":"auto_hand_craft_stick","skill":"hand_craft","params":{"recipe":"s… | なし/対象外 |  |
| 27 | goap.plan stocked inventory.iron_ingot:3 | 616.3 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_ingot","current":"なし","target":"3個","deficit":3}],"suggestions":[{"target":"inventory.iron_ingot","action":"auto_hand_craft_iron_ingot","cost":10… | なし/対象外 |  |
| 28 | goap.plan stocked inventory.iron_pickaxe:1 | 696.3 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.iron_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.iron_pickaxe","action":"auto_workbench_craft_iron_pickaxe… | なし/対象外 |  |
| 29 | goap.plan stocked inventory.diamond_pickaxe:1 | 186.4 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.diamond_pickaxe","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.diamond_pickaxe","action":"auto_workbench_craft_diamon… | なし/対象外 |  |
| 30 | goap.plan stocked inventory.chest:1 | 4.5 | {"plan":[{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","params":{"recipe":"log_to_planks","count":1},"cost":10},{"action":"auto_hand_craft_planks_from_logs_category","skill":"hand_craft","… | なし/対象外 |  |
| 31 | goap.plan stocked inventory.bread:1 | 94.8 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.bread","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.bread","action":"auto_workbench_craft_bread","cost":10,"allSatis… | なし/対象外 |  |
| 32 | goap.plan stocked inventory.cake:1 | 83.6 | {"plan":null,"diagnosis":{"missingRequirements":[{"key":"inventory.cake","current":"なし","target":"1個","deficit":1}],"suggestions":[{"target":"inventory.cake","action":"auto_gather_cake_x1","cost":5,"allSatisfied":fals… | なし/対象外 |  |
| 33 | !goal inventory.wooden_pickaxe:1 | 37608.9 | {"success":true,"goal":"inventory.wooden_pickaxe:1","message":"目標「inventory.wooden_pickaxe:1」を完了しました"} | 位置変化、持ち物変化、視線変化 | [STATE] [GOAP] [GOAP Iter 1] [GOAP Iter 2] [GOAP Iter 3] [GOAP Iter 4] |
| 34 | !goal inventory.stone_pickaxe:1 | 67474.3 | {"success":true,"goal":"inventory.stone_pickaxe:1","message":"目標「inventory.stone_pickaxe:1」を完了しました"} | 位置変化、持ち物変化、視線変化 | [STATE] [GOAP] [GOAP Iter 1] [GOAP Iter 2] [GOAP Iter 3] [GOAP Iter 4] |
| 35 | !goal inventory.furnace:1 | 90507.0 | {"success":false,"goal":"inventory.furnace:1","aborted":true,"error":"Cancelled","missingPreconditions":[]} | 位置変化、持ち物変化、視線変化 | [STATE] [GOAP] [GOAP Iter 1] [GOAP Iter 2] [GOAP Iter 3] [GOAP Iter 4] |

### 再現区画のフラット実行一覧

| 入力 | ms | 返り値 |
|---|---:|---|
| !info all | 301 | {"success":true,"type":"all","data":{"inventory":{"items":[{"name":"cobblestone","count":4,"category":"material"},{"name":"oak_log","count":2,"category":"material"},{"name":"oak_planks","count":40,"category":"material… |
| !status | 253 | {"$undefined":true} |
| !info recipesFor {"item":"wooden_pickaxe"} | 0 | {"success":true,"type":"recipesFor","data":{"item":"wooden_pickaxe","count":1,"recipes":[{"station":"crafting_table","shaped":true,"outputs":[{"name":"wooden_pickaxe","count":1}],"inputs":[{"name":"oak_planks","count"… |
| !info recipesUsing {"ingredients":["stick"]} | 7 | {"success":true,"type":"recipesUsing","data":{"ingredients":["stick"],"mode":"and","results":[{"item":"torch","station":"hand","shaped":true,"outputs":[{"name":"torch","count":4}],"inputs":[{"name":"coal","count":1},{… |
| !info scanBlocks {"range":5,"yaw":90,"coneAngle":30,"maxChecks":-1} | 0 | {"success":true,"type":"scanBlocks","data":{"blocks":[{"name":"grass_block","position":{"x":300,"y":-61,"z":300},"relativePosition":{"x":0,"y":-1,"z":0},"distance":1},{"name":"grass_block","position":{"x":299,"y":-61,… |
| !navigation register {"name":"home"} | 1 | {"success":true,"message":"場所「home」を登録しました","location":{"x":300,"y":-60,"z":300}} |
| !navigation register {"name":"point","coords":[306,-60,300]} | 0 | {"success":true,"message":"場所「point」を登録しました","location":{"x":306,"y":-60,"z":300}} |
| !navigation goto {"name":"point"} | 981 | {"success":true,"message":"「point」に到着しました","location":{"x":306,"y":-60,"z":300}} |
| !navigation gotoCoords {"coords":[300,-60,300]} | 52 | {"success":true,"message":"[300, -60, 300]に到着しました","location":{"x":300,"y":-60,"z":300}} |
| !navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"nearest"} | 62 | {"success":true,"message":"Yaw 90° 方向に 2 ブロック移動しました","targetPosition":{"x":298,"y":-60,"z":300},"actualPosition":{"x":300,"y":-60,"z":300}} |
| !navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"below"} | 16 | {"success":true,"message":"Yaw 90° 方向に 2 ブロック移動しました","targetPosition":{"x":298,"y":-60,"z":300},"actualPosition":{"x":300,"y":-60,"z":300}} |
| !navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"surface"} | 47 | {"success":true,"message":"Yaw 90° 方向に 2 ブロック移動しました","targetPosition":{"x":298,"y":-60,"z":300},"actualPosition":{"x":300,"y":-60,"z":300}} |
| !navigation follow {"username":"RegressionPeer"} | 1 | {"success":true,"message":"RegressionPeer の追跡を開始しました","target":"RegressionPeer"} |
| !navigation stopFollow {} | 0 | {"success":true,"message":"追跡していません"} |
| !look direction {"yaw":90,"pitch":10} | 0 | {"success":true,"yaw":90,"pitch":10} |
| !look player {"username":"RegressionPeer"} | 544 | {"success":true,"target":"RegressionPeer","distance":4} |
| !look watch {"username":"RegressionPeer","intervalMs":200} | 0 | {"success":true,"target":"RegressionPeer","intervalMs":200} |
| !stop | 0 | {"success":true,"stoppedActions":["look_watch"],"message":"停止しました: look_watch"} |
| !idle_on {"intervalMs":200} | 1 | {"success":true,"message":"idleモード開始（interval=200ms, playerRange=8, playerLookChance=0.6）"} |
| !stop | 0 | {"success":true,"stoppedActions":["idle"],"message":"停止しました: idle"} |
| !chat RegressionPeer hello | 0 | {"success":true,"targetUsername":"RegressionPeer","distance":4,"maxDistance":15,"message":"hello"} |
| !echo hello | 0 | {"success":true,"message":"hello"} |
| !history | 0 | {"success":true,"count":0,"latestSequence":0,"history":[]} |
| !history RegressionPeer | 0 | {"success":true,"usernames":["RegressionPeer"],"count":1,"latestSequence":1,"history":[{"sequence":1,"speaker":"RegressionPeer","role":"user","content":"explicit","type":"conversation","timestamp":"2026-10-08T19:11:00… |
| !navigation chestOpen {"coords":[302,-60,300]} | 603 | {"success":true,"message":"チェストを開きました","position":{"x":302,"y":-60,"z":300},"chest":{"itemCount":0,"items":[],"totalSlots":27,"usedSlots":0,"emptySlots":27},"inventory":{"itemCount":6,"items":[{"name":"oak_planks","co… |
| !navigation chestDeposit {"item":"oak_planks","count":3} | 2 | {"success":true,"message":"oak_planks x 3 をチェストに預けました","position":{"x":302,"y":-60,"z":300},"item":"oak_planks","count":3} |
| !navigation chestWithdraw {"item":"oak_planks","count":1} | 1 | {"success":true,"message":"oak_planks x 1 をチェストから取り出しました","position":{"x":302,"y":-60,"z":300},"item":"oak_planks","count":1} |
| !navigation chestClose {} | 0 | {"success":true,"message":"チェストを閉じました","position":{"x":302,"y":-60,"z":300}} |
| !navigation chestOpen {"coords":[302,-60,300]} | 1 | {"success":true,"message":"チェストを開きました","position":{"x":302,"y":-60,"z":300},"chest":{"itemCount":1,"items":[{"name":"oak_planks","count":2,"slot":0}],"totalSlots":27,"usedSlots":1,"emptySlots":26},"inventory":{"itemCo… |
| !stop | 0 | {"success":true,"stoppedActions":["chest"],"message":"停止しました: chest"} |
| !navigation dropItem {"itemName":"cobblestone"} | 1 | {"success":true,"message":"その場で cobblestone を 1個ドロップしました","itemName":"cobblestone","droppedCount":1,"availableCount":4} |
| !navigation pickupItems {"range":6,"itemName":"diamond"} | 757 | {"success":true,"message":"アイテムを拾いました","foundCount":1} |
| !creative placeBlock {"name":"oak_planks","coords":[300,-60,298]} | 1049 | {"success":true,"action":"placeBlock","data":{"success":true,"message":"oak_planks を [300, -60, 298] に設置しました","block":"oak_planks","position":{"x":300,"y":-60,"z":298}}} |
| !skill hand_craft {"recipe":"stick","count":1} | 525 | {"$undefined":true} |
| !skill workbench_craft {"recipe":"wooden_pickaxe"} | 1031 | {"$undefined":true} |
| !skill equip_mainhand {"item":"wooden_pickaxe"} | 493 | {"$undefined":true} |
| !skill equip_armor {"item":"iron_helmet","slot":"helmet"} | 493 | {"$undefined":true} |
| !skill place_block {"blockName":"oak_planks"} | 577 | {"$undefined":true} |
| !skill move_to {"blockType":"furnace"} | 571 | {"$undefined":true} |
| !skill furnace_smelt {"input":"raw_iron","fuel":"coal","output":"iron_ingot"} | 10863 | {"$undefined":true} |
| !skill gather {"itemName":"oak_log","maxDistance":5,"maxAttempts":2} | 6392 | {"$undefined":true} |
| !skill collect_drops {"radius":3,"maxAttempts":1} | 473 | {"$undefined":true} |
| !primitive find_block {"match":"crafting_table","maxDistance":12} | 473 | {"$undefined":true} |
| !primitive find_blocks {"match":["chest","furnace"],"count":2,"maxDistance":12} | 470 | {"$undefined":true} |
| !primitive equip_item {"itemName":"wooden_pickaxe"} | 473 | {"$undefined":true} |
| !primitive craft_item {"itemName":"stick"} | 480 | {"$undefined":true} |
| !primitive move_to {"x":300,"y":-60,"z":300,"range":2,"timeout":2000} | 503 | {"$undefined":true} |
| !primitive collect_drops {"radius":3} | 470 | {"$undefined":true} |
| !primitive dig_block {"x":300,"y":-60,"z":298} | 4136 | {"$undefined":true} |
| !primitive equip_item {"itemName":"oak_planks"} | 467 | {"$undefined":true} |
| !primitive place_block {"reference":{"x":299,"y":-61,"z":298}} | 599 | {"$undefined":true} |
| findBestTool / equipBestToolForBlock chest | - | {"name":"wooden_pickaxe"} |
| !goal inventory.stick:4 | 929 | {"success":true,"goal":"inventory.stick:4","message":"目標「inventory.stick:4」を完了しました"} |
| !goal inventory.cake:1 | 508 | {"success":false,"goal":"inventory.cake:1","error":"目標「nearby.cake:1」を実行できません","missingPreconditions":["inventory.cake:1","nearby.cake:1"]} |
| !stop | 1 | {"success":true,"stoppedActions":["GOAP task"],"message":"停止しました: GOAP task"} |
| !goal inventory.wooden_pickaxe:1 | 522 | {"success":false,"goal":"inventory.wooden_pickaxe:1","aborted":true,"error":"Cancelled","missingPreconditions":[]} |
