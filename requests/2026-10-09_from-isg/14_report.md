# ⑭ Minecraft 1.21.4 対応の実装報告

実施日：2026-10-10（JST）。README.md、13_version_survey.md、13_report.md の「⑭の実装計画」、14_version_1214.md、API.md に基づく。

## 1. 結果と作業範囲

- 指定された `isg/13-version-survey-2026-10-10` / `44614974962804d289445a5c1a73578d41a65f8d` から、同じ minecraft-bot フォルダで `isg/14-version-1214-2026-10-10` を作成した。⑬がmasterに未mergeのため、ユーザーの指定どおり⑬を親とした。
- 実装・テスト・ライブ証跡のコミット：`e422cd0`。本報告はその後に別コミットする。
- 最終 `npm test`：303/303成功（既存292件＋⑭の11件）。④の調査テスト：9/9成功。
- 1.20.1の270組：⑫後／⑬の基準と完全一致。plan順序・action・skill・params・各cost・総cost・診断・失敗理由・証明・探索回数を比較した。main/workerも同一、入力不変、成功planのreplayも合格。
- 1.21.4の270組：153成功、73 relaxed_unreachable、44 iteration_limit。⑬の58成功から95組増え、⑬で成功した58組はすべて維持した。main/worker照合270組と保存した⑭期待値の再照合も合格。
- 専用コピーの1.21.4サーバーで、ペールオーク原木から板・棒・作業台・木のツルハシ・丸石・石のツルハシ・かまど・松明・鉄・ダイヤまで実行成功。moveToward、observeTerrain、placeTorchも成功。
- captureVisionはGPU禁止の明示指示に従って未実施。CPUの人工chunk試験で新植生・未ロード・流体・光を確認した。GPU描画成功は主張しない。
- masterは `aa7f47018ccb4c451ac22ecb31a52dda0d0f3b74` のまま。merge・pushは実施していない。保護された3フォルダには触れていない。

## 2. 変更点

### 共通の版別カテゴリ

`version_categories.js` を追加。既存の `block_categories.yaml` は変更せず、1.20.1には元の定義と順序・オブジェクトをそのまま返す。1.21.4だけlegacy定義をコピーし、block/item registryから `*_log` と `*_planks` を安定順で追加する。追加はpale_oak_log、stripped_pale_oak_log、pale_oak_planks。木・ネザーstem等への意味拡張はしていない。

state_builder、通常/高速観測、gather生成・実行・コスト、goal_evaluator、executor前提確認・状態表示に版を渡す。独立したbuildStateの版省略は選択済みdomain、MC_VERSION、1.20.1の順で解決する。workerは選択済み版を使い、異版混在は従来のVERSION_CONFLICTを維持する。

### 全レシピの保持と実行材料の一致

1.21.4だけ `craft_variants.js` を使用する。全parse可能recipeを列挙し、出力名・個数・クラフト種別・材料消費が同じものを重複排除する。成果物名だけで代替recipeを落とさない。石のツルハシとかまどはcobblestone／blackstone／cobbled_deepslate、松明はcoal／charcoalを保持する。個別材料の増減とcountカテゴリの増減を揃える。

全12種類の板で同じ材料配置・非板材料・出力名・個数になることを実recipesで確認できた群だけ、板カテゴリへ集約する。オークのボート等の樹種固有成果物は具体材料のまま。代表action名を残し、追加variantは材料signatureのSHA256を英小文字に符号化して付ける。レシピ配列を逆順にしても生成配列が一致し、全action名が公開goal parserで呼べる。

新しいparams.craftingRecipeは材料名・形状・出力数を保持する。1.21.4のcraftItemだけが現在のregistryと在庫からprismarine-recipeを構成する。category.plankはスロットごとに実在庫を割り当て、混合板も実行できる。plannerが選んだcoalをcharcoalへ勝手に替える等の不一致を避ける。旧recipesFor経路はそのまま残す。

1.21.4のfurnace_smeltのlog/planks解決にも同じitemカテゴリを使う。1.20.1の6樹種配列は変更しない。ペールオークは実サーバーでinputとfuelとして使い、charcoalの取得を確認した。

### 生成物と版分離

既存の `.cache/minecraft-bot/actions/<version>/prepare-*` stagingと4ファイル構成を維持する。manifest.jsonにMinecraft版、minecraft-data版、カテゴリhash、生成規則revision、4生成物のSHA256を保存する。生成物の再利用機構は追加せず、準備時に生成・完全domain採用する既存方式を守った。

別プロセスで1.20.1→1.21.4→1.20.1を起動し、最初と最後のカテゴリhash・4生成物hash・manifestが完全一致することを確認した。1.20.1の既存生成goldenは更新していない。1.21.4は独立した4配列のgoldenを追加した。

