# ⑮ 評価計画の再利用・動作を継続したまま計画を準備する調査

実施日：2026-10-10（JST）。調査基準：master `a5ef2616ac3ab8e15645321073ea35e32fce520a`。
指定どおり同じ `minecraft-bot` フォルダで `isg/15-reuse-plans-2026-10-10` を作成した。
README.md、15_reuse_plans.md、API.md、07_report.md、14_report.mdを読み、本体・テスト・行動定義は変更していない。

## 1. 結論

**評価計画の再利用は有効。ただし、plan配列を無条件に実行器へ渡すだけでは足りない。推奨は「評価結果の計画を保持 → 旧動作を続けながら必要な準備 → 準備後に操作権を引き継ぐ」という、新しい明示的な実行経路。**

- 自然地形・domain準備済み・評価との競合なしでは、最初のstepイベントまでのp50は1.20.1で252ms、1.21.4で380ms。スキル入口までは341ms、543ms。
- 30目標の評価を先にworkerへ送ると、作業台のstep開始までp50は1,213ms、2,843ms。新しいplan要求の配送・先行要求待ちがp50で1,017ms、2,576msを占める。A*をworkerに移しても、操作権取得後に待てばボットは止まる。
- 2秒の移動後に評価の計画を直接実行した代表9目標は、両版9/9成功、step_failureは0。スキル入口までのp50は49ms、69ms。ただし制御区画・材料あり・各1回で、自然地形の旧API計測との速度比ではない。
- 歩行中は状態が毎回変わり、前後とも計画可能だった組の全plan一致は0。それでも手順（action/skill/params）は1.20.1で30/42、1.21.4で28/46組が同じ。状態・距離コストの完全一致を再利用条件にしない方がよい。
- 材料不足や必要な道具不足は既存の補助目標で回復できる。一方、空の計画の後に成果物を失うと、既存実行器は未達でも成功を返す。Boolean目標がすでに達成済みでも古い非空計画は追加作成する。この2点には再利用経路の確認が必要。
- 数値目標の「現在在庫に追加」と、途中の再計画で再び現在在庫に加算する挙動は既存仕様。今回これを変更する提案とは分ける。

## 2. 試験の範囲・条件

CPU：Intel Core i7-12700F、Node v24.2.0、Java 21。GPU、viewer/ブラウザ、LLM、JEV、H2O-Lightning、subs-llmapiは起動していない。isg本体は実行せず、`src/loop.mjs`とtriggersの読み取りで呼び出し順を確認した。

サーバーはこのrepoの `.cache/minecraft-bot/15-study/` に専用コピーを置き、25569 / RCON 25579だけで、1.20.1 → 1.21.4 → 1.20.1補足の順に起動した。同時起動はしていない。

| 版 | コピー元 | 起動先 | 起動 |
|---|---|---|---|
| 1.20.1 | `../isg/runs/world-snapshot-2026-10-10b`（world内容） | `server-1201/world` | vanillaの1.20.1 jar・properties・eulaをコピーして使用 |
| 1.21.4 | `../isg/server-isg-1214` | `server-1214` | コピー内のfabric-server-launch.jar |

設定変更はコピー内のserver-port/query.port/rcon.port/level-name等だけ。コピー元の設定・ワールドは変更していない。1.21.4のコピー時、使用中の `world/session.lock` は読めなかった。コピー先は独立したロックで起動できたが、元が稼働中のファイルコピーなので、全ワールドの原子的なスナップショットだとは主張しない。
25566/25568には接続していない。`minecraft-bot-stable`、`minecraft-bot-07`、`minecraft-bot-11`には触れていない。

観測は通常の完全observe。STATE_SCAN_RANGEは未設定（既定60）、範囲・カテゴリ・数量・探索上限200・コストは変更していない。自然地形の測定点は(-4.5,69,16.5)、ロード済みの観測一覧は434,650ブロック。制御区画は(2000.5,201,2000.5)付近のbedrock床、原木・石と必要時に作業台・かまどを配置。材料は各試行の前にRCONで供給・clearした。再利用9目標では途中のgiveはしない。初期の1.20.1通常実行の床は61×46、その他は61×61なので、この表から版だけの速度差を推定しない。

代表目標（すべて `inventory.` 接頭辞）：category.log:1、category.plank:4、crafting_table:1、wooden_pickaxe:1、stone_pickaxe:1、cobblestone:1、furnace:1、torch:4、iron_ingot:1。

