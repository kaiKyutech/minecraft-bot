const goapPlanner = require('../planner/goap')
const skills = require('../skills')
const { analyseStepPreconditions, getStateValue } = require('./precondition_checker')
const { checkCompositeState, buildStructuredDiagnosis } = require('../commands/goal_command')

function makeLogger(bot) {
  const base = bot?.systemLog ? bot.systemLog.bind(bot) : console.log
  return {
    log: base,
    warn: base,
    error: base
  }
}

function goapExecLog(bot, ...args) {
  const fn = bot?.systemLog ? bot.systemLog.bind(bot) : console.log
  const message = args.length === 1 ? args[0] : args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  fn(message)
}

// イベントループに制御を返す（I/Oフェーズまで到達させる）
function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * GOAPプランを実行（リプランニング対応）
 * @param {Object} bot - Mineflayerボット
 * @param {string} goalName - 目標名
 * @param {Array} initialPlan - 初期プラン
 * @param {Object} stateManager - 状態マネージャー
 * @param {AbortSignal} signal - キャンセル用シグナル（オプション）
 * @param {Array} missingPreconditions - 満たされていない前提条件のリスト（オプション）
 */
async function executePlanWithReplanning(bot, goalName, initialPlan, stateManager, signal = null, missingPreconditions = null) {
  let currentPlan = [...initialPlan]
  let stepIndex = 0

  while (stepIndex < currentPlan.length) {
    // キャンセルチェック
    if (signal && signal.aborted) {
      const error = new Error('Cancelled') // デモ用: シンプルなメッセージ
      error.name = 'AbortError'
      throw error
    }

    const step = currentPlan[stepIndex]

    if (!step.skill) {
      goapExecLog(bot, `目標達成: ${step.action}`)
      stepIndex++
      continue
    }

    // アクション開始前に最新状態へ更新（各ステップ1回）もしかするとこれじゃgoapが崩れるかもしれない。実験的にここだけにしてみる。
    stateManager.silentRefresh = !bot.shouldLogCommand('goal')
    await stateManager.refresh(bot)
    stateManager.silentRefresh = false

    const preconditionStatus = await analyseStepPreconditions(bot, step, stateManager)

    if (!preconditionStatus.satisfied) {
      goapExecLog(bot, `[REACTIVE_GOAP] ステップ "${step.action}" の前提条件が満たされていません。`)

      // サブゴール探索
      goapExecLog(bot, `[REACTIVE_GOAP] 補助サブゴールを探索します...`)
      const resolved = await tryResolveMissingPreconditions(bot, step, stateManager, preconditionStatus, signal)

      if (resolved) {
        // サブゴールで前提条件を満たしたので、同じステップを再評価
        continue
      }

      goapExecLog(bot, `[REACTIVE_GOAP] サブゴールでの解決に失敗。リプランニングを実行...`)
      goapExecLog(bot, `[REACTIVE_GOAP] 目標: ${goalName}`)

      stateManager.silentRefresh = !bot.shouldLogCommand('goal')
      await stateManager.refresh(bot)
      stateManager.silentRefresh = false
      const newPlan = await replan(bot, goalName, stateManager, signal, missingPreconditions)

      goapExecLog(bot, `[REACTIVE_GOAP] 新しいプラン長: ${newPlan.length}`)
      goapExecLog(bot, `[REACTIVE_GOAP] 新しいプラン: ${newPlan.map(s => s.action).join(' -> ')}`)
      logReplanDetails(newPlan, bot)

      currentPlan = newPlan
      stepIndex = 0
      continue
    }

    // ステップ実行（実行時エラーもリプランニングで対応）
    try {
      await executeStep(bot, step, stateManager, signal)
      stepIndex++

      // アクション間でイベントループに制御を返す（keep-alive処理のため）
      await yieldToEventLoop()
    } catch (error) {
      // キャンセルエラーは再スロー
      if (error.name === 'AbortError') {
        throw error
      }
      goapExecLog(bot, `[REACTIVE_GOAP] ステップ "${step.action}" の実行中にエラーが発生: ${error.message}`)
      goapExecLog(bot, `[REACTIVE_GOAP] 現在の状態から再度プランニングします...`)

      // 状態を更新してリプランニング
      await stateManager.refresh(bot)
      const newPlan = await replan(bot, goalName, stateManager, signal, missingPreconditions)

      goapExecLog(bot, `[REACTIVE_GOAP] 新しいプラン長: ${newPlan.length}`)
      goapExecLog(bot, `[REACTIVE_GOAP] 新しいプラン: ${newPlan.map(s => s.action).join(' -> ')}`)
      logReplanDetails(newPlan, bot)

      currentPlan = newPlan
      stepIndex = 0
      continue
    }
  }

  goapExecLog(bot, `[EXECUTION] 全${currentPlan.length}ステップ完了`)
  goapExecLog(bot, `[EXECUTION] 最終プラン: ${currentPlan.map(s => s.action).join(' -> ')}`)
}

