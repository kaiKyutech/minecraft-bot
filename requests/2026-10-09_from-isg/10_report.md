# 10 地形API 実装報告

⑩のM1を実装した。`../minecraft-bot` の `master`（876cbe6）から `isg/10-terrain-2026-10-10` を作成して作業した。masterへのmerge・pushは行っていない。`../minecraft-bot-stable`、`../minecraft-bot-07`、isg用server-isg（25568）は使用・変更していない。

## 変更

`createBotApi(bot).observeTerrain({radius=64,step=1,maxMs=1000,signal})` を追加した。radiusは0〜128、stepは1〜32の整数。通常の `{ok,data,error}` で返す。OperationManagerの所有権を取得せず、移動・GOAPを停止しない。

中心は呼出開始時の足元の床座標。正方形の格子を北から南、西から東の一次元配列で返す。各セルは `[groundY,groundNameId,topY,topNameId,fluidY,fluidNameId]`、名前は共通辞書 `names` のindex。未読込・未処理の列はnull。読み込み済みの空だけの列は `[null,0,null,0,null,0]`。

地面は衝突分類boundingBox=blockの最上部から植物・葉・原木・幹・根・雪層等を除いたもの。土、砂、grass_block、石、氷、雪ブロック、建築用の板・屋根は含む。最上部はair/cave_air/void_airだけを除く。water/lavaは地面とは分け、最初に見つかった流体とその下の地面を返す。植物が水面にあってもtop/水面/湖底を区別する。詳細な除外条件、stepによる範囲、各フィールドはAPI.mdに記載した。この分類をGOAPの環境知識には適用していない。

チャンクのgetBlockStateIdとbot.registryを使い、blockAtのブロックオブジェクト生成を避けた。走査・キャッシュからの投影・未読込列の処理も約2msごとにsetImmediateで処理を譲る。botごとの最大512チャンクのLRUキャッシュで、ブロック更新は該当列、チャンクload/unloadは該当チャンクを無効化する。respawnでリセットし、endでイベント購読を解除する。

maxMsに達したらok:trueの途中結果（timedOut、pending、unknownRatio）を返す。完了列だけでなく走査途中の列も再開できる。signalはCANCELLED。走査中にworld/次元が変わればBOT_NOT_READYとして、混在した次元の格子を返さない。返却配列・名前辞書は呼出しごとに独立する。

本体の追加は `planner_bot/src/planner/terrain_observation.js` とAPI入口の1メソッド。既存observe/observeFast/GOAP/行動生成には手を入れていない。画像・色・マス目・方角の判断は実装していない。

## オフライン・回帰

- 最終 `npm test`：279/279合格。既存のgoldenは更新していない。
- `node --test --test-concurrency=1 tests/study04/*.test.cjs`：9/9合格。
- ⑤B：9状態×30目標=270組、2反復。既存基準との全計画・コスト・探索回数・失敗分類、およびpairedの計画全体が一致。130組の成功を含む。照合元のmatrix-B/golden/resultsは変更していない。
- 新規 `tests/offline/terrain10.test.cjs`：5/5合格。実際の1.20.1 prismarine-chunkを使い、木の下、草、雪層、スイレンの上の水、溶岩、崖、負の高度、空だけの列、未読込、負座標、step、更新・load/unload・respawn・移動、同時呼出し、返却値の分離、中断・時間切れと再開、実行所有権の維持、全未読込の格子でもyieldすること、途中の次元変更を検査した。

確認の要約は `tests/study10/verification.json`。⑤Bの全反復rawはローカルの `.cache/minecraft-bot/10-matrix-B.json`、ログは同フォルダの `10-*.log` に保存した。

## 時間とイベントループ

Node v24.2.0、step=1、maxMs=10000。coldは地形キャッシュを空にした初回、warmは同じ位置、move-1はX方向へ1ブロック移動。各条件1回（warmは2回）。monitorEventLoopDelayのresolution=1ms、別の1ms intervalでもheartbeatの間隔を保存した。遅延はOSのスケジュール・タイマー精度・GCを含み、API内の同期処理時間だけではない。短いwarm窓の最大値には特にタイマー精度が影響する。

### 全列既知の模擬地形

| 半径 | cold | warm（2回） | move-1 | 最大遅延（4条件の最大） | JSONサイズ |
|---|---:|---:|---:|---:|---:|
| 32 | 52.0ms | 3.7 / 2.1ms | 4.8ms | 13.1ms | 80.7KB |
| 64 | 110.1ms | 6.6 / 5.8ms | 7.4ms | 13.7ms | 316.7KB |
| 96 | 235.4ms | 9.7 / 9.8ms | 11.1ms | 15.1ms | 708.2KB |

coldは約110万／433万／970万状態IDを読む。warmは読み取り0件、4225／16641／37249列を再利用する。1ブロックの移動では新しい境界列だけを読む。rawは `tests/study10/benchmark.json`。

### 自然ワールドの専用コピー

停止中の不変バックアップ `../isg/server-natural/world-05-base` を、このリポジトリの `.cache/minecraft-bot/10-study/server/world` にコピーした。サーバー設定も専用コピーのみを変更。25569 / RCON 25579、view-distance=8、simulation-distance=6。jarは既存の1.20.1を絶対パスで起動。測定時の中心は(-5,69,16)、map取得時はphysicsを止め、コピー内だけrandomTickSpeed=0、昼・晴れとした。移動・GOAP試験ではphysicsを戻した。