一時スクリプトは `.cache/minecraft-bot/15-study/` だけに置いた。通常実行を時間計測するため、プロセス内だけで関数の入口・出口をラップし、workerにも同じ測定ラップを入れた。探索・結果・スキル引数はそのまま。古い計画の試験だけは、未公開の `executePlanWithReplanning` を通常のOperationManagerとsignal/progressの文脈内で呼んだ。これは新APIの実装や、現行公開APIによる再利用の成功を意味しない。

時間はperformance時計。p50/p90は昇順のceil(n×p)番目、各試行1件を1標本とする。並行測定・少数回・状態の異なるワールドなので、全デモの分布や厳密な改善率へ一般化しない。測定ラップの微小な費用も含む。

## 3. 停止時間の内訳

### 3.1 現行の呼び出し順

`src/api.js:65` のexecuteGoalは、最初にOperationManager.runへ入る。`operation_manager.js:75` で旧要求をinterruptし、旧処理の終了とcleanupを待つ。その後、`goal_runner.js`がrefresh/getState、domain準備、道具準備の判断、必要なら道具の補助目標、rootのplanを行う。

`goap_executor.js:55` の通常計画のstep_startは、各stepのrefresh・前提検査**より前**。スキル入口までの時間も測らないと、見た目の停止を過小評価する。補助計画のexecuteSimplePlanでは逆にrefresh/前提検査の後でstep_startを出すため、イベントだけで全経路を同一視できない。

isg側でも、`loop.mjs:128` は評価結果からgoal/estimatedMs/stepsだけを保存し、planを捨てている。`start():424` は旧controllerをabortしてから、`runGoal():479` がexecuteGoalを呼ぶ。コメントの「seamless switch」と実際の呼び出し順は一致していない。ライブラリだけを変えても、isgが先にabortする限り準備中の継続はできない。

### 3.2 自然地形、評価との競合なし

9目標×3巡。最初の原木試行をcoldとして除外し、warmは各版26件（原木2件、他8目標各3件）。自然地形は最初のスキル関数に入った時点で測定用signalをabortし、物理作用を発行しない。CANCELLEDはこの測定の意図した結果で、実行成功率に含めない。道具準備が必要な目標では、最初のstep/skillは補助目標のものを含む。

| 項目（ms、p50 / p90） | 1.20.1、n=26 | 1.21.4、n=26 |
|---|---:|---:|
| executeGoal → step_start | 252.1 / 350.1 | 380.0 / 603.8 |
| executeGoal → 最初のskill入口 | 340.9 / 444.4 | 543.1 / 742.9 |
| 最初のstep前のrefresh合計 | 106.3 / 219.3 | 162.8 / 346.8 |
| domain準備待ち（準備済み） | 0.3 / 0.4 | 0.2 / 0.5 |
| goap.plan全体 | 103.7 / 178.5 | 217.6 / 310.4 |
| うちmainのgatherEffort投影 | 67.9 / 91.1 | 84.5 / 105.0 |
| うちplan要求の配送・先行要求待ち | 0.3 / 0.6 | 0.3 / 0.5 |
| うちworker内のplan処理 | 29.7 / 112.8 | 119.4 / 232.0 |
| step_start後、最初のstepのrefresh | 88.4 / 122.9 | 140.8 / 191.6 |
| 前提条件分析そのもの | 0.1 / 0.2 | 0.1 / 0.2 |

項目ごとの分位点は別々なので足し算して全体の分位点にはならない。worker内のplan処理は純粋なA*だけでなく、facts・閉包・コスト準備・診断等も含む。投影やrefreshはyieldしても、GC・割当て・chunk更新・OSの待ちを完全に分離していない。1.21.4 warmの最大step待ち2,156msは最初のrefreshが1,979msを占め、通常のworker探索だけへ帰属できない。

| 目標 | n/版 | 1.20.1 step / skill p50(ms) | 1.21.4 step / skill p50(ms) |
|---|---:|---:|---:|
| 原木1 | 2 | 174 / 261 | 286 / 412 |
| 板4 | 3 | 190 / 277 | 297 / 433 |
| 作業台1 | 3 | 220 / 336 | 278 / 441 |
| 木のツルハシ1 | 3 | 205 / 309 | 369 / 556 |
| 石のツルハシ1 | 3 | 189 / 276 | 339 / 507 |
| 丸石1 | 3 | 285 / 373 | 544 / 672 |
| かまど1 | 3 | 350 / 444 | 585 / 743 |
| 松明4 | 3 | 301 / 437 | 381 / 507 |
| 鉄インゴット1 | 3 | 296 / 384 | 476 / 603 |

