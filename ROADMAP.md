# Minecraft Bot 開発ロードマップ

## プロジェクトビジョン

村を拠点とした複数のAIボットが協調して生活・探索・防衛を行うマルチエージェントシステム。
LLMを活用した高度な判断と、GOAPによる効率的なプラン実行を組み合わせる。

## 現在の実装状況

### ✅ 完了済み

- **GOAP プランナー**
  - A*アルゴリズムによる効率的な探索
  - ヒューリスティック関数による最適化
  - ドット記法による動的インベントリ管理
  - Backward analysisによる関連アクション抽出

- **基本スキル**
  - `gather`: 資源採集（木、石）
  - `hand_craft`: 2x2グリッドクラフト
  - `workbench_craft`: 3x3グリッドクラフト（作業台）
  - `move_to`: ブロックへの移動
  - `place_block`: ブロック設置
  - `furnace_smelt`: かまど精錬

- **実装済みアクション**
  - 木の伐採（素手/斧）
  - 石の採掘（素手/ピッケル）
  - 板・棒のクラフト
  - 木製ツール作成（ピッケル、斧、剣、シャベル、クワ）
  - 石製ツール作成
  - 作業台・かまどの作成と設置
  - 木炭の精錬

---

## フェーズ1: アイテム収集の完全実装【最優先】

> 「近くに材料さえあればなんでも作ることができる」状態を目指す

### 1.1 鉄関連の実装

#### 必要なスキル
- ✅ `gather` - 既存（鉱石採掘に対応）
- ✅ `furnace_smelt` - 既存（鉄鉱石の精錬に対応）

#### 追加するアクション

**gather_actions.yaml**
```yaml
# 鉄鉱石の採掘
- name: gather_iron_ore_with_stone_pickaxe
  preconditions:
    inventory_space: true
    nearby_iron_ore: true
    inventory.category.pickaxe: true  # 石以上のピッケルが必要
  effects:
    inventory.iron_ore: "+1"
  cost: 8
  skill: gather
  params:
    itemName: iron_ore
    count: 1
```

**furnace_actions.yaml**
```yaml
# 鉄インゴットの精錬
- name: smelt_iron_ingot_with_charcoal
  preconditions:
    inventory.iron_ore: ">=1"
    inventory.charcoal: ">=1"
    nearby_furnace: true
  effects:
    inventory.iron_ore: "-1"
    inventory.charcoal: "-1"
    inventory.iron_ingot: "+1"
  cost: 20
  skill: furnace_smelt
  params:
    input: "iron_ore"
    fuel: "charcoal"
    output: "iron_ingot"
    fuel_count: 1
```

**workbench_craft_actions.yaml**
```yaml
# 鉄製ツール
- name: craft_iron_pickaxe
  preconditions:
    inventory.iron_ingot: ">=3"
    has_stick: ">=2"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-3"
    has_stick: "-2"
    inventory.iron_pickaxe: "+1"
  cost: 8
  skill: workbench_craft

- name: craft_iron_axe
  preconditions:
    inventory.iron_ingot: ">=3"
    has_stick: ">=2"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-3"
    has_stick: "-2"
    inventory.iron_axe: "+1"
  cost: 8
  skill: workbench_craft

- name: craft_iron_sword
  preconditions:
    inventory.iron_ingot: ">=2"
    has_stick: ">=1"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-2"
    has_stick: "-1"
    inventory.iron_sword: "+1"
  cost: 8
  skill: workbench_craft

- name: craft_iron_shovel
  preconditions:
    inventory.iron_ingot: ">=1"
    has_stick: ">=2"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-1"
    has_stick: "-2"
    inventory.iron_shovel: "+1"
  cost: 8
  skill: workbench_craft

- name: craft_iron_hoe
  preconditions:
    inventory.iron_ingot: ">=2"
    has_stick: ">=2"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-2"
    has_stick: "-2"
    inventory.iron_hoe: "+1"
  cost: 8
  skill: workbench_craft
```

#### state_schema.yamlの更新

```yaml
# 環境状態に追加
nearby_iron_ore:
  type: boolean
  default: false
  description: "採掘可能距離（5ブロック以内）に鉄鉱石が存在する"
  detection_method: "findBlock"
  block_name: "iron_ore"
  max_distance: 5

# 複合状態の更新
inventory.category.pickaxe:
  depends_on_inventory:
    - wooden_pickaxe
    - stone_pickaxe
    - iron_pickaxe      # 追加
    - diamond_pickaxe
    - netherite_pickaxe

inventory.category.axe:
  depends_on_inventory:
    - wooden_axe
    - stone_axe
    - iron_axe          # 追加
    - diamond_axe
    - netherite_axe
```

