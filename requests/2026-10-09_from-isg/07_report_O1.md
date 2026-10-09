# 07 O1 実装報告

作業場所は `../minecraft-bot-07`、ブランチは `isg/07-nonblocking-2026-10-09`。42ac72bから作成し、⑥のcheckout・stable・master・isg用25568には触れていない。merge/pushはしていない。

## 実装

- botごとのブロック名/座標キャッシュを追加。初回は完全に読み、blockUpdate、chunk load/unload、移動時の境界部分を差分更新する。respawnでリセット、endでイベント購読を解除する。
- observeと実行中のrefreshが同じ生ブロックキャッシュを使う。実行用の公開cache・世代・観測の所有権は従来どおり別に管理する。
- 実座標からの球・高度範囲・air除外・カテゴリ・フラグ・一覧の順序を維持する。整数距離のbucketに旧x/y/z訪問順で入れ、従来のstable sortと同じ並びを作る。環境の知識を減らしていない。
- キャッシュ同期完了時点の完全なデータから返却する。返却用集計中の更新は次回へ持ち越す。変更のたびに集計を再開始すると採掘中に観測が終わらないため、この一時点のスナップショット方式にした。
- 初回/境界走査と返却用集計は約2ms単位でyieldする。signal/期限で未完の走査を中断したら、未完データは公開せず次回に全走査する。STATE_SCAN_MAX_CHECKSの有限prefix指定は元scannerを使う。observeFastも短い単位でyieldする。
- 公開APIの名前・引数・返却形、GOAP本体と行動定義は変えていない。

## 正しさ

オフラインで、位置の小数・同距離の順序・移動・大きなteleport・blockUpdate・chunk load/unload・respawn・並行観測・返却値変更の分離・中断回復・有限prefix・非整数rangeを検査した。保存済みsurface-emptyスナップショットでも元StateManagerとworldStateを比較し一致した。

ライブはworld-05-baseをworktree内の.cache/minecraft-bot/07-study/serverへコピーし、専用25569/25579で行った。元の自然サーバー/バックアップを書き換えていない。4条件それぞれで、実行開始前だけphysicsを止め、元の全走査と、初期状態・原木設置・撤去・1ブロック移動後の4点を比較した。nearby_blocks、nearby、blocks（全一覧と順序を含む）、在庫counts、装備等が全16点で一致。初期一覧は約434,454ブロック。

- npm test：228/228合格（既存70件のgoldenを更新せず維持）。
- ④調査テスト：9/9合格。
- tests/study07/matrix.cjs O1：⑤matrix-Bの270組に対し、全計画配列・コスト・探索回数・失敗分類を照合。④/⑤の保存済み記録は上書きしていない。

## 実行中の計測

毎回world-05-baseへ復元、新しいbot名、持ち物clear、(-4.5,69,16.5)から開始。isgの20目標、maxMs=800、observeFastは15秒おき。visionは省略。monitorEventLoopDelayのresolutionは10ms。実行signalの期限は120秒だが、発行済み操作のdrainを待つ従来契約のため、返却までの時間はこれを超え得る。

| 目標 | 評価間隔 | 呼出し数 | observe中央値 | evaluate中央値 | 遅延max / p99 | 実行時間・結果 |
|---|---:|---:|---:|---:|---:|---|
| 原木4 | 連続 | 285 | 107ms | 151ms | 566 / 336ms | 120.50秒、CANCELLED |
| 原木4 | 完了後3秒 | 18 | 745ms | 405ms | 591 / 164ms | 75.11秒、成功 |
| 石のツルハシ1 | 連続 | 386 | 126ms | 225ms | 548 / 272ms | 166.81秒、CANCELLED |
| 石のツルハシ1 | 完了後3秒 | 22 | 215ms | 319ms | 553 / 162ms | 80.93秒、成功 |

**O1だけでは最大50msの目安を満たしていない。** 同期計画が残る。原木試験に加えたGC記録では最大29ms（連続）/159ms（3秒間隔）もあった。大量の完全一覧の割当て負荷も残る。原木の連続試験では原木を4個取得していたが、計画された採集の完了まで進まず、APIの成功とはしていない。

05の3秒間隔の記録（observe中央値2.293秒、遅延max859ms、原木77.41秒）と比べ、今回は観測時間が短くなった。ただし別プロセス・1条件1回・実行中の異なる状態であり、厳密な速度比や実行改善の断定には使わない。連続評価の期限到達を残件として記録し、O2で同じ条件を再測定する。

rawはtests/study07/concurrent-O1-*.json、matrix-O1.json。初期の試作測定は最終の同名ファイルで置換し、表は最終の4条件だけを使った。

## 再実行と次段階

~~~powershell
npm test
node --test --test-concurrency=1 tests/study04/*.test.cjs
node tests/study07/matrix.cjs O1
./tests/study07/live.ps1 -Phase O1 -Interval 0
./tests/study07/live.ps1 -Phase O1 -Interval 3000
./tests/study07/live.ps1 -Phase O1 -Interval 0 -Goal inventory.stone_pickaxe:1
./tests/study07/live.ps1 -Phase O1 -Interval 3000 -Goal inventory.stone_pickaxe:1
~~~

専用サーバーは各回save-all/stopで正常停止した。O1のコードとこの報告をコミットして、指示どおりO2へ進む。