/**
 * リプランニングを実行
 * @param {Object} bot - Mineflayerボット
 * @param {string} goalName - 目標名
 * @param {Object} stateManager - 状態マネージャー
 * @param {AbortSignal} signal - キャンセル用シグナル（オプション）
 * @param {Array} missingPreconditions - 満たされていない前提条件のリスト（オプション）
 * @returns {Promise<Array>} 新しいプラン
 */
async function replan(bot, goalName, stateManager, signal = null, missingPreconditions = null) {
  // キャンセルチェック
  if (signal && signal.aborted) {
    const error = new Error('Cancelled') // デモ用: シンプルなメッセージ
    error.name = 'AbortError'
    throw error
  }

  const currentState = await stateManager.getState(bot)
  const result = await goapPlanner.plan(goalName, currentState, makeLogger(bot))

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
        goapExecLog(bot, '\n=== REPLANNING DIAGNOSIS ===')
        goapExecLog(bot, 'プランが見つからなかった理由:')

        if (diagnosis.missingRequirements && diagnosis.missingRequirements.length > 0) {
          goapExecLog(bot, '満たされていない要件:')
          for (const req of diagnosis.missingRequirements) {
            goapExecLog(bot, `  - ${req.key}: 現在=${req.current}, 目標=${req.target}`)
          }
        }

        goapExecLog(bot, '\n提案:')
        for (const suggestion of diagnosis.suggestions.slice(0, 3)) { // 最大3つまで表示
          if (suggestion.message) {
            goapExecLog(bot, `  - ${suggestion.message}`)
          } else if (suggestion.action && suggestion.missingPreconditions) {
            goapExecLog(bot, `  - ${suggestion.target} を達成するには ${suggestion.action} が必要ですが、以下が不足:`)
            for (const missing of suggestion.missingPreconditions.slice(0, 2)) {
              const requiredStr = typeof missing.required === 'boolean'
                ? missing.required.toString()
                : typeof missing.required === 'string' && missing.required.match(/^(>=|<=|>|<|==|!=)/)
                  ? missing.required
                  : `>= ${missing.required}`
              goapExecLog(bot, `      * ${missing.key}: 現在=${missing.current}, 必要=${requiredStr}`)
            }
          }
        }
        goapExecLog(bot, '===========================\n')

        // 複合状態を自動解決してみる
        const structuredDiagnosis = buildStructuredDiagnosis(diagnosis, goalName)
        if (structuredDiagnosis.missingRequirements && structuredDiagnosis.missingRequirements.length > 0) {
          for (const req of structuredDiagnosis.missingRequirements) {
            const compositeGoal = checkCompositeState(req.key, diagnosis)
            if (compositeGoal) {
              goapExecLog(bot, `[REPLAN] 複合状態 "${req.key}" を検出 → サブゴール "${compositeGoal}" を試行`)

              // サブゴールのプランニングを試みる
              const subResult = await goapPlanner.plan(compositeGoal, currentState, makeLogger(bot))
              const subPlan = subResult?.plan

              if (subPlan && Array.isArray(subPlan) && subPlan.length > 0) {
                goapExecLog(bot, `[REPLAN] サブゴール "${compositeGoal}" のプランを発見、返します`)
                return subPlan
              } else {
                goapExecLog(bot, `[REPLAN] サブゴール "${compositeGoal}" のプランニングも失敗`)
                if (missingPreconditions) {
                  missingPreconditions.push(compositeGoal)
                }
              }
            }
          }
        }
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
 * @param {AbortSignal} signal - キャンセル用シグナル（オプション）
 */
async function executeStep(bot, step, stateManager, signal = null) {
  // キャンセルチェック
  if (signal && signal.aborted) {
    const error = new Error('Cancelled') // デモ用: シンプルなメッセージ
    error.name = 'AbortError'
    throw error
  }

  const skill = skills[step.skill]

  if (typeof skill !== 'function') {
    throw new Error(`スキル ${step.skill} が見つかりません`)
  }

  goapExecLog(bot, '\n' + '='.repeat(80))
  goapExecLog(bot, `[EXECUTION] ステップ: ${step.action}`)
  goapExecLog(bot, '='.repeat(80))

  // アクション実行前に状態を更新 34行に移動してみた。実験です。うまくいかない可能性があります。
  //await stateManager.refresh(bot)

  // signalがabortされたら、bot操作を中断するリスナーを設定
  let abortHandler = null
  if (signal) {
    abortHandler = () => {
      goapExecLog(bot, '[EXECUTION] キャンセルシグナル受信、ボット操作を中断します')
      // 移動を停止
      if (bot.pathfinder) {
        bot.pathfinder.setGoal(null)
      }
      // 掘削を停止
      try {
        bot.stopDigging()
      } catch (e) {
        // 掘削中でない場合はエラーを無視
      }
    }
    signal.addEventListener('abort', abortHandler)
  }

  try {
    // スキル実行
    await skill(bot, step.params || {}, stateManager)

      // アクション実行前に状態を更新　34行に移動してみた。実験です。うまくいかない可能性があります。
      //await stateManager.refresh(bot)

    goapExecLog(bot, `[EXECUTION] ステップ "${step.action}" 完了`)
    goapExecLog(bot, '='.repeat(80) + '\n')
  } finally {
    // リスナーをクリーンアップ
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler)
    }
  }
}

