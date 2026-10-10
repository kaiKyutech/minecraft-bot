# 16 準備済みgoalによる切替の実装報告

作業日：2026-10-10〜11（JST）。⑮の `cdf4ea7f01e70572a2f23a81e20e5c343f343cd8` から、指定の `isg/16-prepared-goals-2026-10-10` を作成した。

評価で得た計画を保持するopt-in候補、操作権を取らない準備、準備済みhandleからの実行を追加した。既存 `executeGoal` / `planGoal` / `evaluateGoals` の既定経路、GOAPの探索・コスト・行動定義を維持した。全318テストと両版540組の完全照合に合格した。

## 1. 変更点

| ファイル | 内容 |
|---|---|
| `planner_bot/src/api.js` | includePrepared、prepareGoal、executePreparedGoal。既存のResult・Progress・OperationManagerを使用 |
| `executor/prepared_goals.js` | bot単位の候補/handle保持、世代・互換性・単回消費、準備、実行時と終了時の達成確認 |
| `executor/goal_runner.js` | 内部専用の初期plan/world受け取りと、既存の道具判断関数のexport。指定しない従来経路は維持 |
| `executor/operation_manager.js` | 物理操作/stopが未実行の準備を無効化。既存の中断・drain・cleanup・所有権規則は維持 |
| `planner/goal_evaluator.js` | opt-in時だけ、main側で完全観測と計画コピーにcandidateを関連付ける |
| `planner/planning_service.js` | workerの失敗epochを記録し、失敗時に候補/handleを解放。workerのFIFO・予算・plannerは維持 |
| `doc/planner_bot/API.md` | 新API、所有権・失効・数量契約、isgのpending/currentを分ける例 |
| `tests/offline/prepared-goals.test.cjs` | 追加15テスト |
| `tests/study16/` | 専用サーバー、ライブ・計測・集計、変更していない⑭照合の実行、秘密値検査 |

候補はmain側にgoal、計画の独立コピー、観測時刻、完全観測のcompact projection、Minecraft版、domain指紋を保持する。大きなblocks.listを候補ごとにコピーしない。同じ評価回は独立したprojectionを共有する。

最大3評価回・128候補、最新準備の1handle、使用期限60秒。新しい評価・準備で期限/件数を整理し、bot終了とworker失敗で保持を解放する。domainは行動・schema・版別categoryをSHA256で確認し、同じobject内の変更も検出する。worker epochとaction-filter設定も互換性に含む。返されたplanを書き換えても保持計画を変更できない。

位置、在庫、装備、資源の変化を候補の一律失効条件にしていない。2秒TTLやworld全体一致も導入していない。

## 2. 準備・実行と既存経路の維持

`prepareGoal` は実行中のcontrollerをabortせず、OperationManagerの所有権を取らない。有効候補で道具準備が不要なら、現在の在庫・装備だけを読み、root再計画を省く。環境条件の目標、または直接在庫を読めないcustom StateManagerでは独立観測を行う。

候補が不明・別bot/goal・失効・誤版/domainなら再利用せず、観測と計画を行う。1プロセス1版という既存VERSION_CONFLICTは維持する。計画できなければPLAN_NOT_FOUNDで返し、旧動作は継続する。

道具判断は既存 `buildPickaxePreparationGoals` を使う。現在のbuildStateのcategoryで必須準備を確認し、必要なら最初の道具goalを旧操作中に計画する。実行時は既存runnerでそのprefixを実行し、同じFailureGuard文脈で残る準備とrootのrefresh/計画に戻る。道具を作った後に古いroot候補を重ねて実行しない。最初のprefixにも親goalのsubgoal進捗を付ける。

`executePreparedGoal` は、handleを消費・検証してから通常のOperationManagerへ入る。無効handleは旧操作を中断しない。旧作用のdrain/cleanup後にも準備世代、期限、domain、prepareのsignalを確認する。以後の各stepのrefresh、前提検査、補助目標、再計画、失敗guard、循環/深さ制限は既存executor/runnerを使う。

後続prepare、stop、通常の物理API、視線/idle、bot終了で古い未実行handleを無効化する。A→B→Cで遅れて返るA/B、drain中に選び直されたhandle、開始前abortされた新準備から古い結果を復活させない。既に開始した実行はexecuteのsignalまたはstopで止める。

新経路だけで次を確認する：

- Boolean既達成は実行時にも確認し、作り直さない。prepareのalreadySatisfiedは呼び出し側が旧動作を続ける判断にも使える。
- 数値目標は、drain後の実行開始時在庫にNを足した目標を確認用に保存する。候補観測の在庫を基準にしない。
- 空計画後に目標を失った場合は既存runnerで再計画/回復する。空配列だけで成功にしない。
- 終了時に最新factsで確認し、未達ならGOAL_NOT_SATISFIED。確認用の目標固定はsolverの相対数量retryを変更しない。