### 1.2 ダイヤモンド関連の実装

#### 追加するアクション

**gather_actions.yaml**
```yaml
# ダイヤモンド鉱石の採掘（鉄以上のピッケル必須）
- name: gather_diamond_ore_with_iron_pickaxe
  preconditions:
    inventory_space: true
    nearby_diamond_ore: true
    # ここは鉄以上のピッケルが必要だが、簡易的にinventory.category.pickaxeを使う
    # 実際は inventory.iron_pickaxe や inventory.diamond_pickaxe が必要
    inventory.iron_pickaxe: ">=1"  # または inventory.category.iron_or_better_pickaxe
  effects:
    inventory.diamond: "+1"
  cost: 15
  skill: gather
  params:
    itemName: diamond_ore
    count: 1
```

**workbench_craft_actions.yaml**
```yaml
# ダイヤモンドツール
- name: craft_diamond_pickaxe
  preconditions:
    inventory.diamond: ">=3"
    has_stick: ">=2"
    nearby_workbench: true
  effects:
    inventory.diamond: "-3"
    has_stick: "-2"
    inventory.diamond_pickaxe: "+1"
  cost: 10
  skill: workbench_craft

- name: craft_diamond_axe
  preconditions:
    inventory.diamond: ">=3"
    has_stick: ">=2"
    nearby_workbench: true
  effects:
    inventory.diamond: "-3"
    has_stick: "-2"
    inventory.diamond_axe: "+1"
  cost: 10
  skill: workbench_craft

- name: craft_diamond_sword
  preconditions:
    inventory.diamond: ">=2"
    has_stick: ">=1"
    nearby_workbench: true
  effects:
    inventory.diamond: "-2"
    has_stick: "-1"
    inventory.diamond_sword: "+1"
  cost: 10
  skill: workbench_craft

- name: craft_diamond_shovel
  preconditions:
    inventory.diamond: ">=1"
    has_stick: ">=2"
    nearby_workbench: true
  effects:
    inventory.diamond: "-1"
    has_stick: "-2"
    inventory.diamond_shovel: "+1"
  cost: 10
  skill: workbench_craft

- name: craft_diamond_hoe
  preconditions:
    inventory.diamond: ">=2"
    has_stick: ">=2"
    nearby_workbench: true
  effects:
    inventory.diamond: "-2"
    has_stick: "-2"
    inventory.diamond_hoe: "+1"
  cost: 10
  skill: workbench_craft
```

#### state_schema.yamlの更新

```yaml
nearby_diamond_ore:
  type: boolean
  default: false
  description: "採掘可能距離（5ブロック以内）にダイヤモンド鉱石が存在する"
  detection_method: "findBlock"
  block_name: "diamond_ore"
  max_distance: 5
```

### 1.3 その他の重要アイテム

#### 松明（探索に必須）

**workbench_craft_actions.yaml**
```yaml
- name: craft_torches
  preconditions:
    inventory.charcoal: ">=1"  # または inventory.coal
    has_stick: ">=1"
  effects:
    inventory.charcoal: "-1"
    has_stick: "-1"
    inventory.torch: "+4"  # 松明は4個作成される
  cost: 2
  skill: hand_craft  # 2x2で作れる
```

#### 防具（鉄防具優先）

**workbench_craft_actions.yaml**
```yaml
- name: craft_iron_helmet
  preconditions:
    inventory.iron_ingot: ">=5"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-5"
    inventory.iron_helmet: "+1"
  cost: 8
  skill: workbench_craft

- name: craft_iron_chestplate
  preconditions:
    inventory.iron_ingot: ">=8"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-8"
    inventory.iron_chestplate: "+1"
  cost: 8
  skill: workbench_craft

- name: craft_iron_leggings
  preconditions:
    inventory.iron_ingot: ">=7"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-7"
    inventory.iron_leggings: "+1"
  cost: 8
  skill: workbench_craft

- name: craft_iron_boots
  preconditions:
    inventory.iron_ingot: ">=4"
    nearby_workbench: true
  effects:
    inventory.iron_ingot: "-4"
    inventory.iron_boots: "+1"
  cost: 8
  skill: workbench_craft
```

#### 食糧

