const { createLogger } = require('../utils/logger')

function checkCompositeState(key, rawDiagnosis) {
  if (!rawDiagnosis.suggestions || rawDiagnosis.suggestions.length === 0) {
    return null
  }

  // rawDiagnosisのsuggestionsから対応する複合状態を探す
  for (const suggestion of rawDiagnosis.suggestions) {
    if (suggestion.target === key && suggestion.isComputedState && suggestion.dependencies) {
      const logger = createLogger({ bot: null, category: 'goap.plan', commandName: 'goal' })
      logger.debug(`[DEBUG] Found composite state in checkCompositeState: ${key}`)
      logger.debug(`[DEBUG] Dependencies: ${JSON.stringify(suggestion.dependencies, null, 2)}`)

      // 最初の（最も安価な）依存関係を選択
      const cheapestDependency = suggestion.dependencies[0]
      logger.debug(`[DEBUG] Selected cheapest dependency: ${cheapestDependency}`)

      // "inventory.iron_pickaxe" -> "inventory.iron_pickaxe:1" の形式に変換
      return `${cheapestDependency}:1`
    }
  }

  return null
}

function buildStructuredDiagnosis(diagnosis, goalName) {
  const result = {
    goal: goalName,
    success: false,
    reason: 'planning_failed',
    missingRequirements: [],
    unsatisfiedPreconditions: []
  }

  if (diagnosis.error) {
    result.reason = 'error'
    result.error = diagnosis.error
    return result
  }

  // 不足している要件
  if (diagnosis.missingRequirements && diagnosis.missingRequirements.length > 0) {
    for (const req of diagnosis.missingRequirements) {
      result.missingRequirements.push({
        key: req.key,
        current: req.current,
        required: req.target
      })
    }
  }

  // 満たされていない前提条件
  if (diagnosis.suggestions && diagnosis.suggestions.length > 0) {
    // 目標ごとにグループ化して最も低コストのオプションを表示
    const groupedByTarget = {}
    for (const suggestion of diagnosis.suggestions) {
      if (!groupedByTarget[suggestion.target]) {
        groupedByTarget[suggestion.target] = []
      }
      groupedByTarget[suggestion.target].push(suggestion)
    }

    for (const [target, suggestions] of Object.entries(groupedByTarget)) {
      // 最も低コストの提案を選択
      const bestSuggestion = suggestions
        .filter(s => s.preconditions && s.preconditions.length > 0)
        .sort((a, b) => (a.cost || 999) - (b.cost || 999))[0]

      if (bestSuggestion && bestSuggestion.preconditions) {
        // 満たされていない前提条件のみ抽出
        const unsatisfied = bestSuggestion.preconditions
          .filter(p => !p.satisfied)
          .map(p => ({
            key: p.key,
            current: p.current,
            required: p.required
          }))

        if (unsatisfied.length > 0) {
          result.unsatisfiedPreconditions.push({
            target: target,
            action: bestSuggestion.action,
            cost: bestSuggestion.cost,
            missing: unsatisfied
          })
        }
      }
    }
  }

  return result
}

module.exports = { checkCompositeState, buildStructuredDiagnosis }
