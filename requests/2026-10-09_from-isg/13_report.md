# ⑬ Minecraft 1.21.4 調査結果・⑭実装計画

調査日：2026-10-10（日本時間）。基準：`master aa7f47018ccb4c451ac22ecb31a52dda0d0f3b74`。作業ブランチ：`isg/13-version-survey-2026-10-10`。

## 結論

1.21.4 の問題は pale oak のカテゴリ漏れだけではない。**先頭レシピの順序に依存する生成規則**によって、木の材料、石の材料、松明の燃料が変わる。pale oak を追加するだけでは、丸石から石の道具・かまどを作る経路と石炭から松明を作る経路が直らない。

同じ9状態×30目標を各版で2回計画した。1.20.1 は142成功、1.21.4 は58成功。**成功から失敗への変化84組、失敗から成功への変化0組**。成功を維持した58組中、54組は plan 全体が同一、4組は別の環境資源を使う計画に変化した。

推奨：1.20.1 の既存カテゴリ・生成規則をそのまま残し、版を明示して選ぶ共通カテゴリ解決層と、1.21.4 用の全レシピバリエーション生成を追加する。カテゴリの拡張だけで解決する扱いにはしない。1.20.1 は⑫後の270組を不変の基準とする。

本体コード・追跡済み設定・テスト・lockfileを変更していない。コミット対象はこの報告だけ。一時スクリプトと結果は無視対象の `.cache/minecraft-bot/13-study/` に置いた。GPU、viewer/browser、LLM、JEV、H2O-Lightning、subs-llmapiは起動していない。ライブ試験は不要と判断し、サーバーのコピー・起動・接続は一切行っていない。指定された3つの別worktreeにも操作していない。

## 1. 調査方法と検証の範囲

- README、13_version_survey.md、公開API.mdと関連コード・設定・テストを読んだ。READMEの古い「npm testはテストなし」という記述に対し、現在の package.json は実際にテストを実行する。
- `tests/study04/benchmark.cjs` の `states()` と `goals`、`tests/study04/harness.cjs` の `makePlanner({production:true})` を再利用。VM内で探索回数を数える既存ハーネスを使い、本体ファイルを編集しない。探索・数量加算・⑫の距離/障害コスト・最大200回は現在の本体どおり。
- 版ごとに別Nodeプロセスで `prepareDomain(version)`。計画には `{version,worker:false}` を明示し、各組を2回計画。全成功planの前提・効果を `replay` で検証し、反復のplan/理由/探索回数一致、入力worldState不変をassertした。
- ⑤Bと同じ9状態×30目標、270組。各版540回、計1080回。状態は後掲。1.20.1の540行を `tests/study12/after.json` の同じstate/goal/repeatと照合し、**plan（順序・params・costを含む）、総cost、iterations、reasonが540/540一致**。
- ⑤の古い成功数130を現在の基準と混同しない。⑫が計画・コストを変更した後の `aa7f470` / `study12/after.json` は142成功。⑭で守るのはこの現在の270組である。`study05/matrix.cjs B` は古い④のplan/コストを参照するので、⑫後の完全不変チェックにそのまま使うことはできない。
- `npm test`：292件 pass、fail/skipped/todo=0、113.092秒。GPU/live用scriptは実行していない。
- 追加で10種類の人工的な数量状態×10代表目標を両版で計画（200回）。松明の石炭/木炭の差、丸石を持っていても石の道具が作れないこと、ダイヤ・鉄そのものは道具/材料があれば計画できることを分離した。
- この比較は**計画モデルの実験**であり、1.21.4のライブ採掘・クラフト・精錬が成功する保証ではない。実地の到達性、通信、Fabric/SpectatorPlusの作用は⑭で検証する。

## 2. バージョン依存の一覧

パスはこのリポジトリからの相対位置。

