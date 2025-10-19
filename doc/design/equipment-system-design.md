# 装備システム設計・実装記録

**設計日**: 2025-10-16
**実装日**: 2025-10-17
**目的**: 装備・武器・アイテム表示機能の設計と実装
**ステータス**: ✅ 実装完了

---

## 実装概要

**実装したもの**:
- 動的装備状態追跡（`equipment` オブジェクト）
- 個別装備アクション（27種類）
- 装備スキル（`equip_armor`, `equip_mainhand`）
- LLMプロンプト対応（`equip:` コマンド）

**実装方針**:
- ドット記法による動的追跡（`equipment.diamond_helmet`）
- 個別装備アクション（防具・武器・ツール別）
- 装備セットは将来実装（現時点では個別のみ）

---

## 実装詳細

### 1. 状態スキーマ（state_schema.yaml）

```yaml
equipment_states:
  equipment:
    type: object
    default: {}
    description: "装備中のアイテムを自動追跡（例: {diamond_helmet: true, iron_sword: true}）"
    dynamic: true
    source: "bot.inventory.slots[5-8] + bot.heldItem"
```

**特徴**:
- `inventory` と同じパターンで動的追跡
- `equipment.diamond_helmet: true` 形式でアクセス
- 手動定義不要（全アイテムを自動追跡）

### 2. 状態抽出（state_manager.js）

```javascript
extractEquipment(bot) {
  const equipment = {
    helmet: 'none',
    chestplate: 'none',
    leggings: 'none',
    boots: 'none',
    mainhand: 'none',
    offhand: 'none'
  }

  const slots = bot.inventory?.slots || []
  if (slots[5]) equipment.helmet = slots[5].name
  if (slots[6]) equipment.chestplate = slots[6].name
  if (slots[7]) equipment.leggings = slots[7].name
  if (slots[8]) equipment.boots = slots[8].name
  if (slots[45]) equipment.offhand = slots[45].name

  const heldItem = bot.heldItem
  if (heldItem) {
    equipment.mainhand = heldItem.name
  }

  return equipment
}
```

### 3. 装備アクション（equipment_actions.yaml）

**27個のアクション**:
- ダイヤモンド防具: 4種（helmet, chestplate, leggings, boots）
- 鉄防具: 4種
- 革防具: 4種
- ダイヤモンドツール: 5種（sword, pickaxe, axe, shovel, hoe）
- 鉄ツール: 5種
- 石ツール: 5種

**アクション例**:
```yaml
- name: equip_diamond_helmet
  description: "ダイヤのヘルメットを装備する"
  preconditions:
    inventory.diamond_helmet: ">= 1"
  effects:
    equipment.diamond_helmet: true
  cost: 1
  skill: equip_armor
  params:
    slot: "helmet"
    item: "diamond_helmet"
```

### 4. LLMコマンド対応（llm_handler.js）

**変換例**:
```javascript
convertToGoalCommand("equip:diamond_helmet")
// → "equipment.diamond_helmet:true"

convertToGoalCommand("iron_sword:1")
// → "inventory.iron_sword:1"
```

### 5. プロンプト（prompt_builder.js）

**LLMに提供される説明**:
```
### 装備システム

**フォーマット**: equip:アイテム名

**例**:
- equip:diamond_helmet → ダイヤのヘルメットを装備
- equip:iron_chestplate → 鉄の胸当てを装備
- equip:diamond_sword → ダイヤの剣を手に持つ

**制約**:
- 装備するアイテムは事前にインベントリに持っている必要があります
- 例: diamond_helmet:1 → equip:diamond_helmet の順で実行
```

---

## 質問への回答

### Q1: 装備するアクションを追加すると探索空間は広がる？

**答え: はい、広がります。ただしフィルタで省ける**

---

### Q2: 現在のフィルタ機能の仕組み

#### `analyzeRelevantVariables` 関数（goap.js:1256-1330）

**仕組み: 後方連鎖（Backward Chaining）**

```javascript
1. ゴールから開始: goal = { inventory.diamond_pickaxe: 1 }
   → relevant = { "inventory.diamond_pickaxe" }

2. このゴールに影響を与えるアクションを探す:
   → "craft_diamond_pickaxe" が効果に "inventory.diamond_pickaxe: +1" を持つ
   → このアクションの前提条件を relevant に追加:
      - inventory.diamond: 3
      - inventory.stick: 2
      - nearby_workbench: true

3. さらにそれぞれの前提条件に影響するアクションを探す（再帰的）:
   → "gather_diamond" の前提条件: has_iron_pickaxe, nearby_diamond_ore
   → ... 続く

4. 最終的に relevant = {
     inventory.diamond_pickaxe,
     inventory.diamond,
     inventory.stick,
     nearby_workbench,
     has_iron_pickaxe,
     ...（ゴール達成に必要な全変数）
   }

5. フィルタリング:
   filteredActions = actions.filter(action =>
     action.effects のいずれかが relevant に含まれる
   )
```

