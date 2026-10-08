# ① 調査からのリファクタリング案

2026-10-09、基準 master `db2b29e`。作業ブランチ `refactor/isg-2026-10-09`。
これは②が `01_plan.md` を書くための案であり、本体への変更は行っていない。
観察と検証範囲は `00_observations.md` にある。会話を読まずに両ファイルと tests を参照して作業できるようにした。

## 現在の構造と依存

| 層・ファイル | 責務 | 依存と注意 |
|---|---|---|
| `planner_bot/index.js` | dotenv、設定検証、プロセスシグナル | `bot/startup.js`。ライブラリ入口として require すると起動する |
| `bot/startup.js` | 複数ボット、起動案内、終了 | `bot/ai_bot.js`。200ms 間隔。起動完了バナーと spawn 完了は別 |
| `bot/ai_bot.js` | mineflayer 作成、pathfinder、whisper、履歴、ログ | `commands/index.js` と `state_manager.js`。bot に多数の状態を追加 |
| `commands/index.js` | 文字列の解釈・振り分け・操作中断 | 各ハンドラ、idle/watch の停止。goal の例外を値に変える |
| `commands/goal_command.js` | 生成、道具事前準備、数量削減、診断からの補助目標、実行 | planner、generators、executor、state_builder。単なる文字列アダプタ以上の役割 |
| `planner/goap.js` | ドメイン読み込み、構文、状態遷移、関連変数、ヒューリスティック、A*、不足診断 | state_builder、YAML。module の domain と activeLogger を共有 |
| `planner/state_manager.js` | 観測・キャッシュ・名前付き位置 | block_scanner、state_builder。refresh が blocks.list を含む大きな状態を生成 |
| `planner/state_builder.js` | 生状態→facts、カテゴリ、複合状態 | state_schema/block_categories。型と missing の扱いも計画に影響 |
| `planner/*_generator.js` | 接続バージョンの minecraft-data→行動 YAML | checkout に書き込み、process 内で初回フラグを保持 |
| `executor/goap_executor.js` | 前提検査・補助計画・再計画・AbortSignal | skills、planner、precondition_checker、**goal_command へ逆依存** |
| `executor/precondition_checker.js` | ドメイン中の action に対する実行前判定 | planner.loadDomain、state_builder。未知 action は現在 satisfied |
| `skills/` | 採集・クラフト・精錬・設置など9種 | primitives、stateManager、一部は pathfinder/mineflayer API を直接使用 |
| `primitives.js` | 移動・採掘・回収・クラフト・設置・装備・検索・道具選択 | pathfinder/minecraft-data。moveTo はタイムアウトを持つ |
| `navigation/actions.js` | 名前付き移動、方向移動、追跡、ドロップ、チェスト | primitives と mineflayer。skills の移動/回収とは仕様差がある |
| `vision/capture.js` | 一時 viewer/Chrome、PNG、後処理 | puppeteer/prismarine-viewer。現在 logger 未定義で起動前に失敗 |
| `utils/` | レシピ、スキャン、ログ | 観測・コマンド・計画から共用 |

依存の骨格：起動→bot→commands→goal orchestration→planner/executor→skills→primitives。
state と utils は横断して使われる。循環は goal orchestration→executor→goal_command。
`!goal` と `goap.plan` の差は入口だけではない。前者には事前準備、数量削減、診断解決がある。

## 分け方の案

既存の planner / executor / skills / navigation / bot / commands / utils の配置を保つ。
トップレベルの大幅な再編成や、全機能を services に移す案は不要。

1. **診断と複合状態の解決を計画側の独立ファイルへ移す。** 例 `planner/diagnosis.js`。
   checkCompositeState/buildStructuredDiagnosis を executor と goal orchestration の両方から読む。
   循環の削除を最初の小さい変更にし、`test:known` の当該 TODO を通常の回帰テストにする。
   初期診断、実行失敗時の再診断、複合状態→サブゴール、数量削減を残す。
2. **goal orchestration をコマンド文字列から独立させる。** 例 `executor/goal_runner.js`。
   現在の goal_command の処理を順番ごと保持して移す。薄い command は入力を解釈して runner を呼ぶ。
   単に planner.plan→execute の2行に置換すると、道具準備や補助目標などを失う。
3. **小さいライブラリ入口を足す。** 例 `planner_bot/api.js`。
   ボット/session に結び付いた observe/plan/execute/navigation/look/idle/creative/history を公開する。
   startBots の起動副作用と分離する。既存 action 関数と skills を呼ぶ入口を先に作れば移行量を抑えられる。
   executeGoal(goal, {signal}) は runner に委譲し、stop() は watch/idle/follow/chest も停止できるようにする。
   bot.currentAbortController の中断機能も残す。複数同時操作の優先順位は別途合意が必要。
4. **バージョン別ドメインの準備を共通化する。** 例 `planner/domain.js`。
   接続版で生成→ロード→計画、の順序をどの入口でも使う。
   generator 初回フラグと goap の domain キャッシュをセットで扱う。
   手書き YAML・カテゴリ・schema は現配置を保ち、生成物のキャッシュだけ checkout の外へ移す案を相談する。
   生成 action の意味・順序は golden で固定済み。ヘッダの日時とファイル保存先は意味に含めない。
5. **ログの入口を createLogger に集める。** bot.systemLog の二重フィルタと直接 console を整理する。
   LOG_COMMANDS none でも direct console が残る現状を変えるのは E の範囲。
   調査ログをそのまま golden にしない。計画・返り値・ワールド作用は固定する。
