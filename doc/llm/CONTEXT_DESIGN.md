# LLM コンテキスト設計 - アイテム情報の効率的な提供

**最終更新**: 2025-10-20

このドキュメントは、LLM統合時にマイクラ世界のアイテム情報を効率的にプロンプトに含める方法を検討します。

---

## 問題

### 課題1: プロンプト長の制限

**問題**:
- マイクラには数百種類のアイテム・ブロックが存在
- すべてのアイテム情報をプロンプトに含めると長すぎる
- プロンプトが長すぎると:
  - トークン消費が増加
  - LLMの性能劣化（重要な情報が埋もれる）
  - レスポンス速度の低下

**具体例**:
```
# 全アイテムを含めた場合（悪い例）
利用可能なアイテム:
- oak_log, spruce_log, birch_log, jungle_log, acacia_log, dark_oak_log,
- oak_planks, spruce_planks, birch_planks, jungle_planks, ...
- stone, cobblestone, stone_bricks, mossy_stone_bricks, ...
- diamond, diamond_ore, deepslate_diamond_ore, ...
- netherite_ingot, netherite_scrap, ancient_debris, ...
（以下300種類続く...）
```

### 課題2: 文脈依存のアイテム選択

**問題**:
- 現在の場所だけでフィルタリングすると不十分
- 村にいてもダイアモンドやネザーの話題が出る
- 将来の計画（「ネザーに行きたい」）に必要なアイテムも含める必要がある

**具体例**:
```
状況: プレイヤーが村にいる

場所ベースのフィルタ（不十分）:
→ wheat, carrot, potato, villager_spawn_egg のみ提供
→ 「ダイアモンドを取りに行こう」という会話ができない

理想:
→ 現在地のアイテム + 会話の文脈に応じたアイテムを提供
```

---

## 解決策の方向性

### 1. 階層的なアイテム情報提供

**基本アイデア**:
- レベル1: 常に提供する基本アイテム（木材、石、鉄など）
- レベル2: 現在地周辺で入手可能なアイテム
- レベル3: 会話の文脈に応じて動的に追加

**例**:
```yaml
# レベル1: 基本アイテム（常に提供）
basic_items:
  - oak_log, stone, cobblestone, iron_ingot, diamond
  - crafting_table, furnace, chest
  - wooden_pickaxe, stone_pickaxe, iron_pickaxe

# レベル2: 現在地周辺（動的）
nearby_items:
  - wheat, carrot, potato  # 村にいる場合

# レベル3: 文脈ベース（動的）
contextual_items:
  - obsidian, flint_and_steel  # 「ネザー」という単語が出たら追加
  - ender_pearl, blaze_rod     # 「エンド」という単語が出たら追加
```

### 2. セマンティック検索による動的フィルタリング

**基本アイデア**:
- 会話履歴から重要なキーワードを抽出
- キーワードに関連するアイテムを動的に追加
- ベクトル検索や埋め込みを使った類似度計算

**フロー**:
```
1. 会話履歴を分析
   「ダイアモンドを取りに行きたい」

2. キーワード抽出
   → "diamond", "mining", "underground"

3. 関連アイテムを検索
   → diamond, diamond_ore, iron_pickaxe, torch, ladder

4. プロンプトに追加
```

### 3. カテゴリベースの圧縮

**基本アイデア**:
- 個別のアイテムではなく、カテゴリで提供
- 必要に応じて詳細を展開

**例**:
```yaml
# 圧縮版
categories:
  - logs: [oak_log, spruce_log, birch_log, ...]
  - planks: [oak_planks, spruce_planks, ...]
  - ores: [iron_ore, gold_ore, diamond_ore, ...]

# プロンプト例
利用可能なアイテムカテゴリ:
- logs（6種類の原木）
- planks（6種類の板材）
- ores（鉱石類）
...

# LLMが「oak_log」を指定すると、システムが展開して実行
```

### 4. 段階的な情報提供

**基本アイデア**:
- 最初は最小限の情報のみ提供
- LLMが「利用可能なアイテムを教えて」と聞いたら詳細を返す
- Function calling / Tool use で動的に取得

**フロー**:
```
LLM: 「木材で何か作りたい」
  ↓
System: 基本アイテムのみ提供
  ↓
LLM: getAvailableItems("wood") を呼び出し
  ↓
System: 木材関連アイテムの詳細を返す
  ↓
LLM: 「oak_planks を使ってクラフトしよう」
```

