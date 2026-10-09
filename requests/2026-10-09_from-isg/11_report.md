# ⑪ moveToward の停止調査・修正報告

- 日付: 2026-10-10（JST）
- 開始点: master `876cbe6`
- 作業: `../minecraft-bot-11`、`isg/11-move-2026-10-10`
- 結果: 岸から北への移動、下り斜面、水中の移動が進むことを確認。停止した探索/実行は `no_progress` で早く終了する。

## 原因

経路探索が水を全面的に禁止していたわけではない。修正前も北 `(8,76,-28)` に対し約39msで `path_update.status=success`、28ノードの経路を返した。しかし最初の段差で、forward/jump/sprint が有効なのに座標がほぼ変わらず、繰り返しジャンプや path_reset:stuck が起きた。

主な問題は、Movements が返す斜めの上り下りと、pathfinder のダッシュジャンプ実行/物理予測の組合せ。北行きの最初の斜め上り `(13.5,69,1.5)`、湖への下りの斜め段差など、探索上の候補をそのまま実行すると角で衝突して進めない。正面の段差だけにした試作でも、ダッシュが有効な上りは止まった。正面の段差と上り直前の歩行切替を組み合わせると進んだ。下りも水平以外の斜め移動を除くと湖へ到達した。

この切り分けは接続済みのフォークの `lib/movements.js`、`lib/physics.js`、`index.js` と実際の座標/制御状態に基づく。Minecraft サーバー側と mineflayer の個々の物理式の不一致までは修正しておらず、今回の変更は moveToward の経路候補と実行モードで回避する。

従来の moveToward は goto の完了か呼び出し期限を待つだけだった。成功した経路を実行できずに止まっていても、goto が継続するので `timeout` になり、呼び出し側は進行中と停止を区別できなかった。

追加で、水面では pathfinder が床座標+1を使って `goal_reached` を発行する場合がある。従来のラッパーは完了後の床座標だけを再判定しており、実際には到着しても `no_path` と返すことがあった。自分の goal に対する到着通知を保持するようにした。

イベントと液体落下の仕様は [pathfinder の公式文書](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/readme.md) も参照した。実装判断は手元の依存フォークで確認している。

## 変更

- `planner_bot/src/navigation/move_toward.js` 内だけで Movements を派生し、斜めは同じ高さの候補を使う。上り下りは既存の正面方向の段差/ジャンプ/落下候補を使う。
- 実行経路の次の点が足元より0.5ブロック以上高いときはダッシュを抑える。空中では抑えた状態を維持し、平地に着地すればダッシュを戻す。全移動を歩行に固定しない。
- 100ms間隔で実座標を監視。水平0.75ブロックまたは垂直1.5ブロックの変化を進展とし、迂回・後退も数える。同じ位置での小さな跳ねは進展に数えない。
- 成功経路があるのに800ms進まなければ1回だけ歩行で再探索。その後2秒進まなければ `no_progress`。成功経路がまだない場合も2秒進まなければ `no_progress`。
- 掘削/設置のための待機を考慮。掘削は現在の `bot.digTime+1500ms`（最低2秒）、設置は2秒の猶予。その後も止まれば終了。呼び出し期限が先なら従来通り `timeout`。
- 自分の goal の `goal_reached` を保持し、水面の到着通知を尊重する。
- 返り値の既存フィールドと Result/CANCELLED を維持。追加は reason の `no_progress`、data の `pathStatus`（最終の探索状態、更新前null）と `walkingRetry`（歩行での再探索の有無）。タイマーと追加イベント購読は到着・道なし・期限・中断・例外の後処理で解除。
- 公開API文書と8件の移動回帰テストを追加。

GOAP の計画・コスト・行動定義、自動生成、既存 gotoCoords 等の実装、依存パッケージは変更していない。土/丸石の足場、水への落下、泳ぎ、掘削は pathfinder の既存能力を使う。

## 再現と比較

`../isg/runs/world-snapshot-2026-10-10` を⑪専用サーバーの world にコピーした。Minecraft 1.20.1、peaceful、ボット1体、range=3。25570 / RCON 25580 のみを使用した。サーバーは Java を Hidden で独立起動し、終了時に RCON `save-all` → `stop`。保存完了と両ポート停止を確認済み。

専用サーバーの保存先は `.cache/minecraft-bot/11-server/`（既存ignore内）。node_modules は指定worktreeから元リポジトリの依存へのジャンクション。依存のインストールや書き換えは行っていない。

各ケース開始前にclearとtpを行い、土のケースだけ64個付与。3秒×10回は同じ位置から連続呼び出しとし、途中でteleportしない。その他は開始位置に戻す。整数のRCON tpは中心へ移すので、岸の実座標は `(14.5,68,2.5)`、斜面は `(32.5,78,-13.5)`。この岸セルには足元の草ブロックがあるため、正常に地表上に立てる `(13.5,68,2.5)` も別に比較し、旧版は20秒timeout/約0.20ブロック、最終版は1.77秒arrived/約7.60ブロックだった。埋まり込むtp位置だけで発生する現象ではない。

下表の距離は既存の `distanceReduced`、すなわち目標への直線距離の減少量。歩いた経路の総延長ではない。到着はpathfinderの床座標/到着通知に従うため、実座標の endDistance がrangeを少し上回る場合もある。

