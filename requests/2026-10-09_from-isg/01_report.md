# 01 リファクタリング完了報告

2026-10-09。②リファクタリングエージェント。作業ブランチは `refactor/isg-2026-10-09`。
承認済みの01_planと00_decisionsに従って実装した。push・masterへの変更・mergeは行っていない。

## 結果

- 同一プロセスから使える `createBotApi` を追加し、全メソッドとチャット入口を `{ ok, data, error }` に統一した。
- 観測・計画を実行と並行できるようにし、移動・実行はbotごとに1つの所有者へまとめた。外部AbortSignal、停止、置換、チェストの続行を扱う。
- GOAPの道具事前準備、数量削減、再帰補助目標、前提再検査、再計画を保持した。
- 接続版に合わせた自動生成を、全計画入口のprepareに統一した。生成物は `.cache/minecraft-bot/actions/<版>/`。`.gitignore` は承認された `/.cache/minecraft-bot/` の1行のみ追加。
- skillとcreativeの置き場所探索を共通化し、2つのpolicyと候補順序を維持した。
- 循環依存、refreshの未定義setCommand、visionの未定義loggerを修正した。追加承認に従い実際のbot.viewerを確実に閉じる後処理も修正した。
- API文書を書き直した。yaw90°は西（X−）に訂正し、存在しないCLAUDE.md参照を除いた。

`npm test` は184件すべて成功。5観測状態×14目標＝70件のplan/diagnosis goldenを含め、
plannerの93件が基準と一致した。generator golden、状態facts、非破壊性も成功した。
基準fixtureと `planner_bot/config/` の追跡ファイルは、01開始前から変更していない。
公開結果契約の変更に伴うassertionを更新し、ワールド作用の検査は残した。goldenを更新して通したものはない。

## 構造と依存

| 層 | 変更後の担当 |
|---|---|
| 公開入口 | `planner_bot/api.js`。requireだけで接続・dotenv読込・viewer起動をしない |
| 関数API | `src/api.js`。Result変換、入力、観測と操作の振り分け |
| commands | 文字列解析とAPI呼び出し。独立した大きな実装は移動した |
| executor | goal_runnerに従来!goal全体、goap_executorに前提再検査/補助計画/再計画、operation_managerに所有権/停止 |
| planner | domain、goals、state_operations、relevance、heuristic、priority_queue、failure_diagnosis、diagnosis、logging/options |
| 観測 | state_manager.observeは局所的なworldState、refreshは完了した観測をcacheへ公開。info/statusは独立viewを使用 |
| 操作 | skills/primitives、navigationのactions/placement/placement_search/look/idle、bot/conversation |
| 横断 | utils/resultとAsyncLocalStorageによるcontext/logger |

goap.jsは約1,700行から408行へ分割した。ヒープ・探索順・コスト・ヒューリスティック・条件/効果・
関連変数の選び方・200回の探索上限・yield間隔は変更していない。01では高速化していない。
executorからcommandsへの逆参照を除き、診断をplannerへ移した。

## 変更した公開API

使い方・入力・data・code・停止仕様の詳細は `doc/planner_bot/API.md`。

| 変更前 | 変更後 |
|---|---|
| package mainが存在しないindex.js | planner_bot/api.jsからcreateAIBot/createBotApiをexport |
| 主にhandleChatCommandへの文字列入力 | createBotApi(bot, {stateManager, logLevel})。同じbotのAPIは操作管理を共有 |
| success / undefined / throwの混在 | 全APIメソッドとチャット入口がPromise<Result>。成功data、失敗error.code/message/details |
| !goal | executeGoal(goal, {signal, username})。planGoalは計画だけ |
| !skill / !primitive | executeSkill / executePrimitive。data.name/resultに実際の返り値を保持 |
| !navigation / !creative | navigate / placeBlock。失敗したcreativeもok:false |
| !info / !status / !refresh | info / status / observe / refresh。statusもworldStateを返す |
| !stop / bot.currentAbortController | stopと各実行メソッドの外部AbortSignal。従来botプロパティも維持 |
| look/idle、会話・履歴 | look/startIdle、chat/echo/addMessage/history/speak/speakNearby |
| goal_commandの診断export | planner/diagnosis.js |
| goap.plan/collectShortagesの暗黙domain | 全計画入口でprepareDomain。第4引数のversion、または事前prepareDomain |
| loadDomain/getAllActionsの未準備アクセス | prepareDomain完了後に同期取得。未準備はDOMAIN_NOT_READY |

