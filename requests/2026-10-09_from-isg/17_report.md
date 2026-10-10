# 17 目標実行中の松明挟み込み

作業日：2026-10-11（JST）。⑯ `59757e14e77be7591d09ff0fcce9532591779244` から指定ブランチ `isg/17-interject-2026-10-11` を作成した。

`api.interject('placeTorch', params, {signal})` を追加した。元の目標のcontrollerをabortせず、同じ計画・採集カウンタから再開する。デモ当日の変更を小さくするため、許可する動きはplaceTorchだけ。歩行・掘削・クラフトを途中で強制キャンセルする方式は採用せず、安全な区切りで待つ。

## 1. 実装

| ファイル | 変更 |
|---|---|
| `planner_bot/src/api.js` | 新しいinterjectの入力検査・許可一覧・Result |
| `executor/operation_manager.js` | 元のgoalが所有する1件の挟み込み、停止・drain・装備復元 |
| `executor/interjection.js` | 明示した安全な区切りの内部フック |
| `executor/goap_executor.js` | step前/計画終了の区切り、前提確認と衝突時の既存replan、進捗 |
| `skills/gather.js` | ブロック間・接近完了後・最終掘削後の区切り。completedを保持 |
| `doc/planner_bot/API.md` | 新API、呼び出し例、所有権・待機・進捗・失効 |
| `tests/offline/interject.test.cjs` | 新しい15試験 |
| `tests/study17/` | 専用サーバー・ライブ計測・既存matrix実行・秘密値検査 |

既存executeGoal・planGoal・evaluateGoals・prepareGoal・executePreparedGoal・placeTorchの既定の引数・Result・中断規則は変更していない。GOAPの計画探索、コスト、行動定義、⑯の準備モジュールも変更していない。interjectが呼ばれない場合は区切りのフックがnullを返し、追加の待機・観測・計画を行わない。

元のOperationManager entry/controller、executorのcurrentPlan/stepIndex/planId、gatherのcompleted/attempts/対象回避を保持する。発行済みnative動作の完了後に既存placeTorchを呼び、視線は既存placeTorch、手の装備は挟み込み側で復元する。採集は次の対象を読み直し、掘削前に既存の道具再装備を行う。採集済みのブロックを最初から数え直さない。

**1秒以内にはできていない。** 掘りかけ・クラフトの作用や残る歩行Promiseを放置せず、実際の完了を待つ設計を優先した。今回の素手原木では区切りまで約3秒待つ。gatherの長いx8スキル全体を待つ必要はなく、1ブロックの掘削完了後に挟める。その他のスキルは原則step完了まで待つ。長いgotoや精錬では待機が長くなる。

## 2. 前提衝突・失敗・停止

挟み込み後の次のGOAP stepで、従来のrefreshとanalyseStepPreconditionsを使う。成立していれば同じ計画を続ける。成立しなければFailureGuardに記録し、既存replanを呼ぶ。false要求が既にtrueになった既存の逆転前提は、従来どおりskipする。補助計画の不成立は既存の補助回復経路へ返す。

将来の全stepの前提を一括検査しない。前のstepの効果で成立する条件を誤って不足扱いしないため、順に検査する。torch消費による次stepの不足は追加試験でreplanを確認した。採集内部ではtorchを要求する前提を持たず、現在の対象と道具を確認して同じスキルを続け、次stepで通常のGOAP前提を再確認する。

設置失敗はinterjectのResultだけへ返し、元のgoalは続く。待機中/実行中の重複はINTERJECT_BUSY、一覧外はINTERJECT_NOT_ALLOWED。拒否・開始前abortで元のgoalを止めない。受理後のinterject signal、goal signal、stop、bot終了、新しい物理操作はgoal全体を止める。発行済み作用をawaitしてからCANCELLEDを返す。区切りへ到達する前にgoalが停止/終了した待機要求も解放する。

挟み込み要求の受理時に未実行の⑯handleを無効にする。在庫・装備・周囲が変わり得るため、従来の物理APIと同じ方針。既に実行中のprepared goalは保持する。candidateは⑯同様に保持し、次のprepareで最新factsを確認する。実モジュールを使う追加試験とライブでprepared実行の継続を確認した。

進捗は元のoperationIdとsequenceを共有する。interject_startにkind/boundary/planId/stepIndex/waitMs、interject_endにResultとwaitMs/durationMs/totalMs/resume、interject_resumeにmodeを出す。same_planは継続、replanは前提衝突、repair_subplanは補助計画の回復。gather内部はcontinuation=same_skill。実際の再計画では従来のreplanイベントと新しいplanIdを出す。

## 3. isgの呼び出し

```js
const running = api.executePreparedGoal(handle, {
  signal: currentGoalController.signal,
  onProgress(event) {
    // interject_start/end/resume、step、replanを同じoperationIdで追う
  }
})

// 暗くなったら。currentGoalControllerをabortしない。
const torch = await api.interject('placeTorch', { placement: 'auto' })
if (!torch.ok) console.log(torch.error.code)
const goalResult = await running
```

executeGoalの実行中も同じ呼び方。成功dataは通常のplaceTorchと同じ。signalを指定する場合、受理後にそのsignalをabortするとgoal全体も止まる。単に挟み込みを取り消す用途には使わない。元のgoalがなければ通常のplaceTorchとして実行する。通常api.placeTorchを直接呼ぶ従来の置換動作は維持した。

