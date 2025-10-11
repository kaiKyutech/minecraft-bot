# Minecraft Bot コマンドリファレンス (LLM向け)

このドキュメントは、LLMがMinecraftボットを操作するために使用できるコマンドの説明です。

---

## 基本フロー

1. **状況確認**: `!status` で現在の状態を確認
2. **計画立案**: Minecraftの知識をもとに計画を考える
3. **実行**: 適切なコマンドを選択して実行

---

## コマンド一覧

### 1. `!status` - 現在の状況確認

**用途**: ボットの現在の状況を確認する

**使用例**:
```
!status
```

**出力内容**:
```
=== 現在の状況 ===
位置: (125, 68, -45)
Y座標: 68 (地表:~64, ダイヤ:-64~16)
時間: 昼
道具: stone_pickaxe x1
素材: oak_log x5, cobblestone x20
近くのリソース: log, basic_stone
構造物: workbench
登録済みの場所: home(100,64,200)
---
システム: !goal (GOAP), !creative nav
GOAP: 素材が近くにあるときに自動実行
Creative: ナビゲーション（場所の登録・移動）
```

**説明**:
- **位置**: ボットの現在座標 (x, y, z)
- **Y座標**: 高さ情報（地表は約64、ダイヤモンドは-64~16の範囲）
- **時間**: 昼/夜
- **道具**: 所持している道具類（ピッケル、斧、剣など）
- **素材**: 所持している素材類
- **近くのリソース**: 周辺に存在するリソース（木、石など）
- **構造物**: 周辺の構造物（作業台、かまどなど）
- **登録済みの場所**: ナビゲーションシステムに登録された場所

---

### 2. `!goal` - GOAP自動プランニング

**用途**: 定型的な作業を自動実行（クラフト、採掘など）

**制約**:
- 素材が近くにある（`nearby_xxx: true`）ことが前提
- 必要な道具を持っていることが前提
- リソースが遠くにある場合は実行できない

**使用例**:
```
!goal inventory.wooden_pickaxe:1
!goal inventory.stone_pickaxe:1
!goal inventory.crafting_table:1
!goal inventory.oak_planks:4
```

**成功時の出力**:
```
目標を完了しました
```

**失敗時の出力**:
```
目標を実行できません
=== 不足している要件 ===
nearby_iron_ore: 現在=false, 必要=true
has_stone_or_better_pickaxe: 現在=false, 必要=true
---
GOAP実行不可: 素材が近くにないか道具が不足しています
```

**失敗した場合の対処**:
1. `!status` で状況を再確認
2. 不足している素材を探す（`!creative nav` で移動）
3. 必要な道具を先に作る（別の `!goal` コマンド）

**GOAPで実行可能な目標例**:
- `inventory.wooden_pickaxe:1` - 木のピッケル作成
- `inventory.stone_pickaxe:1` - 石のピッケル作成
- `inventory.iron_pickaxe:1` - 鉄のピッケル作成（鉄鉱石が近くに必要）
- `inventory.diamond_pickaxe:1` - ダイヤのピッケル作成（ダイヤが近くに必要）
- `inventory.crafting_table:1` - 作業台作成
- `inventory.oak_planks:4` - オークの板4枚作成
- `inventory.stick:4` - 棒4本作成

---

### 3. `!creative nav` - ナビゲーション

**用途**: 場所の登録・移動（動的な場所管理）

#### 3.1. 場所の登録

**現在地を登録**:
```
!creative nav register {"name": "home"}
!creative nav register {"name": "mine"}
!creative nav register {"name": "farm"}
```

**特定のブロックの位置を登録**:
```
!creative nav register {"name": "workbench", "blockType": "crafting_table"}
!creative nav register {"name": "furnace", "blockType": "furnace"}
```

#### 3.2. 登録した場所への移動

```
!creative nav goto {"name": "home"}
!creative nav goto {"name": "mine"}
```

#### 3.3. 座標指定での移動

```
!creative nav gotoCoords {"x": 250, "y": 64, "z": -100}
```

#### 3.4. 登録済みの場所一覧表示

```
!creative nav list
```

