# 09 到達事実API 実装報告

## 変更点

指定の `../minecraft-bot` で、master `04abbea` から `isg/09-reachable-2026-10-10` を作成して実装した。

公開APIに `api.reachableFacts({ worldState, goals=[], maxMs=1000, signal }={})` を追加した。返り値は共通の `{ ok, data, error }`。worldState省略時は独立した完全observeを行い、実行cacheには公開しない。木の種類などのフィルター・集約は行わない。

- factsはinventory、カテゴリ、装備、nearby、設備、世界状態等の到達キーを全部返す。現在成立するキーはinitial=true / round=0。生成キーには初めて追加された走査周回と行動名を記録する。
- source（initial/action/computed）とderivedFromも返す。computedは依存キーの生成元を引き継ぐ。現在のスキーマにはcomputed定義がないが、対応するオフライン試験を追加した。
- goalsは既存の解析・加算目標処理を使用し、possible / unreachable / unknown / invalidを入力順で返す。unreachableだけprovenImpossible=true、届かなかったキーをmissingKeysに返す。
- durationMs、observationMs、preparationMs、closureMs、observationComplete、complete、timedOut、rounds、actionCountを返す。
- 中断はCANCELLED。時間切れは成功Resultの部分結果で、未発見を不能と断定しない。観測や計算の開始前に期限が切れればfacts=[]、目標はunknown。

`reachability.js` の既存reachableに任意のメタデータ収集を追加した。通常plan/evaluateGoalsと同じ閉包・同じ行動順・同じ存在条件を使う。新APIは⑦の共有計画workerで実行し、行動の所有権を取得しない。初期状態にあるが行動定義に登場しない葉のキーは結果に追加するが、既存閉包の種には追加しない。GOAPが従来直接確認していた初期キーの扱いと整合させ、evaluateGoalsの閉包は変えていない。

計画・コスト・行動定義・環境知識・自動生成・数量削減・再計画は変更していない。公開契約・使用例・限界は `doc/planner_bot/API.md` に記載した。

## オフライン試験

Node v24.2.0、Minecraft 1.20.1、全3177行動。

新規試験 `tests/offline/reachable09.test.cjs` は5/5合格。数量・負の条件を無視すること、初期値、行動順に従う周回数、最初の生成元、computed、動的な初期在庫と装備、木・作業台・鉄鉱石を含む入力、GOAPの目標形式、不能キー、引数不正、時間切れ・中断を検査した。

GOAPのOperationManager所有者を保持した状態で、別のworker計画と新APIの期限切れ・中断を重ねた。所有者の置換・abortはなく、タイマーは進み、後続呼出しも正常に完了した。これはオフラインでの所有権・worker連携試験であり、ライブで採掘や移動が成功したという意味ではない。

`tests/study09/verify.cjs` では④の9状態×30目標を実際にevaluateGoalsで評価し、新APIと照合した。

| 既存evaluateGoals | 件数 | 新API |
|---|---:|---|
| plannable | 130 | 全件possible |
| unplannable / relaxed_unreachable | 101 | 全件unreachable、missingKeysあり |
| unevaluated / iteration_limit | 39 | 全件possible。不能とは断定しない |

食い違い0/270。入力の変更0。保存済みgoldenや④⑤の元resultsは更新していない。

## 到達キーと時間

各状態で準備後にgoals省略で20回測定した中央値（270組の照合はgoalsあり）。closureMsにはworker内のfacts構築・閉包・結果整形を含む。API全体はworldState指定で、観測時間0。イベントループ遅延はmain threadでmonitorEventLoopDelay（resolution=1ms）の最大値。重い別テストを同時実行していない。

| 保存済み状態 | キー数 | 周回数 | closure中央値 | API全体中央値 | 最大イベントループ遅延 |
|---|---:|---:|---:|---:|---:|
| flat-empty | 218 | 6 | 7.76ms | 8.82ms | 15.84ms |
| flat-stocked | 228 | 5 | 8.54ms | 10.10ms | 15.77ms |
| flat-underground | 137 | 5 | 6.85ms | 7.54ms | 15.60ms |
| natural-empty | 414 | 8 | 18.72ms | 20.35ms | 16.91ms |
| natural-stocked | 414 | 7 | 12.35ms | 14.18ms | 16.16ms |
| surface-empty | 450 | 8 | 12.55ms | 14.15ms | 15.14ms |
| surface-stone | 414 | 6 | 10.64ms | 12.25ms | 15.70ms |
| surface-iron | 384 | 5 | 8.29ms | 9.89ms | 14.57ms |
| underground-stone | 497 | 6 | 9.44ms | 11.56ms | 15.64ms |