**重要な点:**
- **正の効果のみ追跡**（`isPositiveEffect = true`）
- **goalに寄与しない変数は省かれる**

---

### Q3: 装備アクションは省けるか？

**例: ダイヤのピッケルを作る**

```yaml
goal: inventory.diamond_pickaxe: 1

# アクション定義
- name: equip_diamond_helmet
  effects:
    equipped_helmet: "diamond_helmet"  # ← これはgoalに関係ない
  # → フィルタで省かれる ✅

- name: craft_diamond_pickaxe
  effects:
    inventory.diamond_pickaxe: +1  # ← これはgoalに直接寄与
  # → フィルタを通過 ✅
```

**答え: はい、省けます**

- `equipped_helmet` は `inventory.diamond_pickaxe` の達成に**寄与しない**
- 後方連鎖で辿り着かないため、`relevant` に追加されない
- `equip_diamond_helmet` アクションは**フィルタで除外される**

---

## 装備システムの設計

### 推奨アプローチ: 複合状態 + 汎用アクション

#### 状態定義（state_schema.yaml）

```yaml
equipment_states:
  # 個別装備スロット（実装用）
  equipped_helmet:
    type: string
    default: "none"
    description: "装備中のヘルメット"

  equipped_chestplate:
    type: string
    default: "none"

  equipped_leggings:
    type: string
    default: "none"

  equipped_boots:
    type: string
    default: "none"

  equipped_mainhand:
    type: string
    default: "none"
    description: "手に持っているアイテム"

  # 複合状態（GOAP用 - 高レベルな目標）
  has_full_diamond_armor:
    type: boolean
    computed: true
    description: "ダイヤの防具一式を装備している"
    depends_on_equipment:
      helmet: "diamond_helmet"
      chestplate: "diamond_chestplate"
      leggings: "diamond_leggings"
      boots: "diamond_boots"

  has_full_iron_armor:
    type: boolean
    computed: true
    depends_on_equipment:
      helmet: "iron_helmet"
      chestplate: "iron_chestplate"
      leggings: "iron_leggings"
      boots: "iron_boots"

  is_combat_ready:
    type: boolean
    computed: true
    description: "戦闘準備完了（武器+防具）"
    depends_on:
      - has_full_diamond_armor
      - equipped_mainhand: "diamond_sword"

  is_showing_item:
    type: string
    default: "none"
    description: "デモ用: 現在見せているアイテム"
```

---

#### アクション定義（equipment_actions.yaml）

```yaml
actions:
  # 汎用的な装備アクション（防具セット単位）
  - name: equip_full_diamond_armor
    description: "ダイヤの防具一式を装備する"
    preconditions:
      inventory.diamond_helmet: ">= 1"
      inventory.diamond_chestplate: ">= 1"
      inventory.diamond_leggings: ">= 1"
      inventory.diamond_boots: ">= 1"
    effects:
      has_full_diamond_armor: true
      equipped_helmet: "diamond_helmet"
      equipped_chestplate: "diamond_chestplate"
      equipped_leggings: "diamond_leggings"
      equipped_boots: "diamond_boots"
    cost: 2
    skill: equip_armor_set
    params:
      armor_type: "diamond"

  - name: equip_full_iron_armor
    preconditions:
      inventory.iron_helmet: ">= 1"
      inventory.iron_chestplate: ">= 1"
      inventory.iron_leggings: ">= 1"
      inventory.iron_boots: ">= 1"
    effects:
      has_full_iron_armor: true
      equipped_helmet: "iron_helmet"
      equipped_chestplate: "iron_chestplate"
      equipped_leggings: "iron_leggings"
      equipped_boots: "iron_boots"
    cost: 2
    skill: equip_armor_set
    params:
      armor_type: "iron"

  # 個別装備アクション（細かい制御が必要な場合のみ）
  - name: equip_diamond_helmet
    preconditions:
      inventory.diamond_helmet: ">= 1"
    effects:
      equipped_helmet: "diamond_helmet"
    cost: 1
    skill: equip_single_armor
    params:
      slot: "helmet"
      item: "diamond_helmet"

  # 武器装備
  - name: equip_diamond_sword
    preconditions:
      inventory.diamond_sword: ">= 1"
    effects:
      equipped_mainhand: "diamond_sword"
    cost: 1
    skill: equip_weapon
    params:
      item: "diamond_sword"

  # アイテムを見せる（デモ用）
  - name: show_diamond_sword
    description: "ダイヤの剣を手に持って見せる"
    preconditions:
      inventory.diamond_sword: ">= 1"
    effects:
      is_showing_item: "diamond_sword"
      equipped_mainhand: "diamond_sword"
    cost: 1
    skill: show_item
    params:
      item: "diamond_sword"

  - name: show_diamond_pickaxe
    preconditions:
      inventory.diamond_pickaxe: ">= 1"
    effects:
      is_showing_item: "diamond_pickaxe"
      equipped_mainhand: "diamond_pickaxe"
    cost: 1
    skill: show_item
    params:
      item: "diamond_pickaxe"
```