6. **goap.js は最後に分割する。** まず domain、目標構文、状態アクセス/条件/効果、診断を抜き、
   次に関連変数とヒューリスティックを分け、最後に探索器と heap を検討する。
   初期化順・列挙順・heap の同コスト順・探索上限を変えると計画が変わるので、抽出のたびに70件を比較する。
   性能改善、並列候補計画、heuristic 変更はこの段階で行わない。

## まとめられそうな処理と、保持すべき仕様差

| 処理 | 実装群 | 現在の差と提案 |
|---|---|---|
| 設置 | skill place_block / creative placeBlock / primitive placeBlock | skill は同じ高さの6候補・下参照。creative は半径5の3D候補・6方向参照・座標指定。共用探索器に **policy を渡し、両仕様を維持** する案が安全。片方へ統一するなら計画時に確認 |
| 回収 | skill collect_drops / primitive collectDrops / navigation pickupItems / gather 内回収 | 半径、試行数、timeout、対象フィルタ、全部巡回/最寄りだけ、失敗の扱いが違う。共有できるのは entity 抽出・フィルタ・接近などの機構。戻り値と制御を一括置換しない |
| 移動 | skill move_to / primitive moveTo / navigation goto・gotoCoords・direction / workbench・smelt 内 goto | デフォルト距離、許容範囲、timeout、状態参照が違う。primitive を共通核にするときも各既定値を保持 |
| 装備 | equipItem / equip_mainhand / equip_armor / gather の道具選択 | armor の slot 名は helmet 等→Mineflayer head 等に変換。動的最良道具選択を固定装備に置換しない |
| 状態の参照 | state_builder / goap の getStateValue / precondition_checker / goal_command | 数値の exact / >=、undefined/null、カテゴリ再計算の意味を先にテストで一致させてから共用化 |
| 中断 | commands.stopAll / executor AbortSignal / idle/watch stop | !navigation は通常 stopAll を先に呼ぶ。chest 続行3種のみ例外。!info/status/look は別の扱い。関数化で停止範囲が変わらないよう仕様表を作る |

## GOAP で壊しやすい点

- 周辺の設置済み板・作業台・チェスト・かまどを採集する計画は正しい。保護フィルタを足さない。
- numeric 目標は **現在値への加算**。持っている4枚に `inventory.oak_planks:4` は追加4枚の要求。
  前提条件の number は exact、`">= 4"` は比較。goal 達成比較と混同しない。
- inventory の名前別数と category の数・boolean、equipment の名前別 true、nearby flags と nearby counts を保持。
- 探索は行動コストで選び、人間の自然な並びでソートしない。
- 補助計画は不足量を入力にする。AbortSignal の確認、掘削/移動停止、listener の解除を維持する。
- 同期 state refresh を削ると古い環境で再計画する。速い観測 API は03で別に設計する。
- module 単位 domain/activeLogger を session 化する案は、複数ボット・同時 plan の必要性を確認して進める。

## テストと順番

1. `npm test` を基準にし、`npm run test:known` と `npm run test:vision` を確認する。
2. 循環依存の抽出だけをコミット。planner golden と executor の再計画検証、known の改善を確認。
3. runner と API 入口をコミット。flat live で全操作、natural live で3目標、既存文字列入口を確認。
4. domain lifecycle とキャッシュをコミット。generator golden と5観測×14目標を確認。
5. logger、重複処理の機構抽出を小さいコミットで実施。
6. goap 分割を1責務ずつコミット。各段階で同じ fixtures に対する結果を再比較。
7. API.md を実測と新 API に合わせ、機能維持表と例外一覧を01_reportに記載。

fixtures は flat の empty/stocked/underground と natural の empty/stocked。
70件の action/skill/params/cost の順番と diagnosis 全体、facts 5件を固定。
generator は fs 書き込みだけを差し替えて minecraft-data 1.20.1 の実生成を検査する。
executor のサーバーなし検証は技能・計画結果を fixture で代用するため、実ワールドの到達性まで保証しない。
live はCPU群とGPU群を分離し、入力/結果/時間も保存する。

## 依頼者に決めてほしい点（②の計画に残す）

- 新 API の戻り値は `{ok, data, error:{code,message,details}}` などに統一してよいか。
  チャット側の undefined/throw/失敗値は機能差として観測済み。アダプタとして残すか、新仕様へ同時移行するか。
- 「同時実行不可」か、「observe/plan は並行可、移動/実行は1つ」か。stop の対象と操作IDも必要か。
- 生成物の保存先・キャッシュ寿命・異なるMinecraft版の複数botを同一processで扱うか。
  `.gitignore` は今回変更していない。保存先を変えるなら②の計画で明示する。
- 設置探索は両 policy を維持する案を推奨。1つの policy に寄せたい場合、どちらか。
- 新たに再現した !refresh と vision の未定義変数、chest count=-1 の挙動は、現 `01_refactor.md` の許可例外 A/H/E に含まれない。
  **①は修正していない。②が01で直す承認を求めるか、02へ回すかを明確にする。**
- 元の自然地形でかまどが90秒中断になった結果は、採集/作業台到達/補助ゴールの繰り返しをさらに観察する候補。
  リファクタリングのための「改善」として探索・失敗回数上限を勝手に変えない。
- 現ライブテストの自然ワールド区画は再現性を優先して資源を配置する。元の自然地形での無在庫実行も別の受入条件として残すか。

## 固定できていない範囲

全Minecraft版での生成、全素材/全クラフト、遠距離・水中/溶岩・戦闘・死亡・サーバー切断中の再開、複数GOAPの同時実行は網羅していない。
GPU許可後に vision を呼んだが未定義 logger でブラウザ起動前に失敗。画像内容・yawと画像の一致・WebGL後処理は未検証。
テスト用サーバー以外やプレイヤーのMinecraftクライアントには触れていない。
