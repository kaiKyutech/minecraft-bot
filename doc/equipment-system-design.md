# 装備システム設計案

**日付**: 2025-10-16
**目的**: 装備・武器・アイテム表示機能の設計

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