---

### フィルタ機能による探索空間の削減

#### シナリオ1: ダイヤのピッケルを作る

```
Goal: inventory.diamond_pickaxe: 1

後方連鎖:
1. inventory.diamond_pickaxe に寄与するアクション:
   - craft_diamond_pickaxe ✅
   - equip_diamond_sword ❌ （関係ない）
   - show_diamond_pickaxe ❌ （作るのが先）

2. craft_diamond_pickaxe の前提条件:
   - inventory.diamond: 3
   - inventory.stick: 2
   - nearby_workbench: true

3. さらに後方連鎖...

結果: 装備関連アクションは全て除外される
```

#### シナリオ2: 戦闘準備を整える

```
Goal: is_combat_ready: true

後方連鎖:
1. is_combat_ready に寄与するアクション:
   - equip_full_diamond_armor ✅（depends_onで関連）
   - equip_diamond_sword ✅（depends_onで関連）
   - craft_diamond_pickaxe ❌（関係ない）

2. equip_full_diamond_armor の前提条件:
   - inventory.diamond_helmet: 1
   - inventory.diamond_chestplate: 1
   - ...

3. さらに後方連鎖でダイヤの防具をクラフト

結果: ピッケル・斧などのツール作成アクションは除外される
```

---

### アクション数の見積もり

#### 全ての個別装備を定義した場合

```
防具スロット: 4種類（helmet, chestplate, leggings, boots）
素材: 4種類（leather, iron, gold, diamond）
= 4 × 4 = 16アクション

武器・ツール:
- 剣: 5種類 × 1 = 5
- ピッケル: 5種類 × 1 = 5
- 斧: 5種類 × 1 = 5
= 15アクション

合計: 16 + 15 = 31アクション
```

#### 汎用的な装備セット + show_itemの場合（推奨）

```
防具セット: 4種類（leather, iron, gold, diamond）
武器装備: 5種類（wooden_sword, stone_sword, iron_sword, gold_sword, diamond_sword）
show_item: 主要アイテム10種類程度

合計: 4 + 5 + 10 = 19アクション
```

---

### 探索空間への影響

#### フィルタなしの場合

```
全アクション数: 100（既存） + 31（装備） = 131
探索空間: 最悪 131^10 = 爆発的
```

#### フィルタありの場合（現在の実装）

```
Goal: inventory.diamond_pickaxe: 1

フィルタ後のアクション数:
- 既存: ~30-40（関連するもののみ）
- 装備: 0（全て除外）
= 30-40アクション

探索空間: 30^10 = 管理可能
```

**結論: フィルタ機能により、装備アクションは自動的に除外される**

---

## 実装の優先順位

### Phase 1: 複合状態のみ（アクションなし）

```yaml
# state_schema.yaml に追加のみ
has_full_diamond_armor: true
has_full_iron_armor: true
```

- state_builder.js で装備状態を検出
- `bot.inventory.slots` から装備スロットを読み取る
- アクションは追加しない（手動で装備）

**メリット**: ゼロコストで装備状態を認識できる

---

### Phase 2: 装備セットアクション

```yaml
- equip_full_diamond_armor
- equip_full_iron_armor
```

- スキル `equip_armor_set` を実装
- 4つの装備を順番に装備

**用途**:
- ユーザーが「ダイヤの防具を装備して」と指示
- LLMが自動的にプランニング

---

### Phase 3: アイテム表示（デモ用）

```yaml
- show_diamond_sword
- show_diamond_pickaxe
```

- スキル `show_item` を実装
- `bot.equip(item, 'hand')` を呼ぶ

**用途**: デモで「このダイヤの剣を見てください！」

---

## まとめ

### 質問への最終回答

| 質問 | 回答 |
|------|------|
| 装備アクションで探索空間は広がる？ | はい、アクション数は増える |
| フィルタで省ける？ | **はい、goalに寄与しないアクションは自動的に除外される** |
| どうやって省かれる？ | 後方連鎖で辿り着かない変数は `relevant` に入らない |
| ダイヤピッケル作成時に装備アクションは省ける？ | **はい、完全に除外される** |

### 推奨設計

1. **複合状態を活用**: `has_full_diamond_armor` など高レベルな状態
2. **装備セット単位**: 個別スロットではなくセットで装備
3. **show_item を追加**: デモ用に「アイテムを見せる」アクション
4. **フィルタを信頼**: GOAPが自動的に不要なアクションを除外