⑮案からの選択：保持上限を3回/128件/60秒とし、終了時未達は自動で別の数量retryを追加せず、明示的な失敗Resultにした。既存の再計画の加算や無条件完了を既定APIで変更しないため。legacy executeGoalの空計画バグも今回は変更していない。

## 3. isgからの呼び出し

```js
const evaluated = await api.evaluateGoals(goals, {
  includePrepared: true, maxMs: 3000, perGoalMs: 400
})
const choice = evaluated.data.results.find(row => row.goal === selectedGoal)
const prepared = await api.prepareGoal(choice.goal, {
  candidate: choice.candidate, signal: prepareController.signal
}) // この間、旧walk/GOAPのcontrollerはabortしない
if (selectionGeneration !== latestGeneration) return
if (!prepared.ok || prepared.data.alreadySatisfied) return // 旧動作を継続
const result = await api.executePreparedGoal(prepared.data.handle, {
  signal: executionController.signal, onProgress
})
```

prepareの成功dataは `{handle,goal,reused,alreadySatisfied,preparationGoal}`。executeの成功dataは従来と同じ `{goal,message}`。両方Promise<Result>。消費済み・別bot・失効・置換されたhandleはPREPARED_GOAL_INVALID、signal中断はCANCELLED。

isgは評価結果をgoal/見積りだけに縮めずcandidateを保存する。pendingの準備とcurrentの実行を分け、準備成功かつ最新選択の場合にだけ切り替える。旧finishが新currentを消さないように世代/ownerを照合する。stopでは外側の選択世代を進め、pendingのsignalをabortしてapi.stopを待つ。詳しい実行例はAPI.mdに記載した。

isg側ファイルは変更していない。実際のJEV選択・GPU・LLM・H2O-Lightning・subs-llmapiは使用していない。libの新APIをライブスクリプトから直接呼んだ。

## 4. 回帰結果

| 検査 | 結果 |
|---|---|
| `npm test` | 318/318成功（既存303＋追加15）、失敗/skip 0 |
| `node --test --test-concurrency=1 tests/study04/*.test.cjs` | 9/9成功 |
| 1.20.1 ⑭matrix | 270/270、⑫後のbaselineと完全一致 |
| 1.21.4 ⑭matrix | 270/270、⑭expected-1214と完全一致 |

| 版 | 成功 | relaxed_unreachable | iteration_limit | actions |
|---|---:|---:|---:|---:|
| 1.20.1 | 142 | 101 | 27 | 3177 |
| 1.21.4 | 153 | 73 | 44 | 3805 |

行動順・skill・全params・各/総cost・diagnosis・private failure・iterationsを各版の基準へ完全照合した。main/workerの結果一致、成功計画replay、入力不変も合格。⑭の照合ソース・期待値・入力は変更せず、study16/matrix.cjsはVM内で出力先だけ16-study/matrixへ変更した。

追加15テストは、候補のコピー/再利用、版/domain/内容変更・別bot/不明ID・評価回/件数/期限、worker無効化、A→B→C/stop/end/abort、pre-abort、Boolean/数値、環境条件/custom StateManager、空計画・最終未達、道具prefixと失敗、公開APIのResult/進捗、旧owner継続、drain中の再選択、道具の親子進捗・二重作成防止を検証した。

## 5. ライブ方法と結果

版ごとに専用コピーを作成し、同時起動せず25569 / RCON 25579だけへ接続した。

- 1.21.4：`../isg/server-isg-1214` → `.cache/minecraft-bot/16-study/server-1.21.4`（fabric jar/modsを含むコピー）。
- 1.20.1：`../isg/runs/world-snapshot-2026-10-10b` → `server-1.20.1/world`。jar・設定は既存vanillaの読み取りコピー。
- コピー元のworld/session.lockはコピーしない。コピー先だけのport/level-name/online-mode設定を変更した。
- `../isg/server-isg` 25568、元の1.21.4 25566へ接続・操作していない。stable/07/11のフォルダにも触れていない。

代表9目標は⑮と同じ：log:1、plank:4、crafting_table:1、wooden_pickaxe:1、stone_pickaxe:1、cobblestone:1、furnace:1、torch:4、iron_ingot:1。カテゴリ表記は元の目標文字列を維持した。

専用arenaで材料をそろえて評価candidateを取得し、旧walk、または実際に原木取得を始めた旧GOAPを2秒継続する。434,650 blocksの完全自然観測を固定した30目標の背景評価（3000ms/400ms）をworkerへ投入してから選択する。prepare中は旧操作をabortしない。両版でwalk中9/9、GOAP中9/9、合計36/36成功。道具準備のあるfurnaceも成功した。

