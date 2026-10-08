const { getStateValue, evaluateCondition } = require('./state_operations')
const { loadCompositeStateDependencies } = require('./relevance')
const { buildRequirementFromGoalTarget, computeRequirementDeficit, findActionsForRequirement } = require('./heuristic')
function diagnoseGoalFailure(goal, currentState, actions, heuristicContext) {
  const missingRequirements = []
  const suggestions = []

  for (const [key, targetValue] of Object.entries(goal)) {
    const requirement = buildRequirementFromGoalTarget(targetValue)
    const deficit = computeRequirementDeficit(key, requirement, currentState)

    if (deficit > 0) {
      // この要求が満たされていない
      const currentValue = getStateValue(currentState, key)
      const displayCurrent = currentValue !== undefined ? currentValue : 'なし'
      const displayTarget = typeof targetValue === 'number'
        ? `${targetValue}個`
        : targetValue === true ? 'true' : String(targetValue)

      missingRequirements.push({
        key,
        current: displayCurrent,
        target: displayTarget,
        deficit
      })

      // 複合状態の依存関係をチェック
      const compositeStateDeps = loadCompositeStateDependencies()
      const isComputedState = compositeStateDeps[key] && compositeStateDeps[key].length > 0

      if (isComputedState) {
        // 複合状態の場合、依存しているインベントリアイテムを提案
        const dependencies = compositeStateDeps[key]
        suggestions.push({
          target: key,
          action: null,
          isComputedState: true,
          dependencies: dependencies,
          message: `${key} は複合状態です。以下のいずれかを入手してください: ${dependencies.join(', ')}`
        })
        continue
      }

      // この要求を満たすためのアクションを探す
      const candidateActions = findActionsForRequirement(key, requirement, actions)

      if (candidateActions.length > 0) {
        // コスト順にソート（低コスト優先）
        const sortedActions = candidateActions.sort((a, b) => {
          const costA = Number.isFinite(a.cost) ? a.cost : 1
          const costB = Number.isFinite(b.cost) ? b.cost : 1
          return costA - costB
        })

        // 全てのアクションを調べて、前提条件の充足状況を記録
        for (const action of sortedActions) {
          if (action.preconditions) {
            const preconditionStatus = []
            let allSatisfied = true

            for (const [preKey, preCondition] of Object.entries(action.preconditions)) {
              const preValue = getStateValue(currentState, preKey)
              const isSatisfied = evaluateCondition(preValue, preCondition)
              const displayPreValue = preValue !== undefined ? preValue : 'なし'

              preconditionStatus.push({
                key: preKey,
                current: displayPreValue,
                required: preCondition,
                satisfied: isSatisfied
              })

              if (!isSatisfied) {
                allSatisfied = false
              }
            }

            // 全ての選択肢を記録（満たされているかどうかに関わらず）
            suggestions.push({
              target: key,
              action: action.name,
              cost: action.cost,
              allSatisfied: allSatisfied,
              preconditions: preconditionStatus
            })
          }
        }
      } else {
        // アクションが見つからない場合
        suggestions.push({
          target: key,
          action: null,
          message: `${key}を達成するアクションが見つかりません`
        })
      }
    }
  }

  return {
    missingRequirements,
    suggestions
  }
}

module.exports = { diagnoseGoalFailure }
