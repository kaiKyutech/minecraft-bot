# Planner Bot - 実装状況

**最終更新**: 2025-10-19

このドキュメントは実装状況を一目で確認するためのチェックリストです。
詳細な設計・実装については [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

---

## 凡例

- ✅ 実装完了・動作確認済み
- ⚠️ 実装済み・未テスト
- ❌ 未実装

---

## アーキテクチャ

### ボット構成

- ✅ AI Bot (複数体対応)
- ✅ Camera-Bot (複数体対応)
- ✅ Observer Pool (Camera-Bot管理)
- ✅ 1プロセスで全ボット起動

### 設定

- ✅ `.env`によるボット数設定
- ✅ `AI_BOT_COUNT` - AI Bot数
- ✅ `CAMERA_COUNT` - Camera-Bot数

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

- ✅ moveTo (移動)
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
- ✅ `list` - 登録済み場所一覧

### Vision

- ⚠️ `capture` - スクリーンショット取得
- ⚠️ `captureDirection` - 指定方向スクリーンショット
- ⚠️ `capturePanorama` - パノラマ撮影
- ✅ `stats` - Observer Pool統計

### Exploration (未実装)

- ❌ `randomWalk` - ランダム探索
- ❌ `searchBlock` - 特定ブロック探索
- ❌ `returnHome` - 帰還

### Building (未実装)

- ❌ `loadBlueprint` - 設計図読み込み
- ❌ `placeBlocks` - ブロック配置
- ❌ `build` - 建築実行

---

## 視覚システム (Observer Pool)

### コア機能

- ✅ Camera-Botプール管理
- ✅ リクエストキューイング
- ✅ Camera-Bot割り当て
- ✅ 統計情報収集

### Camera-Bot

- ⚠️ prismarine-viewer起動
- ⚠️ TP機能 (AI Botの位置に移動)
- ⚠️ 視線方向設定

### Puppeteer

- ⚠️ ブラウザ起動
- ⚠️ スクリーンショット撮影
- ⚠️ 画像データ取得 (Base64)
- ⚠️ オーバーレイ (位置・方角情報)

### 未実装

- ❌ 画像保存機能
- ❌ 画像処理機能
- ❌ LLMへの画像送信

---

## 会話履歴システム

### コア機能

- ✅ 全員の発言を時系列保存
- ✅ フィルタリング機能
- ✅ FIFO (100メッセージ上限)

### ログ関数

- ✅ `bot.systemLog()` - コンソール出力
- ✅ `bot.speak()` - MC whisper送信
- ✅ `bot.addMessage()` - 履歴追加

### フィルタリング

- ✅ ユーザー指定 (`username`)
- ✅ 複数ユーザー指定 (`usernames`)
- ✅ タイプ指定 (`type`)

### メッセージタイプ

- ✅ `natural_language` - 自然言語
- ✅ `bot_response` - ボット発話
- ✅ `system_info` - システム情報

### コマンド

- ✅ `!history` - 全履歴表示
- ✅ `!history <user>` - ユーザー指定
- ✅ `!history <user1>,<user2>` - 複数指定
- ✅ `!echo <message>` - オウム返しテスト

### 未実装

- ❌ 会話履歴の永続化
- ❌ LLMへの履歴送信

---

## その他コマンド

- ✅ `!status` - 現在の状況表示
- ✅ `!creative <category> <action> [params]`

---

## 将来実装したい機能

### 探索システム

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

### LLM統合

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

1. **視覚システムのテスト**
   - Camera-Botのviewer起動確認
   - スクリーンショット撮影テスト
   - 画像データ取得確認

2. **探索システムの実装**
   - ランダム探索の実装
   - Creative actionとして追加

3. **建築システムの設計**
   - 設計図フォーマット決定
   - ブロック配置アルゴリズム設計

### 優先度: 中

- LLM統合準備 (画像送信API設計)
- 会話履歴の永続化
- インベントリ管理機能

### 優先度: 低

- 戦闘システム
- 村人取引
- レッドストーン回路

---

## 関連ドキュメント

- [API.md](./API.md) - 使い方・コマンドリファレンス
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 設計詳細・システムフロー
- [ISSUES.md](./ISSUES.md) - 現在の課題・未解決問題
