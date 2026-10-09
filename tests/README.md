# 2026-10-09 特性テスト

基準：master db2b29e、Minecraft 1.20.1、Node v24.2.0。
本体の挙動を観察して固定するためのテスト。追加依存はない。01では返り値契約のみResultに移行し、ワールド作用とplanner/generator goldenは維持した。

## 実行

- `npm test`：サーバーなし。02/03の追加回帰を含む202件。約56秒（CPU負荷で変動）。
- `npm run test:known`：refresh と再計画診断を通常の回帰テストとして検証。約2秒。
- `npm run test:live`：フラット25565と自然25567を必要とする。約3分。
- `npm run test:vision`：GPU撮影、再撮影、実行中の方向競合、起動・終了失敗時の後処理を検証。GPUは依頼者の許可済み。Chromeが未配置なら起動前に PUPPETEER_EXECUTABLE_PATH を指定する。
- `npm run observe:standalone`：単一/複数botと設定なしの起動を実測。約6秒。

live は固定されたユーザー名の持ち物を clear し、許可されたテストワールドの専用区画にブロックを置く。
本番ワールドへ向けて実行しない。ポートと RCON properties のパスは `helpers/live.js` に明示してある。
パスワードは server.properties から読み、ログには出さない。
サーバーの起動と正常停止は依頼 README の手順を使う。テスト自身は起動/停止しない。
Windows の Start-Process は Hidden で起動する。終了は RCON save-all→stop。

自然側は(500,80,500)周辺の土の足場に、同じ高さの原木5個・丸石9個・作業台を置く。
道具は渡さず、各目標の前に clear する。材料の配置を維持すれば3目標を繰り返せる。
元の自然地形からの実測とは分けてあり、元地形では木/石ツルハシが成功、かまどは90秒で中断した。
`LIVE_GOALS=wooden_pickaxe` のように環境変数で自然側の対象を絞れる。

## ファイル

| ファイル/ディレクトリ | 内容 |
|---|---|
| `offline/planner.test.cjs` | 5つの実 worldState×14目標の plan/diagnosis 全体、facts、条件、加算目標 |
| `offline/state.test.cjs` | カテゴリ、装備、ドロップ判定、キャッシュ、場所、前提検査 |
| `offline/commands.test.cjs` | パースとResult、停止範囲、chat、history |
| `offline/bot.test.cjs` | bot名、whisper、自然言語フック、履歴100件、speak系 |
| `offline/utilities.test.cjs` | スキャン、yaw、件数上限、レシピの実測 golden、ログ |
| `offline/generation.test.cjs` | 接続版1.20.1の action 自動生成、初回フラグ |
| `offline/executor.test.cjs` | 中断、listener後処理、再計画、補助ゴール不足量、逆転前提 |
| `offline/api.test.cjs` | 共通Result、CJS/ESM入口、副作用なし、並行観測・計画、ログ文脈、中断境界 |
| `offline/operations.test.cjs` | A→B→C置換、2bot独立、chest継続/停止、follow外部abort、idle tick待ち |
| `offline/domain.test.cjs` | 準備共有・失敗再試行・版競合・追跡YAML不変・並行計画 |
| `offline/observation.test.cjs` | 独立観測とrefresh完了順序 |
| `offline/runner.test.cjs` | 数量削減、循環/深さ、診断metadata |
| `offline/placement.test.cjs` | skill/creativeの別policy、順序、立体・同距離候補 |
| `offline/navigation.test.cjs` | verticalMode 4種、直接stopFollow、設置6候補の順番 |
| `offline/failure-guard.test.cjs`, `chest-all.test.cjs`, `timeout.test.cjs` | 反復失敗の上限、chest全量と境界、timeout後の停止 |
| `offline/features03.test.cjs` | 評価70件一致、予算/中断/cache、資源不足事前判定、軽い観測、探索移動、通知の非破壊性 |
| `known-failures/current.test.cjs` | refresh / CommonJS循環依存修正の回帰。TODOなし |
| `live/features.test.cjs` | フラットの全機能群、自然の3GOAP目標 |
| `live/bugfix.test.cjs` | 地下通路の鉄精錬、草設置、chest全量、timeout |
| `live/features03.test.cjs` | 20候補評価・2ワールド軽い観測・途中移動/未ロード/到達不能/no_path・進捗 |
| `gpu/vision.test.cjs` | vision の実GPU呼び出し・競合・後処理 |
| `gpu/persistent.test.cjs` | 常設10枚、旧撮影併用、移動中、起動失敗、bot終了/SIGTERMのbrowser解放 |
| `live/observe.cjs` | 実測記録と worldState を採る補助スクリプト |
| `helpers/module.js` | 本体を改変せず require 依存だけ差し替える試験用ローダー |
| `helpers/live.js` | 接続、RCON、接続版に合わせたキャッシュ生成（旧追跡ディレクトリの保存/復元も残す） |
| `fixtures/` | 実測データ・期待値。gzip は node:zlib で展開 |
| `results/` | 再実行時の結果。コミット対象ではない |