---

## 具体的な実装案

### 案A: ハイブリッドアプローチ（推奨）

**組み合わせ**:
1. 基本アイテム（常に提供） - 30種類程度
2. 現在地周辺アイテム（動的） - 10種類程度
3. 会話文脈アイテム（キーワードベース） - 10種類程度
4. カテゴリ情報（圧縮） - 全カテゴリ

**プロンプト例**:
```
# 基本アイテム
常に利用可能: oak_log, stone, iron_ingot, diamond, crafting_table, ...

# 現在地周辺
周辺で入手可能: wheat, carrot, potato (村)

# 会話文脈
会話に関連: obsidian, flint_and_steel (「ネザー」が言及されたため)

# カテゴリ
その他のアイテムカテゴリ: logs(6種), planks(6種), ores(8種), ...
詳細が必要な場合は getItemCategory(category_name) を使用
```

### 案B: 完全動的アプローチ

**特徴**:
- プロンプトには最小限の情報のみ
- すべてFunction callingで取得

**プロンプト例**:
```
利用可能なツール:
- getAvailableItems(category): カテゴリのアイテム一覧を取得
- searchItems(keyword): キーワードに関連するアイテムを検索
- getNearbyItems(radius): 周辺で入手可能なアイテムを取得

アイテムの詳細が必要な場合はこれらのツールを使用してください。
```

---

## 技術的な検討事項

### 1. アイテムカテゴリの定義

**既存の実装**:
- `config/block_categories.yaml` - ブロックのカテゴリ定義
- GOAP用に一部実装済み

**拡張の必要性**:
- LLM向けにより詳細なカテゴリ分類
- アイテムの用途別分類（建築、採掘、戦闘、農業など）

### 2. キーワード抽出の方法

**選択肢**:
1. **簡易版**: 単純な単語マッチング
   - 「ネザー」→ nether関連アイテム
   - 「ダイアモンド」→ diamond関連アイテム

2. **高度版**: 埋め込みベースの類似度計算
   - 会話履歴を埋め込みベクトル化
   - アイテム説明も埋め込み化
   - コサイン類似度で関連アイテムを抽出

### 3. プロンプト長の管理

**目標**:
- 基本プロンプト + アイテム情報 = 2000トークン以内
- 会話履歴 = 1000トークン以内
- 合計 3000トークン程度（Claude/GPT-4の入力として適切）

**計測方法**:
- トークンカウンターの導入
- 動的に情報量を調整

---

## 実装の優先順位

### フェーズ1: 基本実装
1. ✅ 基本アイテムリストの定義（30種類程度）
2. ✅ カテゴリ情報の整理（既存のblock_categories.yamlを活用）
3. ❌ 現在地周辺アイテムの取得（State Managerを拡張）

### フェーズ2: 文脈ベース
1. ❌ キーワードベースのアイテム追加（簡易版）
2. ❌ 会話履歴からのキーワード抽出
3. ❌ プロンプトへの動的追加

### フェーズ3: 高度化
1. ❌ Function calling / Tool useの実装
2. ❌ セマンティック検索の導入
3. ❌ プロンプト長の自動調整

---

## 関連ドキュメント

- [llm-prompt-v0.11.md](./llm-prompt-v0.11.md) - 現在のLLMプロンプト
- [llm-command-reference.md](./llm-command-reference.md) - LLMが使用できるコマンド
- [../planner_bot/ARCHITECTURE.md](../planner_bot/ARCHITECTURE.md) - GOAPシステムの設計
- [../../config/block_categories.yaml](../../config/block_categories.yaml) - ブロックカテゴリ定義

---

## 未解決の課題

1. **動的アイテム情報の更新タイミング**
   - 毎ターン更新？ 会話の文脈が変わったら？

2. **アイテム情報の形式**
   - 名前のみ？ 用途・レシピも含める？

3. **GOAPとの連携**
   - GOAP用の状態情報とLLM用の情報をどう整合させるか

4. **多言語対応**
   - アイテム名は英語（minecraft ID）だが、説明は日本語？

---

**次のステップ**: LLM統合の実装時に、この設計を元にプロトタイプを作成し、実際のトークン消費量と性能を計測する。
