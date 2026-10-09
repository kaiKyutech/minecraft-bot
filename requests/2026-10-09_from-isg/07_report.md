# 07 O1＋O2 実装報告

⑦の作業を完了した。worktreeは ../minecraft-bot-07、ブランチは isg/07-nonblocking-2026-10-09。42ac72bから作成した。O1は34fa0a9で、07_report_O1.mdを含めてコミット済み。その後O2を実装した。masterへのmerge/push、⑥のcheckout、stable、isg用25568には触れていない。

**workerの計画は270組で全計画・診断・コスト・探索回数・失敗分類が一致。ライブ4条件すべてで目標完了。最大停止は116〜172msで、目安の50msは未達。**

## O1

詳細は07_report_O1.md。完全観測のブロック名/座標キャッシュをbotごとに共有し、blockUpdate、chunk load/unload、移動の境界部分を更新する。実座標からの球、範囲、カテゴリ、一覧の順序は維持した。observeと実行中のrefreshは同じキャッシュを使い、実行用公開cacheの所有権は分離したまま。

O1の全テスト228件、④調査9件、⑤matrix-Bの270組が合格。ライブでは全走査と16点一致したが、計画が同期のままで最大548〜591ms。連続評価の2目標は120秒のsignalで中断、3秒間隔は成功した。

## O2の実装

- プロセスごとの常設worker_threads workerにA*と評価の閉包・cache処理を移した。planGoal、evaluateGoals、runnerの計画・再計画が対象。元の探索アルゴリズム・行動順序・コスト・探索上限・診断は使い続ける。
- workerがminecraft-dataから版ごとの行動を準備する。実行の前提検査や直接getAllActions/loadDomainが使う同じ定義をメイン側へ渡す。行動生成を廃止・固定していない。
- workerにはbuildStateが使う全worldState項目をデータとして渡す。blocks.listとinventory.raw等の、計画に使わない大きな/非データの項目は転送しない。完全observeの返却を削ってはいない。資源見積もりは、全一覧を従来と同じMath.hypot/同距離の先着順で短い単位で集計して渡す。結果のresourcesとestimateDetailsも一致検査した。
- 予算は観測・準備・資源集計・待ち行列・探索を含む絶対期限で伝える。perGoalMs、入力順、cacheの内容キー/256件上限/期限切れをcacheしない規則を維持。未開始の要求が期限切れになったら共有状態のCASで開始を禁止して返す。返却後にその要求の探索を続けない。
- signalはSharedArrayBuffer/Atomicsで探索中の既存チェックから読み、応答をdrainしてからCANCELLEDを返す。planGoalにも任意のsignalを渡せる。応答配送中に届いたabortも優先する。評価/計画の中断で別の実行を停止しない。
- cacheはworker内でbotごとに分離し、end/GCで解放する。workerはidle時unrefする。異常終了はPLANNER_WORKER_FAILEDで返し、次回に再準備する。メイン側の重い探索に自動で戻さない。VERSION_CONFLICTも維持する。
- APIの名前・引数・Result/plan/diagnosisの形は維持。低レベルgoap.planはbotの実行文脈でworkerを使い、追加options.worker=true/falseで明示もできる。独立した既存呼出しのメイン側計画を照合用に残した。

変更した主な場所はplanner/incremental_blocks.js、planning_service.js、planning_worker.js、goap.js、domain.js、goal_evaluator.js、state_manager.js、fast_observation.js、src/api.js、logger.js。⑥担当のskills/primitivesは変更していない。

## 正しさと回帰

- 最終npm testは235件。70件のgoldenは更新せず維持。
- ④調査テストは9/9合格。
- tests/study07/matrix.cjs O2は9スナップショット×30目標=270組。⑤matrix-Bの計画配列全体・コスト・探索回数・失敗分類をまずメイン側と照合し、同じ入力のworkerとメイン側でplan/diagnosis全体、探索回数、private failure metadataを完全比較した。入力変更はなし。
- 新しいworker検査では、mainのtimerが探索中も動くこと、探索途中と配送中の中断、期限切れ/Infinity、版衝突、未開始要求の期限返却、cacheに時間切れを残さないこと、非データItem等の除外、最寄りの同距離選択と入力分離、異常終了後の再準備を検査した。
- ④/⑤の保存済みresults、matrix-A/B、70件のgoldenは書き換えていない。⑦のrawとmatrixはtests/study07に保存した。

## ライブの条件と同時点照合

⑥との干渉を避け、world-05-baseをworktree内の.cache/minecraft-bot/07-study/serverへコピーし、専用25569/25579を使用した。元の自然サーバー/設定/バックアップは変更していない。各回復元、新しいbot名・clear・(-4.5,69,16.5)、warm-up後に測定。