実機能テストは明示的な逐次チェックを使う。この環境の Node 24.2.0 では `await t.test(...)` の後に
親の後処理が先行する挙動を最小例でも観察したので、接続の寿命を子テストのスケジュールに依存させない。

## fixture の読み方

```js
const fs = require('node:fs');
const zlib = require('node:zlib');
const state = JSON.parse(zlib.gunzipSync(fs.readFileSync('tests/fixtures/natural-empty.json.gz')));
const observations = JSON.parse(zlib.gunzipSync(fs.readFileSync('tests/fixtures/flat-observations.json.gz')));
console.log(observations.find(x => x.input === '!refresh'));
```

worldState の counts・equipment・flags・nearby・blocks.list を省かず保存する。
返り値 undefined は JSON で表せないので `{$undefined:true}`。例外は `{thrown:{name,message}}`。
観察JSONには入力、返り値/例外、durationMs、before/after、logs を格納する。
planner golden は `{plan,diagnosis}` 全体を比較する。計画の並びをソートせず、改善を理由に更新しない。
generator golden は YAML の action 配列全体で、生成日時などのヘッダを除いている。

`npm test` は fixture を上書きしない。
`npm run observe:flat` / `observe:natural` と `node tests/tools/capture-offline.cjs` は
**基準を新しく採り直すための補助操作**。通常のリファクタリング検証では実行しない。
本体が変わった後で実行して golden を更新すると回帰を隠すため、必ず基準版と理由を確認する。

generator の試験は fs の保存だけを差し替え、実 minecraft-data で生成する。
live の !goal/関数APIは本体の生成処理を通す。生成先は .cache/minecraft-bot/actions/<版>/。追跡YAMLは変更しない。
同じcheckoutでlive/observeを同時実行しない。強制終了すると復元が走らない可能性がある。
executor の単体検証では plan/skill の結果を代用する。実-worldの到達性は live が検証する。

refresh・循環依存・visionのTODOは01で外した。未修正の動作問題は02へ回し、goldenを更新しない。
既知失敗の扱いは `requests/2026-10-09_from-isg/00_observations.md` に記録した。

02/03の追加実測は `.cache/minecraft-bot/02-03-results/` に保存する。
`node tests/tools/02-natural.cjs` は元地形の調査（最大120秒/目標）。NATURAL_NAME/NATURAL_GOALSで対象を選ぶ。
`node tests/tools/03-calibration.cjs` は自然の専用区画で3目標を実行し、見積もりとステップ通知の時刻を記録する。
`node tests/tools/03-evaluation-warm.cjs` は03-live.jsonの20候補を、初回・準備・反復で評価する。
GPUの子プロセス試験はOSの強制killと区別するため、子プロセス内のSIGTERM通常終了ハンドラを呼ぶ。
