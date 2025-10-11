const goapPlanner = require('../planner/goap')
const skills = require('../skills')
const { analyseStepPreconditions, getStateValue } = require('./precondition_checker')

/**
 * GOAPプランを実行（リプランニング対応）
 * @param {Object} bot - Mineflayerボット
 * @param {string} goalName - 目標名
 * @param {Array} initialPlan - 初期プラン
 * @param {Object} stateManager - 状態マネージャー
 */
async function executePlanWithReplanning(bot, goalName, initialPlan, stateManager) {
  let currentPlan = [...initialPlan]
  let stepIndex = 0

  while (stepIndex < currentPlan.length) {
    const step = currentPlan[stepIndex]

    if (!step.skill) {
      console.log(`目標達成: ${step.action}`)
      stepIndex++
      continue
    }

    const preconditionStatus = await analyseStepPreconditions(bot, step, stateManager)

    if (!preconditionStatus.satisfied) {
      console.log(`[REACTIVE_GOAP] ステップ "${step.action}" の前提条件が満たされていません。補助サブゴールを探索します...`)

      const resolved = await tryResolveMissingPreconditions(bot, step, stateManager, preconditionStatus)

      if (resolved) {
        // サブゴールで前提条件を満たしたので、同じステップを再評価
        continue
      }

      console.log(`[REACTIVE_GOAP] サブゴールでの解決に失敗。リプランニングを実行...`)
      console.log(`[REACTIVE_GOAP] 目標: ${goalName}`)

      await stateManager.refresh(bot)
      const newPlan = await replan(bot, goalName, stateManager)

      console.log(`[REACTIVE_GOAP] 新しいプラン長: ${newPlan.length}`)
      console.log(`[REACTIVE_GOAP] 新しいプラン: ${newPlan.map(s => s.action).join(' -> ')}`)
      logReplanDetails(newPlan)

      currentPlan = newPlan
      stepIndex = 0
      continue
    }

    // ステップ実行（実行時エラーもリプランニングで対応）
    try {
      await executeStep(bot, step, stateManager)
      stepIndex++
    } catch (error) {
      console.log(`[REACTIVE_GOAP] ステップ "${step.action}" の実行中にエラーが発生: ${error.message}`)
      console.log(`[REACTIVE_GOAP] 現在の状態から再度プランニングします...`)

      // 状態を更新してリプランニング
      await stateManager.refresh(bot)
      const newPlan = await replan(bot, goalName, stateManager)

      console.log(`[REACTIVE_GOAP] 新しいプラン長: ${newPlan.length}`)
      console.log(`[REACTIVE_GOAP] 新しいプラン: ${newPlan.map(s => s.action).join(' -> ')}`)
      logReplanDetails(newPlan)

      currentPlan = newPlan
      stepIndex = 0
      continue
    }
  }

  console.log(`[EXECUTION] 全${currentPlan.length}ステップ完了`)
  console.log(`[EXECUTION] 最終プラン: ${currentPlan.map(s => s.action).join(' -> ')}`)
}

/**
 * リプランニングを実行
 * @param {Object} bot - Mineflayerボット
 * @param {string} goalName - 目標名
 * @param {Object} stateManager - 状態マネージャー
 * @returns {Promise<Array>} 新しいプラン
 */
async function replan(bot, goalName, stateManager) {
  const currentState = await stateManager.getState(bot)
  const result = goapPlanner.plan(goalName, currentState)

  // 新しい戻り値形式に対応
  let newPlan = null
  let diagnosis = null

  if (result && typeof result === 'object' && 'plan' in result) {
    // 新形式: { plan: [...], diagnosis: {...} }
    newPlan = result.plan
    diagnosis = result.diagnosis
  } else if (Array.isArray(result)) {
    // 旧形式（後方互換）: plan配列が直接返される
    newPlan = result
  }

  if (!newPlan || !Array.isArray(newPlan)) {
    let errorMessage = 'リプランニングに失敗しました。実行可能なプランが見つかりません。'

    // 診断情報があればログに出力
    if (diagnosis) {
      if (diagnosis.error) {
        errorMessage = `リプランニングに失敗: ${diagnosis.error}`
      } else if (diagnosis.suggestions && diagnosis.suggestions.length > 0) {
        console.log('\n=== REPLANNING DIAGNOSIS ===')
        console.log('プランが見つからなかった理由:')

        if (diagnosis.missingRequirements && diagnosis.missingRequirements.length > 0) {
          console.log('満たされていない要件:')
          for (const req of diagnosis.missingRequirements) {
            console.log(`  - ${req.key}: 現在=${req.current}, 目標=${req.target}`)
          }
        }

        console.log('\n提案:')
        for (const suggestion of diagnosis.suggestions.slice(0, 3)) { // 最大3つまで表示
          if (suggestion.message) {
            console.log(`  - ${suggestion.message}`)
          } else if (suggestion.action && suggestion.missingPreconditions) {
            console.log(`  - ${suggestion.target} を達成するには ${suggestion.action} が必要ですが、以下が不足:`)
            for (const missing of suggestion.missingPreconditions.slice(0, 2)) {
              const requiredStr = typeof missing.required === 'boolean'
                ? missing.required.toString()
                : typeof missing.required === 'string' && missing.required.match(/^(>=|<=|>|<|==|!=)/)
                  ? missing.required
                  : `>= ${missing.required}`
              console.log(`      * ${missing.key}: 現在=${missing.current}, 必要=${requiredStr}`)
            }
          }
        }
        console.log('===========================\n')
      }
    }

    throw new Error(errorMessage)
  }

  return newPlan
}

