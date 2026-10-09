const { loadStateSchema } = require('./state_builder')
const { getStateValue, evaluateCondition } = require('./state_operations')
const { getLogger } = require('./logging')
function loadCompositeStateDependencies() {
  const schema = loadStateSchema()
  const dependencies = {}

  // inventory_states, environment_states, world_statesの全てをチェック
  for (const section of ['inventory_states', 'environment_states', 'world_states']) {
    if (!schema[section]) continue

    for (const [stateName, config] of Object.entries(schema[section])) {
      // computed: true かつ depends_on が定義されている場合（旧方式）
      if (config.computed && Array.isArray(config.depends_on)) {
        dependencies[stateName] = config.depends_on
      }

      // computed: true かつ depends_on_inventory が定義されている場合（新方式）
      if (config.computed && Array.isArray(config.depends_on_inventory)) {
        // inventoryアイテムを "inventory.item_name" 形式に変換
        dependencies[stateName] = config.depends_on_inventory.map(
          itemName => `inventory.${itemName}`
        )
      }
    }
  }

  return dependencies
}

/**
 * 後方解析: ゴールに関連する状態変数を特定
 * @param {Object} goal - 目標状態
 * @param {Array} actions - 全アクション
 * @param {Object} initialState - 初期状態（複合状態の展開判定に使用）
 * @returns {Set} 関連する状態変数のセット
 */
function analyzeRelevantVariables(goal, actions, initialState = null) {
  const relevant = new Set(Object.keys(goal))
  const queue = [...relevant]

  // state_schema.yamlから複合状態の依存関係を動的に読み込む
  const compositeStateDependencies = loadCompositeStateDependencies()

  // 複合状態の展開を追跡（展開済みの複合状態からさらに展開しない）
  const expandedCompositeStates = new Set()

  while (queue.length > 0) {
    const variable = queue.shift()

    // 複合状態の依存関係を展開
    // ただし、以下の条件を全て満たす場合のみ:
    // 1. この変数が複合状態である
    // 2. まだ展開していない
    // 3. 初期状態で既に満たされているか、または初期状態が提供されていない
    if (compositeStateDependencies[variable] && !expandedCompositeStates.has(variable)) {
      // 初期状態で既にこの複合状態が満たされている場合は展開しない
      // （既に持っているピッケルを作り直す必要はない）
      const isAlreadySatisfied = initialState && initialState[variable] === true

      if (process.env.GOAP_DEBUG_COMPOSITE === '1') {
        getLogger().debug(`[COMPOSITE] ${variable}: isAlreadySatisfied=${isAlreadySatisfied}, deps=${JSON.stringify(compositeStateDependencies[variable])}`)
      }

      if (!isAlreadySatisfied) {
        // 複合状態はOR条件（いずれか1つ）なので、最も安い選択肢のみを展開
        // 例: inventory.category.pickaxe → wooden_pickaxe のみ（全てのピッケルではない）
        const deps = compositeStateDependencies[variable]
        const cheapestDep = deps[0]  // 配列の最初が最も安い（state_schema.yamlで定義順）

        if (process.env.GOAP_DEBUG_COMPOSITE === '1') {
          getLogger().debug(`[COMPOSITE] Expanding ${variable} → ${cheapestDep} (選択: 最初の1つのみ)`)
        }

        if (cheapestDep && !relevant.has(cheapestDep)) {
          relevant.add(cheapestDep)
          queue.push(cheapestDep)
          // 展開された依存変数が複合状態の場合、それを記録
          if (compositeStateDependencies[cheapestDep]) {
            expandedCompositeStates.add(cheapestDep)
          }
        }
      }
    }

    // この変数に影響を与えるアクション（正の効果を持つもの）を探す
    // 複合状態の場合は、最もコストの低いアクションのみを選択
    const isCompositeState = compositeStateDependencies[variable] && compositeStateDependencies[variable].length > 0

    let actionsToConsider = []
    for (const action of actions) {
      if (action.effects && action.effects[variable] !== undefined) {
        const effectValue = action.effects[variable]

        // 正の効果のみを追跡（マイナス効果は無視）
        let isPositiveEffect = false
        if (typeof effectValue === 'string') {
          if (effectValue.startsWith('+')) {
            isPositiveEffect = true
          }
        } else if (typeof effectValue === 'number' && effectValue > 0) {
          isPositiveEffect = true
        } else if (effectValue === true || effectValue === 'true') {
          isPositiveEffect = true
        }

        if (isPositiveEffect) {
          actionsToConsider.push(action)
        }
      }
    }

    // 複合状態の場合は最もコストの低いアクションのみ選択
    if (isCompositeState && actionsToConsider.length > 1) {
      const originalCount = actionsToConsider.length
      actionsToConsider.sort((a, b) => {
        const costA = Number.isFinite(a.cost) ? a.cost : 1
        const costB = Number.isFinite(b.cost) ? b.cost : 1
        return costA - costB
      })
      const cheapest = actionsToConsider[0]
      actionsToConsider = [cheapest]  // 最も安いもののみ

      if (process.env.GOAP_DEBUG_COMPOSITE === '1') {
        getLogger().debug(`[COMPOSITE] ${variable}を効果として持つアクション: ${originalCount}個から最安の${cheapest.name}を選択`)
      }
    }

    // 選択されたアクションの前提条件のみを追加
    for (const action of actionsToConsider) {
      if (action.preconditions) {
        for (const [preVar, preCond] of Object.entries(action.preconditions)) {
          // 初期状態ですでに満たしている前提は関連拡張しない
          if (initialState) {
            const currentVal = getStateValue(initialState, preVar)
            if (evaluateCondition(currentVal, preCond)) {
              continue
            }
            // nearby/visible 系は初期状態で0/未定義なら拡張しない（環境がないものは探さない）
            if ((preVar.startsWith('nearby.') || preVar.startsWith('visible_')) &&
                (currentVal === undefined || currentVal === 0)) {
              continue
            }
          }

          if (!relevant.has(preVar)) {
            relevant.add(preVar)
            queue.push(preVar)
          }
        }
      }
    }
  }

  return relevant
}

/**
 * アクションが関連変数に影響するかチェック
 * @param {Object} action - アクション
 * @param {Set} relevantVars - 関連変数のセット
 * @returns {boolean} 関連があればtrue
 */
function isActionRelevant(action, relevantVars) {
  // アクションの効果が関連変数のいずれかに正の影響を与えるか
  if (action.effects) {
    let hasPositiveEffect = false

    for (const [effectVar, effectValue] of Object.entries(action.effects)) {
      if (relevantVars.has(effectVar)) {
        // 正の効果を持つかチェック
        let isPositiveEffect = false
        if (typeof effectValue === 'string') {
          if (effectValue.startsWith('+')) {
            isPositiveEffect = true
          }
        } else if (typeof effectValue === 'number' && effectValue > 0) {
          isPositiveEffect = true
        } else if (effectValue === true || effectValue === 'true') {
          isPositiveEffect = true
        }

        if (isPositiveEffect) {
          hasPositiveEffect = true
        }
      }
    }

    // 少なくとも1つの関連変数に正の効果があればtrue
    return hasPositiveEffect
  }
  return false
}

module.exports = { loadCompositeStateDependencies, analyzeRelevantVariables, isActionRelevant }