**hand_craft_actions.yaml**
```yaml
# パンのクラフト
- name: craft_bread
  preconditions:
    inventory.wheat: ">=3"
  effects:
    inventory.wheat: "-3"
    inventory.bread: "+1"
  cost: 2
  skill: hand_craft
```

**furnace_actions.yaml**
```yaml
# 肉の調理
- name: cook_beef
  preconditions:
    inventory.raw_beef: ">=1"
    inventory.charcoal: ">=1"
    nearby_furnace: true
  effects:
    inventory.raw_beef: "-1"
    inventory.charcoal: "-1"
    inventory.cooked_beef: "+1"
  cost: 12
  skill: furnace_smelt
  params:
    input: "raw_beef"
    fuel: "charcoal"
    output: "cooked_beef"
    fuel_count: 1

- name: cook_porkchop
  preconditions:
    inventory.raw_porkchop: ">=1"
    inventory.charcoal: ">=1"
    nearby_furnace: true
  effects:
    inventory.raw_porkchop: "-1"
    inventory.charcoal: "-1"
    inventory.cooked_porkchop: "+1"
  cost: 12
  skill: furnace_smelt
  params:
    input: "raw_porkchop"
    fuel: "charcoal"
    output: "cooked_porkchop"
    fuel_count: 1
```

### 1.4 block_categories.yamlの拡張

```yaml
# 鉱石カテゴリ
iron_ore:
  - iron_ore
  - deepslate_iron_ore

diamond_ore:
  - diamond_ore
  - deepslate_diamond_ore

coal_ore:
  - coal_ore
  - deepslate_coal_ore

# 食材カテゴリ
raw_meat:
  - raw_beef
  - raw_porkchop
  - raw_chicken
  - raw_mutton

cooked_meat:
  - cooked_beef
  - cooked_porkchop
  - cooked_chicken
  - cooked_mutton
```

### 1.5 実装タスク

- [ ] state_schema.yamlに鉄鉱石、ダイヤモンド鉱石の検出を追加
- [ ] state_builderに鉱石検出ロジックを追加
- [ ] gather_actions.yamlに鉄鉱石・ダイヤモンド採掘を追加
- [ ] furnace_actions.yamlに鉄インゴット精錬を追加
- [ ] workbench_craft_actions.yamlに鉄・ダイヤツール/防具を追加
- [ ] hand_craft_actions.yamlに松明・パンを追加
- [ ] block_categories.yamlに鉱石カテゴリを追加
- [ ] 複合状態（inventory.category.pickaxe等）に鉄・ダイヤを追加

---

## フェーズ2: 探索システムの基盤

> 「材料が近くにない」問題を解決し、目的を持った探索を可能にする

### 2.1 位置記憶システム

#### データ構造
```javascript
// planner_bot/src/memory/location_memory.js
class LocationMemory {
  constructor() {
    this.locations = new Map()
    // location = {
    //   name: "home",
    //   type: "structure", // "structure", "resource", "danger"
    //   coordinates: {x, y, z},
    //   metadata: { ... },
    //   timestamp: Date.now()
    // }
  }

  saveLocation(name, coordinates, type, metadata) {}
  getLocation(name) {}
  getLocationsByType(type) {}
  getNearestLocation(currentPos, type) {}
  updateLocation(name, updates) {}
}
```

#### Primitives追加
```javascript
// planner_bot/src/primitives.js
async function saveLocationPrimitive(bot, params, memoryManager) {
  const {name, type, metadata} = params
  const pos = bot.entity.position
  memoryManager.locations.saveLocation(name, pos, type, metadata)
}

async function navigateToSavedLocation(bot, params, memoryManager) {
  const {locationName} = params
  const location = memoryManager.locations.getLocation(locationName)
  if (!location) throw new Error(`Unknown location: ${locationName}`)

  await navigateTo(bot, location.coordinates)
}
```

### 2.2 探索API

#### 新しいスキル: explore
```javascript
// planner_bot/src/skills/explore.js
async function explore(bot, params, stateManager, memoryManager) {
  const {direction, distance, purpose} = params
  // direction: "north", "south", "east", "west", "random"
  // distance: 移動距離（ブロック数）
  // purpose: "iron_ore", "village", "cave", "wood" など

  const startPos = bot.entity.position.clone()
  const targetPos = calculateTargetPosition(startPos, direction, distance)

  const discoveries = []

  // 移動しながら周囲をスキャン
  await navigateTo(bot, targetPos)

  // 発見物を記録
  const nearbyBlocks = scanSurroundings(bot, 32)
  if (purpose === "iron_ore" && nearbyBlocks.iron_ore.length > 0) {
    discoveries.push({
      type: "iron_ore",
      position: nearbyBlocks.iron_ore[0].position
    })
    memoryManager.locations.saveLocation(
      `iron_ore_${Date.now()}`,
      nearbyBlocks.iron_ore[0].position,
      "resource",
      {resourceType: "iron_ore"}
    )
  }

  return {discoveries, explored: true}
}
```

