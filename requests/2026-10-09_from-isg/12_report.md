# 12 Gather cost 実装報告

- 日付: 2026-10-10 (Asia/Tokyo)
- 起点: master bee3d1c。ブランチ: isg/12-gather-cost-2026-10-10。master への merge / push は行っていない。

## 原因

isg の見立ては正しい。craft_generator.js の DEFAULT_COST=10 に対し、カテゴリの素手 gather は x1=3、x3=5、合計8。nearby.category.plank の数量だけを見て、距離や地下へのアクセスを費用に入れていなかった。原木、石、鉱石、砂等のカテゴリ gather、カテゴリ内の個別 gather、その他すべての個別 gather が同じ問題を持つ。goal_evaluator.js の estimatedMs は表示用の別モデルで、A* の cost には使われていなかった。

## 変更

gather_cost.js で観測ごとの共通費用を計算し、ドメインを変更せず計画ごとに gather 行動のコピーへ付ける。

`cost = 基礎コスト(count, tool) + 0.5 × max(0, nearestDistance - 2) + 2 × obstructionCount`

対象ブロックは gather の初回選択と同じ最寄り。カテゴリはその全ブロックを対象にする。採る個数は既存の数量・道具・まとめ取り割引に保持し、近付く費用は最寄り1対象から推定する。埋没判定は6隣接セルがすべて観測中の非空気・非水ブロックであること。埋没対象だけ、ボットの目から対象中心への線上を半ブロック間隔（最大512点）で検査し、対象自身を除く障害セルを重複なしで数える。露出資源には、地表を歩けば迂回できる土等の直線障害費を加えない。

全gather（カテゴリ・個別・道具 variant・数量）に同じ規則が働く。板の例外、クラフト値の引下げ、採集前提の制限は追加していない。生成YAML・効果・閉包・200回制限・既存ヒューリスティックは維持。局所計画とworker計画は同じ費用を使う。workerへ座標一覧を送らず小さな要約だけ送り、evaluateGoals cacheにも要約を含める。原観測と共有ドメインを変更しない。投影は約2ms区間でyieldし、deadline / signal に対応する。

## ライブ試験

world-snapshot-2026-10-10b をこのrepoの .cache/minecraft-bot/12-study/server/world へコピーし、127.0.0.1:25569 / RCON 25579 だけを使用。読み元ワールド・他worktree・他プロジェクト設定は変更していない。GPU / viewer / LLM / JEV / H2O-Lightning / subs-llmapi は使用していない。パスワードはコピー用server.propertiesにだけ保存し、報告・成果JSON・コミットに含めない。試験完了後 save-all → stop、ポートの待受がないことを確認。

- (139.5,69,217.5)、acacia_log 16個、板4枚: 旧 `auto_gather_plank_category_barehand_x1 → auto_gather_plank_category_barehand_x3` (8) → 新 `auto_hand_craft_planks_from_logs_category` (10)。実行成功、原木15個と板4枚。最低y=69、終了位置も同じ。実行 615.962ms。
- 最寄り地下板の距離 57.493、推定障害数 0。
- 同地点、原木なし: log gather → 板クラフト。実行成功（地表の近い木を使用）。
- 至近距離に露出した板4ブロックを置いたケース: 原木を持っていても環境の板を集める計画を保持。
- 代表目標の計画比較（表は空手／原木16・iron_pickaxe・coal8の条件。成功はplanが存在する意味で、代表目標全件のライブ実行ではない）:

| 状態 | 目標 | 旧手数 / 新手数 | 旧cost / 新cost |
|---|---|---:|---:|
| surface-empty | inventory.stone_pickaxe:1 | 8 / 9 | 55 / 104.342 |
| surface-empty | inventory.furnace:1 | 8 / 9 | 56 / 105.342 |
| surface-empty | inventory.torch:4 | 8 / 9 | 57 / 114.883 |
| surface-empty | inventory.iron_pickaxe:1 | 未発見 / 未発見 | なし / なし |
| surface-empty | inventory.diamond:1 | 未発見 / 未発見 | なし / なし |
| surface-equipped | inventory.stone_pickaxe:1 | 6 / 7 | 42 / 54 |
| surface-equipped | inventory.furnace:1 | 5 / 5 | 33 / 35 |
| surface-equipped | inventory.torch:4 | 3 / 3 | 25 / 30 |
| surface-equipped | inventory.iron_pickaxe:1 | 未発見 / 未発見 | なし / なし |
| surface-equipped | inventory.diamond:1 | 未発見 / 未発見 | なし / なし |

ライブの全手順・診断・展開ログは tests/study12/live-results.json、観測は repro.json.gz。鉄のツルハシ・ダイヤはこのライブ空手／装備条件では従来も今回も計画未発見。今回の変更は遠い資源の不在や旧来の探索上限を解消するものではない。

## 回帰・270組の比較