### 実装しても問題ない理由

- ✅ フィルタ機能が正しく動作している
- ✅ goalに関係ないアクションは探索対象外
- ✅ 探索空間の爆発は起きない
- ✅ アクション数を30個程度追加しても大丈夫

**次のステップ**: Phase 1（状態のみ）から始めて、必要に応じてアクションを追加する。

---

## 実装完了記録

### 実装したフェーズ

✅ **Phase 1**: 装備状態の追跡（完了）
- `equipment` オブジェクトによる動的追跡
- `state_manager.js` による装備情報抽出
- `state_builder.js` による GOAP 状態構築

✅ **Phase 2（一部）**: 個別装備アクション（完了）
- 27個の装備アクション定義
- `equip_armor.js` スキル（防具装備）
- `equip_mainhand.js` スキル（武器・ツール装備）
- GOAP ドメインへの統合

✅ **Phase 3（一部）**: LLMコマンド対応（完了）
- `equip:` プレフィックスのサポート
- LLMプロンプトへの説明追加
- `convertToGoalCommand()` 関数の拡張

### 未実装（将来の拡張）

❌ **装備セットアクション**:
- `equip_full_diamond_armor` などのセット装備
- 複合状態 `has_full_diamond_armor` の活用
- スキル `equip_armor_set` の実装

❌ **アイテム表示機能**:
- `show_item` スキル
- `is_showing_item` 状態

### テスト方法

**手動テスト**:
```bash
# Minecraftサーバーに接続
node planner_bot/index.js

# チャットコマンドでテスト
!goal equipment.diamond_helmet:true
# または LLMモード:
ダイヤのヘルメットを装備して
```

**期待される動作**:
1. `inventory.diamond_helmet >= 1` を確認
2. `equip_armor` スキルを実行
3. Mineflayerの `bot.equip(item, 'head')` を呼び出し
4. 装備完了

### バグ修正履歴

**2025-10-17**: `equip_armor.js` のバグ修正
- **問題**: `bot.equip(itemToEquip, 'head' + slot)` が "headhelmet" という不正な destination を生成
- **修正**: destination mapping を使用して正しい Mineflayer API 呼び出しに修正
- **影響**: 装備システムが正しく動作するようになった

### 設計判断の記録

**なぜ個別アクションを採用したか**:
1. 柔軟性: LLMが自由に装備を選択できる
2. 段階的実装: セットは後から追加可能
3. フィルタ機能: 無関係なアクションは自動除外される

**なぜドット記法を採用したか**:
1. `inventory` との一貫性
2. 手動定義不要（全アイテムを自動追跡）
3. 拡張性（新しい装備を追加しても変更不要）

**フィルタ機能の信頼性**:
- 後方連鎖により、goal に寄与しないアクションは自動除外
- 27個の装備アクションを追加しても探索空間は爆発しない
- 実測値: `!goal inventory.diamond_pickaxe:1` では装備アクションは全て除外される

---

## 今後の改善案

### 優先度: 高

1. **装備状態の可視化**
   - `!status` コマンドに装備情報を追加
   - 現在装備中のアイテムを表示

2. **装備セット機能**
   - `equip_full_diamond_armor` アクション
   - 一括装備でターン数削減

### 優先度: 中

3. **耐久値の追跡**
   - ツールの耐久値を state に追加
   - 壊れる前に新しいツールを作成

4. **自動装備交換**
   - より良い装備を入手したら自動で交換
   - 例: 石の剣 → 鉄の剣 → ダイヤの剣

### 優先度: 低

5. **エンチャント対応**
   - エンチャント済みアイテムの識別
   - エンチャントテーブルの利用

---

## 参考情報

### Mineflayer API

**装備スロット**:
```javascript
bot.inventory.slots[5]  // helmet
bot.inventory.slots[6]  // chestplate
bot.inventory.slots[7]  // leggings
bot.inventory.slots[8]  // boots
bot.inventory.slots[45] // offhand
bot.heldItem            // mainhand
```

**装備メソッド**:
```javascript
bot.equip(item, destination)
// destination: "head", "torso", "legs", "feet", "hand", "off-hand"
```

### 関連ファイル

- `planner_bot/config/state_schema.yaml` - 装備状態定義
- `planner_bot/config/actions/equipment_actions.yaml` - 装備アクション定義
- `planner_bot/src/planner/state_manager.js` - 装備情報抽出
- `planner_bot/src/planner/state_builder.js` - 装備状態構築
- `planner_bot/src/skills/equip_armor.js` - 防具装備スキル
- `planner_bot/src/skills/equip_mainhand.js` - 武器装備スキル
- `planner_bot/src/llm/prompt_builder.js` - LLMプロンプト
- `planner_bot/src/llm/llm_handler.js` - コマンド変換