### 2.3 周囲状況分析

```javascript
// planner_bot/src/primitives.js
async function analyzeSurroundings(bot, params) {
  const {radius = 32} = params

  const analysis = {
    resources: {},
    structures: [],
    threats: [],
    terrain: {}
  }

  // ブロックスキャン
  for (const blockType of ['iron_ore', 'coal_ore', 'diamond_ore', 'log', 'stone']) {
    const blocks = bot.findBlocks({
      matching: (block) => block && block.name.includes(blockType),
      maxDistance: radius,
      count: 10
    })
    analysis.resources[blockType] = blocks.length
  }

  // 敵スキャン
  const entities = Object.values(bot.entities)
  for (const entity of entities) {
    if (entity.type === 'mob' && entity.mobType !== 'Passive') {
      analysis.threats.push({
        type: entity.mobType,
        distance: bot.entity.position.distanceTo(entity.position)
      })
    }
  }

  return analysis
}
```

### 2.4 実装タスク

- [ ] LocationMemoryクラスの実装
- [ ] saveLocationPrimitive, navigateToSavedLocationの実装
- [ ] exploreスキルの実装
- [ ] analyzeSurroundingsの実装
- [ ] 探索結果の記録・可視化

---

## フェーズ3: AI間協調システム

> 複数のボットが役割分担して効率的に活動する

### 3.1 AI間通信

#### メッセージングシステム
```javascript
// planner_bot/src/communication/messaging.js
class MessageBus {
  constructor() {
    this.bots = new Map() // botName -> bot instance
    this.messageHistory = []
  }

  registerBot(name, bot) {}
  sendMessage(from, to, message) {}
  broadcastMessage(from, message) {}
  getMessageHistory(botName, limit = 10) {}
}
```

#### Primitives追加
```javascript
async function sendMessagePrimitive(bot, params, messageBus) {
  const {targetBot, message} = params
  messageBus.sendMessage(bot.username, targetBot, message)
  // 相手のボットのチャットに表示
  bot.chat(`@${targetBot}: ${message}`)
}
```

### 3.2 アイテム授受

#### アイテム転送
```javascript
// planner_bot/src/primitives.js
async function giveItemPrimitive(bot, params, botManager) {
  const {targetBotName, itemName, count} = params

  const targetBot = botManager.getBot(targetBotName)
  if (!targetBot) throw new Error(`Bot not found: ${targetBotName}`)

  // アイテムを投げる
  const item = bot.inventory.items().find(i => i.name === itemName)
  if (!item || item.count < count) {
    throw new Error(`Not enough ${itemName}`)
  }

  await bot.toss(item.type, null, count)
  // 相手が拾うのを待つ
  await sleep(2000)
}

async function requestItemPrimitive(bot, params, botManager, messageBus) {
  const {targetBotName, itemName, count, reason} = params

  messageBus.sendMessage(
    bot.username,
    targetBotName,
    `アイテムリクエスト: ${itemName} x${count} (理由: ${reason})`
  )
}
```

### 3.3 役割管理

```javascript
// planner_bot/src/roles/role_manager.js
class RoleManager {
  constructor() {
    this.roles = new Map() // botName -> role
  }

  setRole(botName, role) {
    // role: "miner", "builder", "explorer", "defender", "farmer"
    this.roles.set(botName, role)
  }

  getRole(botName) {
    return this.roles.get(botName) || "idle"
  }

  getBotsByRole(role) {
    return Array.from(this.roles.entries())
      .filter(([_, r]) => r === role)
      .map(([name, _]) => name)
  }
}
```

### 3.4 実装タスク

- [ ] MessageBusクラスの実装
- [ ] sendMessage, broadcastMessageの実装
- [ ] giveItem, requestItemの実装
- [ ] RoleManagerクラスの実装
- [ ] 役割に応じたゴール優先度の調整

---

## フェーズ4: 戦闘・防衛システム

### 4.1 敵検知

