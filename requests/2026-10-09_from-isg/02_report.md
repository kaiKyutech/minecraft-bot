# 02 バグ修正報告

2026-10-09。③実装エージェント。master `1f8951d` から `isg/02-03-2026-10-09` を作成し、承認された02_03_planに従って実装。
masterへの変更・merge・pushは行っていない。

## 変更

- **B1**：実行ごとのFailureGuardを追加。関連状態・action/params・失敗理由が同じ失敗3回、または進展のない失敗10回で `REPEATED_FAILURE`。detailsにgoal/action/params/code/reason/attempts/limit/limitKindを返す。前提不足、補助目標の成功後に親を再試行するループ、数量削減での終了伝播も扱う。時刻・視線・小さい座標の揺れは進展にしない。実際の在庫や環境変化は区別する。通常の計画・行動選択は変更していない。
- **B2**：従来6候補の順序・下面参照を優先し、すべて失敗した場合のみ半径5のGOAP用立体探索へ進む。固体の6方向参照、草/雪の層/空気各種の置換、体積重複と到達距離の除外を追加。creativeの既存policyは変更していない。
- **B3**：01のmoveToに、timeoutでsetGoal(null)しgotoをdrainする実装がすでにあった。offlineと実サーバーで確認し、本体は変更せず回帰テストを追加。
- **B4**：prismarine-windowsの `items()` はプレイヤー側を返すため、withdrawはcontainer側slots（0〜inventoryStart）を明示的に参照する。count=-1は転送元の全スタックをmetadata/NBTごとに合算して転送する。単体/ラージチェストとdeposit→withdraw1→withdraw全部を検証。失敗を成功数に含めず、完了グループのtransferredCountを保持する。
- API.mdに変更した動作とREPEATED_FAILUREを追加。

## 検証

各新規バグテストは修正前に失敗を確認し、修正後に成功した。B3は現状で通る回帰テストとして扱った。

| 検証 | 結果 |
|---|---|
| npm test | 193/193成功、50.2秒。70件のplan/diagnosis goldenを含む。fixtureを更新していない |
| 最後のrunnerループ補強後のrunner/executor | 13/13成功 |
| npm run test:live（最終） | 4/4成功、243.2秒。自然3目標25.5/34.0/46.5秒 |
| 草上の作業台・単体/ラージchest・timeout | ライブ成功。chestは130個deposit→1個withdraw→129個withdraw全部、空chestの全部失敗も確認 |
| 追加のB2ライブ確認 | 雪の層・cave_air・従来6候補がすべて固体で塞がれた上段の窪みへのfurnace設置が成功（03の完了検証時に追加、1/1成功） |
| 地下y=16・幅1通路でiron_ingot:1 | 2回成功。14.9秒・14.3秒。furnace/raw_iron3/acacia_planks3/丸石/木・石ツルハシを与え、設置から精錬まで確認 |
| 既存flatライブ全機能 | 成功。最後の検証64.9秒 |
| 自然資源配置区画の木/石ツルハシ/かまど | 成功。初回の回帰では25.7/32.3/42.9秒。元地形とは別条件 |

ラージチェストの最初のテスト配置が2つのsingle chestだったため失敗した。type=left/rightを明示してテスト側を修正した。製品の挙動変更でテストを通したものではない。
ローカル接続はsandboxでEACCESになったため、承認済みローカルライブ試験を制限外で実行した。

## B5：元の自然地形の結果と残件

元の自然ワールドへ資源を追加せず、空在庫から試した。

- Natural02、開始(-2.5,66,13.5)：木ツルハシ21.2秒、石ツルハシ24.4秒でREPLAN_FAILED。かまどは120.1秒の観察上限でCANCELLED。元地形の3目標安定成功は達成していない。
- 別の新規bot Natural02B、開始(-6.5,70,19.5)、空在庫でかまどを再試行。道具準備の原木3個採集中、最初にpathfinderが `Took to long to decide path to goal!`。次の採集候補が見つからず同じ5手の計画を繰り返し、26.97秒でREPEATED_FAILURE（BLOCK_NOT_FOUND、同じ理由3回）。在庫は空のまま。

コードとログから、観測で原木があることと実際に到達できることに差があり、gatherの既定searchSampleSize=1と失敗位置の回避により代替候補へ進めないケースを確認した。このケースはかまど設置以前に起きるためB2だけでは直らない。B1は同じ失敗を有限で返す。
元の①観察と同一のワールド状態ではなく、元の90秒中断すべてを同じ原因と断定はしない。

**提案**：gatherの失敗後に取得する候補数を広げて到達可能な別資源を試す改善、到達性を踏まえた環境情報の提供。今回は承認された変更範囲を保ち、候補選択やplannerの意味は変更しない。この未修正調査結果は02の依頼で認められた報告範囲であり、03の追加APIには進む。

## 記録・コミット・後片付け

- キャッシュに02-offline-final.log、02-live-final.log、02-natural-run.log、02-natural-detail.log、02-03-results/02-natural*.jsonを保存。初期worldStateは大きいためコミットしない。
- 61cd389：B1と承認済み計画。f34a9cc：B2。227b0c2：B4/B3回帰。残りのライブ試験と文書は02の完了コミットへまとめる。
- 生成は版別cache。追跡YAML・golden・.gitignoreを変更していない。秘密を記録していない。①bのファイル、他プロジェクトのコード・設定、Minecraftクライアントに触れていない。
- テストbotはquit。今回起動したflat PID9344、natural PID34672は03のライブ検証にも使用し、03完了時にRCON save-all→stopで終了する（終了確認は03_reportに記載）。

02の最終ライブコマンドは終了コード0。計画変更が必要な回帰はないため、承認どおり03へ続行する。