1.21.4の自然地形cold原木はchunk未到着でblocks=0、PLAN_NOT_FOUNDになったため、到達時間を計算しない。次の観測では一覧434,650件になった。この失敗を資源が本当にない証拠にはしない。

制御区画の通常executeGoalは各目標3回、各版27/27完了。step / skillのp50は1.20.1で48.5 / 87.2ms、1.21.4で90.2 / 124.9ms。別のcold作業台1回は、stepまで3,889 / 3,571ms、初期refresh 2,408 / 1,504ms、domain準備1,438 / 2,022ms。初回のchunk処理とdomain生成は、定常のA*時間と区別し、接続後のwarm-upで先に済ませる。

### 3.3 30目標の評価との競合

自然地形の同じ観測から30目標をmaxMs=3000/perGoalMs=400でevaluateGoalsへ送り、worker要求を送信した後に作業台をexecuteGoalする。各版3回。evaluateGoalsは予算切れならunevaluatedになる契約のまま。通常plan要求には評価のような短い全体期限がなく、共有workerの先行評価を待つ。

| 版・回 | stepまで(ms) | skillまで(ms) | plan要求post → worker処理開始(ms) | worker内plan(ms) |
|---|---:|---:|---:|---:|
| 1.20.1 / 1 | 2439 | 2525 | 2219 | 17 |
| 1.20.1 / 2 | 1213 | 1311 | 1017 | 18 |
| 1.20.1 / 3 | 1210 | 1297 | 961 | 17 |
| 1.21.4 / 1 | 2843 | 2965 | 2573 | 48 |
| 1.21.4 / 2 | 2842 | 2948 | 2595 | 30 |
| 1.21.4 / 3 | 2869 | 3017 | 2576 | 29 |

workerが同期探索中はmessage自体の受信も遅れる。従ってpost→開始には配送・workerのイベント受付待ち・tail待ちを含める。「受信後のtail待ち」だけでは競合を過小評価する。計画再利用はこの初回要求と投影を省けるが、途中の再計画には同じ競合が残る。isgログそのものの全時刻・全外部処理を再現した分解ではなく、症状を起こせるライブラリ側の経路を分離した実験である。

## 4. 評価から実行までの変化

制御区画で歩行6窓、diamond_axeを持つGOAP採集6窓を各版実施。各窓は完全observe → 30目標evaluate（3000/400ms）→ 2秒待ち → 完全observe。isgの実コードもevaluationGapMs=2000は**評価完了後の間隔**なので、開始間隔が常に2秒ではない。実測の観測前後の間隔は下表。窓同士は同じ連続活動から取ったので独立標本ではない。

後から固定した前後スナップショットに対し、代表9目標を通常のplanGoal（短い評価期限なし、探索上限200）で再計画した。各活動54組、各版108組。評価での予算切れを「計画が変わった」に混ぜない。比較は(1)action/skill/paramsの順序まで一致、(2)costも含むplan全体の一致を分ける。

| 版・活動 | 窓数 | 間隔p50/最大(ms) | 位置変化 | 在庫変化 | 装備変化 | nearby数量変化 |
|---|---:|---:|---:|---:|---:|---:|
| 1.20.1 歩行 | 6 | 2889 / 4504 | 6/6 | 0/6 | 0/6 | 6/6 |
| 1.20.1 採集 | 6 | 2482 / 3557 | 5/6 | 4/6 | 0/6 | 4/6 |
| 1.21.4 歩行 | 6 | 3685 / 5740 | 6/6 | 0/6 | 0/6 | 6/6 |
| 1.21.4 採集 | 6 | 2920 / 5031 | 5/6 | 5/6 | 0/6 | 5/6 |

歩行の位置差p50は15.6 / 18.6ブロック、採集は0.91 / 2.19ブロック。時刻は除外している。装備変化0はこの標本内だけの結果で、選択前後の道具変更一般を否定しない。

| 版・活動 | 前後とも計画可能 | 手順が同じ | 手順変更率（同左分母） | cost込み全一致 | 成功↔未発見の切替（全54組） |
|---|---:|---:|---:|---:|---:|
| 1.20.1 歩行 | 42 | 30 | 12/42 = 28.6% | 0/42 | 0/54 |
| 1.20.1 採集 | 29 | 27 | 2/29 = 6.9% | 16/29 | 6/54 |
| 1.21.4 歩行 | 46 | 28 | 18/46 = 39.1% | 0/46 | 2/54 |
| 1.21.4 採集 | 37 | 32 | 5/37 = 13.5% | 17/37 | 5/54 |