| 半径 | cold | warm（2回） | move-1 | 最大遅延（4条件の最大） | JSONサイズ |
|---|---:|---:|---:|---:|---:|
| 32 | 55.4ms | 2.9 / 2.8ms | 3.3ms | 12.0ms | 78.7KB |
| 64 | 177.2ms | 9.5 / 6.9ms | 6.0ms | 11.2ms | 313.7KB |
| 96 | 280.3ms | 11.3 / 11.7ms | 19.7ms | 15.8ms | 714.0KB |

すべてcomplete=true、unknownRatio=0。読み込まれていない列を追加ロードする処理はなく、view-distanceが小さければ範囲外はnullになる。

## 格子の実地照合

半径96の取得範囲はX=-101〜91、Z=-80〜112。最高の地面は **(72,118,-60)、grass_block**、topも同じ。近い水面は **(-4,62,12)、water**、その下の地面は **Y=60、dirt**。水の列は4095列だった。

最高地点、水の例、木の葉が最上部の4列、計6列について、独立したblockAtの最上部からの走査でtopの高さ・名前が一致し、ground/fluidの実ブロック名も一致した。RCONのexecute if blockでサーバー側のground/topも確認した。例の全データとserverConfirmedフラグは `tests/study10/live-results.json` のsamplesにある。

## 歩行・GOAPとの並行

連続取得は各呼出し完了後100ms待ち、半径96・maxMs=1000。coldを含めて歩行／GOAPと同時に開始した。実行窓のmonitorEventLoopDelayはresolution=10ms。

| 操作 | 地形取得 | 呼出数 | 実行結果 | 最大遅延 / p99 |
|---|---|---:|---|---:|
| 歩行 (-4.5,16.5)→(5,16) | なし | 0 | arrived、水平距離7.93減少 | 21.3 / 18.8ms |
| 同じ歩行 | あり | 9 | 同じ地点へarrived、水平距離7.93減少 | 23.8 / 22.3ms |
| 在庫の板から棒4 | なし | 0 | 302ms、成功、棒4 | 19.6 / 19.6ms |
| 在庫の板から棒4 | あり | 1 | 619ms、成功、棒4 | 16.1 / 16.0ms |
| 空の在庫から原木4 | あり | 433 | 75.39秒、成功、実物の原木8 | 113.3 / 102.4ms |

歩行中の地形の最長返却時間は540msだが、mainを連続540ms占有していない。地形だけのcold/warm窓は最大15.8ms、歩行・棒作成の並行窓は最大23.8msだった。原木採集では⑦で報告されたような100ms超の既存実行由来の遅延が残り、50ms達成とはしない。原木の取得数8は既存GOAP/採集の動作としてそのまま記録した。

棒作成の実行時間は並行時に増えている。短い操作にcold走査を重ねることによるCPU/GC/観測の競合を含み、実行速度が改善したとはしていない。先に地形をwarmにする／取得間隔を調整することができる。rawにはGOAP実行時間と観測ループのdrainを含む全窓時間を分けて保存している。最終値は基準ワールドをコピーし直した再試験による。採集GOAPの開始・計画・step開始／成功・終了の進捗も保存した。

## 残る制約

- 地面の分類は決めた衝突・名前・material基準による。人工物を自然地形と区別せず、waterlogged固体の内部の水、地下の水・溶岩、洞窟断面、液面の小数高さは返さない。
- 格子全体は単一時点のsnapshotではない。走査中に更新された列は再走査するが、採用済みの列の後の変更は次回。移動中の中心は開始時に固定する。
- coldの返却時間と最大停止時間は別。全走査は分割したが、GC・Mineflayer/pathfinder・OS由来の停止を取り除いたわけではなく、全状況で最大50msを保証しない。JSON.stringifyは呼出し側の同期処理で、大きな格子を頻繁に文字列化するならその負荷も別に考慮する。
- maxMsは厳密な返却時刻の保証ではない。上限内の配列paddingと後処理、128読み取りごとの予算確認、yield後のスケジュール遅延がある。
- 毎回格子を投影する時間も予算を消費する。maxMsが極端に小さい場合、既に走査済みのprefixの投影だけで予算に達し、繰返しだけでは完了しない場合がある。完了にはmaxMsを増やすかstep/radiusを調整する。途中の縦走査の進捗自体はキャッシュに残る。
- 各条件1〜2回の測定なので、統計的な速度比・停止時間の非増加は断定しない。長い同期走査を新設せず、観測単独のタイマーと実際の歩行・GOAPの継続を検証した。

## 再実行・終了

```powershell
npm test
node --test --test-concurrency=1 tests/study04/*.test.cjs
node tests/study05/matrix.cjs B .cache/minecraft-bot/10-matrix-B.json
node tests/study10/benchmark.cjs
./tests/study10/live.ps1 -ResetWorld
```

ResetWorldは専用サーバー内の前回worldをworld-saved-日時へ移して保存し、停止中の基準コピーから作り直す。サーバー起動・ローカル接続が許される環境で実行する。25569/25579に別サーバーがいれば中断する。最初のsandbox内の起動試行はローカル接続EACCESで失敗し、Javaも終了していた。権限を切り替えた正常試験の数値のみを採用した。

専用サーバーはsave-all→stopで正常停止し、Javaの終了、全dimensionの保存ログ、25569/25579のポート解放を確認した。RCONの秘密値は文書・テスト結果・コミットに含めていない。API.md、実装、テスト、結果、この報告を指定ブランチにコミットし、指示どおりここで止まる。
