# TODO - 必須実装項目

このファイルは **絶対に実装しなければならない機能** を管理します。

- **このファイル (TODO.md)**: 必須実装項目（優先度: 高）
- **ISSUES.md**: 気が向いたら実装する項目（優先度順）

---

## 設計哲学

**情報のフィルタリングではなく、情報の量（解像度）を調整する**

このプロジェクトの役割:
- システムが取得できる**最大解像度の情報**を提供
- 解像度調整に必要な**メタデータ**を豊富に用意（距離、カテゴリ、型定義など）
- LLMプロジェクトが解像度を調整しやすい**データ構造**を設計

LLMプロジェクトの役割:
- 提供された情報から**どの解像度を使うか**を決定
- LLMの性能に応じて**情報を取捨選択**
- プロンプトに含める情報量を**動的に調整**

---

## 1. チェスト操作機能（GOAP外コマンド）

**目的**: チェストの作成・整理・アイテム出し入れをコマンドで行えるようにする

**設計方針**:
- GOAPには含めない（LLMが明示的に制御）
- `!navigation` 配下のコマンドとして実装
- チェスト操作は汎用的なブロックインタラクトとして設計

**実装内容**:

### 5-1. ブロック設置コマンド
```javascript
!navigation placeBlock {"name": "chest", "coords": [100, 64, 200]}
!navigation placeBlock {"name": "crafting_table", "coords": [100, 64, 201]}
```

**機能**:
- インベントリに指定ブロックがあるか確認
- 指定座標に移動
- ブロックを設置（`bot.placeBlock()`）

**パラメータ**:
- `name` (string): ブロック名（例: "chest", "crafting_table"）
- `coords` (array): 設置座標 `[x, y, z]`

### 5-2. チェスト操作コマンド

#### チェストにアイテムを預ける
```javascript
!navigation chestDeposit {"coords": [100, 64, 200], "item": "iron_ingot", "count": 5}
```

**機能**:
- 指定座標のチェストに近づく
- チェストを開く（`bot.openChest()`）
- インベントリから指定アイテムを指定個数入れる
- チェストを閉じる

**パラメータ**:
- `coords` (array): チェスト座標 `[x, y, z]`
- `item` (string): アイテム名
- `count` (number, optional): 個数（デフォルト: 全て）

#### チェストからアイテムを取り出す
```javascript
!navigation chestWithdraw {"coords": [100, 64, 200], "item": "oak_log", "count": 10}
```

**機能**:
- 指定座標のチェストに近づく
- チェストを開く
- チェストから指定アイテムを指定個数取り出す
- チェストを閉じる

**パラメータ**:
- `coords` (array): チェスト座標
- `item` (string): アイテム名
- `count` (number, optional): 個数（デフォルト: 全て）

#### チェストの中身を確認
```javascript
!navigation chestList {"coords": [100, 64, 200]}
```

**機能**:
- 指定座標のチェストに近づく
- チェストを開く
- 中身を取得
- チェストを閉じる

**戻り値**:
```json
{
  "success": true,
  "items": [
    { "name": "iron_ingot", "count": 15 },
    { "name": "oak_log", "count": 32 },
    { "name": "coal", "count": 8 }
  ],
  "totalSlots": 27,
  "usedSlots": 3,
  "emptySlots": 24
}
```

### 5-3. 実装ファイル
- `planner_bot/src/navigation/actions.js` - 主要な実装
- `planner_bot/src/bot/startup.js` - コマンド例追加
- `doc/planner_bot/API.md` - ドキュメント更新

### 5-4. LLMプロジェクトでの使用例

```
LLMの判断フロー:
1. "鉄のピッケルを作りたい"
2. インベントリ確認 → 材料不足
3. !navigation chestList {"coords": [100, 64, 200]}
4. チェストに iron_ingot が 10個ある
5. !navigation chestWithdraw {"coords": [100, 64, 200], "item": "iron_ingot", "count": 3}
6. 棒がない → !goal inventory.stick:2（GOAP実行）
7. 材料が揃った → !goal inventory.iron_pickaxe:1（GOAP実行）
8. 完成したピッケルをチェストに保管
9. !navigation chestDeposit {"coords": [100, 64, 200], "item": "iron_pickaxe", "count": 1}
```

**実装状況**: 🔴 未実装

---

## 2. 情報提供システムの拡充（解像度調整対応）

**目的**: LLMプロジェクトが解像度を調整しやすいように、最大解像度の情報とメタデータを提供