歩行では炉・石道具の計画が変わる例があり、「移動では常に同じ計画」とは言えない。⑫の距離コストで、同じ資源数でも別経路が選ばれる。古いコストは評価時の選択の根拠として残し、実行時の最安・所要時間の保証には使わない。採集の在庫増加では、不要になった材料採集が古い計画に残る場合がある。

30目標×6窓=180評価の内訳は、1.20.1歩行：plannable78/unplannable102、採集：54/96/unevaluated30。1.21.4歩行：78/89/unevaluated13、採集：64/90/unevaluated26。区画に石炭・鉄材料を置いていないので松明・鉄インゴットはこの比較の多くで未発見。これらの実行成功は別の材料あり試験で確認した。新旧ワールドやこの区画だけから、デモ全体の成功率を推定しない。

## 5. 古い計画を既存実行器へ渡した結果

### 5.1 代表9目標、各版1回

evaluateGoalsのplanを保持し、約2ブロック歩き、評価完了から2秒経ってから実行器へ渡した。観測作成から実行までの実際の計画年齢は1.20.1で2,011〜3,011ms、1.21.4で2,022〜3,616ms（初回domain準備も含む）。全18件が成功、実在庫の取得を確認し、前提失敗・再計画は0。

| 目標 | 1.20.1 skill入口まで / 完了(ms) | 1.21.4 skill入口まで / 完了(ms) |
|---|---:|---:|
| 原木1 | 87 / 6096 | 94 / 6404 |
| 板4 | 56 / 65 | 76 / 80 |
| 作業台1 | 49 / 56 | 57 / 62 |
| 木のツルハシ1 | 69 / 781 | 69 / 760 |
| 石のツルハシ1 | 44 / 760 | 57 / 777 |
| 丸石1 | 48 / 5299 | 80 / 6719 |
| かまど1 | 45 / 703 | 49 / 773 |
| 松明4 | 46 / 49 | 68 / 70 |
| 鉄インゴット1 | 53 / 10655 | 78 / 10686 |

step_startまでは全件0.2〜1.5msで、現実のスキル開始までの大半は各stepのrefreshだった。ここではrootのrefresh/投影/worker再計画を省いただけで、各stepのrefresh・前提検査は省いていない。材料・設備が用意された短い計画なので、これを自然地形で必ず50msに収まるという基準にはしない。

### 5.2 変化・失敗を入れた試験

下表のライブは各ケース各版1回（1.20.1の空計画は補足プロセス）。「必要な道具喪失」「採集途中の失敗」「恒久的スキル失敗」は人工状態で各版1回。人工試験は実domain/planner/precondition/failureGuardを使い、物理スキルだけを代替した。カテゴリの消費・出力を具体的なoak/cobble在庫へ反映して次のbuildStateで再計算する。人工10ケース/版の最終結果だけを採用し、カテゴリ在庫の反映が不完全だった初期mockの結果は採用していない。

| 状況 | 1.20.1 | 1.21.4 | 解釈 |
|---|---|---|---|
| 作業台計画、状態変化なし | 成功51ms | 成功59ms | 直接再利用できる |
| 作業台計画、20ブロック移動 | 成功56ms | 成功64ms | 手元クラフトの計画は位置変化に耐える |
| 板8→0、周りの原木は残す | 前提失敗1回→板の補助目標→成功9890ms | 同→成功6818ms | 回復はできるが、失敗の余分な費用はある |
| 原木計画、唯一の原木を消す | REPLAN_FAILED、80ms | REPLAN_FAILED、114ms | スキルを始めず不能証明。成功にはできない |
| 数値「作業台1追加」の前に作業台1を取得 | 最終2個 | 最終2個 | 正しい追加数量の契約。重複バグ扱いにしない |
| Boolean「作業台を持つ」の前に作業台1を取得 | さらに作り最終2個、45ms | 同、36ms | 前提検査はgoal達成済みを検査しない |
| Booleanの評価plan=[]、その後作業台を失う | ok:trueだが作業台0、stepなし | 同 | 空計画は古い状態の達成判定を引き継げない |
| 丸石計画の石ツルハシを木ツルハシに替える | 成功6190ms | 成功6172ms | この採集に必要なpickaxe条件は木でも満たす |
| 鉄素材計画の必須stone-or-betterを失う（人工） | 補助計画込み6スキルで石ツルハシ・raw_iron取得 | 同 | 必須道具不足の補助解決を人工確認。ライブの完全喪失は未試験 |
| 松明8、最初の4本の後にcoalを消しcharcoal4を与える | REPLAN_FAILED/iteration_limit、残り4本、652ms | replan1回、最終12本、690ms | 版別recipeと再計画時の数量加算が出る |
| 原木4、採集スキルが1本取ってから失敗（人工） | replan後最終5本 | replan後最終9本 | 再計画は現在在庫へ再度4を加える。採集単位の余剰も含む |
| 同じクラフトスキルが永久に同じ失敗（人工） | 3回目でREPEATED_FAILURE | 同 | 既存guardを捨てなければ有限で終わる |