**出力例**:
```
2個の場所が登録されています
  - home: (100, 64, 200)
  - mine: (250, 10, -50)
```

---

## 使用例: ダイヤモンドのピッケルを作る

### シナリオ1: 素材が近くにある場合

```
ユーザー: ダイヤモンドのピッケルを作って

LLM思考:
1. まず状況確認
2. ダイヤモンドと棒が近くにあるか確認
3. あれば !goal で実行

実行:
!status
→ 近くのリソース: diamond_ore
→ 道具: iron_pickaxe x1

!goal inventory.diamond:3
!goal inventory.diamond_pickaxe:1
```

### シナリオ2: ダイヤモンドが近くにない場合

```
ユーザー: ダイヤモンドのピッケルを作って

LLM思考:
1. 状況確認
2. ダイヤモンドが近くにない
3. まず鉄ピッケルを用意し、ダイヤを探す必要がある

実行:
!status
→ Y座標: 68 (地表)
→ 近くのリソース: log, basic_stone
→ 道具: なし

LLM思考:
- ダイヤは Y=-64~16 の範囲にある
- 鉄ピッケルが必要
- まず道具を準備してから探索に行く

実行:
!goal inventory.wooden_pickaxe:1
!goal inventory.stone_pickaxe:1
（鉄鉱石を探して）
!goal inventory.iron_pickaxe:1
（Y=-64~16 に移動）
!creative nav gotoCoords {"x": 0, "y": -30, "z": 0}
!status
→ 近くのリソース: diamond_ore（見つかったら）
!goal inventory.diamond:3
!goal inventory.diamond_pickaxe:1
```

---

## 重要な原則

### 1. Minecraftの知識を活用する

LLMは以下の知識を持っていることを前提とします：
- **ツール階層**: 木 → 石 → 鉄 → ダイヤモンド
- **クラフトレシピ**: 各アイテムの作成方法
- **リソースの生成場所**:
  - 木: 地表（Y=64付近）
  - 鉄鉱石: Y=0~72（地下）
  - ダイヤモンド: Y=-64~16（深い地下）

### 2. GOAPの制約を理解する

- GOAPは「素材が近くにある」ことが前提
- 素材が遠い場合は `!creative nav` で移動が必要
- 道具が不足している場合は先に作成

### 3. 効率的な計画を立てる

- 必要な道具を事前に準備
- 重要な場所は登録しておく（家、鉱山、畑など）
- Y座標を意識して移動（ダイヤは深い地下）

### 4. 失敗時の対処

GOAPが失敗した場合：
1. 失敗理由を確認（不足している要件）
2. `!status` で再確認
3. 不足しているものを準備
4. 再実行

---

## よくあるパターン

### パターン1: 何も持っていない状態から木のピッケルを作る

```
!status
!goal inventory.wooden_pickaxe:1
```

### パターン2: 家の場所を登録して戻る

```
!creative nav register {"name": "home"}
（探索...）
!creative nav goto {"name": "home"}
```

### パターン3: 鉄鉱石を探して鉄ピッケルを作る

```
!status
→ Y座標が高い場合は地下に移動
!creative nav gotoCoords {"x": 0, "y": 10, "z": 0}
!status
→ 近くのリソース: iron_ore（見つかったら）
!goal inventory.iron_ingot:3
!goal inventory.iron_pickaxe:1
```

---

## 制限事項

### 現在使用できないもの

- `!skill` - スキル直接実行（通常は使用しない）
- `!creative explore` - 探索機能（未実装）
- `!creative build` - 建築機能（未実装）

### 注意事項

- 場所の登録情報は再起動すると消える（将来は永続化予定）
- GOAPのプラン生成には時間がかかる場合がある
- チャットメッセージは0.5秒間隔で送信される（スパム対策）

---

## まとめ

このボットシステムは、LLMが戦略的判断を行い、GOAPとCreative Actionsを使って実行するアーキテクチャです。

- **LLM**: 何をすべきか考える（戦略）
- **GOAP**: 定型作業を自動実行（戦術）
- **Creative**: 探索・移動などの非定型作業（創造）

システムは「判断材料」を提供するだけで、最終的な判断はLLMに委ねられます。