## 4. 回帰結果

| 検査 | 結果 |
|---|---|
| `npm test` | 333/333成功（既存318＋追加15）、fail/cancel/skip 0、116.7秒 |
| `node --test tests/offline/interject.test.cjs` | 15/15成功 |
| `node --test --test-concurrency=1 tests/study04/*.test.cjs` | 9/9成功 |
| 1.20.1 matrix | 270/270、⑯と完全一致 |
| 1.21.4 matrix | 270/270、⑯と完全一致 |

| 版 | success | relaxed_unreachable | iteration_limit | actions |
|---|---:|---:|---:|---:|
| 1.20.1 | 142 | 101 | 27 | 3177 |
| 1.21.4 | 153 | 73 | 44 | 3805 |

行動順・skill・全params・cost・diagnosis・private failure・iterationsを従来の版別基準へ完全照合し、main/worker一致、計画replay、入力不変も確認した。⑭のmatrixソース/基準/入力は変更せず、⑯と同じVMラッパーで出力先だけ17-studyへ変えた。1.21.4のdifferences欄は1.20.1基準との差で、⑯/1.21.4からの差ではない。

追加15試験は歩行/掘削/クラフトの発行済みPromiseの完了待ち、所有者・装備・planId/cursor維持、設置失敗、stop/goal abort/interject abort/end、待機中の停止、重複/開始前abort、前提衝突replan、既存skip、採集途中の数保持、公開APIの許可一覧/idle fallback/Result、実preparedモジュールの継続と未実行handle失効を確認した。歩行・クラフトの物理動作はofflineの模擬Promise試験。ライブは実際の採集・設置で確認した。

## 5. 1.21.4ライブ

`../isg/server-isg-1214` を `.cache/minecraft-bot/17-study/server-1.21.4` へ新しくコピーし、25569 / RCON 25579だけで起動・接続した。専用コピー内のY=21の暗い地下試験場で、原木を素手で集める長いgoalの最初の掘削開始から100ms後に要求した。松明設置前のblock/sky/levelはすべて0、dark=true。設置マスがtorchになったこと、在庫が4→3、元のcontrollerがabortされないことを確認した。GPU/LLM等は使用していない。

| 経路 / 目標 | 区切り待ち ms | 要求→設置確認 ms | 要求→挟み込み終了 ms | 終了→次の掘削開始 ms | goal全体 秒 | 結果 |
|---|---:|---:|---:|---:|---:|---|
| executeGoal / log:8 | 3022.3 | 4031.6 | 5050.1 | 371.7 | 40.0 | 松明・goal成功、replan 0 |
| executePreparedGoal / log:4 | 2993.2 | 4052.1 | 5102.9 | 352.3 | 34.2 | 松明・goal成功、replan 0 |
| executeGoal / log:2、松明なし | 3257.3 | — | 3257.9 | 374.4 | 12.9 | ITEM_NOT_FOUND、goal成功、replan 0 |

「設置確認」はnative placeBlockが完了し、設置先の実ブロックを確認した時刻。挟み込み終了には視線・手の装備復元も含む。再開後の測定は同じgatherスキル内の次のnative dig入口。3ケースとも計画がgatherの1stepだけなので、次のGOAP step_startは存在しない。そこを0msと報告していない。

開始在庫の原木は2。最初の2ケースの既存計画はgather x8で、実際に8ブロックだけ掘り、終了在庫10。log:4でもx8を選ぶ既存のバッチ計画は変更していない。松明なしlog:2の既存計画はx3で、3ブロック・終了在庫5。挟み込み前の1ブロックを重ねて掘り直したりcompletedを減らしたりしていない。offlineでは開始5＋指定3＝8も検証した。

最初の地上屋根付き試験でも所有権/継続は成功したが、APIのskyLightが15だったため暗所確認として採用せず、上記地下試験で測り直した。証跡はignoredの `.cache/minecraft-bot/17-study/live-1.21.4.json` とログ。初回証跡はlive-first-1214.json。秘密値は保存/出力していない。

専用サーバーはRCONのsave-all/stopで停止し、記録した専用PIDの終了と25569/25579の解放を確認した。元の25568/25566へ接続していない。stable/07/11にも触れていない。デモ当日の範囲を優先し、1.20.1ライブは省略した（270組の照合は実施）。

## 6. 残る制約

- 1秒以内の挟み込み開始/設置は保証しない。長い歩行・クラフト・精錬はstepの安全な区切りまで待つ。今回の実測は原木であり、鉄・ダイヤ採集、長い歩行中のライブは未実施。
- placeTorchの既存の最大8候補・設置の待機・視線復元時間は変えていない。今回約1秒で設置を確認し、その後の復元を含めると約2秒だった。
- 衝突が後のstepにある場合は、そのstepへ来て検出する。挟んだ位置が将来の経路を妨げない保証も従来placeTorchと同じ。
- 相対数量の既存retry/replanで再加算される可能性、legacy executeGoalの空計画の無条件完了、⑯報告の採掘/道具問題は修正していない。挟み込みでgoalを最初から作り直すことはなく、通常継続では同じ数量計画を保持する。
- isg側の暗さ判定・呼び出し実装は変更していない。新APIを組み込む必要がある。JEV・GPU・LLM・H2O-Lightning・subs-llmapiは使っていない。

API.mdと本報告を含めてコミットして終了する。masterへのmerge・pushは行わない。