/**
 * 単一ステップを実行
 * @param {Object} bot - Mineflayerボット
 * @param {Object} step - プランステップ
 * @param {Object} stateManager - 状態マネージャー
 */
async function executeStep(bot, step, stateManager) {
  const skill = skills[step.skill]

  if (typeof skill !== 'function') {
    throw new Error(`スキル ${step.skill} が見つかりません`)
  }

  console.log(`[EXECUTION] ステップ: ${step.action}`)

  await skill(bot, step.params || {}, stateManager)
  await stateManager.refresh(bot)

  console.log(`[EXECUTION] ステップ "${step.action}" 完了`)

  // 各アクション完了をチャットに表示（一時的にコメントアウト）
  // await bot.chatWithDelay(`${step.action} を完了しました`)
}

/**
 * リプラン詳細をログ出力
 * @param {Array} plan - プラン
 */
function logReplanDetails(plan) {
  console.log(`[REACTIVE_GOAP] 新プランの詳細:`)
  plan.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.action} (skill: ${step.skill || 'なし'})`)
  })
}

function formatCondition(condition) {
  if (typeof condition === 'boolean' || typeof condition === 'number') {
    return String(condition)
  }
  return condition
}

function deriveSubGoalInput(missing, goapState) {
  const { key, condition } = missing
  const current = Number(getStateValue(goapState, key)) || 0

  const clamp = (value) => Math.max(1, Math.min(64, Math.round(value)))

  if (typeof condition === 'number') {
    const requiredDelta = condition - current
    if (requiredDelta <= 0) return null
    const deficit = clamp(requiredDelta)
    return `${key}:${deficit}`
  }

  if (typeof condition === 'string') {
    const trimmed = condition.trim()
    const comparison = trimmed.match(/^(>=|<=|==|!=|>|<)\s*(-?\d+)$/)
    if (comparison) {
      const [, operator, raw] = comparison
      const target = Number(raw)
      let required
      switch (operator) {
        case '>':
          required = target + 1
          break
        case '>=':
          required = target
          break
        case '==':
          required = target
          break
        default:
          return null
      }
      const deficitRaw = required - current
      if (deficitRaw <= 0) return null
      const deficit = clamp(deficitRaw)
      return `${key}:${deficit}`
    }

    if (/^-?\d+$/.test(trimmed)) {
      const target = Number(trimmed)
      const deficitRaw = target - current
      if (deficitRaw <= 0) return null
      const deficit = clamp(deficitRaw)
      return `${key}:${deficit}`
    }
  }

  if (typeof condition === 'boolean') {
    return condition === true ? `${key}:true` : `${key}:false`
  }

  return null
}

async function executeSimplePlan(bot, plan, stateManager) {
  for (const step of plan) {
    if (!step.skill) continue

    const status = await analyseStepPreconditions(bot, step, stateManager)
    if (!status.satisfied) {
      throw new Error(`サブプランのステップ ${step.action} の前提条件を満たせません`)
    }
    await executeStep(bot, step, stateManager)
  }
}

async function tryResolveMissingPreconditions(bot, step, stateManager, status) {
  for (const missing of status.missing) {
    const subGoalInput = deriveSubGoalInput(missing, status.goapState)
    if (!subGoalInput) {
      continue
    }

    console.log(`[REACTIVE_GOAP]   → 補助ゴール検討: ${missing.key} ${formatCondition(missing.condition)} / 現在値 ${missing.currentValue ?? 0}`)
    console.log(`[REACTIVE_GOAP]     サブゴール候補: ${subGoalInput}`)

    const subResult = goapPlanner.plan(subGoalInput, status.worldState)

    // 新しい戻り値形式に対応
    let subPlan = null
    let subDiagnosis = null

    if (subResult && typeof subResult === 'object' && 'plan' in subResult) {
      subPlan = subResult.plan
      subDiagnosis = subResult.diagnosis
    } else if (Array.isArray(subResult)) {
      subPlan = subResult
    }

    if (!subPlan || !Array.isArray(subPlan) || subPlan.length === 0) {
      console.log(`[REACTIVE_GOAP]     サブプラン生成に失敗 (${subGoalInput})`)

      // 診断情報があれば簡潔に表示
      if (subDiagnosis && subDiagnosis.suggestions && subDiagnosis.suggestions.length > 0) {
        const firstSuggestion = subDiagnosis.suggestions[0]
        if (firstSuggestion.missingPreconditions && firstSuggestion.missingPreconditions.length > 0) {
          const firstMissing = firstSuggestion.missingPreconditions[0]
          console.log(`[REACTIVE_GOAP]       → 不足: ${firstMissing.key} (現在: ${firstMissing.current})`)
        }
      }

      continue
    }

    console.log(`[REACTIVE_GOAP]     サブプラン: ${subPlan.map(s => s.action).join(' -> ')}`)

    try {
      await executeSimplePlan(bot, subPlan, stateManager)
      await stateManager.refresh(bot)
      console.log(`[REACTIVE_GOAP]     サブゴール達成 (${subGoalInput})`)
      return true
    } catch (error) {
      console.log(`[REACTIVE_GOAP]     サブゴール実行に失敗: ${error.message}`)
      await stateManager.refresh(bot)
    }
  }

  return false
}

module.exports = {
  executePlanWithReplanning
}
