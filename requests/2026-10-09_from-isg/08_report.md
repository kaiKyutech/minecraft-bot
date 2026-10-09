# 08 照度情報・松明設置APIの実装報告

master `9b329b2` から、指定フォルダで `isg/08-light-torch-2026-10-09` を作成した。L1・T1を別々に実装・検証し、コミットした。

| 段階 | コミット | 内容 |
|---|---|---|
| L1 | `facb37b` | observeFastのlightへlevel/dark/torchNearbyを追加 |
| T1 | `9e6af79` | 明示呼び出しのplaceTorch、設置・中断・ライブ検証、API説明 |

この報告は最後の別コミットに含める。自動で作成・設置する仕組みは追加していない。GOAPの探索、コスト、行動定義、環境の知識は変更していない。既存のplace_block・creative設置・06の採掘や下降処理も維持した。

## L1

既存の `light.block` / `light.sky` をそのまま残し、次を追加した。

- `level`：目の高さ（足元+1.62）のmax(block, sky)。片方でも不明ならnull。時刻・雨・雷の減光補正はしない。
- `torchNearby`：床座標を中心とした球内のtorch / wall_torch。既定半径5、引数torchRadiusで0〜8。ほかの光源はフラグに含めないが、受信したblock lightはlevelへ反映する。
- `dark`：既定level < 8かつ近傍に松明なし。darkBelowは0〜16。松明を検出した場合は光の更新前でもfalse。明るさが閾値以上でもfalse。それ以外で未読込があればnullとし、暗いと断定しない。

小さい共通helper `utils/light_info.js` を追加し、fast_observation.jsは照度呼び出し部分だけを変更した。松明検出は資源走査の部分結果・cache・予算に依存せず、毎回上限付きで読む。資源のmaxMsは厳密な全観測期限ではなく、半径8で最大2109セルの照度用検索は別に行う。⑦との統合を容易にするため、資源観測の仕組みは変えていない。

## T1

`api.placeTorch({ radius=3, placement='auto', darkBelow=8, torchRadius=5, signal }={})` を追加した。placementはauto / floor / wall。返却は通常のResultで、dataにposition、block、placement、beforeLight、afterLight、attempts、viewRestoredを含む。詳細・例は `doc/planner_bot/API.md` に記載した。

在庫の通常torchを装備し、読み込み済み空気の下面・壁面を探す。半径1〜4、上下±1、目から面まで4.5以内。全面の固体を支持面とし、天井・草・葉・部分ブロック等を参照しない。自分のXZ列・身体に重なるマスと、視線方向の直近の通路を除外する。背面・側面、低い位置、近距離を優先し、最大8候補。移動・採集・作成は行わない。

Promiseの成功・例外にかかわらず、対象マスにtorch / wall_torchが実在する場合だけ成功する。空気・別ブロック・未読込は失敗。置けた後に候補を追加実行しない。通常の設置が回す視線は終了前に元へ戻す。

OperationManagerを使用し、既存の実行の中断・終了を待って所有権を取得する。equip / place / lookは発行済み作用の終了を待つ。signal・stop・新しい実行の中断を優先し、中断後に新しい設置や視線復元を始めない。松明なしはITEM_NOT_FOUND、設置未確認はPLACEMENT_FAILED、中断はCANCELLED。引数不正・開始前のabortでは既存所有者を止めない。

## 検証結果

- `npm test`：**255/255合格**。従来242件にL1の4件、T1の9件を追加。⑤のreachability等と、⑥のD1/D2/P1/P2の21回帰テストも含む。
- `node --test --test-concurrency=1 tests/study04/*.test.cjs`：**9/9合格**。
- ⑤BのGOAP照合：**270組、2反復、計1080記録**。従来成功130組の計画全体・コスト・探索回数が一致。不能101組の早期判定、未解決39組の上限も維持。入力不変。goap / heuristic / relevance / state_operationsのソースハッシュは⑤記録と一致。
- オフラインでは4方角・小数座標での身体と正面回避、床・壁の支持面、部分ブロック・未読込の除外、実設置後の例外、空気や別ブロックの失敗、在庫なし、引数検証、中断・所有権のdrainを確認した。
- **ライブ4ケース合格**。地下3件と昼の地表。地下各件は実設置をRCON条件＋サーバーログの固有マーカーで確認した。RCONの空の応答を成功とは扱っていない。