/**
 * リプラン詳細をログ出力
 * @param {Array} plan - プラン
 */
function logReplanDetails(plan, bot) {
  goapExecLog(bot, `[REACTIVE_GOAP] 新プランの詳細:`)
  plan.forEach((step, index) => {
    goapExecLog(bot, `  ${index + 1}. ${step.action} (skill: ${step.skill || 'なし'})`)
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

async function executeSimplePlan(bot, plan, stateManager, signal = null) {
  for (const step of plan) {
    // キャンセルチェック
    if (signal && signal.aborted) {
      const error = new Error('Cancelled') // デモ用: シンプルなメッセージ
      error.name = 'AbortError'
      throw error
    }

    if (!step.skill) continue

    await stateManager.refresh(bot)

    const status = await analyseStepPreconditions(bot, step, stateManager)
    if (!status.satisfied) {
      throw new Error(`サブプランのステップ ${step.action} の前提条件を満たせません`)
    }
    await executeStep(bot, step, stateManager, signal)
  }
}

async function tryResolveMissingPreconditions(bot, step, stateManager, status, signal = null) {
  for (const missing of status.missing) {
    const subGoalInput = deriveSubGoalInput(missing, status.goapState)
    if (!subGoalInput) {
      continue
    }

    goapExecLog(bot, `[REACTIVE_GOAP]   → 補助ゴール検討: ${missing.key} ${formatCondition(missing.condition)} / 現在値 ${missing.currentValue ?? 0}`)
    goapExecLog(bot, `[REACTIVE_GOAP]     サブゴール候補: ${subGoalInput}`)

    const subResult = await goapPlanner.plan(subGoalInput, status.worldState, makeLogger(bot))

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
      goapExecLog(bot, `[REACTIVE_GOAP]     サブプラン生成に失敗 (${subGoalInput})`)

      // 診断情報があれば簡潔に表示
      if (subDiagnosis && subDiagnosis.suggestions && subDiagnosis.suggestions.length > 0) {
        const firstSuggestion = subDiagnosis.suggestions[0]
        if (firstSuggestion.missingPreconditions && firstSuggestion.missingPreconditions.length > 0) {
          const firstMissing = firstSuggestion.missingPreconditions[0]
          goapExecLog(bot, `[REACTIVE_GOAP]       → 不足: ${firstMissing.key} (現在: ${firstMissing.current})`)
        }
      }

      continue
    }

    goapExecLog(bot, `[REACTIVE_GOAP]     サブプラン: ${subPlan.map(s => s.action).join(' -> ')}`)

    try {
      await executeSimplePlan(bot, subPlan, stateManager, signal)
      await stateManager.refresh(bot)
      goapExecLog(bot, `[REACTIVE_GOAP]     サブゴール達成 (${subGoalInput})`)
      return true
    } catch (error) {
      // キャンセルエラーは再スロー
      if (error.name === 'AbortError') {
        throw error
      }
      goapExecLog(bot, `[REACTIVE_GOAP]     サブゴール実行に失敗: ${error.message}`)
      await stateManager.refresh(bot)
    }
  }

  return false
}

module.exports = {
  executePlanWithReplanning
}