## 3. 1.20.1の回帰

| 検証 | 結果 |
|---|---|
| 最終npm test | 303成功、失敗0、skip0、102.174秒 |
| 既存1.20.1の生成golden全4配列 | 一致（npm test内） |
| ④調査テスト | 9成功、失敗0、26.497秒 |
| ⑤B相当、⑫後の9状態×30目標 | 270組完全一致 |
| main/worker | 両版とも270組の全Result・失敗情報が一致 |
| 版を戻す別プロセス試験 | カテゴリと4生成物が完全復元 |

1.20.1は142成功／101 relaxed_unreachable／27 iteration_limit、domain 3177 actions。⑤Bの古い130成功の記録ではなく、ユーザーが指定した⑫後142成功の基準を照合した。既存 `tests/study05/matrix-B.json`、`tests/study12/after.json`、④のfixture、1.20.1のgoldenを変更していない。

基準のplan・診断・失敗情報まで含む270組を `tests/study14/baseline-1201.json.gz` に保存した。⑬がコードを変更しなかった4461497の結果で、⑫のafter.jsonに照合済みの結果を元にしている。

## 4. 1.21.4の照合

1.20.1の9個の保存worldStateを読み、1.21.4の比較用コピーだけgrass→short_grassに明示変換する。元fixtureは書き換えない。探索上限200、GOAP探索・コスト・relevance・再計画の規則は変更しない。

| 版・段階 | success | relaxed_unreachable | iteration_limit | frontier_exhausted |
|---|---:|---:|---:|---:|
| 1.20.1／⑫後、⑭とも | 142 | 101 | 27 | 0 |
| 1.21.4／⑬（草名変換あり） | 58 | 198 | 13 | 1 |
| 1.21.4／⑭ | 153 | 73 | 44 | 0 |

1.20.1に比べ、成功→失敗は以下の1組だけ。追加recipeによる分岐で200回の上限に達するためで、不能証明ではない。

| 状態 | 目標 | 1.20.1 | 1.21.4 |
|---|---|---|---|
| underground-stone | inventory.wooden_pickaxe:1 | success | iteration_limit（provenImpossible=false） |

逆に1.20.1で不能だった次の12組が成功した。材料の代替recipeや新カテゴリから経路が増えたことによる差であり、旧版に対する修正ではない。

| 状態 | 1.21.4で新たに成功する目標 |
|---|---|
| flat-empty | stone_pickaxe:1、furnace:1、torch:4、charcoal:1、raw_iron:3 |
| flat-stocked | stone_pickaxe:1、furnace:1、iron_pickaxe:1、iron_axe:1、charcoal:1、raw_iron:3 |
| flat-underground | torch:4 |

目標はすべてinventory.接頭辞付き。残る失敗は73組の不能証明と44組の探索未完として区別し、探索上限を増やして隠していない。以下の人工状態では200回以内で成功することを別途確認した：18種の通常/stripped原木→棒、12種の板→棒/作業台/木のツルハシ、石材料3種→石のツルハシ/かまど、coalとcharcoal→松明。全parse可能recipeが消費・出力・クラフト種別を維持したactionに対応すること、全参照itemが現registryにあることも検証した。

### 行動数と測定値

| 種別 | 1.20.1 | 1.21.4 |
|---|---:|---:|
| gather_auto | 1130 | 1234 |
| hand_craft_auto | 275 | 383 |
| workbench_craft_auto | 482 | 768 |
| equipment_auto | 1252 | 1382 |
| 静的行動を含む合計 | 3177 | 3805 |
| 初回domain準備(ms) | 941.869 | 1316.720 |
| main計画p50(ms) | 83.310 | 83.478 |
| main計画p95(ms) | 827.479 | 1548.114 |
| main計画最大(ms) | 1159.116 | 2357.851 |
| 最大timer間隔(ms) | 1583.060 | 2428.741 |

main/workerを交互に照合した実測で、timerには意図的にmain計画を実行する時間も含む。workerだけのAPI応答停止時間を示す数値ではない。ほかのCPU試験や専用サーバーとの同時実行も含むため、性能改善の厳密な比較には使わない。追加recipeで探索分岐が増えることは残る問題として扱う。

## 5. 専用1.21.4ライブ

コピー元は `C:\Users\kaiha\personal-files\akai_project\isg\server-isg-1214`。実行先はこのrepoの `.cache/minecraft-bot/14-study/server`。server-port/query.port=25569、rcon.port=25579へコピー内だけ変更。Java21、`-Xmx4G -jar fabric-server-launch.jar nogui`、Start-Process Hiddenで起動した。25566/25568へ接続していない。RCON秘密値はコピー内propertiesから読むだけで、ログ・文書・コミットへ出していない。