```javascript
async function detectThreats(bot, params) {
  const {radius = 16} = params

  const threats = []
  const entities = Object.values(bot.entities)

  for (const entity of entities) {
    const distance = bot.entity.position.distanceTo(entity.position)
    if (distance > radius) continue

    if (entity.type === 'mob') {
      const hostile = ['Zombie', 'Skeleton', 'Creeper', 'Spider', 'Enderman']
      if (hostile.includes(entity.mobType)) {
        threats.push({
          type: entity.mobType,
          distance: distance,
          entity: entity
        })
      }
    }
  }

  return threats
}
```

### 4.2 戦闘スキル

```javascript
// planner_bot/src/skills/combat.js
async function combat(bot, params, stateManager) {
  const {targetEntity, strategy} = params
  // strategy: "aggressive", "defensive", "flee"

  if (strategy === "flee") {
    // 逃走
    const safeLocation = memoryManager.locations.getNearestLocation(
      bot.entity.position,
      "structure"
    )
    await navigateTo(bot, safeLocation.coordinates)
    return
  }

  // 武器を装備
  const sword = bot.inventory.items().find(i => i.name.includes('sword'))
  if (sword) await bot.equip(sword, 'hand')

  // 攻撃
  await bot.pvp.attack(targetEntity)
}
```

### 4.3 実装タスク

- [ ] detectThreatsの実装
- [ ] combatスキルの実装
- [ ] retreatToSafetyの実装
- [ ] 自動防衛モードの実装

---

## フェーズ5: LLM統合

### 5.1 状況サマリ生成

```javascript
// planner_bot/src/llm/situation_analyzer.js
function generateSituationSummary(bot, memoryManager, botManager) {
  const threats = detectThreats(bot, {radius: 16})
  const inventory = bot.inventory.items().map(i => `${i.name}×${i.count}`)

  return {
    time: bot.time.isDay ? "昼" : "夜 (危険)",
    position: bot.entity.position,
    health: `${Math.round(bot.health / 20 * 100)}%`,
    hunger: `${Math.round(bot.food / 20 * 100)}%`,
    inventory: inventory.join(", "),
    threats: threats.map(t => `${t.type} (${Math.round(t.distance)}m)`),
    knownLocations: memoryManager.locations.getLocationsByType("structure"),
    otherBots: botManager.getBotStatuses()
  }
}
```

### 5.2 LLM判断ループ

```javascript
async function llmDecisionLoop(bot, interval = 10000) {
  setInterval(async () => {
    const situation = generateSituationSummary(bot, memoryManager, botManager)
    const decision = await decidenextAction(situation)

    // LLMの判断に基づいてゴールを設定
    if (decision.action === "explore") {
      await executeGoal(bot, `explore(${decision.params})`)
    } else if (decision.action === "goal") {
      await executeGoal(bot, decision.goalName)
    }
  }, interval)
}
```

### 5.3 実装タスク

- [ ] 状況サマリ生成の実装
- [ ] LLM API統合（OpenAI / Anthropic）
- [ ] 判断ループの実装
- [ ] プロンプトエンジニアリング

---

## 付録: 技術的な考慮事項

### A. ツール必要度の階層

**Tier 1（採掘可能）:**
- 素手: 土、砂、砂利、木
- 木のピッケル: 石、石炭鉱石
- 石のピッケル: 鉄鉱石、ラピスラズリ鉱石
- 鉄のピッケル: ダイヤモンド鉱石、金鉱石、レッドストーン鉱石
- ダイヤのピッケル: 黒曜石

**複合状態の追加候補:**
```yaml
inventory.category.stone_or_better_pickaxe:
  depends_on_inventory: [stone_pickaxe, iron_pickaxe, diamond_pickaxe, netherite_pickaxe]

inventory.category.iron_or_better_pickaxe:
  depends_on_inventory: [iron_pickaxe, diamond_pickaxe, netherite_pickaxe]
```

### B. パフォーマンス最適化

- **ブロック検索のキャッシュ**: 毎回findBlocksするのは重い
- **探索結果の永続化**: ファイルまたはDBに保存
- **LLM呼び出しの頻度制御**: コスト削減

### C. エラーハンドリング

- **材料不足**: LLMに「探索が必要」と伝える
- **パスファインディング失敗**: 別ルートを試す
- **敵遭逃**: 戦闘or逃走の判断

---

## 次のステップ

1. **フェーズ1の実装**: 鉄・ダイヤモンド関連のアクション追加
2. **テスト**: `!goal inventory.iron_pickaxe:1` が動作するか確認
3. **フェーズ2の設計**: 探索システムの詳細仕様を決定