例：flat-emptyのinventory.category.logはround=1、auto_gather_log_category_barehand_x1由来。inventory.stickはround=1、auto_hand_craft_stick由来。nearby_workbenchはround=1、move_to_workbench由来。これらは行動をまだ実行していない存在条件の閉包であり、現在の在庫ではない。初期在庫・設備があれば同じキーはround=0となる。

「持ち物なし・木だけ見える」の小さい合成入力では65キーを返した。原木カテゴリ・棒・作業台への目標はpossible、鉄インゴットはunreachable。観測カテゴリに木・基本石・鉄鉱石がある入力では鉄インゴットもpossibleとなった。

## 観測込みの時間とイベントループ

surface-emptyの保存済みブロックをblockAtで返す模擬botに対し、**本体のStateManager.observe**を使った。観測範囲は既定の60。未記録セルはairとしたので、ライブ通信・チャンク配信の測定ではない。各モード独立のbot/cacheで、初回・同位置・Xを1移動・移動後同位置の順に1回ずつ測定した。domainは準備済み。

| モード | 状態 | 全体 | 観測 | 閉包 | 最大イベントループ遅延 |
|---|---|---:|---:|---:|---:|
| observeのみ | 初回 | 1447.97ms | 1447.97ms | — | 36.44ms |
| observeのみ | 同位置 | 214.78ms | 214.78ms | — | 15.70ms |
| observeのみ | 1ブロック移動 | 214.50ms | 214.50ms | — | 15.09ms |
| observeのみ | 移動後同位置 | 148.92ms | 148.92ms | — | 15.70ms |
| reachableFacts、worldState省略 | 初回 | 1349.23ms | 1334.35ms | 12.88ms | 15.36ms |
| 同上 | 同位置 | 214.95ms | 198.22ms | 13.95ms | 16.20ms |
| 同上 | 1ブロック移動 | 244.90ms | 229.94ms | 12.98ms | 15.37ms |
| 同上 | 移動後同位置 | 185.18ms | 170.89ms | 12.05ms | 15.72ms |

worldState省略の4件すべてでobservationComplete=true / complete=true、450キーを返した。大きい停止の追加はこの測定では見られないが、各状態1回のオフライン測定から厳密な遅延上限や改善は断定しない。観測の比重が大きいため、毎回の候補列挙には同じobserve結果を渡す使い方が適している。

## 回帰・再実行

- `npm test`：274/274合格（新規5件を含む）。
- `node --test --test-concurrency=1 tests/study04/*.test.cjs`：9/9合格。
- `node tests/study09/verify.cjs`：270/270一致。測定結果を `tests/study09/results.json` に保存した。再実行は `.cache/minecraft-bot/09-study/verification.json` へ出力し、コミット済みresultsを上書きしない。
- `node tests/study05/matrix.cjs B .cache/minecraft-bot/09-study/matrix-B.json`：270組×旧版/本体×2回の1080測定がすべて合格。旧成功130組の計画配列全体・コスト・探索回数を維持し、成功計画の再生も合格。証明済み不能101組は探索0回、未解決39組は従来の探索回数・理由を維持。入力変更0。
- `git diff --check`：合格。

## 限界・終了状態

roundは行動順に依存する走査の周で、最短手数ではない。最後の変化なしの周もroundsに数える。生成元は完全な計画や因果グラフではない。数量・消費・負の条件を無視するため、possibleでもA*・実地実行の成功は保証しない。

unreachableは今の観測と行動モデルについての不能であり、観測外の資源を含む本当の不能とは区別できない。observationCompleteは完全observeが返ったことだけを表し、全チャンクの読込・全世界の把握を保証しない。

初回共有domain準備には完了待ちと転送・採用があり、maxMsや中断の返却が遅れる場合がある。準備済みでも入力転送・結果整形を含む厳密な実時間保証はない。閉包自体はworker内で期限・中断を確認し、返却後にこの要求の閉包を続けない。

ライブ試験は任意のため実施していない。サーバー・ワールド・Minecraftクライアントは起動も変更もしていない。`../isg/server-isg`（25568）、`../minecraft-bot-stable`、`../minecraft-bot-07`、他のプロジェクトには触れていない。masterへのmerge・pushはしていない。報告をコミットして、この段階で停止する。