空の持ち物から専用bedrock床の区画で実行。原木・石・石炭鉱石・鉄鉱石・ダイヤ鉱石を区画に配置するが、連続12目標の途中でgiveによる材料補充はしていない。作業台とかまどもボットが作成・設置する。各目標には120秒の中断期限を設けた。時間には計画・実行・実行後500msの在庫反映待ちと観測を含む。

| 実行目標 | 秒 | 実在庫で確認した結果 |
|---|---:|---|
| category.log:8 | 37.510 | pale_oak_log 8 |
| category.plank:16 | 5.913 | pale_oak_planks 16 |
| stick:8 | 0.571 | stick 8 |
| crafting_table:1 | 0.559 | crafting_table 1 |
| wooden_pickaxe:1 | 1.194 | wooden_pickaxe 1、作業台設置 |
| cobblestone:12 | 37.652 | cobblestone 16（採集単位による余剰） |
| stone_pickaxe:1 | 1.639 | stone_pickaxe 1 |
| furnace:1 | 0.591 | furnace 1 |
| torch:4 | 7.347 | torch 4 |
| iron_ingot:3 | 52.004 | iron_ingot 3、かまど設置・精錬 |
| iron_pickaxe:1 | 2.970 | iron_pickaxe 1 |
| diamond:1 | 10.624 | diamond 1 |

APIと補足試験：

| 試験 | 秒 | 結果 |
|---|---:|---|
| moveToward | 3.002 | reached=true、距離16.019→2.000、pathStatus=success |
| observeTerrain（radius=8） | 0.009 | 289セルknown、unknown=0、timedOut=false |
| placeTorch | 1.590 | 床にtorch設置、attempts=1、torchNearby=true、視点復元 |
| 混合板クラフト | 3.426 | オーク2＋ペールオーク2を全消費し、作業台1をhand_craftで作成 |
| ペールオーク木炭 | 11.662 | pale_oak_log 2を材料・燃料に使い、charcoal 1を取得 |
| captureVision | 未実施 | GPU禁止のため。viewer/ブラウザ描画を起動していない |

初回の石床では丸石段階が120秒で中断。bedrock床にした次の試行では資源14個を使い切りREPLAN_FAILEDになった。既存計画は採集単位x8などで要求数を超えて集め、資源消費後の再計画でも追加数量を目標とするため、床を掘らない十分な資源40個の試験区画に直した。採集・再計画の本体仕様は変更していない。初回混合板試験は周辺作業台を採集してしまったため、周辺の作業台をなくして補足試験をやり直し、板の実消費とhand_craftのstep_successを確認した。

連続目標/APIの成功記録と、区画を直した補足試験の2行を合わせた証跡は `tests/study14/live-results.json`。plan・Result・在庫前後・位置・進捗イベントを含む。最初の失敗ログはローカルのlive-initial / live-secondに保存している。

サーバーはsave-all→stopで正常終了。補足試験後も同じ手順で停止し、2026-10-10 20:05:10 JSTにRCON Listener停止を記録した。最終PID 41612の終了と25569/25579の待受がないことを確認した。コピー元サーバーと禁止フォルダには変更していない。

## 6. 再現と1.20.1への戻し方

repoルートでCPU検証する：

```powershell
npm test
node --test tests/study04/*.test.cjs
node tests/study14/matrix.cjs 1.20.1
node tests/study14/matrix.cjs 1.21.4
node tests/study14/generation.cjs
node tests/study14/restart.cjs
```

matrixはmain/worker・replay・入力不変・6比較項目を検証し、結果を `.cache/minecraft-bot/14-study/matrix-<version>.json` に保存する。1.20.1は元基準、1.21.4は⑭の期待値と照合する。生成goldenを意図して作り直す場合だけgeneration.cjsの `--record` を使う。既存1.20.1 goldenは対象外。

ライブ再現は同じ専用コピーだけを起動し、`node tests/study14/live.cjs` を実行する。`supplemental` 引数なら周辺作業台を除いた混合板/木炭だけ実行する。`node tests/study14/live.cjs stop` でsave-all→stopする。既存試験の自然サーバー用helperはproperties読み込みを専用コピーへ差し替えて使い、接続先は25579に固定される。コピー内propertiesの値は表示しない。

1.20.1へ戻す際はbotプロセスを正常終了し、独立した1.20.1サーバー/ワールドを指定する。PowerShellなら `$env:MC_VERSION='1.20.1'`、factoryなら `version:'1.20.1'` で再起動する。未指定の既定値も従来の1.20.1。1.21.4ワールドを古いサーバーに読み込ませない。同一プロセス内で異版をprepareすると従来どおりVERSION_CONFLICTになるため、プロセスを再起動する。1.21.4キャッシュの削除は不要。