通常計画の各stepでは、まずrefresh→現domainの前提検査。満たせなければ不足の補助目標、その後必要ならrootをreplanする。スキル実行エラーでもrefresh→FailureGuard→replan。逆転したfalse前提だけはstep_skippedになる。これは任意の「成果物をもう持つ」のスキップではない。

`precondition_checker.js` は未知のactionにも前提なしとして通す。再利用の新APIは、現行bot/version/domainから発行した計画だけを受け、action/skill/paramsの整合を確認する必要がある。単なる公開の任意配列受け取りにしない。

また実行器は全step終了後に最終goalを再検証していない。上の空計画は、既存executeGoalがfreshに計画する通常経路のバグを主張するものではなく、**再利用を追加すると顕在化する穴**。新経路には空計画・既達成Booleanの開始判定と、成功返却前のgoal確認を置く。最終確認のために数量目標やコストを勝手に変更しない。

### 5.3 残る危険

gatherの通常paramsはitemName/countで、評価resourcesのnearestPositionは参考値。実際の探索は現在の位置・環境から行うので、全候補が同じ場所へ固定されるわけではない。ただし古い計画が選んだ素材・道具・クラフトvariantは残る。不要な採集、遠い設備へ移動、消えた対象の探索、スキルの移動timeoutや失敗連鎖は起こり得る。

今回、自然地形の全障害物・未ロード・長距離資源消失の失敗連鎖を網羅していない。FailureGuardは同じ失敗3回/進展なし10回だが、位置・周囲・在庫が変わると記録が変わるので、任意の地形で厳密な時間上限を保証しない。新経路にもsignalと外側の試行時間上限を維持する。古い計画が失敗しても、rootからfreshなFailureGuardを作り直して無限にリトライしない。

## 6. 計画中に旧動作を続ける方法と所有権

既存planGoal/observe/evaluateGoalsはOperationManagerの所有権を取らず、実行中の動作を止めない。新計画を準備する段階ではこの性質を使い、`operations.run`への登録と旧controllerのabortを後ろへ移す。新しい物理操作を旧操作と並走させる案ではない。

| 実験（各版1回） | 1.20.1 | 1.21.4 |
|---|---:|---:|
| 歩行中、評価競合ありでplanGoal準備 | 2722ms中に10.86ブロック移動 | 809ms中に2.72ブロック移動 |
| 準備後の切替→新しいskill入口 | 174ms | 72ms |
| 旧GOAP採集中のplanGoal準備 | 2419ms中に原木1→3 | 885ms中に原木1→2 |
| 準備後2秒待って切替、旧GOAPの所有者 | goalのまま、原木5 | goalのまま、原木2 |
| GOAPから切替→新しいstep / skill入口 | 18 / 99ms | 584 / 685ms |

準備中の競合評価は、先に保存した自然地形の30目標の観測を使った人工的な負荷。新目標の計画にはその時点の区画の観測を使う。旧GOAPが実際に原木を1本取ったのを待ってから測定した。切替前に旧controllerを外からabortしていない。切替後、旧API結果はCANCELLED、新しい作業台は成功。新処理の後から旧処理がpathfinderを止める例は今回出なかった。

1.21.4の584msは旧GOAPの終了待ちを含み、cleanup関数自体は約0.09ms。旧採集は引き継ぎ中に原木をもう1本取得し、最終3本になった。発行済み採掘・craft/equip等の作用は取り消せないため、drain契約は維持する。この待ちをPromise.raceで切り捨てたり、所有者を先に変えて隠してはいけない。

新しい準備要求A→B→C、stop、abort、bot.endの扱いも必要。単にrunの前でawait planGoalするだけだと、stopの後に古い準備結果が到着して実行を復活させる競合が生じる。準備要求用の世代・controllerを管理し、stopは準備と現所有者の両方を中断する。準備中のBは旧物理所有者Aを中断しないが、Cが選ばれたらBの準備を破棄し、BはCANCELLEDで返す。引き継ぎ直前と旧操作のdrain後に世代/signalを再確認する。

## 7. 推奨する実装案（未実装）

### 7.1 APIと実行経路

既存executeGoal/planGoal/evaluateGoalsの既定契約は維持し、まず新経路をopt-inにする。以下は**提案APIであり、現行コードにはない**。

