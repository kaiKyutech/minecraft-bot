# LLM文明シミュレーション アーキテクチャ

このドキュメントは、Minecraftボットにおける「LLMによる文明シミュレーション」の設計思想とアーキテクチャをまとめたものです。

## 目次

1. [設計思想](#設計思想)
2. [3層アーキテクチャ](#3層アーキテクチャ)
3. [各層の詳細](#各層の詳細)
4. [LLMとシステムの役割分担](#llmとシステムの役割分担)
5. [実装済み機能](#実装済み機能)
6. [将来の拡張](#将来の拡張)

---

## 設計思想

### 核心的な原則

```
LLM = 意思決定者（創造的・自由）
  ↓ 思考・判断・創造
GOAP = 定型作業の自動化（決定論的・制限的）
Creative Actions = 非定型作業の実行（手続き的）

重要: システムは「判断」せず、LLMに「判断材料」を提供するだけ
```

### なぜこの設計なのか

1. **自由度の確保**
   - システムが判断を押し付けない
   - LLMが創造的な解決策を考えられる
   - 例: 「村人に道具を借りる」「チェストを確認する」など

2. **イノベーションの余地**
   - 定型的でない行動を許容
   - LLMが新しい方法を発見できる
   - 文明シミュレーションに必要な「試行錯誤」が可能

3. **Minecraftの知識を活用**
   - LLMは既にMinecraftの知識を持っている
   - レシピや採掘ルールを再実装する必要がない
   - システムは「現在の状況」を伝えることに集中

---

## 3層アーキテクチャ

```
┌─────────────────────────────────────────┐
│  LLM Layer (戦略)                        │
│  - タスク分解                            │
│  - どのレイヤーを使うか判断              │
└─────┬───────────────────────────────────┘
      │
      ├─→ 決定論的タスク
      │   └─→ GOAP Layer (!goal)
      │        - クラフト、採掘、戦闘
      │
      └─→ 創造的タスク
          └─→ Creative Actions (!creative)
               ├─ Navigation (nav)
               ├─ Exploration (explore) - 将来
               ├─ Building (building) - 将来
               └─ Interaction (interact) - 将来

共通基盤: Primitives (moveTo, digBlock, craftItem...)
```

### 各層の責務

| 層 | 責務 | 自由度 | 例 |
|---|------|--------|-----|
| **LLM** | 戦略的判断、タスク分解 | 完全に自由 | 「まず道具を準備してから探索に行く」 |
| **GOAP** | 定型作業の自動実行 | 制約あり（材料が近くに必要） | クラフト、近くのリソース採取 |
| **Creative** | 非定型作業の実行 | 制約なし | 探索、移動、建築、交渉 |
| **Primitives** | 最下層の操作 | N/A | moveTo, digBlock, craftItem |

---

## 各層の詳細

### 1. LLM Layer（戦略層）

**役割**:
- 現在の状況を理解
- 目標達成のための計画を立案
- どのシステムを使うか判断

**判断材料**:
```
!status コマンドで取得:
  - 位置情報（Y座標含む）
  - インベントリ（ツール・材料）
  - 周辺環境（近くのリソース）
  - 登録済みの場所
  - 利用可能なシステム

!goal 失敗時の診断:
  - 不足している要件
  - GOAPが実行できない理由
```

**LLMが考えること**:
- 「鉄ピッケルを作るには、まず石ピッケルが必要」
- 「ダイヤが近くにない → 探索が必要」
- 「探索前に準備（ツール、食料）をすべき」
- 「または村人に借りられないか試してみる」

**LLMの思考例**:
```
User: "ダイヤモンドを掘って"

LLM思考:
1. !status で確認 → インベントリ空、近くに木がある
2. ダイヤ採掘には鉄ピッケルが必要
3. 鉄ピッケルには鉄鉱石 → 石ピッケル → 木ピッケルが必要
4. まず木を集めてピッケルを作ろう

実行:
  !goal inventory.wooden_pickaxe:1
  !goal inventory.stone_pickaxe:1
  !goal inventory.iron_pickaxe:1

  (鉄鉱石が近くにない場合)
  !creative explore findBlock {"blockType": "iron_ore"}

  !goal inventory.iron_pickaxe:1
  ...
```

---

### 2. GOAP Layer（戦術層）

**役割**:
- 定型的な作業を自動プランニング
- 材料が揃っている場合の最適な手順を計算

**得意なこと**:
- クラフト（レシピ通り）
- 近くのリソース採取
- ツール準備
- 連鎖的な作業（木→板→棒→ピッケル）

**苦手なこと**:
- 探索（リソースが近くにない）
- 移動（場所が動的）
- 創造的判断（何を建てるか、など）

**制約**:
```yaml
# GOAPの前提
preconditions:
  nearby_diamond_ore: true  # 近くにダイヤ鉱石がある
  has_iron_pickaxe: true    # 鉄ピッケルを持っている

# これらが false の場合、GOAPは実行できない
```

**診断出力例**:
```
> !goal inventory.diamond:1

Goal cannot be executed
=== MISSING ===
nearby_diamond_ore: now=false, need=true
has_iron_or_better_pickaxe: now=false, need=true
---
GOAP cannot execute. Materials not nearby or tools missing.
Consider: !creative nav, !status, or prepare materials first
```

---

### 3. Creative Actions Layer（創造層）

**役割**:
- GOAPで扱えない創造的・探索的行動
- 動的な目標に対する柔軟な対応

**現在実装済み**: Navigation

```bash
# 場所の登録
!creative nav register {"name": "home"}
!creative nav register {"name": "spawn"}

# 場所への移動
!creative nav goto {"name": "home"}

# 座標指定移動
!creative nav gotoCoords {"x": 250, "y": 64, "z": -100}

# 一覧表示
!creative nav list
```

**将来実装予定**:

```bash
# Exploration（探索）
!creative explore findBlock {"blockType": "diamond_ore"}
!creative explore randomWalk {"distance": 100}
!creative explore scanArea {"radius": 50}

# Building（建築）
!creative building wall {"material": "stone", "length": 10}
!creative building house {"design": "simple"}
!creative building save_design {"name": "tnt_cannon"}

# Interaction（交渉）
!creative interact talk {"target": "villager"}
!creative interact trade {"target": "villager", "item": "iron_pickaxe"}
```

---

## LLMとシステムの役割分担

### システムがやること

✅ **現在の状況を正確に伝える**
- 位置、インベントリ、周辺環境
- 登録済みの場所
- GOAPが失敗した理由

✅ **システムの制約を明示する**
- GOAPは「材料が近くにある」前提
- Creativeは探索・移動・創造を担当

✅ **事実のみを提供**
- 「ダイヤが近くにない」（事実）
- ~~「まず鉄ピッケルを作るべき」~~（判断）

### システムがやらないこと

❌ **判断を押し付ける**
- ~~「推奨される実行順序: 1. ツール準備 2. 探索...」~~
- ~~「次はこれをやってください」~~

❌ **Minecraftの知識を再実装**
- レシピ情報（LLMが知っている）
- ツール階層（LLMが知っている）

❌ **創造的な解決策を制限**
- 「村人に借りる」という選択肢を奪わない
- 「チェストを確認する」という発想を妨げない

---

## 実装済み機能

### 1. Navigation System

**ファイル**:
- `src/creative_actions/navigation.js`
- `src/commands/creative_command.js`
- `src/planner/state_manager.js` (namedLocations管理)

**機能**:
- 場所の登録・取得・一覧表示
- 登録済み場所への移動
- 座標指定移動

**特徴**:
- GOAPとは独立した層
- 再起動すると登録情報は消える（将来は永続化可能）

---

### 2. Status Display

**ファイル**:
- `src/commands/status_command.js`

**表示内容**:
```
=== STATUS ===
Pos: (125, 68, -45)
Y-Level: 68 (Surface:~64, Diamond:-64~16)
Time: Day
Inventory: Empty
Tools: stone_pickaxe x1
Materials: oak_log x5, cobblestone x20
Nearby: log, basic_stone
Structures: workbench
Locations: home(100,64,200), mine(250,10,-50)
---
Systems: !goal (GOAP), !creative (nav/explore/build), !skill
GOAP: auto-execute when materials nearby
Creative: navigation, exploration, building
```

**出力先**: マインクラフトのチャット欄（LLMが読む）

---

### 3. GOAP Diagnosis

**ファイル**:
- `src/commands/goal_command.js`

**診断内容**:
```
Goal cannot be executed
=== MISSING ===
nearby_iron_ore: now=false, need=true
has_stone_or_better_pickaxe: now=false, need=true
---
GOAP cannot execute. Materials not nearby or tools missing.
Consider: !creative nav, !status, or prepare materials first
```

**出力先**:
- チャット欄: LLM向け（簡潔）
- コンソール: 開発者向け（詳細）

---

## 情報の出力先

### チャット欄（LLM向け）

**目的**: LLMが判断するための情報

**内容**:
- `!status` の出力
- `!goal` 失敗時の診断
- `!creative` の実行結果

**特徴**:
- 簡潔で読みやすい
- 事実のみ、判断は含まない

### コンソール（開発者向け）

**目的**: デバッグとシステム理解

**内容**:
- GOAPプラン詳細（ステップ、コスト、前提条件）
- 状態遷移ログ `[STATE]`
- スキル実行ログ `[GATHER]`, `[CRAFT]`
- ナビゲーションログ `[NAVIGATION]`

**特徴**:
- 詳細で技術的
- システムの内部動作を追跡可能

---

## 将来の拡張

### 1. Exploration System

```javascript
// src/creative_actions/exploration.js

module.exports = {
  // リソースを探して移動
  async findBlock(bot, stateManager, params) {
    const { blockType, maxDistance = 200, maxAttempts = 5 } = params

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const block = bot.findBlock({
        matching: (b) => b && b.name === blockType,
        maxDistance: 100
      })

      if (block) {
        await primitives.moveTo(bot, { position: block.position })
        return { success: true, position: block.position }
      }

      // 見つからなければランダムに移動して再探索
      await this.randomWalk(bot, stateManager, { distance: 50 })
    }

    throw new Error(`${blockType} not found after ${maxAttempts} attempts`)
  },

  // ランダムな方向に探索
  async randomWalk(bot, stateManager, params) {
    const distance = params.distance || 50
    const angle = Math.random() * Math.PI * 2
    const currentPos = bot.entity.position

    const targetPos = {
      x: currentPos.x + Math.cos(angle) * distance,
      y: currentPos.y,
      z: currentPos.z + Math.sin(angle) * distance
    }

    await primitives.moveTo(bot, { position: targetPos, range: 10 })
    return { success: true, newPosition: bot.entity.position }
  }
}
```

---

### 2. Building System

```javascript
// src/creative_actions/building.js

module.exports = {
  // 壁を建設
  async buildWall(bot, stateManager, params) {
    const { material, length, height = 3 } = params
    // 実装...
  },

  // 設計図を保存
  async saveDesign(bot, stateManager, params) {
    const { name, area } = params
    // ボット周辺のブロック配置を記録
    // JSON形式で保存
    // 例: TNTキャノンの設計図
  },

  // 設計図から建築
  async buildFromDesign(bot, stateManager, params) {
    const { designName } = params
    // 保存された設計図を読み込んで建築
  }
}
```

---

### 3. Interaction System

```javascript
// src/creative_actions/interaction.js

module.exports = {
  // NPCに話しかける
  async talk(bot, stateManager, params) {
    const { target, message } = params
    // 近くのエンティティを探す
    // チャットまたは右クリックで対話
  },

  // 村人と取引
  async trade(bot, stateManager, params) {
    const { target, offer, request } = params
    // 村人の取引ウィンドウを開く
    // 取引を実行
  }
}
```

---

### 4. 永続化システム

```javascript
// src/persistence/location_storage.js

module.exports = {
  // 場所情報をファイルに保存
  save(locations) {
    const data = JSON.stringify(locations, null, 2)
    fs.writeFileSync('data/locations.json', data)
  },

  // 起動時に読み込み
  load() {
    if (fs.existsSync('data/locations.json')) {
      const data = fs.readFileSync('data/locations.json', 'utf8')
      return JSON.parse(data)
    }
    return {}
  }
}
```

---

## LLMプロンプト設計（参考）

```markdown
# Minecraft AI Assistant

あなたはMinecraftの世界で活動するAIエージェントです。
目標を達成するために、利用可能なシステムを自由に組み合わせて行動してください。

## 基本フロー

1. **状況確認**: まず `!status` で現在の状態を確認
2. **計画立案**: Minecraftの知識をもとに計画を考える
3. **実行**: 適切なコマンドを選択して実行

## 利用可能なシステム

### GOAP System (!goal)
- **用途**: 定型的な作業の自動化
- **制約**: 材料が近くにある（nearby_xxx: true）ことが前提
- **例**: `!goal inventory.wooden_pickaxe:1`

### Creative Actions (!creative)
- **用途**: 探索、ナビゲーション、創造的行動
- **制約**: なし（自由度が高い）
- **例**:
  - `!creative nav register {"name": "home"}`
  - `!creative nav goto {"name": "home"}`

## 重要な原則

1. **Minecraftの知識を活用**
   - ツール階層（木→石→鉄→ダイヤ）を理解している
   - クラフトレシピを知っている
   - リソースの生成場所を知っている

2. **システムの制約を理解**
   - GOAPは「近くにない」リソースを扱えない
   - 探索が必要な場合はCreativeを使う
   - 場所を記憶したい場合はNavigationを使う

3. **創造的に考える**
   - システムに頼りすぎない
   - 効率的な方法を自分で考える
   - 将来のために場所を登録しておく
   - 村人に話しかけるなど、定型外の方法も検討する
```

---

## 設計の利点

### 1. 自由度の確保
- LLMが創造的な解決策を考えられる
- システムが判断を押し付けない
- イノベーションの余地がある

### 2. スケーラビリティ
- 新しいCreative Actionsを追加しやすい
- GOAPのアクション定義と独立
- LLMのプロンプトを変えるだけで動作が変わる

### 3. 保守性
- 各層が独立している
- GOAPとCreativeが干渉しない
- デバッグしやすい（ログが分離）

### 4. LLMの能力を最大限活用
- Minecraftの知識を再実装する必要がない
- 文明シミュレーションに必要な「思考」をLLMに任せる
- システムは「手足」に徹する

---

## まとめ

このアーキテクチャは、**LLMを「司令官」、GOAPとCreativeを「兵士」** として扱います。

- **LLM**: 戦略を考え、判断し、創造する
- **GOAP**: 定型作業を高速に自動実行
- **Creative**: 探索・移動・建築など非定型作業を実行

システムは「判断材料」を提供するだけで、最終的な判断はLLMに委ねます。
これにより、創造性と効率性を両立した文明シミュレーションが可能になります。
