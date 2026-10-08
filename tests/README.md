# 2026-10-09 特性テスト

基準：master db2b29e、Minecraft 1.20.1、Node v24.2.0。
本体の挙動を観察して固定するためのテスト。追加依存はない。

## 実行

- `npm test`：サーバーなし。157件。約40秒（CPU負荷で変動）。
- `npm run test:known`：refresh と循環依存の望ましい挙動を TODO として検証。約2秒。
- `npm run test:live`：フラット25565と自然25567を必要とする。約3分。
- `npm run test:vision`：GPU使用を許可された場合のみ実行。現版では logger 未定義で失敗する TODO。
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
| `offline/commands.test.cjs` | パース、undefined/throw/値、停止範囲、chat、history |
| `offline/bot.test.cjs` | bot名、whisper、自然言語フック、履歴100件、speak系 |
| `offline/utilities.test.cjs` | スキャン、yaw、件数上限、レシピの実測 golden、ログ |
| `offline/generation.test.cjs` | 接続版1.20.1の action 自動生成、初回フラグ |
| `offline/executor.test.cjs` | 中断、listener後処理、再計画、補助ゴール不足量、逆転前提 |
| `offline/navigation.test.cjs` | verticalMode 4種、直接stopFollow、設置6候補の順番 |
| `known-failures/current.test.cjs` | refresh / CommonJS循環依存の再現。TODO付きで exit 0 |
| `live/features.test.cjs` | フラットの全機能群、自然の3GOAP目標 |
| `gpu/vision.test.cjs` | vision の実呼び出し。現在は起動前に ReferenceError |
| `live/observe.cjs` | 実測記録と worldState を採る補助スクリプト |
| `helpers/module.js` | 本体を改変せず require 依存だけ差し替える試験用ローダー |
| `helpers/live.js` | 接続、RCON、生成ファイルのバイト保存/復元 |
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
live の !goal は本体の生成処理を通し、終了時に生成ディレクトリを元のバイトへ戻す。
同じcheckoutでlive/observeを同時実行しない。強制終了すると復元が走らない可能性がある。
executor の単体検証では plan/skill の結果を代用する。実-worldの到達性は live が検証する。

TODO は失敗しても exit 0 になる。修正後に TODO を外し、通常の回帰検証に移す。
既知失敗の扱いは `requests/2026-10-09_from-isg/00_observations.md` に記録した。
