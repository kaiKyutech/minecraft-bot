# 05 G → A → B 実装報告

## 完了したこと

指定順でG、A、Bを実装し、段階ごとにコミットした。Gは `da4488c`、Aは `3a17162`。Bはこの報告を含む最後のコミット。

- **G**：原木4個の自然スポーン付近5試行は **0/5 → 5/5**、実際の回収は各8個。同じ復元ワールドの3地点×3目標は **3/9 → 6/9**。旧成功の脱落は0。詳細は `05_report_G.md`。
- **A**：270組すべてで旧版と計画全体・コスト・探索回数が一致。70件のgoldenは変更せず合格。状態署名・effect索引・依存表の再利用で計画を高速化した。
- **B**：成功130組の計画・コスト・探索回数を維持。閉包で不能と証明できる101組はA*の探索0回。残る39組は200回上限の未解決として区別した。
- 標準テスト **221/221**、調査テスト **9/9**。並行実行のライブでもG、G+A、G+A+Bの全段階で原木8個の回収を確認した。

ブランチは `isg/05-implement-2026-10-09`。C・D・E・F・H・Iは実装していない。masterへのmerge/push、stable worktree、25568のisg用サーバーには触れていない。

## Aの変更

`state_operations.js` に、計画1回だけで使う署名関数のfactoryを追加した。再帰的なキー順・配列・undefined等の表現は既存と同じ。探索ノードの不変な共有部分をWeakMapで再利用する。**各計画で新しいキャッシュ**を作り、観測APIの可変入力や別の計画との共有キャッシュには使わない。既存の `serializeState` は通常の内容ハッシュ用として残した。

`heuristic.js` は、アクション配列をキーとするWeakMapでeffectキー→アクションの索引を再利用する。アクションの順序・貢献判定・前提コストの合計は変更しない。`relevance.js` は準備済みschemaの依存表を再利用する。

並行計画テストでは2種類のスナップショットから28目標を同時に計画し、goldenとの完全一致と入力不変を確認した。APIの観測・計画と実行の所有権分離、キャンセル、従来の道具準備等の標準テストも維持した。

## Bの変更と公開契約

03の `reachable` を通常の `goap.plan` にも適用した。すべての行動と初期状態から、数量・消費・負の条件を無視した存在条件の閉包を作る。必要な存在条件がその過大近似でも得られない場合だけ早期診断する。初期状態に正の値があるが行動のキーには登場しない項目を、誤って不能としない検査も追加した。

閉包で排除できない目標は従来と同じA*を使う。GOAPのnearby等の知識を減らす変更、行動追加、探索上限の引上げ、ヒューリスティック倍率変更はしていない。

runner・再計画も同じ判定を使用する。道具準備は従来の位置に残す。証明済み不能では、存在条件を解決できない数量削減・補助計画の再試行を省いて終了する。探索上限だけの場合は従来の数量削減・補助目標を維持する。FailureGuard、中断、診断・不足目標の共有情報も維持した。

公開メソッドの名前・引数・Result形・成功時の `{ plan, diagnosis }` は変更しない。内部では失敗結果をWeakMapで分類し、評価キャッシュにも分類を別途保持する。既存のdiagnosisやgoldenに分類フィールドを混ぜていない。

`planGoal` の未発見codeは既存の `PLAN_NOT_FOUND`、再計画失敗は `REPLAN_FAILED`。既存detailsに以下を保持する。

| reason | provenImpossible | 意味 |
|---|---|---|
| relaxed_unreachable | true | 与えられた観測・行動モデル内で証明済み不能。iterations=0 |
| iteration_limit | false | 200回の探索で未発見。不能の証明ではない |
| frontier_exhausted | false | 現行探索の候補枯渇。閉包による証明とは区別 |
| invalid_goal | false | 形式・目標名が不正 |

detailsにはgoal、iterations、maxIterationsも入る。補助目標で失敗した場合は、その目標と既存のgoalChain等を確認できる。

`evaluateGoals` は、証明済み不能だけ `unplannable / relaxed_unreachable`。探索上限は `unevaluated / iteration_limit`、候補枯渇は `unevaluated / frontier_exhausted`、時間予算中断は従来の `unevaluated / budget_exceeded`。探索上限時の診断は返すが、その診断を不能の証明とはしない。時間予算中断はcacheせず、200回まで探索した結果は分類とともにcacheする。`timedOut` は時間予算中断がある場合だけtrue。

以上を `doc/planner_bot/API.md` に記載した。証明は現在の観測・モデルについてのもので、観測外の資源や実地の到達性を保証しない。

## 270組の照合と計画時間

④の9スナップショット×30目標を使用した。各組で旧版と改修版を2回ずつ実行し、2回目は順序を逆転した。計画配列全体を対応する旧版と比較し、④の記録に対してaction列・コスト・探索回数を照合した。成功計画は本体の前提条件・効果で再生し、追加量の目標達成を検査した。入力の変更は0。

旧版は `eab3cca` のGOAP・heuristic・relevanceを保存したVM。状態操作の既存関数・ドメイン・目標解析は共通。④の保存済みresultsや元の70件goldenは上書きしていない。従来の調査テストを再実行できるよう、旧ソースを `tests/study04/fixtures/` に固定した。

Node v24.2.0 / Minecraft 1.20.1。domain準備・入力ロード・再生は計画時間の外。**Bの閉包は通常のplan呼出し内で毎回計算し、計画時間に含めた**。測定中に別の重いテストを同時実行していない。表の合計は270組の各2回の中央値の合計、p95はその270値の順位統計。