| ケース | bot位置 | 設置位置・実ブロック | 光block/sky/level | dark / torchNearby |
|---|---|---|---|---|
| 地下・床 | (200.5,41,200.5) | (200,41,199) torch | 前0/0/0 → 後0/0/0 | true/false → false/true |
| 地下・壁 | (220.5,41,200.5) | (220,41,197) wall_torch | 前0/0/0 → 後0/0/0 | true/false → false/true |
| 地下・設置直後に例外を注入 | (240.5,41,200.5) | (240,41,199) torch | 前0/0/0 → 後0/0/0 | true/false → false/true |
| 昼の地表・時刻6000 | (250.5,100,250.5) | 設置なし | 0/15/15 | false/false |

地下は各1候補で成功し、在庫4本→3本。設置直後にobserveFastを資源予算0で呼んでもdark=false / torchNearby=trueだった。視線はyaw=π、pitch=0へ復元できた。各地下ケースの在庫なし・事前abortも対応するcodeを返した。発行中の中断と次の所有者の待機はオフラインで検証した。

ライブ準備の予備試行は、未読込の場所へのfillや、結果保存時のBigIntの直列化で失敗した。試験室のforceload・現地読み込みと保存用変換を修正してから全4ケースを再実行し、上表は最終合格試行のみを示す。

## 再実行とデータ

```powershell
npm test
node --test --test-concurrency=1 tests/study04/*.test.cjs
node tests/study05/matrix.cjs B .cache/minecraft-bot/08-study/matrix-B.json
./tests/study08/live.ps1
```

`tests/study08/live-results.json` に実測値・在庫・視線・サーバー確認、`verification.json` に回帰集計・GOAPハッシュを保存した。`verify.cjs` はcache内のnpm-test.log / study04-test.log / matrix-B.jsonとライブ記録を照合する。⑤のtracked matrixや⑥のライブ・計測データは上書きしていない。⑥の自然9試行そのものの再実行はしていない。

## 制限と終了状態

生のskylightを使用するため、夜の地表では明るさを高く見積もり得る。levelは描画の明るさや敵の出現を保証しない。近傍の松明も、壁の遮蔽を含む照明の届き方を保証せず、更新遅れ時の重複判断を避ける指標である。

正面しか置けない場所、範囲外、部分ブロックしかない場所等はPLACEMENT_FAILEDになり得る。未来の経路を完全に予約するものではない。発行済み設置は中断しても物理的に取り消せない。光の値を補正して成功を装ったり、GOAPを変える対処はしていない。

⑦とのサーバー競合を避け、workspace内のignored `.cache/minecraft-bot/08-study/server` に、停止保存済みのworld-05-baseから専用コピーを作成した。25569 / RCON25579のみを利用。元の稼働world、他リポジトリの設定、25568、stable worktree、利用者のMinecraftクライアントは変更していない。秘密値は元propertiesから読み、ignoredな専用設定以外には保存・出力していない。

最終サーバーはsave-all→stop、全dimension保存・Java終了・専用ポート解放を確認した。bot・viewerは残していない。GPU・LLM・JEVは使用していない。

作業中、別作業でmasterが⑦を取り込んだ `adc0b45` へ進んだ。本ブランチは依頼どおり `9b329b2` 起点を維持し、⑦取り込み後との結合試験や統合は行っていない。本エージェントからmasterへのmerge・pushはしていない。報告を完了したので、ここで停止する。
