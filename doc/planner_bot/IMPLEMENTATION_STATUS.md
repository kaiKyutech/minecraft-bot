# Planner Bot - 実装状況

**最終更新**: 2025-10-24

このドキュメントは実装状況を一目で確認するためのチェックリストです。
詳細な設計・実装については [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

---

## 凡例

- ✅ 実装完了・動作確認済み
- ⚠️ 実装済み・未テスト
- 🔄 計画中・未実装
- ❌ 未実装

---

## アーキテクチャ

### ボット構成

- ✅ AI Bot (複数体対応、マルチプロセス対応)
- ✅ 1プロセス1ボット方式
- ✅ PM2によるプロセス管理
- ❌ ~~Camera-Bot~~ (削除済み)
- ❌ ~~Observer Pool~~ (削除済み)

### 設定

- ✅ `.env`によるボット数設定
- ✅ `AI_BOT_COUNT` - AI Bot数
- ✅ ecosystem.config.js - PM2設定
- ❌ ~~`CAMERA_COUNT`~~ (削除済み)

---

## GOAP システム

### コア機能

- ✅ A* プランニング
- ✅ 状態管理 (State Manager)
- ✅ リプランニング (失敗時自動再計画)
- ✅ 診断システム (失敗原因表示)

### アクション定義

- ✅ リソース採集 (`gather_actions.yaml`)
- ✅ 手持ちクラフト (`hand_craft_actions.yaml`)
- ✅ 作業台クラフト (`workbench_craft_actions.yaml`)
- ✅ 移動・設置 (`movement_actions.yaml`)

### 状態管理

- ✅ 状態スキーマ (`state_schema.yaml`)
- ✅ ブロック分類 (`block_categories.yaml`)
- ✅ インベントリ状態
- ✅ 周辺環境状態
- ✅ 装備状態

### スキル

- ✅ gather (採集)
- ✅ craft (クラフト)
- ✅ equip (装備)

### プリミティブ

- ✅ moveTo (移動、タイムアウト計算改善済み)
- ✅ digBlock (採掘)
- ✅ craftItem (クラフト)
- ✅ equipItem (装備)

### コマンド

- ✅ `!goal <state>:<value>`
- ✅ `!skill <name> [params]`
- ✅ `!primitive <name> [params]`

---

## Creative アクション

### Navigation

- ✅ `register` - 現在地を名前付きで登録
- ✅ `goto` - 登録済みの場所に移動
- ✅ `gotoCoords` - 座標指定で移動
- ✅ `moveInDirection` - Yaw方向と距離で移動（地表検出機能付き）
  - ✅ `nearest` - 最も近い地面
  - ✅ `below` - 下方向の地面
  - ✅ `above` - 上方向の地面
  - ✅ `surface` - 空が見える地表
- ✅ `follow` - プレイヤー追跡
- ✅ `stopFollow` - 追跡停止
- ✅ `list` - 登録済み場所一覧

### Vision

- ✅ `capture` - スクリーンショット取得
  - ✅ 動的ポート割り当て (get-port)
  - ✅ オンデマンドviewer起動
  - ✅ Yaw視野ガイド (±60° FOV)
  - ✅ ターゲットサークル (視線先ブロック情報)
  - ✅ 座標系修正 (北=0°、反時計回り)
  - ✅ Base64画像データ出力
  - ✅ ファイル保存 (screenshots/screenshot_{botname}.png)
- ❌ ~~`captureDirection`~~ (削除済み、captureに統合)
- ❌ ~~`capturePanorama`~~ (削除済み)
- ❌ ~~`stats`~~ (Observer Pool削除により不要)

### Exploration

- 🔄 `topDownMap` - 俯瞰ヒートマップ生成（計画中）
  - 相対高度を色で表現
  - オブジェクトマーク（絵文字/ラベル）
  - 北を上にした座標グリッド
- ❌ `randomWalk` - ランダム探索
- ❌ `searchBlock` - 特定ブロック探索
- ❌ `returnHome` - 帰還

### Building (未実装)

- ❌ `loadBlueprint` - 設計図読み込み
- ❌ `placeBlocks` - ブロック配置
- ❌ `build` - 建築実行

---

## 視覚システム

### コア機能

- ✅ AI Botが自分自身の視界をキャプチャ
- ✅ prismarine-viewer (オンデマンド起動)
- ✅ 動的ポート割り当て
- ✅ Puppeteerによるスクリーンショット
- ✅ 視線方向設定 (yaw, pitch)
- ✅ `bot.blockAtCursor()` による視線先ブロック情報
- ❌ ~~Observer Pool~~ (削除済み、YAGNI原則により簡素化)
- ❌ ~~Camera-Bot~~ (削除済み)

### 画像オーバーレイ

- ✅ 左上情報ボックス (Pos, Yaw, Pitch, Target)
- ✅ Yaw視野ガイド (左端・中央・右端の垂直線)
- ✅ ターゲットサークル (画面中央、緑の照準)
- ✅ 視線先ブロック情報表示
- ❌ Pitch視野ガイド (削除済み、LLMが混乱するため)

### 座標系

- ✅ Yaw: 北=0°、反時計回り（西=90°、南=180°、東=270°または-90°）
- ✅ Pitch: 水平=0°、上=マイナス、下=プラス
- ✅ Mineflayer公式ドキュメントの誤りを修正（実測に基づく）

### 未実装

- ❌ 画像処理機能
- ❌ LLMへの画像送信（別プロジェクトで実装予定）

---

## 会話履歴システム

### コア機能

- ✅ 全員の発言を時系列保存
- ✅ フィルタリング機能
- ✅ FIFO (100メッセージ上限)

### ログ関数

- ✅ `bot.systemLog()` - コンソール出力
- ✅ `bot.speak()` - MC whisper送信 (定義のみ、LLMプロジェクトで使用)
- ✅ `bot.addMessage()` - 履歴追加

### フィルタリング

- ✅ ユーザー指定 (`username`)
- ✅ 複数ユーザー指定 (`usernames`)
- ✅ タイプ指定 (`type`)

### メッセージタイプ

- ✅ `natural_language` - 自然言語
- ✅ `bot_response` - ボット発話
- ✅ `system_info` - システム情報

### コマンド処理

- ✅ `!`で始まるメッセージはコマンド（履歴に入れない）
- ✅ それ以外は自然言語として履歴に追加

### 未実装

- ❌ 会話履歴の永続化
- ❌ LLMへの履歴送信（別プロジェクトで実装予定）

---

## その他コマンド

- ✅ `!status` - 現在の状況表示
- ✅ `!creative <category> <action> [params]`

---

## 将来実装したい機能

### 探索システム

- 🔄 topDownMap (俯瞰ヒートマップ、計画中)
- ❌ ランダム探索
- ❌ 特定ブロック探索
- ❌ マッピング (訪問済みチャンク記録)
- ❌ 帰還アルゴリズム
- ❌ 未探索エリア優先探索

### 建築システム

- ❌ 設計図フォーマット定義
- ❌ 設計図読み込み
- ❌ ブロック配置計画
- ❌ 建築実行
- ❌ 建築進捗管理

### 戦闘システム

- ❌ 敵対Mob検出
- ❌ 攻撃アクション
- ❌ 回避・防御
- ❌ HP管理

### インベントリ管理

- ❌ アイテム整理
- ❌ 不要アイテム破棄
- ❌ チェスト操作
- ❌ アイテム転送

### LLM統合（別プロジェクトで実装予定）

- ❌ 画像をLLMに送信
- ❌ LLMからのコマンド受信
- ❌ 自然言語による目標設定
- ❌ 会話履歴をLLMに渡す
- ❌ LLMによる状況判断

### その他

- ❌ 村人取引
- ❌ レッドストーン回路
- ❌ エンチャント
- ❌ 醸造
- ❌ 農業 (自動農場)

---

## 次のステップ (優先度順)

### 優先度: 高

1. **topDownMapの実装**
   - 俯瞰ヒートマップ生成
   - 相対高度を色で表現
   - オブジェクトマーク（木、石、建材など）
   - LLMが座標を理解しやすくする

2. **moveInDirectionの改善**
   - ✅ 地表検出機能追加済み
   - ✅ surface モード追加済み
   - ✅ 空間確認（2ブロック）追加済み

### 優先度: 中

- 探索システムの実装 (ランダム探索)
- 建築システムの設計 (設計図フォーマット)

### 優先度: 低

- 戦闘システム
- 村人取引
- レッドストーン回路

---

## 最近の主な変更 (2025-10-24)

### Vision システム
- ✅ Observer Pool削除（YAGNI原則）
- ✅ AI Botが自分自身のスクリーンショットを取得
- ✅ 動的ポート割り当て (get-port)
- ✅ Yaw座標系修正（北=0°、反時計回り）
- ✅ Pitch視野ガイド削除（LLMの混乱を防ぐ）
- ✅ ターゲットサークルと視線先ブロック情報追加

### Navigation システム
- ✅ `follow` / `stopFollow` 実装
- ✅ `moveInDirection` 実装
  - ✅ 4つの地表検出モード (nearest, below, above, surface)
  - ✅ 2ブロック分の空間確認（全モード）
  - ✅ Yaw座標系修正（vision と一致）

### プリミティブ
- ✅ `moveTo` タイムアウト計算改善（線形増加、1ブロック=1秒、最小30秒）

---

## 関連ドキュメント

- [API.md](./API.md) - 使い方・コマンドリファレンス
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 設計詳細・システムフロー
- [CLAUDE.md](../../CLAUDE.md) - プロジェクト概要・開発ガイド