```js
// 評価は通常のplanner・順序・時間予算・cacheをそのまま使う。
const batch = await api.evaluateGoals(goals, {
  worldState, maxMs: 3000, perGoalMs: 400, includePrepared: true
})
// plannableな各結果のpreparedCandidateをisg側で保持する。
const prepared = await api.prepareGoal(chosen.goal, {
  candidate: chosen.preparedCandidate, signal: pending.signal
})
if (!prepared.ok) return keepCurrentAndReport(prepared.error)
if (selectionGeneration !== latestGeneration) return
// この時点まで旧walk/GOAPを続ける。旧controllerを先にabortしない。
const result = await api.executePreparedGoal(prepared.data.handle, {
  signal: pending.signal, onProgress
})
```

prepareGoalは操作権を取得しない。executePreparedGoalが通常のOperationManagerで旧操作の中断・drain・cleanup・新所有者の設定を行う。preparedCandidate/handleはbotに紐づく短い不透明IDとし、main側でimmutableなplanコピーとgoal、観測日時、Minecraft版、domain世代/指紋、準備の種類を保持する。任意配列の無検証実行は公開しない。

候補には原観測を30回丸ごとコピーしない。古い評価回を有限件数で解放し、bot.end・domain無効化で解放する。未評価/不能/null planには実行handleを出さず、成功した空配列は別扱いにする。includePreparedを指定しない返却値は同一に保つ。

実行handleは1回の選択・準備世代に結びつけ、一度の引き継ぎで消費する。同じ候補を次の選択でも使う場合は新しいprepareGoalを呼び、数値目標の開始在庫を新しく取る。準備中に別の実行APIが所有者を置き換えた場合も、古い準備世代から勝手に実行を開始しない。

### 7.2 再利用する条件

| 変化・条件 | 提案の扱い |
|---|---|
| botのセッション、Minecraft版、domainのaction/skill/recipe/schema指紋が不一致 | 拒否、旧動作を止めず新しくprepare。異版tokenを現domainへ当てない |
| goal文字列・action/skill/paramsが発行時と不一致、token失効、abort済み | 実行しない。必要なら新しい準備要求として扱う |
| 位置、時刻、距離cost、資源数、通常の材料在庫の変化 | 全状態一致による再計画をしない。古いplanで開始し既存前提確認・補助目標・再計画を使う |
| plan=[] | 現在のgoal達成を確認。未達なら旧動作中にprepareし直す。無条件成功は禁止 |
| Boolean目標が現在すでに達成 | 不要なplanを開始しない扱いを新経路に明記。isgはcontinueとして扱える |
| 数値の成果物を既に持つ | 「実行時の現在在庫＋指定量」を維持。Booleanの既達成判定で省略しない |
| 必須の道具事前準備が残る | 下記のrunner準備経路に回す。評価planをそのままrootの完全なexecuteGoal代替とみなさない |
| 計画が古いが上記には当たらない | 年齢を記録して再利用。2秒TTLや在庫全一致を必須にしない。保持上限による失効時は準備を旧動作中に行う |

`goal_runner`の道具事前準備・数量削減・補助目標・循環/深さ制限は、evaluateGoalsのroot planそのものに全部含まれるわけではない。再利用APIから内部executorへ直行してこれらを省く実装は避ける。

最初の実装ではrunnerの読み取りだけの前半を抽出し、現在のinventory/equipmentから既存buildPickaxePreparationGoalsで必須準備を確認する。準備なしなら評価root planを採用する。準備がある場合は、同じplannerで**最初の道具補助目標の計画**を旧動作中に用意し、既存のrunner文脈・共有FailureGuardで開始する。その後は既存のrefresh→残る道具準備→root計画の順へ戻す。道具を作った後に元の評価rootを無条件実行すると、rootに残る道具作成を二重に実行し得るので避ける。

この段階では「道具準備後のroot計画も全部事前に済む」とは約束しない。仮想的な採集数量・材料消費・位置を予測して全prefixを合成する最適化は別段階にする。GOAPの計画・コスト・行動定義の変更は不要。

成功返却前には、実行時の開始在庫から解決したgoalを最新factsで確認する。未達の空計画を成功にせず、同じ実行のguardとsignalの中で既存の再計画へ戻す、または明示的な失敗を返す。初期goalの固定は確認用であり、solverの目標調整や現行の再計画の加算を変更するものではない。固定絶対目標へ全retryを変える案は既存動作を変えるので、別承認の提案として残す。

### 7.3 isg側の変更