| 対象 | 現状・依存 | ⑭の扱い |
|---|---|---|
| `planner_bot/config/block_categories.yaml` | 版を取らない静的一覧。blockのlog16種/plank11種、itemのlog16種/plank11種。pale_oak_log、stripped_pale_oak_log、pale_oak_planksが両側にない。道具の可否はboolean、採掘能力の階層は手動 | 1.20.1の一覧と順序を固定。1.21.4だけ規則から追加 |
| `src/planner/state_builder.js` | schema/categoriesをプロセス内singletonでcache。inventoryは全item名を保持するがカテゴリ合計は静的一覧だけ。nearby.categoryは入力観測の集計値をコピー | カテゴリcacheを版別にし、観測とplannerに同じ解決済み定義を渡す |
| `src/planner/state_manager.js` | 完全観測の環境flag/nearby集計も `loadBlockCategories()` を使う。findBlock対象はschemaから | bot.versionを解決層へ渡す。外部worldStateを使う経路も同じ版 |
| `src/planner/fast_observation.js` | 軽い観測のカテゴリcount/最寄り位置も同じ静的一覧 | 完全観測とカテゴリを一致させる |
| `src/planner/gather_cost.js`, `goal_evaluator.js` | カテゴリの距離/障害要約、評価の資源見積もりに同じ一覧。評価cacheキーにはbot.versionがある | カテゴリ拡張をコストにも反映。①観測、②生成、③計画、④実行のどれかだけ更新しない |
| `src/skills/gather.js` | カテゴリ名から探索するblock名を静的一覧で解決。個別名の検査・ドロップ確認はminecraft-data(bot.version) | 1.21.4のカテゴリを実際の採集候補にも反映 |
| `src/planner/gather_generator.js` | mcDataのblocks/drops[0]/harvestTools/hardnessで生成。カテゴリ代表の先頭有効blockで道具要件/ドロップを決める。カテゴリはx1/x3/x8、カテゴリ外は個別x1。カテゴリ外のpale oakは個別採集できるがcategory.log/plank効果は付かない | 新材がカテゴリに入る時、代表・順序・数量・効果が変わる。1.20.1の順序を維持 |
| `src/planner/craft_generator.js` | 全recipesを走査するが `seen[hand/workbench]` が**成果物名**で重複排除し最初の1件だけ残す。許可された材料カテゴリはplankのみ。レシピ間で複数樹種があっても、実際の先頭材料がカテゴリ外なら個別名になる | 1.21.4で全バリエーションを保持。カテゴリ化の可否は同じ成果物というだけで決めない |
| 同generatorの静的allowlist読込 | `loadAllowedRecipesFromStatic()` は呼ばれるが、返したallowedHand/allowedWorkbenchを実際の生成ループでは使わない。isHandAllowedも未使用 | 「静的YAML掲載品だけ生成される」と想定しない。既存の全成果物生成を狭めない |
| `src/planner/equipment_generator.js` | 版の全itemsByNameから装備actionを生成。blacklist固定、stackSizeを使う | 新itemも自動対応。版別goldenで照合 |
| `config/actions/gather_actions.yaml`, `hand_craft_actions.yaml`, `workbench_craft_actions.yaml` | 版なし。通常は生成済みの各skillがあれば丸ごとskipされる。craft allowlist読込にも使われる | 通常の1.21.4修正でこれらだけ編集しても生成actionには効かない。1.20.1用fallbackを維持 |
| `config/actions/movement_actions.yaml` | 全版で読む。crafting_table/furnaceへの移動・設置4action | 名前は両版に存在、現時点で変更不要 |
| `config/actions/furnace_actions.yaml` | 全版で読む。精錬10action、log/plankカテゴリと具体的raw_iron/coal/charcoal等を使用。自動smelt生成はない | 精錬のモデルと実行時の材料選択を揃える。既存肉の名前問題は下記の既存制限 |
| `config/actions/equipment_actions.yaml` | 生成equipmentに加えて全版で読む。armor12action | 名称・slotを両版で確認する |
| `config/actions_generated/` | 版なし、追跡済みYAMLとbackupがある。現在のdomain生成/読込では**使わない**。古いlive helperに保存/復元コードが残る | 手編集・上書き禁止。実際に読むのは `.cache` の生成物 |
| `config/state_schema.yaml` | inventory/equipmentは動的。環境はcrafting_table/furnaceの近傍/可視、is_day。現在は原木等の名前一覧なし | 共通schemaは変更不要。版の選択をカテゴリ側に渡す |
| `config/dependency.yaml` | oak_log/oak_planks/wooden_pickaxeの古い具体依存があるが、現行本体でこのファイルの読込は見つからない | 計画失敗の原因ではない。`relevance.js`の依存はstate_schema由来 |
| `src/skills/hand_craft.js` | log_to_planksは `(_log|_stem)$` とstripped接頭辞から板名を解決。pale oak名も規則に合うがwood/hyphaeは合わない | 名前規則を無制限に広げない。カテゴリlogの意味と動的実行を合わせる |
| `src/skills/workbench_craft.js`, `src/primitives.js` craftItem | 成果物名で `bot.recipesFor` し、その返り値の先頭をbot.craftに渡す。plannerで選んだ具体材料/variantはparamsにない | variantと実行レシピの整合性・混合樹種の扱いを検証。必要な場合1.21.4経路だけsignatureで選ぶ |
| `src/skills/furnace_smelt.js` | mcData(bot.version)を読むがカテゴリlog/planksの解決は**別の6樹種固定配列**（oak/birch/spruce/jungle/acacia/dark_oak）。cherry/mangrove/stripped/planksのbamboo/crimson/warpedも対象外 | 1.21.4経路で共通itemカテゴリを参照。pale oakだけ足す特例にしない。1.20.1挙動は維持 |
| `src/primitives.js`, `src/utils/recipe_utils.js` | 掘削道具・item/block ID・recipesなどはbot.versionからmcDataを読む。手持ち/armor slot5–8、45は固定 | registry/IDを版から引く現行方針を維持 |
| `src/utils/server_block_updates.js`, `dig_execution.js` | block_change/multi_block_changeを直接読む。air state IDはregistry、座標形式はsupportFeatureで分岐。mineflayer内部 `_updateBlockState` にも依存 | 1.21.4の採掘成功確認・block更新・timeout中断をライブで試す |
| `src/navigation/actions.js` pickupItems、`src/primitives.js` collectDrops | 前者はentity.metadata[8]、後者はmetadata最後のslotとitemIdで直接解釈。fast観測はgetDroppedItemも使う | item component/metadataの版差があるためライブ確認対象。調査時点で壊れたと断定しない |
| `src/navigation/placement_search.js`, `placement_ground.js` | grassとshort_grassを**既に両方**置換可能に含める | grass改名だけを理由にこのコードを直す必要はない |
| `src/planner/terrain_observation.js` | bot.registryのstate ID/boundingBox/material、game.minY/height。樹木のsuffix除外はpale oakにも合う。新植生の地面判定は実dataに依存 | pale_hanging_moss/eyeblossomなどの人工chunkで検証。GOAPの資源カテゴリと地表分類を混ぜない |
| `src/utils/light_info.js`, `src/navigation/torch_placement.js` | sky/block lightと通常torch/wall_torch、形状/registryに依存 | 1.21.4の光配信・設置確認をCPUだけで試す |
| `src/vision/capture.js`, `persistent.js` | viewerにbot.versionを渡す。GPU/browserを使うのは明示起動時 | 今回実行禁止。⑭でも許可がなければGPU試験を実行しない |
| `planner_bot/index.js`, `src/bot/startup.js`, `ai_bot.js` | CLIはMC_VERSIONまたはfalseで自動検出、factoryはconfig.versionをmineflayerへ渡す。spawn後に実bot.versionを利用 | 正式な起動経路は既に版指定可。APIとCLIで指定/検出版を揃える |
| `ecosystem.config.js` | MC_VERSIONは空文字。auto検出の起動設定 | 切替時は環境変数を明示、1.20.1の既定を勝手に変更しない |
| ルート `test.js` | 試験用に数値 `version: 1.21` を指定。npm test・公開入口の経路には含まれない | 正式版指定の参考にしない。文字列 '1.21.4' を使う |
| `doc/mineflayer/screenshot.js` | ドキュメントの補助コードもviewer.setVersion(bot.version) | 今回の実行対象外 |

### 2.1 既定値とcacheの実際

`'1.20.1'` fallbackは `domain.js:103`、`planning_service.js:62`、`goal_runner.js:65,599`、gather/craft/equipment各generatorのpromiseキー・出力先・mcData選択にある。正式なAPIはspawn後bot.versionを渡すので、1.21.4を指定して接続した場合に必ず1.20.1へ固定されるわけではない。**版の渡し忘れがある低レベル呼出し**にはfallbackが効く。

現在のcacheは `.cache/minecraft-bot/actions/<version>/`。各版に `equipment_auto.yaml`、`gather_auto.yaml`、`hand_craft_auto.yaml`、`workbench_craft_auto.yaml`。prepare時に `prepare-*` stagingを作り、全生成物をparse検査し、stagingからdomainを読み、各ファイルをrenameして公開する。毎プロセスで再生成し、既存cacheを信頼してskipする仕組みではない。追跡YAMLには書かない。

ファイルの出力先は既に版別で混ざらない。同一プロセスではselectedVersionと共有workerを1版に固定し、別版への変更は `VERSION_CONFLICT`。**同一プロセス内で1.20.1/1.21.4のbotを混在運用する契約はない**。切替はプロセス再起動で行う。この契約は維持する。

ただしカテゴリ/schemaのsingletonには版キーがない。今のファイルが共通なため、出力先が版別でも意味は1.20.1のまま。これが修正対象。generatorを直接呼んで共通outputDirを渡せば、そのcaller自身が別版を上書きできるため、⑭の試験も版別outputDirを徹底する。

公開中の複数ファイルのrenameは全4個一括のtransactionではない。生成完了後のin-memory domainは一式で採用されるが、同じ版を別プロセスで同時準備し、別ルールを使う運用には注意する。準備失敗後のstaging/selectedVersionも残り得る。今回の検証で別版cacheが混ざった事実はなく、schema/generator revisionと依存版のmanifestを付けるのは⑭の改善案。