**設計方針**:
- このプロジェクトは**データ提供者**に徹する
- フィルタリングはしない（全データ + メタデータを提供）
- LLMプロジェクトが自由に解像度を調整できる構造

**実装内容**:

### 2-1. ブロック情報の拡充

現在: `scanBlocks` で座標リストを返す

改善: より多くのメタデータを追加
```json
{
  "blocks": [
    {
      "type": "diamond_ore",
      "position": [100, 64, 200],
      "distance": 15.3,
      "direction": {"yaw": 45, "pitch": -10},
      "accessible": true,
      "metadata": {
        "hardness": 3.0,
        "requiresTool": "iron_pickaxe"
      }
    }
  ],
  "summary": {
    "byType": {
      "diamond_ore": 5,
      "iron_ore": 23
    },
    "byDistance": {
      "0-10": 50,
      "10-20": 120,
      "20-50": 300
    },
    "byAccessibility": {
      "accessible": 400,
      "requiresDigging": 70
    }
  },
  "metadata": {
    "totalScanned": 1523,
    "scanRange": 50,
    "scanCenter": [100, 64, 200]
  }
}
```

### 2-2. インベントリ情報の拡充

現在: アイテムリストとカテゴリ

改善: より詳細なメタデータ
```json
{
  "items": [
    {
      "name": "iron_ingot",
      "count": 15,
      "category": "material",
      "metadata": {
        "stackable": true,
        "maxStack": 64,
        "durability": null,
        "canCraft": ["iron_pickaxe", "iron_sword", ...],
        "canSmelt": false
      }
    }
  ],
  "summary": {
    "totalItems": 10,
    "totalCount": 234,
    "byCategory": {
      "tool": 3,
      "material": 5,
      "other": 2
    },
    "byStackUsage": {
      "almostFull": ["dirt", "cobblestone"],
      "halfFull": ["iron_ingot"],
      "almostEmpty": ["diamond"]
    }
  },
  "capacity": {
    "totalSlots": 36,
    "usedSlots": 10,
    "emptySlots": 26
  }
}
```

### 2-3. プレイヤー情報の拡充

現在: username, position, distance

改善: より多くのメタデータ
```json
{
  "players": [
    {
      "username": "Player1",
      "position": [110, 65, 210],
      "distance": 15.3,
      "direction": {"yaw": 45, "pitch": 0},
      "health": 20,
      "visible": true,
      "lastSeen": 0,
      "metadata": {
        "inSameChunk": true,
        "inRenderDistance": true,
        "reachable": true
      }
    }
  ],
  "summary": {
    "totalPlayers": 5,
    "byDistance": {
      "0-10": 1,
      "10-50": 2,
      "50-100": 2
    },
    "byVisibility": {
      "visible": 3,
      "invisible": 2
    }
  }
}
```

### 2-4. エンティティ情報の追加

新規: mobs, items, vehicles などの情報
```json
{
  "entities": [
    {
      "type": "zombie",
      "id": 12345,
      "position": [105, 64, 195],
      "distance": 8.2,
      "health": 20,
      "hostile": true,
      "metadata": {
        "mobType": "undead",
        "canBurn": true,
        "drops": ["rotten_flesh", "iron_ingot"]
      }
    }
  ],
  "summary": {
    "totalEntities": 15,
    "byType": {
      "zombie": 3,
      "skeleton": 2,
      "item": 10
    },
    "byHostility": {
      "hostile": 5,
      "neutral": 0,
      "passive": 10
    }
  }
}
```

### 2-5. 実装ファイル
- `planner_bot/src/commands/info_command.js` - 主要な拡充
- `planner_bot/src/utils/metadata_builder.js` - メタデータ生成ユーティリティ（新規）
- `doc/planner_bot/API.md` - ドキュメント更新

### 2-6. LLMプロジェクトでの使用例

```javascript
// 低性能LLM用: 近いものだけ使用
const nearbyBlocks = infoData.blocks.filter(b => b.distance < 10)
const blockSummary = infoData.summary.byDistance["0-10"]

// 高性能LLM用: 全データ使用
const allBlocks = infoData.blocks
const detailedSummary = infoData.summary
```

**実装状況**: 🔴 未実装

---

## 実装優先順位

1. 🔴 **チェスト操作機能** - 未実装（機能追加）
2. 🔴 **情報提供システムの拡充** - 未実装（解像度調整対応）