## 7. 計画との差・残る問題

- 板カテゴリ集約は「全具体recipeを保持」した後の最適化として⑬で許容されていたものを今回含めた。全12種の同形recipe確認、配列順逆転、実サーバーでの混合板消費を合格条件にした。代替を全件保持すると探索分岐が増えるため。
- 共通成果物の代表recipeは1.20.1の先頭recipeと材料が一致するものを優先し、残るvariantを安定順に並べる一般規則にした。特定の石・松明だけの特例にはしていない。これは追加recipeによる探索上限到達を減らすため。1.20.1生成の順序は変更しない。
- 1.21.4は1.20.1の成功目標集合と厳密に同一ではない。追加成功12組と探索上限到達1組を上に列挙した。後者を隠す探索上限変更はしていない。
- generic log_to_planksやカテゴリ採集は具体在庫を完全に表さない既存の抽象モデルを維持する。資源消費・サーバー在庫反映・位置変化で再計画が必要になるケースは残る。全自然環境の全レシピ実行成功を保証する試験ではない。
- 木炭の全18樹種でのライブ、チェスト転送、GPU描画、1.20.1の新しいライブ回帰は今回実施していない。1.20.1は既存CPU回帰と270組完全一致で検証した。通信不具合を推測してprotocol/metadataを先回り変更していない。
- GPU、LLM、JEV、H2O-Lightning、subs-llmapiを使っていない。npm testのvision契約試験は既存のmock試験で、GPUライブではない。

本報告をコミットして停止する。masterへのmerge・pushは行わない。

## 8. 1.21.4の全270組の結果一覧

S=success、U=relaxed_unreachable（不能証明）、L=iteration_limit（探索未完）。詳細plan・診断・cost・iterationsはexpected-1214.json.gzとmatrix出力に保存している。

| 目標 | flat-empty | flat-stocked | flat-underground | natural-empty | natural-stocked | surface-empty | surface-stone | surface-iron | underground-stone |
|---|---|---|---|---|---|---|---|---|---|
| inventory.oak_planks:4 | S | S | S | S | S | S | S | S | S |
| inventory.stick:4 | S | S | S | S | S | S | S | S | S |
| inventory.crafting_table:1 | S | S | S | S | S | S | S | S | S |
| inventory.wooden_pickaxe:1 | S | S | S | S | S | S | S | S | L |
| inventory.wooden_sword:1 | S | S | S | S | S | S | S | S | S |
| inventory.stone_pickaxe:1 | S | S | S | S | S | S | S | S | S |
| inventory.furnace:1 | S | S | S | S | S | S | S | S | S |
| inventory.torch:4 | S | S | S | S | S | S | S | S | S |
| inventory.iron_ingot:3 | L | L | U | S | S | S | S | L | L |
| inventory.iron_pickaxe:1 | L | S | U | L | S | L | L | S | L |
| inventory.diamond_pickaxe:1 | L | L | U | U | U | U | U | U | L |
| inventory.chest:1 | S | S | S | S | S | S | S | S | S |
| inventory.bread:1 | U | U | U | U | U | U | U | U | U |
| inventory.cake:1 | U | U | U | U | U | U | U | U | U |
| inventory.iron_axe:1 | L | S | U | L | S | L | L | S | L |
| inventory.golden_pickaxe:1 | L | L | U | U | U | U | U | U | U |
| inventory.diamond_axe:1 | L | L | U | U | U | U | U | U | L |
| inventory.gold_ingot:1 | S | S | U | U | U | U | U | U | U |
| inventory.charcoal:1 | S | S | S | S | S | S | S | S | S |
| inventory.glass:1 | U | U | S | U | U | U | U | U | U |
| inventory.cooked_beef:1 | U | U | U | U | U | U | U | U | U |
| inventory.bucket:1 | L | L | U | S | S | S | S | S | L |
| inventory.shears:1 | L | L | U | S | S | S | S | S | S |
| inventory.iron_block:1 | L | L | U | L | L | L | L | L | L |
| inventory.anvil:1 | L | L | U | L | L | L | L | L | L |
| inventory.raw_iron:3 | S | S | U | S | S | S | S | S | S |
| inventory.category.plank:12 | S | S | S | S | S | S | S | S | S |
| inventory.category.basic_stone:8 | U | U | S | S | S | S | S | S | S |
| inventory.category.log:4 | S | S | S | S | S | S | S | S | S |
| inventory.category.basic_stone:2 | U | U | S | S | S | S | S | S | S |