- 評価の保存時にgoal/estimatedMs/stepsだけに縮めず、対応するcandidateと観測日時・評価回を保持する。選択肢の表示と実行計画の関連を切らない。JEV等は今回実行していない。
- `start`での旧controller.abortを削り、新選択はpendingとして準備する。ctx.currentとpendingを分け、準備失敗なら旧currentを継続する。準備完了かつ最新選択ならexecutePreparedGoalで切り替える。
- 旧finishが遅れて到着しても新current/pendingを消さない。世代またはoperationIdで照合する。人のstopはpendingのprepareも中断する。
- 本物の再計画時だけfreshな計画・コストへ更新する。評価時のestimatedMsは古い見積もりとして表示し、実際の資源位置を保証する文言にしない。
- 準備済みdomainを接続後にwarm-upする。背景評価を重複して無制限に積まない。

### 7.4 worker待ちの残件と実装順

1. 評価candidate保持、prepare/execute分離、runnerの初期計画受け取り、空計画/既達成確認、世代管理を一緒に実装する。通常executeGoalはそのまま残す。
2. 途中の再計画待ちが問題なら、呼び出し側が期限付き背景評価を中断・drainしてから再計画を優先する方式を追加検討する。workerのtailは1本なので、初期plan再利用だけでは全再計画待ちは消えない。
3. 優先待ち行列・評価の分割・別workerは別途測定して判断する。別workerはCPU/メモリ/domain複製費用を増やす。evaluateGoalsの入力順・予算・perGoalMsを暗黙に変える修正や、mainへの重いA*フォールバックは今回の初手にしない。

実装場所は既存のapi.js、goal_runner.js、goap_executor.js、operation_manager.jsを中心とし、handle保持が必要なら小さいprepared_goalモジュールをexecutorに置く。plannerの大規模な再分割や生成YAMLの手書き化はしない。置かれた板・設備を資源として使う動作も維持する。

実装依頼で確定させる細部は、handleの保持件数/時間上限、終了時goal未達を既存再計画へ戻すか専用の失敗Resultにするか、既達成Booleanをisgがcontinueとして扱う返却形。推奨は有限の保持、同じguard内の回復、alreadySatisfiedを準備結果として通知する形。いずれも今回の調査では実装していない。旧APIの数値retryを絶対目標へ変更するかどうかは、この3点とは別の仕様判断である。

## 8. 270組の照合と実装時の合格条件

既存 `tests/study14/matrix.cjs` を、そのソース・期待値・テスト入力を変更せず実行した。VM内の一時コピーで出力先だけ15-study/matrixへ振り替え、⑭のローカル出力を上書きしない。

| 版 | 各版の期待値との照合 | 成功 | relaxed_unreachable | iteration_limit | actions |
|---|---|---:|---:|---:|---:|
| 1.20.1 | 270/270完全一致 | 142 | 101 | 27 | 3177 |
| 1.21.4 | 270/270完全一致 | 153 | 73 | 44 | 3805 |

両版ともmain/worker完全一致、成功計画replay、入力不変のassertionに合格。失敗0。

基準は1.20.1が⑫後/⑬のbaseline-1201、1.21.4が⑭expected-1214。版同士が同じ結果であることを要求するのではない。各版の基準に対しplanの順序/action/skill/全params（craftingRecipeの形状・材料を含む）/各cost・総cost・diagnosis・failure理由/証明/iterationsを完全照合する。main/workerのResultとprivate failure情報、成功計画のreplay、入力不変も検査する。

将来の実装でもこの540組を変更せず通す。evaluateGoalsのcacheキー、距離/障害費、カテゴリ、recipe、閉包、A*上限200は据え置く。古い計画を実行する新経路ではfresh planと同じ経路を選ぶことは要求しないが、同じ入力をfreshに計画した270組の結果は変えない。

新経路に追加する検証：同じsnapshotのevaluate→preparedのstep配列完全一致、2秒移動/在庫・装備・資源変更、空plan後の喪失、既達成Booleanと数値追加の区別、runner道具準備/数量削減/補助目標/循環、途中失敗の共有guard、誤版/誤bot/改変token、A→B→C/準備中stop/abort/domain worker失敗、dig/craft中のdrain、古いcleanupが新所有者を止めないこと。両版で初動のstepイベントとskill/最初の物理作用までを別々に測り、旧動作の位置・在庫進捗と最大の連続停止も測る。今回の測定値だけで50ms保証は置かない。

本調査ではnpm test全303件の再実行はしていない。コード変更のない調査なので、対象のライブ・人工状態・両版270組を検証範囲とした。⑭の303件成功を今回実行したものとして数えない。

## 9. 証跡・再現・終了