終了時の再試験は両版とも5/5成功：材料を失ったtableの補助計画回復、Boolean既達成（table1のまま）、数値追加（table1→2）、空handle後のtable喪失から回復、材料ありfurnaceの道具prefix（wooden_pickaxeを1本だけ作成してfurnace1）。

### 5.1 選択から最初のskillまで

⑮と同じく、選択時刻→step_startと、選択時刻→最初のskill関数入口を別々に記録した。skill入口は最初の物理効果の完了ではない。以下は同じtable目標、同じ材料・背景観測、各3回の比較。p90は3回の最大値で、統計的な上限保証ではない。

| 版 / 旧操作 | 従来executeGoal skill p50/p90 ms | 新経路・候補再利用 skill p50/p90 ms | 再利用のprepare p50 ms |
|---|---:|---:|---:|
| 1.20.1 walk | 1605.0 / 1649.4 | 174.7 / 218.7 | 11.3 |
| 1.20.1 GOAP | 1631.5 / 2259.9 | 122.2 / 615.4 | 8.5 |
| 1.21.4 walk | 2028.9 / 2854.1 | 183.8 / 201.9 | 18.8 |
| 1.21.4 GOAP | 2422.8 / 2885.5 | 624.9 / 645.0 | 17.3 |

候補なしの新prepare経路でも、旧操作を続けながらworkerを待てる。選択→skill p50/p90は1.20.1 walk 1350.0/1943.5ms、GOAP 1284.7/1297.1ms、1.21.4 walk 1838.6/2873.2ms、GOAP 1726.5/1736.2ms。再利用でこの初期計画待ちを省いた。

再利用の選択→step_start p50/p90は、1.20.1 walk 39.8/40.8ms、GOAP 23.7/504.1ms、1.21.4 walk 37.7/40.5ms、GOAP 549.7/550.1ms。GOAPでは発行済み採掘のdrainが残る。prepare完了→skill p50は1.20.1 GOAP 110.3ms、1.21.4 GOAP 605.9msだった。

⑮の自然地形・従来経路の競合評価測定は1.20.1 skill 2525/1311/1297ms、1.21.4 2965/2948/3017ms。上の同条件比較とは地形/旧動作が異なるため、その数値との単純な改善率は主張しない。⑮の内部executor再利用50〜70msより今回のwalkが遅いのは、継続した移動後の完全refresh等も含むため。50ms保証は置かない。

### 5.2 準備の間の進展

compareの全24試行で、prepare完了時にも旧ownerがactiveかつ未abortであることをassertした。再利用のprepareは約9〜19msの中央値で、physics tickより短く、準備中の観測距離/取得数は0だった。これは旧操作を停止したという意味ではない。

候補なしで待つ間の旧walkの実座標移動は、1.20.1で8.63/5.60/5.49ブロック、1.21.4で13.66/7.96/7.79ブロック。旧GOAPは1.20.1で各1原木、1.21.4で0/0/1原木を追加取得し、実座標もそれぞれ0.81〜1.11、1.11〜1.90ブロック進んだ。準備中のworker待ちが停止時間になっていない。

## 6. 未解消のケースと制約

1. 初期plan再利用は、途中の補助計画・再計画や道具prefix後のroot計画のworker待ちまでは解消しない。旧walkで作業台から離れたwooden/stone pickaxe候補は前提検査が移動補助を要求し、初回試験では約1.6〜1.7秒が残った。位置全一致で候補を捨てる変更はしていない。
2. 1.21.4の完全空在庫から `inventory.category.pickaxe:true` を準備する試験は、既存A*の200回上限でPLAN_NOT_FOUNDとなった。root raw_iron候補がplannableでも最初の道具goalを直接計画できない場合がある。旧動作を継続して失敗を返す。GOAPの上限・行動・コストやread-only準備での仮想効果合成は変更していない。成功する道具引継ぎは、材料ありfurnaceで両版確認した。
3. 材料を持つraw_iron試験でも、両版で既存executeGoalがok:trueなのに取得数0となるケースを再現した。wooden/stone pickaxeは在庫にあるが、実際のiron_oreのdig呼出し直前heldItemはnullだった。1秒後にもraw_ironは0。新経路はGOAL_NOT_SATISFIEDで未達を返した。候補rootを再利用せず道具prefix後にfresh計画した場合にも再現しており、旧gather/装備側の原因特定・修正は今回行っていない。
4. numeric retryは既存どおり再計画時の在庫へNを加算する。途中取得後の過剰作成を絶対数量へ変更していない。終了確認は未達成功を防ぐが、最適な取得数・経路を保証しない。
5. 読み込み済みの世界に基づく候補/見積りであり、資源消失や未読込・移動可能性は実行側で失敗し得る。候補IDはプランナーの成功候補で、実地成功保証ではない。