### 2.2 インストール済み依存

調査は依存の更新なし。package.jsonの範囲指定より**現在のlockfile/実インストール**を基準にする。

| 依存 | 実インストール | 確認 |
|---|---|---|
| mineflayer | 4.33.0 | `lib/version.js` testedVersionsに1.20.1/1.21.4がある。今回接続してはいない |
| minecraft-data | 3.98.0 | 1.20.1 protocol763/dataVersion3465、1.21.4 protocol769/dataVersion4189。実レジストリ・recipesで生成/計画した |
| minecraft-protocol | 1.62.0 | mcDataに1.21.4 protocolあり。通信実測は依頼元の既存結果のみ |
| mineflayer-pathfinder | 2.4.5 fork | lock SHA `1b1c11469b7b2a1afa47ea5d961c4e5e22b48629`。Movementsはbot.registryで名前→IDを解決。今回移動は未試験 |
| prismarine-viewer | 1.33.0 fork | lock SHA `0603f5580aa8b539f6d53fa26dc0764aef31e08d`。対応一覧に1.21.4、textures/1.21.4.pngとblocks_states.jsonが実在。GPU試験はしていない |
| prismarine-chunk / prismarine-physics | 1.39.0 / 1.10.0 | 版に依存するchunk/移動の下層。1.21.4人工chunkとライブを⑭で追加 |