| 比較 | 成功数 | 合計 | 中央値/組 | p95/組 |
|---|---:|---:|---:|---:|
| Aの対照旧版 | 130 | 64.42秒 | 111.25ms | 1161.61ms |
| A | 130 | 34.85秒 | 45.83ms | 711.86ms |
| Bの対照旧版 | 130 | 67.09秒 | 110.71ms | 1279.87ms |
| A+B（閉包込み） | 130 | 31.54秒 | 19.61ms | 758.48ms |

Aは対応する対照に対して合計約46%短縮。A+Bはその対照に対して約53%短縮。AとBは別の測定なので、異なる対照の時間を同じ実行の数値として扱わない。

旧版の失敗は129組の200回上限＋11組の候補枯渇。Bでは101組を証明済み不能として0回で返し、39組が200回上限のまま。全270組の探索回数合計は **27,564 → 9,553**。成功130組の探索回数合計1,753は同じ。

詳細データ：`tests/study05/matrix-A.json`、`matrix-B.json`。productionのソースハッシュも保存した。集計は `performance.json`。

## 実行中のobserve＋evaluateGoals

Gで保存した `../isg/server-natural/world-05-base` へ各回復元し、自然サーバー25567/25577だけを使用した。新しい名前・clear・(-4.5,69,16.5)へのtp、原木4個の目標、120秒期限を共通にした。

isgと同じ20目標に対して、3秒間隔で完全observe＋evaluateGoals（maxMs=800）を呼び、10秒間隔でworldState省略のplanGoal(stick:4)も並行した。開始前にdomainと評価をwarm-upし、監視にはNodeのmonitorEventLoopDelay（10ms）を使用した。GPU・visionはこの比較では使っていない。

GとAは固定コミットを `.cache/minecraft-bot/05-study/runtime-*` にGit archiveして、**その版のbot/API/runner一式**から起動した。checkoutやstable worktreeは使っていない。A+Bは今回の本体。別の重いベンチマーク・テストは並行させず、各回終了後はsave-all/stopと全dimensionの保存・プロセス終了を確認した。

| 指標 | G | G+A | G+A+B |
|---|---:|---:|---:|
| observe＋evaluateの呼出し数 | 13 | 13 | 14 |
| 合計時間の中央値 | 2.484秒 | 2.632秒 | 2.881秒 |
| 合計時間の最大 | 7.321秒 | 6.983秒 | 7.288秒 |
| evaluate単体の中央値 | 448ms | 390ms | 378ms |
| observe単体の中央値 | 1.843秒 | 2.350秒 | 2.293秒 |
| イベントループ遅延の最大 | 879ms | 678ms | 859ms |
| 原木の実行完了時間 | 77.31秒 | 77.88秒 | 77.41秒 |
| 回収した原木 | 8 | 8 | 8 |

評価単体には短縮が見られたが、**observeを含む全体と最大停止が改善したとは判断できない**。観測の比重が大きく、約0.86秒の停止は残る。worldState省略のplanGoalも独立観測を含み、A+Bで中央値3.21秒・最大8.93秒だった。通常の計画だけを速くする今回の改修で、観測全体の遅さを解決したとは報告しない。

またevaluateGoalsには03から閉包があり、Bは主に通常の計画・runnerへの適用と分類の正確化である。Bだけで評価APIが大幅に速くなる設計変更ではない。

各版1実行、実行中に状態が変わる時系列の測定。呼出しごとの観測は同一入力ではなく、統計的な効果の断定には使わない。rawデータは `tests/study05/concurrent-{G,A,AB}.json`。最初に他の試験が並行した予備計測は集計から除外し、再測定したデータを保存した。

## テスト・再実行

- G標準213件、A標準215件、B標準221件が合格。最終の不足情報共有の修正後にもBの専用6件を再実行して合格。
- `node --test --test-concurrency=1 tests/study04/*.test.cjs` はA/Bで各9件合格。
- A/Bのmatrixはそれぞれ270組×旧版/本体×2回＝1080測定。すべて検証を通過し、旧成功130組の脱落は0。
- API形、cacheの外部変更からの分離、28計画の並行、予算・中断、証明済み不能時のrunnerと再計画、既存の補助処理・FailureGuardを検査した。

```powershell
npm test
node --test --test-concurrency=1 tests/study04/*.test.cjs
node tests/study05/matrix.cjs B

# 比較用ワールドが停止中・保存コピーがある環境で、順番に実行する
./tests/study05/live.ps1 -Phase G -Cases @(0) -Concurrent
$env:STUDY_RUNTIME_REF = '3a17162'
./tests/study05/live.ps1 -Phase A -Cases @(0) -Concurrent
Remove-Item Env:\STUDY_RUNTIME_REF
./tests/study05/live.ps1 -Phase AB -Cases @(0) -Concurrent
node tests/study05/summarize-performance.cjs
```

Aのmatrixを再実行する場合はAコミットの本体で `node tests/study05/matrix.cjs A` を使う。B本体では不能組の探索回数が意図的に変わるため、Aの完全一致条件を適用しない。④のraw記録を分析し直す `analyze.cjs` で今回の結果を旧resultsへ上書きしない。

## 残る問題と終了状態

Gの低い開始地点 (10.5,63,3.5) は3目標とも120秒中断のまま。Gで候補は変わるが、移動時間切れが続く。A/Bでその地形上の問題は改修していない。深い目標の39組も200回上限のままで、不能と断定していない。

最後の自然サーバーは正常停止した。`world-05-base` は残し、現在のworldは最後の計測後に保存された状態。実行中の計測用bot・viewerは残していない。

依頼されたG/A/Bと報告を完了したので、ここで止まる。