試験手順の補正：1.21.4の初回自然観測がチャンク読込待ちで開始条件に届かず、待ちを追加して本試験を開始した。再接続時にも自然観測を取り直せない試行があったため、補足比較は最初に得た同じ完全自然snapshotを入力に固定した（⑮の固定背景負荷と同じ方式）。owner中断状態の計測は参照objectを後から読むのではなく、prepare完了時のBooleanを保存するよう補正して再実行した。これらの開始/計測失敗を成功試行に含めていない。

## 7. 証跡・再実行・終了

再実行用は `tests/study16/server.ps1` と `live.cjs`。server.ps1はprepare/start/status、live.cjsはall/compare/legacy/edges/mining/stop。allで完全自然snapshotを取得し、その後の比較は同じsnapshotを読む。profile/worker-profileは計測用の一時ラップで、本番sourceやworker schedulerを改変しない。

```powershell
./tests/study16/server.ps1 -Version 1.20.1 -Mode prepare
./tests/study16/server.ps1 -Version 1.20.1 -Mode start
./tests/study16/server.ps1 -Version 1.20.1 -Mode status
node tests/study16/live.cjs 1.20.1 all
node tests/study16/live.cjs 1.20.1 compare
node tests/study16/live.cjs 1.20.1 legacy
node tests/study16/live.cjs 1.20.1 edges
node tests/study16/live.cjs 1.20.1 mining
node tests/study16/live.cjs 1.20.1 stop
# Java終了と25569/25579解放後に、版を1.21.4へ変更する。
node tests/study16/matrix.cjs 1.20.1
node tests/study16/matrix.cjs 1.21.4
node tests/study16/summarize.cjs
node tests/study16/check-secrets.cjs
```

prepareは既存の専用コピーを上書きしない。設定やサーバーフォルダは秘密値を含むのでgitへ追加しない。port確認は値全体を出すassertを使わずBooleanだけを確認する。RCON認証はメモリ内で読み、ログへ出さない。新しいsource/doc/reportとローカル証跡に対し、設定から読んだ秘密値の一致検査を実施した（値は出力しない）。

rawと集計は `.cache/minecraft-bot/16-study/` のlive/compare/legacy/edges/mining-版.json、summary.json、matrix/、各実行log。初回liveは1.20.1が25成功、1.21.4が24完了後に前述の空在庫道具準備で失敗した。代表18切替、最終edges5、compare12、legacy6、採掘の旧/新結果を分けて保存・報告している。

主要rawのSHA256：

| ファイル（16-study内） | SHA256 |
|---|---|
| compare-1.20.1.json | 6d9c4d255b28037ae0657111d3675dda6bd5adb6d714ab0ca2e5cd8e169dc0db |
| compare-1.21.4.json | 1d65eece2edd4d9cb3d9b0cbb8459e7acdf3300a16bde002cd9141dc342f10e7 |
| legacy-1.20.1.json | 16f83fd347864711bb7d65c8e62914fa3654858e71405ba54c34ac2217c9e158 |
| legacy-1.21.4.json | 704c73f24057e4751e0883b2465b45999dea7e2bc26d076d6752a09f36358376 |
| edges-1.20.1.json | 1f8a6b62599075c66eae4fdb630f723e172a956d5f0919f63e745fb2c7bbb6b8 |
| edges-1.21.4.json | c6cb386c515957d17482a0f45afb9f4b29b2af5a032d4d85babf0dce5028139e |
| live-1.20.1.json | 7a7dd15f78a1ed08026dc530272a0689cd121347099425aa1c8d881764dddee0 |
| live-1.21.4.json | 81a447883c080b4d6af6acd6ac4854223be1753e38315851b1afcb6708c97bbc |
| mining-1.20.1.json | f9cd541cbb30570ddd2565d2a0ad53510b373a82bb991f046ac06947f254ce98 |
| mining-1.21.4.json | 8de0807bc12913c2294737f3c9b4f32be3b1451017f20386277bed023df66be5 |
| matrix/matrix-1.20.1.json | 4401391512dffd966cc3060fe3834760c1204f035217d401edf633d802219014 |
| matrix/matrix-1.21.4.json | 67c8d4caef12f679b7443e77b8cb0ed91325a1af7bcbd6a01709519fe60d1654 |

専用Javaは1.20.1でPID 52112/47508、1.21.4でPID 27416/58580を順に使用した。最終の1.20.1は2026-10-11 00:19:58 JST、1.21.4は00:22:58 JSTまでにsave-all→stopで保存・終了を確認した。4つの専用PIDが残っておらず、25569/25579にLISTENがないことを確認した。秘密値検査も合格した。

masterへのmerge・pushは行わない。実装・API文書・試験・この報告を⑯ブランチにコミットして停止する。