- npm test: **292 pass / 0 fail**。
- node --test --test-concurrency=1 tests/study04/*.test.cjs: **9 pass / 0 fail**。
- gather_cost12.test.cjs: **5 pass**（全種類への費用、原木→板、至近の板、worker一致、geometryのcache失効、予算・中断）。
- ライブ: **13ケース成功**（2ゴール実行＋10代表計画比較＋至近の板）。
- ⑤Bの9状態×30目標×2反復。旧 130成功 → 新 142成功。成功を失った組は0。変化 129/270組。分類: 情報改善87、推定改善17、中立13、改善12。
- 新版で成功した全計画を既存の前提・効果でreplayし、加算目標を満たすことと観測の非変更を検証。両反復の手順・費用・展開数も確認する。
- 元の golden / results.json / matrix-B.json は変更していない。before.json / after.json / comparison.json は新しい別成果。新goldenとしての採否は依頼者に委ねる。古い exact テストは数量だけの観測で旧goldenを維持し、全観測ではreplay・直接計画/evaluation一致・逐次/並行一致を確かめるよう変更。worker停止・queued deadline試験は、新しい非同期投影が済んでdispatchしてから試験のqueueを作る。

### 時間と探索回数

| 指標 | 旧 | 新 |
|---|---:|---:|
| 平均 ms | 76.701 | 100.765 |
| 中央値 ms | 15.598 | 52.773 |
| p95 ms | 487.139 | 541.244 |
| 展開数合計（270組） | 9553 | 7573 |

新しい幾何投影の分だけ、とくに元々短い計画の時間は増える。平均増加は 31.374%。単なる高速化ではないことを明記する。展開数合計は 20.726%減少。40万以上のブロックの観測でも、全セルの文字列Mapを作らず、最寄り候補のアクセス検査に必要なセルだけを索引に保持する。要約を1バッチで共有し、探索中の再スキャンをしない。タイマー継続・中断・workerに対するbudget試験は通っている。測定は同一プロセスで旧/新を交互実行し、反復で順を反転したwall-clock値（Node v24.2.0）。

## 残る問題と評価の限界

- 直線アクセスは経路探索の代用。壁を迂回できる地下通路、非固体だが空気以外の植物、未読込セル、実際の道具速度は正確に扱わない。非空気・非水を障害近似に使い、未観測のセルは障害と決めつけない。
- 最寄り1対象だけのアクセス推定。x3/x8の残りの対象の位置・掘削量、採集後の位置、枯渇、障害を一度掘って通路にした後の再利用は計画内で追跡しない。再計画時は再観測から費用を更新する。これを導入するには位置・資源消費も扱う別の計画モデルが必要。
- ヒューリスティックは従来から最適性を保証しない（④の反例テストも維持）。今回の270組では成功を失う組・旧計画の再評価より高費用となる組はいずれも0。将来の「推定悪化」は新式で再評価した旧経路より費用の高い計画を先に返す場合を指す。今回の式は個別目標を優遇せず、これらもすべて列挙する。改善判定もこの費用近似内の評価で、実地の短縮保証ではない。
- 読み込むだけのAPI、公開入力とResult形は変更していない。costだけが観測依存になった。座標のない数量観測では旧費用。

## 再実行

- node tests/study12/matrix.cjs compare（git show bee3d1c のGOAPをVMに読み、現在版と交互計測。checkout不要）
- PowerShell: & ./tests/study12/live.ps1 → 起動完了後 node tests/study12/live.cjs（終わるとsave-all/stop）
- node tests/study12/summarize.cjs（比較JSONとこの報告を再生成）

## 変わった全129組

「旧再評価」は旧手順を新式で計算した費用。同じ式での新旧比較に使う。各組の原plan（params・各step cost）、ms、2反復の値はcomparison.json / before.json / after.jsonに保持。

### 1. flat-empty / inventory.oak_planks:4

- 旧: cost 10、展開 2、success
- 新: cost 17.254、展開 2、success（旧再評価 17.254）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_oak_planks_barehand_x8`
- 新手順: `auto_gather_oak_planks_barehand_x8`

### 2. flat-empty / inventory.stick:4

- 旧: cost 15、展開 3、success
- 新: cost 22.254、展開 3、success（旧再評価 22.254）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick`
- 新手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick`

### 3. flat-empty / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 23.827、展開 2、success（旧再評価 23.827）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_gather_crafting_table_x1`

### 4. flat-empty / inventory.wooden_pickaxe:1

- 旧: cost 33、展開 12、success
- 新: cost 40.254、展開 8、success（旧再評価 40.254）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_pickaxe`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_pickaxe`

### 5. flat-empty / inventory.wooden_sword:1

- 旧: cost 33、展開 9、success
- 新: cost 40.254、展開 8、success（旧再評価 47.508）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_plank_category_barehand_x3 → move_to_workbench → auto_gather_plank_category_barehand_x1 → auto_hand_craft_stick → auto_workbench_craft_wooden_sword`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`

### 6. flat-empty / inventory.chest:1

- 旧: cost 5、展開 2、success
- 新: cost 26.274、展開 2、success（旧再評価 26.274）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_chest_x1`
- 新手順: `auto_gather_chest_x1`

### 7. flat-empty / inventory.gold_ingot:1

- 旧: cost 52、展開 23、success
- 新: cost 139.408、展開 17、success（旧再評価 139.408）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `move_to_workbench → auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_workbench_craft_gold_ingot`
- 新手順: `auto_gather_plank_category_barehand_x8 → move_to_workbench → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_workbench_craft_gold_ingot`

### 8. flat-empty / inventory.category.plank:12

- 旧: cost 16、展開 5、success
- 新: cost 30.508、展開 3、success（旧再評価 30.508）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_gather_plank_category_barehand_x8`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_gather_plank_category_barehand_x8`

### 9. flat-empty / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 43.476、展開 4、success（旧再評価 43.476）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`

### 10. flat-stocked / inventory.oak_planks:4

- 旧: cost 10、展開 2、success
- 新: cost 10、展開 2、success（旧再評価 17.254）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_oak_planks_barehand_x8`
- 新手順: `auto_hand_craft_oak_planks`

### 11. flat-stocked / inventory.stick:4

- 旧: cost 15、展開 3、success
- 新: cost 20、展開 3、success（旧再評価 22.254）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick`
- 新手順: `auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`

### 12. flat-stocked / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 20、展開 3、success（旧再評価 23.827）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_hand_craft_planks_from_logs_category → auto_hand_craft_crafting_table`

### 13. flat-stocked / inventory.wooden_pickaxe:1

- 旧: cost 33、展開 10、success
- 新: cost 40.254、展開 10、success（旧再評価 40.254）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_pickaxe`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_pickaxe`

### 14. flat-stocked / inventory.wooden_sword:1

- 旧: cost 33、展開 9、success
- 新: cost 35、展開 6、success（旧再評価 47.508）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_plank_category_barehand_x3 → move_to_workbench → auto_hand_craft_stick → auto_gather_plank_category_barehand_x1 → auto_workbench_craft_wooden_sword`
- 新手順: `auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`

### 15. flat-stocked / inventory.torch:4

- 旧: cost 25、展開 4、success
- 新: cost 30、展開 4、success（旧再評価 32.254）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick → auto_hand_craft_torch`
- 新手順: `auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_hand_craft_torch`

### 16. flat-stocked / inventory.chest:1

- 旧: cost 5、展開 2、success
- 新: cost 26.274、展開 2、success（旧再評価 26.274）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_chest_x1`
- 新手順: `auto_gather_chest_x1`

### 17. flat-stocked / inventory.gold_ingot:1

- 旧: cost 24、展開 21、success
- 新: cost 104.154、展開 19、success（旧再評価 104.154）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → move_to_workbench → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_workbench_craft_gold_ingot`
- 新手順: `auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → auto_gather_nether_gold_ore_x1 → move_to_workbench → auto_gather_nether_gold_ore_x1 → auto_workbench_craft_gold_ingot`

### 18. flat-stocked / inventory.category.plank:12

- 旧: cost 16、展開 5、success
- 新: cost 25.254、展開 4、success（旧再評価 37.762）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_gather_plank_category_barehand_x1 → auto_gather_plank_category_barehand_x3`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_planks_from_logs_category`

### 19. flat-stocked / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 43.476、展開 4、success（旧再評価 43.476）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`

### 20. flat-underground / inventory.oak_planks:4

- 旧: cost 10、展開 2、success
- 新: cost 10.768、展開 2、success（旧再評価 10.768）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_oak_planks_barehand_x8`
- 新手順: `auto_gather_oak_planks_barehand_x8`

### 21. flat-underground / inventory.stick:4

- 旧: cost 15、展開 3、success
- 新: cost 15.768、展開 3、success（旧再評価 15.768）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick`
- 新手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick`

### 22. flat-underground / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 5.768、展開 2、success（旧再評価 5.768）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_gather_crafting_table_x1`

### 23. flat-underground / inventory.wooden_pickaxe:1

- 旧: cost 28、展開 7、success
- 新: cost 28.768、展開 5、success（旧再評価 28.768）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`

### 24. flat-underground / inventory.wooden_sword:1

- 旧: cost 28、展開 9、success
- 新: cost 28.768、展開 5、success（旧再評価 29.536）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick → auto_gather_plank_category_barehand_x1 → auto_workbench_craft_wooden_sword`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_sword`

### 25. flat-underground / inventory.stone_pickaxe:1

- 旧: cost 41、展開 7、success
- 新: cost 42.536、展開 7、success（旧再評価 42.536）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick → auto_gather_plank_category_barehand_x3 → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe`
- 新手順: `auto_gather_plank_category_barehand_x3 → auto_hand_craft_stick → auto_gather_plank_category_barehand_x3 → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe`

### 26. flat-underground / inventory.furnace:1

- 旧: cost 29、展開 8、success
- 新: cost 29.829、展開 6、success（旧再評価 29.829）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_furnace_x1`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_furnace_x1`

### 27. flat-underground / inventory.chest:1

- 旧: cost 5、展開 2、success
- 新: cost 5.62、展開 2、success（旧再評価 5.62）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_chest_x1`
- 新手順: `auto_gather_chest_x1`

### 28. flat-underground / inventory.charcoal:1

- 旧: cost 16、展開 5、success
- 新: cost 20.629、展開 4、success（旧再評価 20.629）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_plank_category_barehand_x1 → smelt_charcoal_with_planks`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_gather_plank_category_barehand_x1 → smelt_charcoal_with_planks`

### 29. flat-underground / inventory.glass:1

- 旧: cost 5、展開 2、success
- 新: cost 6.031、展開 2、success（旧再評価 6.031）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_glass_x1`
- 新手順: `auto_gather_glass_x1`

### 30. flat-underground / inventory.category.plank:12

- 旧: cost 16、展開 5、success
- 新: cost 17.536、展開 3、success（旧再評価 17.536）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_gather_plank_category_barehand_x8`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_gather_plank_category_barehand_x8`

### 31. flat-underground / inventory.category.basic_stone:8

- 旧: cost 30、展開 8、success
- 新: cost 30.768、展開 6、success（旧再評価 30.768）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8`

### 32. flat-underground / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 15.722、展開 4、success（旧再評価 15.722）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`

### 33. flat-underground / inventory.category.basic_stone:2

- 旧: cost 29、展開 8、success
- 新: cost 29.768、展開 6、success（旧再評価 29.768）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3`
- 新手順: `auto_gather_plank_category_barehand_x8 → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3`

### 34. natural-empty / inventory.oak_planks:4

- 旧: cost 15、展開 3、success
- 新: cost 26.415、展開 3、success（旧再評価 26.415）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`
- 新手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`

### 35. natural-empty / inventory.stick:4

- 旧: cost 23、展開 4、success
- 新: cost 48.937、展開 4、success（旧再評価 48.937）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`

### 36. natural-empty / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 12.796、展開 2、success（旧再評価 12.796）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_gather_crafting_table_x1`

### 37. natural-empty / inventory.wooden_pickaxe:1

- 旧: cost 50、展開 52、success
- 新: cost 75.937、展開 16、success（旧再評価 75.937）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`

### 38. natural-empty / inventory.wooden_sword:1

- 旧: cost 38、展開 7、success
- 新: cost 63.937、展開 7、success（旧再評価 63.937）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`

### 39. natural-empty / inventory.stone_pickaxe:1

- 旧: cost 62、展開 11、success
- 新: cost 95.906、展開 16、success（旧再評価 122.843）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe`

### 40. natural-empty / inventory.furnace:1

- 旧: cost 62、展開 30、success
- 新: cost 96.906、展開 16、success（旧再評価 96.906）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace`

### 41. natural-empty / inventory.torch:4

- 旧: cost 62、展開 16、success
- 新: cost 98.088、展開 18、success（旧再評価 125.025）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_stick → auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_torch`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_workbench_craft_wooden_pickaxe → auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_torch`

### 42. natural-empty / inventory.iron_ingot:3

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 228.279、展開 40、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3 → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_furnace → place_furnace → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks`

### 43. natural-empty / inventory.chest:1

- 旧: cost 40、展開 11、success
- 新: cost 65.937、展開 11、success（旧再評価 65.937）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_chest`
- 新手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_chest`

### 44. natural-empty / inventory.charcoal:1

- 旧: cost 75、展開 25、success
- 新: cost 109.906、展開 12、success（旧再評価 109.906）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → place_furnace → smelt_charcoal_with_planks`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → place_furnace → smelt_charcoal_with_planks`

### 45. natural-empty / inventory.bucket:1

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 238.279、展開 43、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3 → place_furnace → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → auto_workbench_craft_bucket`

### 46. natural-empty / inventory.shears:1

- 旧: cost 128、展開 31、success
- 新: cost 218.279、展開 36、success（旧再評価 218.279）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_stone_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_furnace → auto_gather_iron_ore_category_pickaxe_x3 → place_furnace → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → auto_hand_craft_shears`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3 → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_furnace → place_furnace → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → auto_hand_craft_shears`

### 47. natural-empty / inventory.raw_iron:3

- 旧: cost 63、展開 12、success
- 新: cost 117.373、展開 17、success（旧再評価 144.31）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3`

### 48. natural-empty / inventory.category.plank:12

- 旧: cost 35、展開 6、success
- 新: cost 60.937、展開 6、success（旧再評価 60.937）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`

### 49. natural-empty / inventory.category.basic_stone:8

- 旧: cost 52、展開 53、success
- 新: cost 86.906、展開 17、success（旧再評価 86.906）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8`

### 50. natural-empty / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 33.937、展開 2、success（旧再評価 33.937）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x8`
- 新手順: `auto_gather_log_category_barehand_x8`

### 51. natural-empty / inventory.category.basic_stone:2

- 旧: cost 51、展開 53、success
- 新: cost 85.906、展開 17、success（旧再評価 85.906）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3`

### 52. natural-stocked / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 12.796、展開 2、success（旧再評価 12.796）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_gather_crafting_table_x1`

### 53. natural-stocked / inventory.wooden_pickaxe:1

- 旧: cost 45、展開 15、success
- 新: cost 45、展開 11、success（旧再評価 45）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`
- 新手順: `auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`

### 54. natural-stocked / inventory.stone_pickaxe:1

- 旧: cost 36、展開 13、success
- 新: cost 44.969、展開 13、success（旧再評価 44.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_stone_pickaxe`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_stone_pickaxe`

### 55. natural-stocked / inventory.furnace:1

- 旧: cost 17、展開 5、success
- 新: cost 25.969、展開 5、success（旧再評価 25.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace`

### 56. natural-stocked / inventory.iron_ingot:3

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 150.405、展開 81、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_furnace → auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_stick → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3 → place_furnace → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_log`

### 57. natural-stocked / inventory.iron_pickaxe:1

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 160.405、展開 71、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → auto_gather_iron_ore_category_pickaxe_x3 → place_furnace → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_log → smelt_iron_ingot_with_coal → auto_workbench_craft_iron_pickaxe`

### 58. natural-stocked / inventory.iron_axe:1

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 160.405、展開 71、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → auto_gather_iron_ore_category_pickaxe_x3 → place_furnace → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_log → smelt_iron_ingot_with_coal → auto_workbench_craft_iron_axe`

### 59. natural-stocked / inventory.charcoal:1

- 旧: cost 35、展開 7、success
- 新: cost 43.969、展開 7、success（旧再評価 43.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace → place_furnace → smelt_charcoal_with_log`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace → place_furnace → smelt_charcoal_with_log`

### 60. natural-stocked / inventory.bucket:1

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 160.405、展開 76、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `move_to_workbench → auto_gather_basic_stone_category_pickaxe_x8 → auto_hand_craft_planks_from_logs_category → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_furnace → auto_hand_craft_stick → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3 → place_furnace → smelt_iron_ingot_with_log → smelt_iron_ingot_with_log → smelt_iron_ingot_with_planks → auto_workbench_craft_bucket`

### 61. natural-stocked / inventory.shears:1

- 旧: cost 102、展開 47、success
- 新: cost 140.405、展開 55、success（旧再評価 140.405）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `move_to_workbench → auto_gather_basic_stone_category_pickaxe_x8 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_furnace → place_furnace → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3 → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_coal → auto_hand_craft_shears`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_furnace → auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_stick → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3 → place_furnace → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_coal → auto_hand_craft_shears`

### 62. natural-stocked / inventory.raw_iron:3

- 旧: cost 37、展開 14、success
- 新: cost 66.436、展開 14、success（旧再評価 66.436）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3`
- 新手順: `auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3`

### 63. natural-stocked / inventory.category.basic_stone:8

- 旧: cost 2、展開 2、success
- 新: cost 10.969、展開 2、success（旧再評価 10.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8`

### 64. natural-stocked / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 33.937、展開 2、success（旧再評価 59.874）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`
- 新手順: `auto_gather_log_category_barehand_x8`

### 65. natural-stocked / inventory.category.basic_stone:2

- 旧: cost 1、展開 2、success
- 新: cost 9.969、展開 2、success（旧再評価 9.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x3`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x3`

### 66. surface-empty / inventory.oak_planks:4

- 旧: cost 15、展開 3、success
- 新: cost 23.131、展開 3、success（旧再評価 23.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`
- 新手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`

### 67. surface-empty / inventory.stick:4

- 旧: cost 23、展開 4、success
- 新: cost 31.131、展開 4、success（旧再評価 31.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`

### 68. surface-empty / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 19.616、展開 2、success（旧再評価 19.616）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_gather_crafting_table_x1`

### 69. surface-empty / inventory.wooden_pickaxe:1

- 旧: cost 50、展開 52、success
- 新: cost 58.131、展開 18、success（旧再評価 58.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`

### 70. surface-empty / inventory.wooden_sword:1

- 旧: cost 38、展開 7、success
- 新: cost 46.131、展開 7、success（旧再評価 46.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`

### 71. surface-empty / inventory.stone_pickaxe:1

- 旧: cost 62、展開 11、success
- 新: cost 82.262、展開 11、success（旧再評価 82.262）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe`

### 72. surface-empty / inventory.furnace:1

- 旧: cost 62、展開 30、success
- 新: cost 74.131、展開 19、success（旧再評価 74.131）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace`

### 73. surface-empty / inventory.torch:4

- 旧: cost 62、展開 16、success
- 新: cost 82.93、展開 16、success（旧再評価 82.93）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_stick → auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_torch`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_stick → auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_torch`

### 74. surface-empty / inventory.iron_ingot:3

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 184.422、展開 55、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_stone_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_gather_iron_ore_category_pickaxe_x3 → auto_workbench_craft_furnace → place_furnace → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks`

### 75. surface-empty / inventory.chest:1

- 旧: cost 40、展開 11、success
- 新: cost 48.131、展開 11、success（旧再評価 48.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_chest`
- 新手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_chest`

### 76. surface-empty / inventory.charcoal:1

- 旧: cost 75、展開 25、success
- 新: cost 87.131、展開 12、success（旧再評価 87.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → place_furnace → smelt_charcoal_with_planks`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → place_furnace → smelt_charcoal_with_planks`

### 77. surface-empty / inventory.bucket:1

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 194.422、展開 57、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_stone_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_gather_iron_ore_category_pickaxe_x3 → auto_workbench_craft_furnace → place_furnace → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → auto_workbench_craft_bucket`

### 78. surface-empty / inventory.shears:1

- 旧: cost 128、展開 31、success
- 新: cost 174.422、展開 35、success（旧再評価 174.422）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_stone_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_furnace → auto_gather_iron_ore_category_pickaxe_x3 → place_furnace → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → auto_hand_craft_shears`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_stone_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_gather_iron_ore_category_pickaxe_x3 → auto_workbench_craft_furnace → place_furnace → smelt_iron_ingot_with_planks → smelt_iron_ingot_with_planks → auto_hand_craft_shears`

### 79. surface-empty / inventory.raw_iron:3

- 旧: cost 63、展開 12、success
- 新: cost 105.422、展開 12、success（旧再評価 105.422）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_gather_log_category_barehand_x1 → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3 → auto_workbench_craft_stone_pickaxe → auto_gather_iron_ore_category_pickaxe_x3`

### 80. surface-empty / inventory.category.plank:12

- 旧: cost 35、展開 6、success
- 新: cost 43.131、展開 6、success（旧再評価 43.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`

### 81. surface-empty / inventory.category.basic_stone:8

- 旧: cost 52、展開 53、success
- 新: cost 64.131、展開 19、success（旧再評価 64.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x8`

### 82. surface-empty / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 16.131、展開 2、success（旧再評価 16.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x8`
- 新手順: `auto_gather_log_category_barehand_x8`

### 83. surface-empty / inventory.category.basic_stone:2

- 旧: cost 51、展開 53、success
- 新: cost 63.131、展開 19、success（旧再評価 63.131）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe → auto_gather_basic_stone_category_pickaxe_x3`

### 84. surface-stone / inventory.oak_planks:4

- 旧: cost 15、展開 3、success
- 新: cost 25.458、展開 3、success（旧再評価 25.458）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`
- 新手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`

### 85. surface-stone / inventory.stick:4

- 旧: cost 23、展開 4、success
- 新: cost 25.298、展開 4、success（旧再評価 25.298）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`

### 86. surface-stone / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 25.298、展開 4、success（旧再評価 27.598）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_crafting_table`

### 87. surface-stone / inventory.wooden_pickaxe:1

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 52.298、展開 45、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_workbench_craft_wooden_pickaxe`

### 88. surface-stone / inventory.wooden_sword:1

- 旧: cost 38、展開 7、success
- 新: cost 40.298、展開 7、success（旧再評価 40.298）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`

### 89. surface-stone / inventory.stone_pickaxe:1

- 旧: cost 39、展開 16、success
- 新: cost 48.267、展開 9、success（旧再評価 48.267）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_stone_pickaxe`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_stone_pickaxe`

### 90. surface-stone / inventory.furnace:1

- 旧: cost 17、展開 5、success
- 新: cost 23.969、展開 5、success（旧再評価 23.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace`

### 91. surface-stone / inventory.torch:4

- 旧: cost 34、展開 13、success
- 新: cost 58.159、展開 9、success（旧再評価 58.159）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_coal_ore_category_pickaxe_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_hand_craft_torch`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_hand_craft_torch`

### 92. surface-stone / inventory.iron_ingot:3

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 126.236、展開 100、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_gather_log_category_barehand_x3 → auto_workbench_craft_furnace → place_furnace → auto_gather_iron_ore_category_pickaxe_x3 → smelt_iron_ingot_with_log → smelt_iron_ingot_with_log → smelt_iron_ingot_with_log`

### 93. surface-stone / inventory.chest:1

- 旧: cost 40、展開 122、success
- 新: cost 42.298、展開 11、success（旧再評価 42.298）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_workbench_craft_chest`
- 新手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_chest`

### 94. surface-stone / inventory.charcoal:1

- 旧: cost 40、展開 13、success
- 新: cost 49.267、展開 7、success（旧再評価 49.267）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace → auto_gather_log_category_barehand_x3 → place_furnace → smelt_charcoal_with_log`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace → place_furnace → smelt_charcoal_with_log`

### 95. surface-stone / inventory.bucket:1

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 136.236、展開 106、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `move_to_workbench → auto_gather_basic_stone_category_pickaxe_x8 → auto_gather_iron_ore_category_pickaxe_x3 → auto_workbench_craft_furnace → place_furnace → auto_gather_log_category_barehand_x3 → smelt_iron_ingot_with_log → smelt_iron_ingot_with_log → smelt_iron_ingot_with_log → auto_workbench_craft_bucket`

### 96. surface-stone / inventory.shears:1

- 旧: cost 72、展開 60、success
- 新: cost 116.236、展開 67、success（旧再評価 131.799）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_iron_ore_category_pickaxe_x3 → auto_gather_coal_ore_category_pickaxe_x3 → auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace → place_furnace → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_coal → auto_hand_craft_shears`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_gather_log_category_barehand_x3 → auto_workbench_craft_furnace → place_furnace → auto_gather_iron_ore_category_pickaxe_x3 → smelt_iron_ingot_with_log → smelt_iron_ingot_with_log → auto_hand_craft_shears`

### 97. surface-stone / inventory.raw_iron:3

- 旧: cost 1、展開 2、success
- 新: cost 31.969、展開 2、success（旧再評価 31.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_iron_ore_category_pickaxe_x3`
- 新手順: `auto_gather_iron_ore_category_pickaxe_x3`

### 98. surface-stone / inventory.category.plank:12

- 旧: cost 35、展開 53、success
- 新: cost 37.298、展開 6、success（旧再評価 37.298）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`

### 99. surface-stone / inventory.category.basic_stone:8

- 旧: cost 2、展開 2、success
- 新: cost 8.969、展開 2、success（旧再評価 8.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8`

### 100. surface-stone / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 10.298、展開 2、success（旧再評価 10.298）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x8`
- 新手順: `auto_gather_log_category_barehand_x8`

### 101. surface-stone / inventory.category.basic_stone:2

- 旧: cost 1、展開 2、success
- 新: cost 7.969、展開 2、success（旧再評価 7.969）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x3`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x3`

### 102. surface-iron / inventory.oak_planks:4

- 旧: cost 15、展開 3、success
- 新: cost 18.257、展開 3、success（旧再評価 18.257）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`
- 新手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`

### 103. surface-iron / inventory.stick:4

- 旧: cost 23、展開 4、success
- 新: cost 26.257、展開 4、success（旧再評価 26.257）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`

### 104. surface-iron / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 26.257、展開 4、success（旧再評価 27.187）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_crafting_table`

### 105. surface-iron / inventory.wooden_pickaxe:1

- 旧: cost 28、展開 7、success
- 新: cost 31.257、展開 7、success（旧再評価 31.257）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe`
- 新手順: `auto_gather_log_category_barehand_x1 → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe`

### 106. surface-iron / inventory.wooden_sword:1

- 旧: cost 28、展開 7、success
- 新: cost 31.257、展開 7、success（旧再評価 31.257）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_sword`
- 新手順: `auto_gather_log_category_barehand_x1 → move_to_workbench → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_sword`

### 107. surface-iron / inventory.stone_pickaxe:1

- 旧: cost 16、展開 5、success
- 新: cost 16.458、展開 5、success（旧再評価 16.458）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x3 → move_to_workbench → auto_workbench_craft_stone_pickaxe`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x3 → move_to_workbench → auto_workbench_craft_stone_pickaxe`

### 108. surface-iron / inventory.furnace:1

- 旧: cost 17、展開 5、success
- 新: cost 17.458、展開 5、success（旧再評価 17.458）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace`

### 109. surface-iron / inventory.torch:4

- 旧: cost 11、展開 4、success
- 新: cost 18.318、展開 4、success（旧再評価 18.318）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_torch`
- 新手順: `auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_torch`

### 110. surface-iron / inventory.chest:1

- 旧: cost 40、展開 28、success
- 新: cost 43.257、展開 19、success（旧再評価 43.257）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_chest`
- 新手順: `move_to_workbench → auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_chest`

### 111. surface-iron / inventory.charcoal:1

- 旧: cost 40、展開 13、success
- 新: cost 43.715、展開 10、success（旧再評価 43.715）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `move_to_workbench → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → auto_gather_log_category_barehand_x3 → place_furnace → smelt_charcoal_with_log`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace → auto_gather_log_category_barehand_x3 → place_furnace → smelt_charcoal_with_log`

### 112. surface-iron / inventory.raw_iron:3

- 旧: cost 1、展開 2、success
- 新: cost 50.711、展開 2、success（旧再評価 50.711）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_iron_ore_category_pickaxe_x3`
- 新手順: `auto_gather_iron_ore_category_pickaxe_x3`

### 113. surface-iron / inventory.category.plank:12

- 旧: cost 35、展開 15、success
- 新: cost 38.257、展開 10、success（旧再評価 38.257）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`

### 114. surface-iron / inventory.category.basic_stone:8

- 旧: cost 2、展開 2、success
- 新: cost 2.458、展開 2、success（旧再評価 2.458）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8`

### 115. surface-iron / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 11.257、展開 2、success（旧再評価 14.514）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`
- 新手順: `auto_gather_log_category_barehand_x8`

### 116. surface-iron / inventory.category.basic_stone:2

- 旧: cost 1、展開 2、success
- 新: cost 1.458、展開 2、success（旧再評価 1.458）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x3`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x3`

### 117. underground-stone / inventory.oak_planks:4

- 旧: cost 15、展開 3、success
- 新: cost 29.839、展開 3、success（旧再評価 29.839）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`
- 新手順: `auto_gather_oak_log_barehand_x1 → auto_hand_craft_oak_planks`

### 118. underground-stone / inventory.stick:4

- 旧: cost 23、展開 4、success
- 新: cost 37.696、展開 4、success（旧再評価 37.696）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick`

### 119. underground-stone / inventory.crafting_table:1

- 旧: cost 5、展開 2、success
- 新: cost 24.46、展開 2、success（旧再評価 24.46）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_crafting_table_x1`
- 新手順: `auto_gather_crafting_table_x1`

### 120. underground-stone / inventory.wooden_pickaxe:1

- 旧: cost なし、展開 200、iteration_limit
- 新: cost 64.696、展開 189、success（旧再評価 なし）
- 判定: **改善**。コストによる探索順の変化で200回以内に計画を発見。
- 旧手順: `計画なし (iteration_limit)`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_hand_craft_stick → auto_hand_craft_planks_from_logs_category → auto_workbench_craft_wooden_pickaxe`

### 121. underground-stone / inventory.wooden_sword:1

- 旧: cost 38、展開 7、success
- 新: cost 52.696、展開 7、success（旧再評価 52.696）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_wooden_sword`

### 122. underground-stone / inventory.stone_pickaxe:1

- 旧: cost 39、展開 17、success
- 新: cost 53.696、展開 17、success（旧再評価 53.696）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_stone_pickaxe`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_gather_basic_stone_category_pickaxe_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → move_to_workbench → auto_workbench_craft_stone_pickaxe`

### 123. underground-stone / inventory.torch:4

- 旧: cost 34、展開 12、success
- 新: cost 66.479、展開 12、success（旧再評価 66.479）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_hand_craft_torch`
- 新手順: `auto_gather_log_category_barehand_x1 → auto_gather_coal_ore_category_pickaxe_x1 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_stick → auto_hand_craft_torch`

### 124. underground-stone / inventory.chest:1

- 旧: cost 40、展開 161、success
- 新: cost 54.696、展開 34、success（旧再評価 54.696）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_workbench_craft_chest`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → move_to_workbench → auto_workbench_craft_chest`

### 125. underground-stone / inventory.charcoal:1

- 旧: cost 40、展開 13、success
- 新: cost 54.696、展開 13、success（旧再評価 54.696）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace → auto_gather_log_category_barehand_x3 → place_furnace → smelt_charcoal_with_log`
- 新手順: `auto_gather_basic_stone_category_pickaxe_x8 → move_to_workbench → auto_workbench_craft_furnace → auto_gather_log_category_barehand_x3 → place_furnace → smelt_charcoal_with_log`

### 126. underground-stone / inventory.shears:1

- 旧: cost 72、展開 60、success
- 新: cost 116.384、展開 181、success（旧再評価 116.384）
- 判定: **中立**。新式で同費用の別手順／別順序を返す。
- 旧手順: `auto_gather_coal_ore_category_pickaxe_x3 → move_to_workbench → auto_gather_basic_stone_category_pickaxe_x8 → auto_workbench_craft_furnace → place_furnace → auto_gather_iron_ore_category_pickaxe_x3 → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_coal → auto_hand_craft_shears`
- 新手順: `move_to_workbench → auto_gather_basic_stone_category_pickaxe_x8 → auto_gather_iron_ore_category_pickaxe_x3 → auto_workbench_craft_furnace → place_furnace → auto_gather_coal_ore_category_pickaxe_x3 → smelt_iron_ingot_with_coal → smelt_iron_ingot_with_coal → auto_hand_craft_shears`

### 127. underground-stone / inventory.raw_iron:3

- 旧: cost 1、展開 2、success
- 新: cost 27.601、展開 2、success（旧再評価 27.601）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_iron_ore_category_pickaxe_x3`
- 新手順: `auto_gather_iron_ore_category_pickaxe_x3`

### 128. underground-stone / inventory.category.plank:12

- 旧: cost 35、展開 64、success
- 新: cost 49.696、展開 18、success（旧再評価 49.696）
- 判定: **情報改善**。手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。
- 旧手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`
- 新手順: `auto_gather_log_category_barehand_x3 → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category → auto_hand_craft_planks_from_logs_category`

### 129. underground-stone / inventory.category.log:4

- 旧: cost 8、展開 4、success
- 新: cost 22.696、展開 2、success（旧再評価 37.392）
- 判定: **推定改善**。全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。
- 旧手順: `auto_gather_log_category_barehand_x1 → auto_gather_log_category_barehand_x3`
- 新手順: `auto_gather_log_category_barehand_x8`