createAIBotは既存の同期factoryのまま。spawnを待って使う。
内部plannerは従来の `{plan, diagnosis}`、直接skill/primitiveは低レベルの値/throw契約を維持した。
これらは公開Result APIの所有権管理を通らない。関数としての通常利用にはcreateBotApiを使う。
数値目標を現在在庫へ加える意味、YAML形式、カテゴリ、ブロックからの資源取得は維持した。

## 同時実行と停止の確認

observe/planGoal/info/statusは実行を置換せず、実行cacheやrefresh抑制フラグを汚さない。
明示refreshは完了した状態のみを公開し、古い要求の後着を防ぐ。
新しい実行/移動は前を中断し、発行済みの非同期操作が終了してから次へ進む。
A→B→Cで未開始のBが置換された場合はCANCELLED。古いfinallyがCを消すことはない。

chestの転送/closeはセッション内で逐次化し、stop後の未開始続行はCANCELLED。
follow開始後も外部signalを保持し、abortで追跡を止める。stopはidle/watchの実行済みtickも待つ。
開始前にabort済みの新しい要求は現在の実行を停止しない。複数botは独立する。

方向指定visionは実行/follow中にOPERATION_CONFLICT。方向省略は実行と並行できる。
同じbotの撮影は逐次化する。カメラだけを動かす変更やlook/idle/watchの方針変更は行っていない。

## テスト結果と機能維持表

Node v24.2.0、Minecraft 1.20.1。新しい依存は追加していない。
ログは `.cache/minecraft-bot/refactor-results/` に保存した（コミット対象外）。
通常のtest:live等は引き続きtests/resultsへ出力し、今回の記録のみキャッシュへ整理した。

| 検証 | 結果・記録 |
|---|---|
| npm test | 184/184成功、約42.6秒。refactor-offline-final.log |
| planner golden | 5 snapshot×14目標のplan/diagnosis、facts、条件等93件成功。基準変更なし |
| npm run test:live | 2/2成功、177.1秒。refactor-live-final.log、live-flat.json、live-natural.json |
| 自然の3目標 | 資源配置区画・空の在庫から、木ツルハシ21.1秒、石ツルハシ28.6秒、かまど40.1秒で成功。かまどは関数API入口で実行 |
| npm run test:vision | 1/1成功、16.2秒。PNG署名/1920×1080画像を確認。再撮影、方向競合、並行実行、browser起動失敗とclose失敗時もviewer解放。refactor-vision-final.log、vision.json |
| observe:standalone | 1体・2体のspawn、設定不足時のexit 1と案内を確認。基準fixtureを更新せずstandalone.jsonへ保存 |
| 循環依存 | requireのCJS/ESM、起動、再計画失敗で警告とundefined診断関数なし |
| git差分 | fixtureとconfigに差分なし、git diff --check成功 |

GPUテストは許可済みとして実施した。Puppeteerの期待するChromeが未配置だったため、
実行プロセスに `PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe` を指定した。
設定ファイルや他プロジェクトは変更していない。GPUテスト内の模擬起動/close失敗ログは意図した検査。