一時スクリプト：profile.cjs / worker-profile.cjs（計測のみ）、live.cjs（timing/latency/drift/stale/reuse/empty/handoff/stop）、artificial.cjs、matrix.cjs、summarize.cjs。すべて `.cache/minecraft-bot/15-study/`。raw JSONは各mode-版.json、前後の観測はdrift-版-活動-番号.json.gz、集計はsummary.json。サーバーフォルダとpropertiesには秘密値があるため、丸ごとのログ出力やgit addはしない。

再現は専用コピーを25569/25579で起動してDoneを確認してから、例として `node .cache/minecraft-bot/15-study/live.cjs 1.20.1 timing` を実行する。modeをlatency/drift/stale/reuse/handoffへ替える。handoffとstaleの並行負荷はlatencyが保存したnatural-版.json.gzを使うのでlatencyを先に行う。各モード終了後にbot退出を確認し、次のモードを開始する。版を変える前に `node .cache/minecraft-bot/15-study/live.cjs <版> stop`（save-all→stop）でJava終了・ポート解放を確認する。artificial/matrixはサーバー不要で版ごとの別Nodeプロセス。

主要rawのSHA256（15-study内、matrixだけサブフォルダ）：

| ファイル | SHA256 |
|---|---|
| timing-1.20.1.json | aa5bcb1b704abb325b18574e7403adb1c50d58e8c87181fdff39ffa9c8c9fc58 |
| latency-1.20.1.json | f61fc2c142392d77764ac859135919570eb39dfcc91e3c5215bc3750883bb5d2 |
| drift-1.20.1.json | d238a2772e4910d44acf6ef5e333f99056c41735d4019b9d24865138ad76839b |
| stale-1.20.1.json | 45730d55cf8e5adf90631be80af25ebba9461ed2bd88368b99df284d3f97fd7b |
| reuse-1.20.1.json | 82faba71090b7bc28c24d6eba50a2e3ce8326903a962330275ab14759bd44fe4 |
| artificial-1.20.1.json | abac676d1c55b8a43212de006537d72194a6ea201732c60e040a0da4fbdafcb3 |
| handoff-1.20.1.json | 7d02794b5b3ecbcec46fd5e6b4838e145db36bcaf088ea33ebed485cd7df6895 |
| timing-1.21.4.json | 382a7f682d20c5d3c524bf45b4feef7f1d751d379d0e01902982a9b385806678 |
| latency-1.21.4.json | 7b7b7a330dd6deddc0a9f4571850527cc1703f2d802fd46dc009683a2bb56932 |
| drift-1.21.4.json | 05921e72eec7390771f0b58fdc94aa35c334c907badbe0ee44a15d4c3e9fd3e5 |
| stale-1.21.4.json | 5ee03ccee57c0dd54ab11619cfdfd0a89964447395732a4af70a0c1fc781a418 |
| reuse-1.21.4.json | 59da79777fb38708397807ce50b07affed61bbe5846c1335f24a1009ac507986 |
| artificial-1.21.4.json | b258f91a33efcda6b3891e770e9040943af87f534b67d80cb7fba96ff9a9d58b |
| handoff-1.21.4.json | 811ea454fa98ab5dea486297377079e5e165cd6605ab77ec7a4fc71d5ae94f21 |
| empty-1.20.1.json | 2170a903761473d2cad1a84ca4e986f8246151f72520a53d1bdda2b2e0b7eddd |
| matrix/matrix-1.20.1.json | 91273bdcd47497a19afb4e7cabcce7211221c77f872302ad7fa09aad845aaa3d |
| matrix/matrix-1.21.4.json | 19ce8372ccc7647d1f4fab0bdc6467793eecf498865d0fdf2a91d0819e8e2976 |

rawと一時スクリプトはignoreされたローカル証跡で、今回のコミットはこの報告だけ。別checkoutへこの文書だけを渡した場合、rawは付属しない。コミット対象のコード・テスト・golden・fixture・.gitignore・依存はa5ef261と同一であることをgit diffで確認した。

秘密値について：設定確認のマスキング不備により、ツールの確認出力にRCON秘密値の一部を出してしまった。値自体はこの報告・測定JSON・一時スクリプト・コミットには含めない。パスワードの変更は行っていない。

終了：1.21.4は2026-10-10 23:01:19 JST、最後の1.20.1補足は23:05:19 JSTに全dimension保存・RCON Listener停止を記録。各Java PIDの終了と25569/25579の待受なしを確認した。botも退出済み。本報告を指定ブランチへコミットし、masterへのmerge・pushをせず停止する。