公式説明でもMineflayerは版指定を省略したサーバー版検出と、Minecraftの複数版を扱う構成を説明している。ただし現行upstreamの対応範囲を、このcheckoutのfork/lockfileの実証と同一視しない。[Mineflayer公式](https://github.com/PrismarineJS/mineflayer)、[minecraft-data公式](https://github.com/PrismarineJS/minecraft-data)。forkのWebページ取得は失敗したため、forkの上記確認はローカルにあるコードとlockfileによる。

## 3. 失敗原因を分離した結果

### A. pale oakカテゴリ漏れ

1.21.4先頭レシピ：stickは `inventory.pale_oak_planks >= 2`、crafting_tableは `>=4`、wooden_pickaxeは `>=3` とstick2。wooden_sword、chestなども同じ影響。1.20.1のこれらはplankカテゴリ前提だった。

`findCategoryVariantResults()` は複数の既知plankを見つけるが、実際に採る先頭レシピのpale oakがカテゴリにないため、`useItemCategories=false` になる。**全レシピの木材の代用可能性を見ているつもりでも、先頭を保存する段階で漏れる**。

inventoryにpale_oak_log8、pale_oak_planks32を与えてbuildStateすると、個別在庫は保持するがcategory.log=0、category.plank=0。自然のpale oak原木が周りにあってもnearby.category.logへ数えず、generic log_to_planksの経路に入らない。個別原木→個別板は生成されるので、pale oakを**個別指定した計画**は別経路で可能。

作業台の目標は9/9成功を維持するが、これは全状態にある環境の作業台を壊して取れるため。カテゴリを使う作成が健全という意味ではない。環境資源として採ることは正しい現行動作であり、禁止しない。

### B. 石の素材レシピの順序

stone_pickaxeとfurnaceには両版とも3レシピがある。1.20.1の順序は cobblestone → blackstone → cobbled_deepslate、1.21.4は cobbled_deepslate → blackstone → cobblestone。

1.21.4で生成されたstone_pickaxeの前提はcobbled_deepslate3、furnaceは8。**plankカテゴリを直しただけでは丸石の経路が戻らない**。basic_stoneは「stone/cobblestoneを集める」カテゴリであり、cobbled_deepslate等を足すと現在のカテゴリ採集が代表ドロップのcobblestoneを生成したことにする危険がある。採集カテゴリとクラフト代用材料を同じ名前で拡張しない。

地下状態のかまどは失敗ではなく、深いdeepslateを8回個別採集する高コスト計画に変化した。⑫のコストが強く効く例であり、距離評価が壊れたという判定にはしない。

### C. 松明の燃料レシピの順序

両版ともcoal/charcoalの2レシピがある。1.20.1生成actionはcoal、1.21.4はcharcoalを要求する。coal8+stick16だけの状態は1.20.1で1手成功、1.21.4ではrelaxed_unreachable。charcoal8+stick16だけなら逆に1.21.4で1手成功、1.20.1ではrelaxed_unreachable。後者は既存1.20.1モデルの制限であり、⑭で1.20.1まで直さない。

1.21.4の松明は、棒のpale oak前提と木炭を作るかまどの深層丸石前提を両方受ける。9状態すべて失敗した。

### D. 鉄・ダイヤは名前変更ではなく材料経路への波及

iron_ingot/raw_iron/diamond/pickaxeの名前と採掘階層は両版にある。棒・木の道具が作れないため採石・鉄道具・ダイヤ取得へ到達できない。鉄を材料から精錬する計画は石ツルハシ・燃料・近傍かまどを準備すると両版とも成功し、iron_ingot3+stick16+作業台ならiron_pickaxeは両版1手。iron_pickaxeを初期所持しdiamond_oreを観測した状態でdiamond:1は両版1手。ダイヤ自身の1.21.4障害は今回再現していない。

`iteration_limit` と `frontier_exhausted` は不能の証明ではない。`relaxed_unreachable` は**現在の観測と生成された行動モデル内**の存在閉包での不能。Minecraftで本当に作れないとは報告しない。

### E. 改名・新規要素と既存制限

- registry差分：blocks 1003→1095（削除1/追加93）、items 1255→1385（削除2/追加132）。削除blockはgrass、削除itemはgrass/scute。対応する新名はshort_grass/turtle_scute。追加にはpale oak一式、tuff加工材、copper door/trapdoor/grate/bulb等、crafter/trial_spawner/vault、resin、pale moss/eyeblossom、mace等がある。
- 30目標で使う名称は両版にある。草とscuteは30目標に含まれない。既存snapshotの自然系6状態はnearbyやblocks.listにgrassを含むため、実1.21.4のsnapshotと同じではない。草改名の影響を別途照合した結果を後掲する。
- 設置の草判定は既にshort_grassに対応。地形観測はboundingBox/materialで判定する。旧inventory.grass/scuteの利用者向け文字列を自動変換する公開APIはない。旧名のgoalは構文として受理され得るが、版の存在チェックをして自動aliasする設計ではない。⑭で無断の旧名互換を足さず、API文書に版の名前を明記する。
- 同名クラフトactionの前提が変わったものは**78件**。木/石/松明以外にもwool/carpet、sandstone/quartz/purpurの加工、bed、turtle_helmet(scute→turtle_scute)、brewing_standなどがある。これはrecipes内容/順序への依存の棚卸しであり、その78成果物全部のライブ失敗を検証したわけではない。
- blockカテゴリのraw_meat/cooked_meatには実blockではない名前がある。raw_beef/raw_porkchop/raw_chicken/raw_muttonはitemでも無効（実名beef/porkchop/chicken/mutton）。furnace_actionsにも旧raw名がある。両版共通の既存モデル制限なので、⑭の1.21.4対応に便乗して1.20.1を修正しない。
- 新しいrecipeを全件出すと、木材の混合・結果の樹種・blockのprimary drop・カテゴリと個別在庫の二重表現など、現行モデルの簡略化が表面化する。実行できることを検証した範囲を明記する。

## 4. ⑭の実装計画

⑭では次の順序で、小さい単位の変更/コミットと検証を行う。GOAPの探索アルゴリズム・上限・再計画・採集コスト・環境ブロックを材料にする方針は変更しない。

### 1. 1.20.1の基準固定

`aa7f470` のgenerator golden（4ファイルのaction配列全体）と今回照合した `study12/after.json` 270組を保存/照合する専用の回帰試験を追加。既存goldenを更新して回帰を隠さない。比較対象はplanの順序、action、skill、params、各cost、総cost、診断、不能理由/証明、iterations、入力不変。時刻/所要時間は一致条件にしない。初回準備とworker/main両経路も見る。

### 2. 版を明示する共通カテゴリ解決層

既存 `block_categories.yaml` は**1.20.1のlegacy定義として一切変更しない**。同じ配置思想を守り `src/planner/` 内に小さなresolverを追加する案。`getCategories(version)` を全呼出しへ渡し、版別にcacheする。1.20.1は同じ一覧/順序/オブジェクト契約、1.21.4はlegacyのcopyへregistryで存在を確かめた拡張を行う。未指定版は選択済みdomain/botから解決し、接続APIでは版なしを安易にfallbackしない。

規則案：既存logの意味を維持し、registryから通常/strippedの `*_log`、plankは `*_planks` をblock/item別に列挙・相互照合する。既存要素の順序を保ち、追加を安定順でappend。`*_wood`/`*_hyphae`/ネザーstemをlogへ自動追加する変更は別の意味拡張なのでこの段階ではしない。boolean工具階層・basic_stoneはlegacyのまま。命名suffixだけでsmelt可能性・樹種付き成果物の代用を証明した扱いにしない。

Minecraft-data 3.98.0の返却objectにはtagフィールドが見つからなかった。tagを使うなら別の取得/生成と版管理が必要。今回のデモ対応に新しい外部tag依存を増やすより、現registryの名前規則とレシピ照合を選ぶ。将来tag化できる境界にはしておく。

変更先：state_builder、state_manager、fast_observation、gather_generator、craft_generator、gather skill、gather_cost、goal_evaluator。workerのprepare/evaluate/reachableFactsとexecutorのbuildStateにも同じ版/定義を使う。worldStateに版情報を追加するなら既存形に破壊的な必須項目を作らず、API/workerで選択版を明示する。

### 3. 全レシピを保持する生成規則（1.21.4だけ）

**推奨の初期実装は、parse可能な全レシピを具体的材料付きで保持し、同じ前提/消費/成果物/出力数/クラフト種別のものだけ重複排除する方式。** 成果物名だけのseenを廃止するのは1.21.4経路に限定する。これならcoal/charcoal、cobblestone/blackstone/cobbled_deepslate、樹種を一般規則で処理できる。

既存action名を最初の代表に残し、追加variantは材料signature由来の安定した**英小文字とunderscoreだけの名前**にする案。現在のgoal parserのaction名規則は `[a-z_]+` で、数字入りsuffixやハイフンを使うとaction目標として呼べない。この既存制限も考慮する。順序は安定に決め、recipe配列順の変更で代表/探索結果が揺れないようにする。樹種固有のboat/fence/door等の成果物へ、任意plankカテゴリを無条件で当てない。

板カテゴリへの正の効果や消費、個別在庫の効果も1.21.4で整合させる。カテゴリ採集・generic log_to_planksが具体在庫を決めないことと、個別レシピへの到達の関係をテストする。最初は具体素材の採集→具体板→具体レシピを失わないことを優先する。

レシピを全部残すとaction数と探索分岐が増える。1.21.4専用に、**材料を替えても同じ出力/個数・同じ材料位置/個数で実行できることを検証したレシピ群だけ**plankカテゴリへ集約する最適化は可能。ただしこれは後段とし、合算だけで混合樹種が実行可能だと扱わない。blockの採集カテゴリbasic_stoneを石クラフトの代用カテゴリへ兼用する案は採らない。

1.20.1経路では先頭1件、既存順序、既存カテゴリ効果・action名をそのまま使う。低コスト化のための探索変更や1.20.1のcoal/charcoal修正をしない。

### 4. 実行との整合性

1.21.4のfurnace_smeltのlog/planks解決を共通itemカテゴリと、該当input/fuel用途で有効な材料の確認へ変更する。1.20.1の6樹種配列をそのまま残す。pale oak/stripped/cherry等の具体材料とsmelting recipe、燃料投入で期待する成果物が出るかを検証する。

craftItemはbot.recipesForが手元の材料で実行できるrecipeを返すことを使えるが、plannerが選んだ材料/消費と別のrecipeになる可能性をテストする。必要なら追加variantのparamsにrecipe signatureを渡し、1.21.4だけ実行時候補と照合する。材料混合・出力数・hand/workbench判定・数量再計画・道具準備に対する回帰を用意する。

直接protocol/metadataを読む箇所は、実1.21.4で掘削確認、ドロップfilter、チェスト転送、精錬slotを観察してから必要な修正を判断する。調査で未確認な通信不具合を先回りして仕様変更しない。

### 5. 生成物/キャッシュの版分離

現在の `<version>/prepare-*` stagingと4ファイル構成、完全domain採用を維持。カテゴリ/生成規則revision、minecraft-data版、Minecraft版、生成物hashをmanifestへ持たせる案。再利用を導入するならこれらが一致したときだけ使用する。category resolver/評価cache/workerも版を鍵にする。1.20.1→1.21.4→1.20.1を**別プロセス**で起動し、各生成物・計画が最初の値に戻ることを照合する。異版を同一プロセスでprepareするとVERSION_CONFLICTになる既存試験を残す。

### 6. 1.21.4用照合と合格条件

- 270組の1.21.4比較用コピーを作る。grass→short_grassを明示的に変換し、変更前/変更後の結果を残す。1.20.1 fixtureは上書きしない。**⑤B相当の基準は今回の壊れた結果を「正しいgolden」として固定するだけではない**。失敗の再現用結果と、⑭の成功経路の期待値を分ける。
- 人工状態を追加：各樹種の通常/stripped原木、各plank、既存の環境板、板の混合、周囲の作業台なし/あり、pale oakだけの資源、持ち物のみ。木の道具・棒・作業台が材料から作れることを確認する。
- 石の道具/かまどはcobblestone、blackstone、cobbled_deepslateを個別に与えた3系統。basic_stoneカテゴリの採集効果がドロップと一致すること。coal/charcoal各系統のtorch、鉄精錬と鉄道具、道具を初期所持したdiamondを追加。
- 不可能な状態はrelaxed_unreachable/provenImpossible/iterations=0、探索未完はiteration_limit/frontier_exhausted/provenImpossible=falseを維持。資源を増やしても元モデルの探索限界をすべて成功へ変えることは合格条件にしない。
- 生成goldenを版ごとに別に持つ。1.21.4の全variantを実recipesと照合し、同じ結果名でも材料/出力数/クラフト種別が異なるrecipeを落としていないこと、action名が一意・安定・公開parserで呼べること、すべてのitem/block参照が現版にあることを検証する。既存のraw肉等はlegacy例外とし、1.20.1で勝手に除去しない。
- 270組をmain/workerで照合し、通常planGoal・executeGoal内の計画・evaluateGoals・reachableFactsで選択版を一致させる。繰返しcache、期限/中断、準備失敗再試行、版競合、非破壊な入力を検証する。
- 両版のdomain/action数、prepare時間、計画時間、イベントループ停止を計測。現在の200探索回を増やして失敗を隠さない。閉包possibleは実行成功の証明にしない。
- 人工1.21.4 chunkでshort_grass、pale oakの葉/木/板、pale moss/eyeblossom、流体、未ロード、光と松明をCPUで検証。
- `npm test` 292件と**現在の1.20.1 270組完全一致**が必須。⑭で追加した件数を報告する。⑬のこの結果は1.21.4ライブ成功の合格証ではない。

### 7. ライブ確認・戻し方

必要なライブは `../isg/server-isg-1214` をこのリポジトリ内の専用無視対象フォルダへコピーして行う。server-port/query.port=25569、rcon.port=25579、Java21 `C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot\bin\java.exe`、`-Xmx4G -jar fabric-server-launch.jar nogui`。起動前に25569/25579の空きを確認する。Start-Process Hiddenを使い、ログのDoneで起動判定。コピー元や25566/25568には接続しない。RCON秘密値はコピー内propertiesから読み、ログ/文書/commitへ出さない。終了はsave-all→stop、プロセス/ポートの終了を確認する。

専用区画で代表目標をCPUだけでexecuteGoalし、inventory差分/進捗/中断を記録。環境作業台を壊して取得する成功と、作成する成功を分ける。GPU/LLM/JEV等は禁止を引き継ぎ、viewer試験は依頼元の既存確認を参考扱いに留める。1.20.1のライブ回帰も既存本番サーバー/保護worktreeを使わず、専用コピーで実施する。

戻すときはbotプロセスを正常終了し、1.20.1用サーバーと `MC_VERSION=1.20.1` / factory `version:'1.20.1'` で再起動する。1.21.4へ更新したworldを古いサーバーへ戻す方法にはしない。1.20.1の専用world/生成cacheを独立に保持し、⑭の変更前の `aa7f470` からも同じ計画結果を得られることを保証する。masterへのmerge/pushは依頼者が判断する。

## 5. 残る危険・判断

最大の危険はレシピ全件の分岐増加と、カテゴリ合算で実行可能性を過大評価すること。1.21.4に限定した具体variantと実行照合から始める。legacyの1.20.1を固定した分岐は保守コストを増やすが、「動作・計画を一切変えない」条件を満たすため明示的に選ぶ。

任意バージョン全般に対応する保証、肉の旧名の修正、logへwood/stemを含める拡張、探索限界改善、同一プロセス内の異版bot混在は今回の⑭計画に含めない。対応対象はまず1.20.1/1.21.4。未知の版でresolverを静かに1.21.4規則へ切り替えず、既存対応範囲と未検証であることを文書に残す。

実装開始前に追加で必須の質問はない。樹種固有成果物や混合材料をどこまでカテゴリ化するかは、上記の具体variant優先なら未確認の代用規則を仮定せず進められる。実行試験でplannerとサーバーのrecipeが不一致になる場合は、⑭報告で該当材料・結果と制限を明示する。

## 6. 実測表・再現用資料

以下は一時結果から転記した。生のJSONと調査scriptは `.cache/minecraft-bot/13-study/` にあるがGitに入れない。後続agentが別checkoutでも再現できるよう、測定scriptの全文を後掲する。

### 6.1 全30目標の集計

S=計画成功、U=relaxed_unreachable、L=iteration_limit、E=frontier_exhausted。各列は9状態の組数。失敗理由の変化も保持し、不能と探索未完を分ける。

| 目標（inventory.を省略） | 1.20.1 S/U/L/E | 1.21.4 S/U/L/E | 失った成功数 |
|---|---:|---:|---:|
| oak_planks:4 | 9/0/0/0 | 9/0/0/0 | 0 |
| stick:4 | 9/0/0/0 | 0/8/0/1 | 9 |
| crafting_table:1 | 9/0/0/0 | 9/0/0/0 | 0 |
| wooden_pickaxe:1 | 9/0/0/0 | 0/7/2/0 | 9 |
| wooden_sword:1 | 9/0/0/0 | 0/9/0/0 | 9 |
| stone_pickaxe:1 | 7/2/0/0 | 0/7/2/0 | 7 |
| furnace:1 | 7/2/0/0 | 1/8/0/0 | 6 |
| torch:4 | 7/2/0/0 | 0/9/0/0 | 7 |
| iron_ingot:3 | 4/3/2/0 | 0/7/2/0 | 4 |
| iron_pickaxe:1 | 2/3/4/0 | 1/8/0/0 | 1 |
| diamond_pickaxe:1 | 0/8/1/0 | 0/9/0/0 | 0 |
| chest:1 | 9/0/0/0 | 3/6/0/0 | 6 |
| bread:1 | 0/9/0/0 | 0/9/0/0 | 0 |
| cake:1 | 0/9/0/0 | 0/9/0/0 | 0 |
| iron_axe:1 | 2/3/4/0 | 1/8/0/0 | 1 |
| golden_pickaxe:1 | 0/7/2/0 | 0/9/0/0 | 0 |
| diamond_axe:1 | 0/8/1/0 | 0/9/0/0 | 0 |
| gold_ingot:1 | 2/7/0/0 | 1/8/0/0 | 1 |
| charcoal:1 | 7/2/0/0 | 1/7/1/0 | 6 |
| glass:1 | 1/8/0/0 | 1/8/0/0 | 0 |
| cooked_beef:1 | 0/9/0/0 | 0/9/0/0 | 0 |
| bucket:1 | 5/3/1/0 | 1/7/1/0 | 4 |
| shears:1 | 6/3/0/0 | 1/7/1/0 | 5 |
| iron_block:1 | 0/3/6/0 | 0/7/2/0 | 0 |
| anvil:1 | 0/3/6/0 | 0/7/2/0 | 0 |
| raw_iron:3 | 6/3/0/0 | 3/6/0/0 | 3 |
| category.plank:12 | 9/0/0/0 | 9/0/0/0 | 0 |
| category.basic_stone:8 | 7/2/0/0 | 4/5/0/0 | 3 |
| category.log:4 | 9/0/0/0 | 9/0/0/0 | 0 |
| category.basic_stone:2 | 7/2/0/0 | 4/5/0/0 | 3 |
| **合計270組** | **142/101/27/0** | **58/198/13/1** | **84** |

### 6.2 全270組の状態別対照

セルは「1.20.1→1.21.4」。状態を次の略号で示す。

1. flat-empty（tests/fixtures/flat-empty.json.gz、SHA256 e62d20464dce3273a3bdee1e2b5dd6f6ca3bf16b8d431362ff70b6ec9d2a666c）
2. flat-stocked（tests/fixtures/flat-stocked.json.gz、SHA256 341f41d6713021279ba46a9ae7f3dbe0840906e03842ead521bd0e24130e391a）
3. flat-underground（tests/fixtures/flat-underground.json.gz、SHA256 1e6f76541dd15d407c9d88b3a8ff9b9939133f2b4fd70dbfb68561702a79e4d1）
4. natural-empty（tests/fixtures/natural-empty.json.gz、SHA256 47d51c2c5eb6fdeea0c25d45a7a0ee74339dad578416f86c0c2e17fab1e6a1ec）
5. natural-stocked（tests/fixtures/natural-stocked.json.gz、SHA256 a00d7e5b8d1259d0a5c3821e34ec0d499a029f47bfcc0cf2e794b57e56ada55c）
6. surface-empty（tests/study04/snapshots/surface-empty.json.gz、SHA256 42da5b3ef1c8a29656ab365f91a9ff3d237fd1dc631a9596ad5cbf8aa02008b9）
7. surface-stone（tests/study04/snapshots/surface-stone.json.gz、SHA256 7d739720686147b43fe4243362e342781f9e9eb80bfeced62862af640a10f4a2）
8. surface-iron（tests/study04/snapshots/surface-iron.json.gz、SHA256 a5119780f5e0890d313c556526ce4b4eb3829250c2a7c4c2b166b61638be9d5d）
9. underground-stone（tests/study04/snapshots/underground-stone.json.gz、SHA256 57a934d1fc33728e0960d814569634ee9b39209fef827034812b52c62e105d05）

| 目標（inventory.を省略） | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| oak_planks:4 | S→S | S→S | S→S | S→S | S→S | S→S | S→S | S→S | S→S |
| stick:4 | S→U | S→U | S→U | S→U | S→U | S→U | S→U | S→E | S→U |
| crafting_table:1 | S→S | S→S | S→S | S→S | S→S | S→S | S→S | S→S | S→S |
| wooden_pickaxe:1 | S→U | S→L | S→U | S→U | S→L | S→U | S→U | S→U | S→U |
| wooden_sword:1 | S→U | S→U | S→U | S→U | S→U | S→U | S→U | S→U | S→U |
| stone_pickaxe:1 | U→U | U→U | S→U | S→U | S→U | S→U | S→L | S→U | S→L |
| furnace:1 | U→U | U→U | S→U | S→U | S→U | S→U | S→U | S→U | S→S |
| torch:4 | U→U | S→U | U→U | S→U | S→U | S→U | S→U | S→U | S→U |
| iron_ingot:3 | U→U | U→U | U→U | S→U | S→U | S→U | S→U | L→L | L→L |
| iron_pickaxe:1 | U→U | U→U | U→U | L→U | S→U | L→U | L→U | S→S | L→U |
| diamond_pickaxe:1 | U→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U | L→U |
| chest:1 | S→S | S→S | S→S | S→U | S→U | S→U | S→U | S→U | S→U |
| bread:1 | U→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U |
| cake:1 | U→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U |
| iron_axe:1 | U→U | U→U | U→U | L→U | S→U | L→U | L→U | S→S | L→U |
| golden_pickaxe:1 | L→U | L→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U |
| diamond_axe:1 | U→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U | L→U |
| gold_ingot:1 | S→U | S→S | U→U | U→U | U→U | U→U | U→U | U→U | U→U |
| charcoal:1 | U→U | U→U | S→S | S→U | S→U | S→U | S→U | S→U | S→L |
| glass:1 | U→U | U→U | S→S | U→U | U→U | U→U | U→U | U→U | U→U |
| cooked_beef:1 | U→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U | U→U |
| bucket:1 | U→U | U→U | U→U | S→U | S→U | S→U | S→U | S→S | L→L |
| shears:1 | U→U | U→U | U→U | S→U | S→U | S→U | S→U | S→S | S→L |
| iron_block:1 | U→U | U→U | U→U | L→U | L→U | L→U | L→U | L→L | L→L |
| anvil:1 | U→U | U→U | U→U | L→U | L→U | L→U | L→U | L→L | L→L |
| raw_iron:3 | U→U | U→U | U→U | S→U | S→U | S→U | S→S | S→S | S→S |
| category.plank:12 | S→S | S→S | S→S | S→S | S→S | S→S | S→S | S→S | S→S |
| category.basic_stone:8 | U→U | U→U | S→U | S→U | S→S | S→U | S→S | S→S | S→S |
| category.log:4 | S→S | S→S | S→S | S→S | S→S | S→S | S→S | S→S | S→S |
| category.basic_stone:2 | U→U | U→U | S→U | S→U | S→S | S→U | S→S | S→S | S→S |

### 6.3 成功を維持したがplanが変わった4組

| 状態/目標 | 1.20.1 | 1.21.4 |
|---|---|---|
| flat-stocked / inventory.crafting_table:1 | 2手、cost 20 | 1手、cost 23.827 |
| surface-stone / inventory.crafting_table:1 | 3手、cost 25.298000000000002 | 1手、cost 27.598 |
| surface-iron / inventory.crafting_table:1 | 3手、cost 26.256999999999998 | 1手、cost 27.187 |
| underground-stone / inventory.furnace:1 | 3手、cost 17 | 10手、cost 692.1199999999999 |

作業台の3組は作成から環境の作業台の採集へ変更。underground-stoneのかまどはカテゴリ採石から個別deepslate8回へ変更（各採集cost=84.64、合計692.12）。全plan不一致88組の内訳は成功喪失84＋この4。失敗同士の理由だけの変化はこれとは別に表6.2で示す。

### 6.4 代表目標の人工状態対照

人工状態は位置/blocks.listなしの数量モデルで、⑫の幾何costは加えない。nearbyのカテゴリは現行block_categoriesから集計。数値goalは**現在在庫に加算**（例えば丸石64所持でもcobblestone:8は72個が目標）。Sの後の数字は手数。

| 状態 | 所持品 | 周囲 |
|---|---|---|
| oak-supply | oak_log:8, oak_planks:32, coal:8 | oak_log:16, stone:64, iron_ore:8, diamond_ore:4, crafting_table:1, furnace:1 |
| oak-sticks | oak_log:8, oak_planks:32, stick:16, coal:8 | oak_log:16, stone:64, iron_ore:8, diamond_ore:4, crafting_table:1, furnace:1 |
| oak-sticks-cobble | oak_log:8, oak_planks:32, stick:16, coal:8, cobblestone:64, wooden_pickaxe:1 | oak_log:16, stone:64, iron_ore:8, diamond_ore:4, crafting_table:1, furnace:1 |
| oak-planks-only | oak_planks:32 | なし |
| iron-ready | iron_ingot:3, stick:16 | oak_log:16, stone:64, iron_ore:8, diamond_ore:4, crafting_table:1, furnace:1 |
| stone-ready | stone_pickaxe:1, oak_log:8, coal:8 | oak_log:16, stone:64, iron_ore:8, diamond_ore:4, crafting_table:1, furnace:1 |
| coal-sticks | coal:8, stick:16 | なし |
| charcoal-sticks | charcoal:8, stick:16 | なし |
| pale-supply | pale_oak_log:8, pale_oak_planks:32, stick:16, coal:8 | stone:64, iron_ore:8, diamond_ore:4, crafting_table:1, furnace:1, pale_oak_log:16 |
| diamond-ready | iron_pickaxe:1 | oak_log:16, stone:64, iron_ore:8, diamond_ore:4, crafting_table:1, furnace:1 |

周囲にcrafting_table/furnaceがあれば対応するnearby/visible flag=true、その他false。原木は16、stone64、iron_ore8、diamond_ore4等を上記どおり与えている。pale-supplyは1.20.1では存在しない名を含む**比較用の負例**で、その版で実行可能なワールドではない。

| 目標（inventory.を省略） | oak-supply | oak-sticks | oak-sticks-cobble | oak-planks-only | iron-ready | stone-ready | coal-sticks | charcoal-sticks | pale-supply | diamond-ready |
|---|---|---|---|---|---|---|---|---|---|---|
| stick:4 | S1→U | S1→E | S1→E | S1→U | S3→E | S2→U | E→E | E→E | E→S1 | S3→U |
| crafting_table:1 | S1→S1 | S1→S1 | S1→S1 | S1→U | S1→S1 | S1→S1 | U→U | U→U | S1→S1 | S1→S1 |
| wooden_pickaxe:1 | S2→U | S1→U | S1→E | S4→U | S3→U | S4→U | U→U | U→U | U→S1 | L→U |
| cobblestone:8 | S3→U | S2→U | S1→S1 | U→U | S2→S2 | S1→S1 | U→U | U→U | U→S2 | S1→S1 |
| stone_pickaxe:1 | S4→U | S3→U | S1→U | U→U | S3→U | S4→E | U→U | U→U | U→U | S5→U |
| iron_pickaxe:1 | L→U | L→U | S6→U | U→U | S1→S1 | L→U | U→U | U→U | U→U | L→L |
| furnace:1 | S3→U | S2→U | S1→S1 | U→U | S2→S2 | S1→S1 | U→U | U→U | U→S2 | S1→S1 |
| torch:4 | S2→U | S1→S2 | S1→S2 | U→U | U→S3 | S3→U | S1→U | U→S1 | S1→U | U→U |
| iron_ingot:3 | L→U | L→U | S5→U | U→U | L→L | S4→S4 | U→U | U→U | U→U | L→L |
| diamond:1 | L→U | L→U | S7→U | U→U | S2→S2 | L→U | U→U | U→U | U→U | S1→S1 |

丸石64+木ツルハシ+棒+作業台のoak-sticks-cobbleで、stone_pickaxeは1手成功→U。かまどは既存環境から採れるため1手成功を維持し、このセルはかまどの作成を検証しない。oak-planks-onlyでは棒/作業台/木ツルハシの3つとも1.21.4がU。stone-readyの鉄インゴットとdiamond-readyのdiamond、iron-readyの鉄ツルハシは両版で成功する。

### 6.5 ドメインと草改名

| 種別 | 1.20.1 | 1.21.4 |
|---|---:|---:|
| equip_mainhand | 1264 | 1394 |
| gather | 1130 | 1222 |
| hand_craft | 275 | 316 |
| workbench_craft | 482 | 523 |
| move_to | 2 | 2 |
| place_block | 2 | 2 |
| furnace_smelt | 10 | 10 |
| equip_armor | 12 | 12 |
| **合計** | **3177** | **3481** |

自然系6状態のgrassを、個別nearbyキー、block名、summaryなどを含めshort_grassへ置き換え、1.21.4の270組をさらに2回計画した。変換前後の540行すべてでplan/cost/reason/iterationsが一致した。従って今回の30目標の退行は、草の旧名を持つfixtureだけが原因ではない。これは実1.21.4の地形snapshot取得を代替するものではない。

### 6.6 再現手順

既存テスト/fixtureを上書きせず、リポジトリrootで次の測定scriptを `.cache/minecraft-bot/13-study/survey.cjs` に保存し、版ごとに別プロセスで実行する。scriptは一時調査用であり本体の変更ではない。

```powershell
New-Item -ItemType Directory -Force .cache/minecraft-bot/13-study | Out-Null
node .cache/minecraft-bot/13-study/survey.cjs 1.20.1
node .cache/minecraft-bot/13-study/survey.cjs 1.21.4
node .cache/minecraft-bot/13-study/survey.cjs 1.21.4 rename-grass
npm test
```

測定script全文：

```js
process.env.LOG_LEVEL = 'error'
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../../..'),req=p=>require(path.join(root,p))
const {states,goals}=req('tests/study04/benchmark.cjs')
const {makePlanner,replay}=req('tests/study04/harness.cjs')
const goap=req('planner_bot/src/planner/goap'),service=req('planner_bot/src/planner/planning_service')
const version=process.argv[2],renameGrass=process.argv[3]==='rename-grass',suffix=renameGrass?'-renamed':'',out={version,renameGrass,node:process.version,goals,states:[],rows:[]}
function rename(value){if(Array.isArray(value))return value.map(rename);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k==='grass'?'short_grass':k,rename(v)]));return value==='grass'?'short_grass':value}
async function main(){
 await goap.prepareDomain(version)
 const actions=goap.getAllActions();out.actions=actions.length;out.skills={};for(const a of actions)out.skills[a.skill||'symbolic']=(out.skills[a.skill||'symbolic']||0)+1
 fs.writeFileSync(path.join(__dirname,`domain-${version}.json`),JSON.stringify(actions,null,2))
 const solver=makePlanner({production:true})
 for(const s of states()){
  const bytes=fs.readFileSync(s.file),raw=JSON.parse(zlib.gunzipSync(bytes)),world=renameGrass?rename(raw):raw,before=JSON.stringify(world)
  out.states.push({name:s.name,file:path.relative(root,s.file),sha256:crypto.createHash('sha256').update(bytes).digest('hex')})
  for(const goal of goals) for(let repeat=0;repeat<2;repeat++){
   const r=await solver.run(goal,world,{version,worker:false});assert.equal(r.thrown,undefined)
   const validation=replay(goal,world,r.result.plan);if(validation)assert.equal(validation.valid,true)
   const row={state:s.name,goal,repeat,plan:r.result.plan,diagnosis:r.result.diagnosis,reason:r.reason,planningFailure:r.planningFailure,iterations:r.metrics.iterations,cost:r.result.plan?.reduce((n,x)=>n+x.cost,0)??null,durationMs:r.durationMs}
   if(repeat){const prev=out.rows.at(-1);assert.deepEqual(row.plan,prev.plan);assert.equal(row.iterations,prev.iterations);assert.equal(row.reason,prev.reason)}
   out.rows.push(row)
  }
  assert.equal(JSON.stringify(world),before);console.log(version,s.name,'checked');fs.writeFileSync(path.join(__dirname,`matrix-${version}${suffix}.json`),JSON.stringify(out,null,2))
 }
 const mc=require(path.join(root,'node_modules/minecraft-data'))(version),names=['stick','crafting_table','wooden_pickaxe','stone_pickaxe','iron_pickaxe','furnace','torch','pale_oak_planks']
 out.recipes=Object.fromEntries(names.filter(n=>mc.itemsByName[n]).map(n=>[n,{variants:mc.recipes[mc.itemsByName[n].id]?.length,first:mc.recipes[mc.itemsByName[n].id]?.[0],action:actions.find(a=>a.name===`auto_hand_craft_${n}`||a.name===`auto_workbench_craft_${n}`)}]))
 out.summary={};for(const r of out.rows.filter(x=>!x.repeat))out.summary[r.reason]=(out.summary[r.reason]||0)+1
 fs.writeFileSync(path.join(__dirname,`matrix-${version}${suffix}.json`),JSON.stringify(out,null,2));console.log(JSON.stringify({version,actions:out.actions,skills:out.skills,summary:out.summary}));await service.close()
}
main().catch(async e=>{console.error(e);await service.close();process.exitCode=1})
```

⑫の保存結果との照合（同じrootで実行）：

```js
const fs = require('fs'), assert = require('assert/strict')
const actual = JSON.parse(fs.readFileSync('.cache/minecraft-bot/13-study/matrix-1.20.1.json')).rows
const golden = require('./tests/study12/after.json').rows
for (const r of actual) {
  const g = golden.find(x => x.state === r.state && x.goal === r.goal && x.repeat === r.repeat)
  assert.ok(g)
  for (const key of ['plan', 'cost', 'iterations', 'reason']) assert.deepEqual(r[key], g[key])
}
console.log(actual.length, 'rows identical')
```

人工状態測定script全文（同ディレクトリにprobe.cjsとして保存、各版を引数に実行）：

```js
process.env.LOG_LEVEL='error'
const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'../../..'),version=process.argv[2]
const goap=require(path.join(root,'planner_bot/src/planner/goap')),service=require(path.join(root,'planner_bot/src/planner/planning_service'))
const categories=require(path.join(root,'planner_bot/src/planner/state_builder')).loadBlockCategories()
const common={oak_log:16,stone:64,iron_ore:8,diamond_ore:4,crafting_table:1,furnace:1}
const inputs=[['oak-supply',{oak_log:8,oak_planks:32,coal:8},common],['oak-sticks',{oak_log:8,oak_planks:32,stick:16,coal:8},common],['oak-sticks-cobble',{oak_log:8,oak_planks:32,stick:16,coal:8,cobblestone:64,wooden_pickaxe:1},common],['oak-planks-only',{oak_planks:32},{}],['iron-ready',{iron_ingot:3,stick:16},common],['stone-ready',{stone_pickaxe:1,oak_log:8,coal:8},common],['coal-sticks',{coal:8,stick:16},{}],['charcoal-sticks',{charcoal:8,stick:16},{}],['pale-supply',{pale_oak_log:8,pale_oak_planks:32,stick:16,coal:8},{...common,oak_log:0,pale_oak_log:16}],['diamond-ready',{iron_pickaxe:1},common]]
const goals=['inventory.stick:4','inventory.crafting_table:1','inventory.wooden_pickaxe:1','inventory.cobblestone:8','inventory.stone_pickaxe:1','inventory.iron_pickaxe:1','inventory.furnace:1','inventory.torch:4','inventory.iron_ingot:3','inventory.diamond:1']
async function main(){
await goap.prepareDomain(version);const rows=[]
for(const[name,counts,nearby]of inputs){
 const category={};for(const[c,cfg]of Object.entries(categories.categories))category[c]=(cfg.blocks||[]).reduce((n,b)=>n+(nearby[b]||0),0)
 const world={inventory:{counts},equipment:{},inventory_space:true,nearby:{...nearby,category},nearby_blocks:{visible_workbench:!!nearby.crafting_table,nearby_workbench:!!nearby.crafting_table,visible_furnace:!!nearby.furnace,nearby_furnace:!!nearby.furnace},isDay:true}
 for(const goal of goals){const r=await goap.plan(goal,world,null,{version,worker:false}),failure=goap.getPlanFailure(r);rows.push({state:name,goal,reason:r.plan?'success':failure?.reason,steps:r.plan?.length,plan:r.plan,diagnosis:r.diagnosis,failure})}
}
fs.writeFileSync(path.join(__dirname,`probe-${version}.json`),JSON.stringify({version,inputs,goals,rows},null,2));for(const state of inputs.map(x=>x[0]))console.log(version,state,rows.filter(r=>r.state===state).map(r=>r.reason==='success'?`S${r.steps}`:r.reason==='relaxed_unreachable'?'U':r.reason==='iteration_limit'?'L':r.reason).join(' '));await service.close()
}
main().catch(async e=>{console.error(e);await service.close();process.exitCode=1})
```

### 6.7 ローカル証跡

次はこの調査実行の出力SHA256。JSONのduration値は再実行で変わるので、hash一致は合格条件ではない。

| ファイル（.cache/minecraft-bot/13-study内） | SHA256 |
|---|---|
| matrix-1.20.1.json | 02b13509316b029b7b20769a9993725362721162434a5c335a258af64a7d1e04 |
| matrix-1.21.4.json | 6fb3ac7cb41726158ddd7928e2dbd2243957ba443962a827299028ee9700e2b1 |
| matrix-1.21.4-renamed.json | 45f7294d9cbd17e8b200f99c7aef4ac28b98642e32b650d61c2406ae4af1df55 |
| comparison.json | b909e3a5008a3a124d859869e1e6e7d199302ae38cf8b02facce0b4d27bf2f7f |
| probe-1.20.1.json | b98398555714427b0f2bcf86ea2b384b18dcb6b39a9394c19cf0c04979a6aefb |
| probe-1.21.4.json | 90c46a2492d18f87600666d8a46e9d05e0cb6938b20cbe2509e7af7462d4534f |
| changed-recipes.json | b0f033230f14466cddc9f02d78204a0cdce6f85dfe90ec255af93ff848f4bffb |
| npm-test.log | 20e21f4a464155ebffd03d7af21bb37fa39aba7b5ebd2858e88671a4d9218053 |

本報告だけをコミットして終了する。本体の修正、masterへのmerge、pushは実施しない。