比較中に葉が1個変化する予備試験があり、異なる時点の走査を比較していた。その試験は本表に使っていない。O2の一致比較ではphysicsを止めるほか、専用コピーだけrandomTickSpeedを一時0にし、block/chunkイベントが来た比較を取り直す。初期・原木設置・撤去・1ブロック移動後の4点×4条件で全走査と一致した。比較後に元のrandomTickSpeed=3とphysicsを戻してから実行した。

実行中はisgの20目標、maxMs=800でobserve＋evaluateを連続または前の完了後3秒間隔で呼ぶ。observeFastは15秒おき、visionは省略。monitorEventLoopDelayのresolutionは10ms。各条件1回の最終値で、時系列の状態やCPU負荷が違うため統計的な速度比は断定しない。

| 目標 | 間隔 | O1遅延max/p99 | O1実行 | O1＋O2遅延max/p99 | O1＋O2実行 |
|---|---|---:|---|---:|---|
| 原木4 | 連続 | 566/336ms | 120.50秒 中断 | 126/101ms | 75.25秒 成功、原木8 |
| 原木4 | 3秒 | 591/164ms | 75.11秒 成功 | 116/100ms | 73.71秒 成功、原木8 |
| 石のツルハシ1 | 連続 | 548/272ms | 166.81秒 中断 | 147/53ms | 97.61秒 成功、実物1 |
| 石のツルハシ1 | 3秒 | 553/162ms | 80.93秒 成功 | 172/97ms | 91.26秒 成功、実物1 |

O1＋O2の観測/評価の中央値と呼出し数：

| 目標/間隔 | 回数 | observe | evaluate |
|---|---:|---:|---:|
| 原木/連続 | 126 | 110ms | 234ms |
| 原木/3秒 | 18 | 667ms | 556ms |
| 石ツルハシ/連続 | 252 | 127ms | 149ms |
| 石ツルハシ/3秒 | 25 | 244ms | 336ms |

評価の返却速度そのものが常に速くなるとは報告しない。workerのCPU・待ち行列・時間予算の影響はある。改善したのはmainの長いGOAP探索停止と、今回の連続評価で実行を完了できたこと。3秒間隔の石ツルハシの実行時間はO1より長く、実行速度全般の改善とはしない。

O1の石ツルハシ中断の166.81秒は、120秒で中断要求後も発行済み作用をdrainする既存契約による。期限を返却時刻の厳密な上限とはしていない。

## 50ms未達の理由と残件

観測の完全な一覧は初期で約43万ブロック。返却用オブジェクトの割当て/GCが残る。O2でGCの最大は、原木連続23ms、原木3秒107ms、石連続37ms、石3秒56msだった。GCだけで50msを超える試験があり、観測を小刻みにyieldしても止められない。

さらに実行にはmainのpathfinder等が残る。追加の同期呼出し計測ではgetPathToが最大約42ms、findBlocksが最大約25ms。forkのpathfinderはtickTimeout=40msで同期計算する。最大172msのすべてを個別の関数へ帰属できたわけではなく、GC・移動/採集・通信処理・OSスケジュールの寄与は未分離。**目安50msを達成したとは報告しない。**

知識を減らすための範囲/カテゴリ削減、計画結果の変更、返却値の形を変える圧縮はしていない。50msをさらに目指すなら、完全一覧の割当てと実行中の同期処理の別調査が必要。⑥との分担に従い、そのためのskills/primitives変更には踏み込んでいない。

## 再実行・終了

~~~powershell
npm test
node --test --test-concurrency=1 tests/study04/*.test.cjs
node tests/study07/matrix.cjs O2
./tests/study07/live.ps1 -Phase O2 -Interval 0
./tests/study07/live.ps1 -Phase O2 -Interval 3000
./tests/study07/live.ps1 -Phase O2 -Interval 0 -Goal inventory.stone_pickaxe:1
./tests/study07/live.ps1 -Phase O2 -Interval 3000 -Goal inventory.stone_pickaxe:1
~~~

rawはtests/study07/concurrent-O2-*.json、matrix-O2.json。GC、結果、在庫、観測/evaluate時間を保存。一部試験には読み込んだソースハッシュと同期処理時間も保存した。原木2条件は待ち行列の期限処理後に再測定して同名rawを置換。予備の失敗比較や古い原木測定は集計していない。無期限deadlineと配送中abortの最後の修正は、通常の有限予算・成功した本測定の動作を変えない。

専用サーバーは各回save-all/stopで正常終了。botはquitして残していない。O2のコード・この報告を作業ブランチへコミットし、指示どおりここで止まる。masterへmerge/pushしていない。
