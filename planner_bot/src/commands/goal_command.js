const goapPlanner = require('../planner/goap')
const { executePlanWithReplanning } = require('../executor/goap_executor')

/**
 * !goal コマンドのハンドラ
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} goalName - 目標名
 * @param {Object} stateManager - 状態マネージャー
 * @param {AbortSignal} signal - キャンセル用シグナル（オプション）
 */
async function handleGoalCommand(bot, username, goalName, stateManager, signal = null) {
  // プランニング前に必ず最新の状態を取得
  await stateManager.refresh(bot)
  const worldState = await stateManager.getState(bot)
  const result = await goapPlanner.plan(goalName, worldState)

  // goapPlanner.plan() は常に { plan: [...], diagnosis: {...} } 形式を返す
  const plan = result.plan
  const diagnosis = result.diagnosis

  if (!plan || !Array.isArray(plan)) {
    bot.systemLog('目標を実行できません')

    // 構造化された診断情報を構築
    const structuredDiagnosis = buildStructuredDiagnosis(diagnosis, goalName)

    // コンソールに構造化されたデータを整形出力
    console.log('\n=== 構造化された診断情報 ===')
    console.log(JSON.stringify(structuredDiagnosis, null, 2))
    console.log('============================\n')

    // 会話履歴に構造化されたデータを記録
    bot.addMessage(bot.username, structuredDiagnosis, 'system_info')

    // コンソールには詳細ログ（開発者向け）
    logDiagnosisDetails(diagnosis)

    // エラーオブジェクトに構造化された診断情報を添付
    const error = new Error(`目標「${goalName}」を実行できません`)
    error.diagnosis = structuredDiagnosis
    throw error
  }

  logPlanDetails(goalName, plan)

  // 開始通知（LLMプロジェクトで使用する場合は bot.speak() も呼ぶ）
  const startMessage = `目標「${goalName}」を開始します`
  bot.systemLog(startMessage)
  // await bot.speak(username, startMessage)  // LLMプロジェクトで使用時にアンコメント
  // bot.addMessage(bot.username, startMessage, 'bot_response')  // LLMプロジェクトで使用時にアンコメント

  // signalをexecutorに渡す
  await executePlanWithReplanning(bot, goalName, plan, stateManager, signal)

  // 成功通知（LLMプロジェクトで使用する場合は bot.speak() も呼ぶ）
  const completeMessage = `目標「${goalName}」を完了しました`
  bot.systemLog(completeMessage)
  // await bot.speak(username, completeMessage)  // LLMプロジェクトで使用時にアンコメント
  // bot.addMessage(bot.username, completeMessage, 'bot_response')  // LLMプロジェクトで使用時にアンコメント
}

/**
 * 構造化された診断情報を構築
 * @param {Object} diagnosis - GOAP診断結果
 * @param {string} goalName - 目標名
 * @returns {Object} 構造化された診断情報
 */
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

/**
 * 診断情報をコンソールに出力（開発者向け詳細ログ）
 * @param {Object} diagnosis - 診断結果
 */
function logDiagnosisDetails(diagnosis) {
  if (diagnosis.error) {
    console.log('=== GOAL DIAGNOSIS ===')
    console.log(`エラー: ${diagnosis.error}`)
    console.log('======================')
    return
  }

  if (!diagnosis.missingRequirements || diagnosis.missingRequirements.length === 0) {
    return
  }

  console.log('\n=== GOAL DIAGNOSIS ===')
  console.log('満たされていない要件:')

  for (const req of diagnosis.missingRequirements) {
    console.log(`  - ${req.key}: 現在=${req.current}, 目標=${req.target}`)
  }

  if (diagnosis.suggestions && diagnosis.suggestions.length > 0) {
    console.log('\n提案: 以下の方法で達成できます:\n')

    // 目標ごとにグループ化
    const groupedByTarget = {}
    for (const suggestion of diagnosis.suggestions) {
      if (!groupedByTarget[suggestion.target]) {
        groupedByTarget[suggestion.target] = []
      }
      groupedByTarget[suggestion.target].push(suggestion)
    }

    for (const [target, suggestions] of Object.entries(groupedByTarget)) {
      console.log(`${target} を達成する方法:`)

      for (let i = 0; i < suggestions.length; i++) {
        const suggestion = suggestions[i]

        // 複合状態の特別処理
        if (suggestion.isComputedState && suggestion.dependencies) {
          console.log(`  ${target} は複合状態（自動計算）です。`)
          console.log(`  以下のいずれかを作成/入手すれば自動的に true になります:\n`)

          for (const dep of suggestion.dependencies) {
            console.log(`    - ${dep} を作成`)
          }
          console.log('')
          continue
        }

        if (suggestion.message) {
          console.log(`  オプション${i + 1}: ${suggestion.message}`)
          continue
        }

        if (!suggestion.action) continue

        const costStr = suggestion.cost !== undefined ? ` (コスト=${suggestion.cost})` : ''
        const statusStr = suggestion.allSatisfied ? ' ✓ 全ての前提条件を満たしています！' : ''
        console.log(`  オプション${i + 1}: ${suggestion.action}${costStr}${statusStr}`)

        if (suggestion.preconditions && suggestion.preconditions.length > 0) {
          console.log('    前提条件:')
          for (const precond of suggestion.preconditions) {
            const mark = precond.satisfied ? '✓' : '✗'
            const requiredStr = formatRequiredValue(precond.required)
            console.log(`      ${mark} ${precond.key}: 現在=${precond.current}, 必要=${requiredStr}`)
          }
        }
        console.log('')
      }
    }
  }

  console.log('======================\n')
}

function formatRequiredValue(required) {
  if (typeof required === 'boolean') {
    return required.toString()
  }
  if (typeof required === 'string' && required.match(/^(>=|<=|>|<|==|!=)/)) {
    return required
  }
  if (typeof required === 'number') {
    return `>= ${required}`
  }
  return String(required)
}

/**
 * プラン詳細をコンソールに出力
 * @param {string} goalName - 目標名
 * @param {Array} plan - プラン
 */
function logPlanDetails(goalName, plan) {
  console.log('=== GOAP PLAN DETAILS ===')
  console.log(`目標: ${goalName}`)
  console.log(`プラン長: ${plan.length} ステップ`)
  console.log('詳細:')

  plan.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.action}`)
    console.log(`     スキル: ${step.skill || 'なし'}`)
    console.log(`     パラメータ: ${JSON.stringify(step.params || {})}`)

    if (step.preconditions && Object.keys(step.preconditions).length > 0) {
      console.log(`     前提条件: ${JSON.stringify(step.preconditions)}`)
    }
    if (step.effects && Object.keys(step.effects).length > 0) {
      console.log(`     効果: ${JSON.stringify(step.effects)}`)
    }

    console.log(`     コスト: ${step.cost || 0}`)
    console.log('')
  })

  const totalCost = plan.reduce((sum, step) => sum + (step.cost || 0), 0)
  console.log(`総コスト: ${totalCost}`)
  console.log('========================')
}

module.exports = handleGoalCommand