| 維持する機能 | 確認結果 |
|---|---|
| GOAP計画/診断/設置済み建築ブロックも資源にする | planner golden一致、数量加算テスト成功。禁止条件は追加していない |
| 道具準備/数量削減/補助目標/再帰/再計画/逆転前提 | executor/runnerテスト成功、自然3目標とflat成功/不能目標成功 |
| 停止/外部signal/実行置換/2bot独立 | offline所有権テストとlive goal↔move、並行observe/info/status/refresh/plan成功 |
| 全9スキル | flatでgather、collect_drops、hand/workbench_craft、furnace_smelt、place_block、equip_mainhand/armor、move_toを確認 |
| primitive8種/道具helpers | flatで探索/移動/採掘/回収/クラフト/設置/装備、findBestTool/equipBestToolForBlockを確認 |
| 登録/登録先・座標・方向移動 | register/goto/gotoCoords、nearest/below/surface成功、aboveの既存失敗も保持 |
| follow/stopFollow/drop/pickup | 追跡と停止、その場と相手近くのdrop、実アイテムentity回収成功 |
| chest4種/stop/chat時close | 通常countのopen/deposit/withdraw/close、stop/chatで解放。続行の停止競合もoffline成功 |
| skill/creative設置 | 6候補順・下面参照、3D探索・距離tieの順をoffline固定。座標あり/なし・占有失敗・skillをlive確認 |
| info all/scan/recipes/status/refresh | payloadとrecipe golden成功、live全種類、移動中に所有者を維持したまま取得 |
| vision | 上記GPUテスト。画像は草地と空、yaw90/pitch0の情報が正しく描画されることを目視確認 |
| whisper/chat/history/echo/自然言語event | peerとのlive通信成功。手動履歴、100件FIFO、sequence/filter、custom hook、autoHandleWhisper:false、speakNearby/chatWithDelayはoffline成功 |
| look/idle/watch | live方向/player/watch/idle/stop、offlineで実行中tickを待つ停止を確認 |
| 自動生成/版選択 | generator golden一致、初回plan準備、共通prepare・失敗再試行・同時準備・版競合・追跡YAML不変を確認 |
| 単体起動/複数bot/ログ | standalone確認、bot分離と並行log文脈、prototypeのloggerも確認。error設定のliveで同じ作用が成功 |

今回起動したフラットPID47620と自然PID45680は、RCON save-all→stopで正常終了した。
両PIDが終了したことも確認した。テストbotはquitし、ブラウザ/viewerは解放した。
ユーザーのMinecraftクライアントや他プロジェクトのコード・設定は変更していない。

## 残した問題・気づいた点

| 項目 | 扱い |
|---|---|
| chest count=-1の一部失敗 | 原因・計算を01では変更していない。02へ |
| 元の自然地形でかまどが90秒で終わらない | 00の観察を維持。今回の受入は決定事項6に従って資源配置区画。02へ |
| skillの置き場所6候補・creativeの半径5 | 挙動を保持。探索の改善は02へ |
| 資源採集や再計画で同じ失敗を繰り返す、探索性能 | アルゴリズム・上限は保持。02/03で扱う |
| 実行中の任意方向vision、常設viewer/browser | 今回はOPERATION_CONFLICTと都度後処理。カメラだけを動かす機能は03へ |
| domainの実行中reload/複数版同時対応 | 追加していない。プロセス1版、同版のprepare共有 |
| dependency.yaml・未使用関数・コメント化された探索上限 | 利用へ結び付けたり削除して意味を変えたりしていない |
| 似た回収処理 | navigation.pickupItems（range5/名前フィルタ）とprimitives.collectDrops（radius6）/skill.collect_drops（radius12/試行）は既定値・再試行が異なるため維持 |
| 似た作成・移動処理 | hand/workbench craftとprimitive craft、skill move_toとnavigation/primitive moveは道具・材料・距離・探索の責務が異なるため維持 |
| 自動履歴追加がない | 従来どおり。API文書を手動追加へ訂正した |

検証範囲は1.20.1、許可済み2ワールドと5観測snapshot。別版の実サーバー、
ネットワーク切断中のあらゆるMineflayer操作、元自然地形の全到達性は今回の受入検証に含めていない。
abortは発行済みのMinecraft作用を巻き戻さず、終了・後処理を待って次の副作用を防ぐ契約。

## 段階コミット

| commit | 内容 |
|---|---|
| 926fcb4 | 診断の循環依存、refresh/vision logger、計画書 |
| ce5280d | 版別domain準備とcache |
| 84c7df0 | 実bot.viewerの取得とclose |
| 35e044d | !goal全体をgoal_runnerへ移動 |
| 08168d6 | 独立観測、非同期context/logger |
| 624faff | 操作所有権、中断をskills等へ伝播 |
| 90a568b | 公開Result API、薄いチャット入口 |
| 50f9fbd | 2policyを保持した設置探索共通化 |
| 37780df | GOAP責務分割、golden一致 |
| 122a9b0 | code/log文脈、中断境界、viewer/idle後処理の補強 |
| 763cc69 | custom planning loggerのprototype/this保持 |

最後の文書・検証コミットに、live検証、API文書、本報告をまとめた。
結果ログやPNG・生成cacheはコミットしない。追加依存はない。