| ケース | 修正前 | 修正後 |
|---|---|---|
| 北 `(8,76,-28)` 3秒×10 | 全10回timeout、ほぼ停止 | 1回目11.42、2回目11.11ブロック進み、3回目2.35秒でarrived。以降到着済み |
| 同じ北、30秒 | 30.01秒timeout、0.34ブロック | 7.83秒arrived、29.26ブロック |
| 土64、北3秒×10 | 全10回timeout、ほぼ停止 | 1回目11.85、2回目12.07ブロック、3回目1.55秒でarrived |
| 土64、北30秒 | 30.03秒timeout、0.34ブロック | 7.55秒arrived、29.30ブロック |
| 北 `(8,-28)` 高さなし、20秒 | 20.02秒timeout、0.20ブロック | 7.30秒arrived、27.65ブロック |
| 湖方向 `(14,-8)`、20秒 | 20.02秒timeout、0.20ブロック | 1.85秒arrived、6.98ブロック |
| 南 `(14,12)`、20秒 | 1.88秒arrived、6.60ブロック | 2.30秒arrived、6.54ブロック（別実測1.93秒） |
| 北東山頂 `(40,98,-28)`、20秒 | 20.02秒timeout、0.48ブロック | 20.01秒timeout、41.19ブロック進展。追加の60秒予算では21.79秒arrived、46.26ブロック |
| 斜面 `(32,78,-14)` → 湖 `(-14,63,-1)`、20秒 | 20.02秒timeout、1.51ブロック | 最終到着判定修正後16.94秒arrived、47.32ブロック。水中サンプル8件 |

上り/下りを修正した一括実測 `after.json` は水面到着通知の修正前に採ったため、最後の斜面行は移動47.87ブロック/15.40秒だがreasonがno_pathだった。最終版の該当行は `water-arrival.json` の再実測に置き換えて比較している。`comparison.json` は各行の参照元を明示する。

追加の専用区画で比較:

| 条件 | 修正前 | 修正後 |
|---|---|---|
| 開けた平地、目標へ19ブロック接近、各3回 | 3.427 / 3.399 / 3.409秒 | 3.421 / 3.405 / 3.403秒 |
| 岩盤で囲まれた到達不能区画 | 7ms no_path | 38ms no_path |
| 物理実行を停止して座標が変化しない模擬実行側停止、予算6秒 | 6.03秒timeout | 2.04秒no_progress、進展0 |

最後の行は自然地形の到達性試験とは分けた停止判定の制御実験。no_progressは到達不能の証明ではない。

## 検証と再実行

- `npm test`: 最終版282件（新規8件を含む）、失敗0。
- `node --test --test-concurrency=1 tests/study04/*.test.cjs`: ④の調査テスト9件、失敗0。
- `node tests/study05/matrix.cjs B .cache/minecraft-bot/11-verification/matrix-B-11.json`: 270組×2反復×baseline/production。成功130組を含め、全計画・コスト一致、不能判定・反復数・入力非破壊を検証。
- `git diff --check`: 通過。

ログとB照合の完全データは `.cache/minecraft-bot/11-verification/`。秘密を含むserver.propertiesやサーバーのworld/logはコミット対象に含めない。

コミット対象の実測は `tests/study11/`。`live.cjs` が指定ケース、`controls.cjs` が平地/道なし/模擬停止、`compare.cjs` が比較の集約。修正前は876cbe6のmoveTowardだけをVMで読み、公開APIから呼ぶ。通常の旧版/新版比較では同じ依存とワールドを使っている。

専用サーバーを上記コピー/ポートで起動してから、⑪worktreeで以下を実行できる。

```powershell
$env:MOVE_BASELINE='1'
node tests/study11/live.cjs before
Remove-Item Env:MOVE_BASELINE
node tests/study11/live.cjs after
$env:MOVE_CASE='slope-west'
node tests/study11/live.cjs water-arrival
$env:MOVE_CASE='northeast-peak'
$env:MOVE_MS='60000'
node tests/study11/live.cjs peak-60s
Remove-Item Env:MOVE_CASE
Remove-Item Env:MOVE_MS
node tests/study11/controls.cjs
node tests/study11/compare.cjs
```

valid-shore の補助実測は `MOVE_CASE=lake-10`、`MOVE_START=[13.5,68,2.5]`。移動前のterrain、機器負荷や到着付近の水面の上下で時間・末尾座標は変動する。ワールドを新規コピーしてから再実行する。

## 残る制約

- 北東山頂は20秒では着き切らないが、継続して進み、長い予算で到着した。進んでいるtimeoutは従来通り正常な途中移動。
- no_progressは約2秒の観察に基づく判断。重い/未完の探索、実行障害、狭い地形等でも返るため、呼び出し側はpathStatusと距離を見て次の目標/再試行を選ぶ。数学的な到達不能判定ではない。
- 斜めに高さを変える候補を使わないため、斜め段差だけの狭い経路を選べなくなる可能性がある。水平の斜め移動、通常の正面段差と水中移動は維持。GOAPと他の移動APIにはこの変更を適用していない。
- 足場の新しい方式、垂直の泳ぎ、pathfinder本体の物理修正は今回追加していない。既存の下り水面/泳ぎで今回の湖移動を確認した。
- 時間予算後の既存の掘削drain/後処理は引き続き待つ。no_progressの時刻は厳密な全体終了期限ではない。

masterへのmerge/pushは行っていない。⑩のcheckout、25569、isgの25568、および minecraft-bot-stable / minecraft-bot-07 は変更/起動/停止対象にしていない。専用サーバーを停止し、報告をコミットして作業終了する。
