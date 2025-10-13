const goapPlanner = require('../planner/goap')
const { executePlanWithReplanning } = require('../executor/goap_executor')

/**
 * !goal コマンドのハンドラ
 * @param {Object} bot - Mineflayerボット
 * @param {string} goalName - 目標名
 * @param {Object} stateManager - 状態マネージャー
 * @param {AbortSignal} signal - キャンセル用シグナル（オプション）
 */
async function handleGoalCommand(bot, goalName, stateManager, signal = null) {
  const worldState = await stateManager.getState(bot)
  const result = await goapPlanner.plan(goalName, worldState)

  // 新しい戻り値形式に対応
  // resultがオブジェクトでplanプロパティを持つ場合は新形式、配列の場合は旧形式（後方互換）
  let plan = null
  let diagnosis = null

  if (result && typeof result === 'object' && 'plan' in result) {
    // 新形式: { plan: [...], diagnosis: {...} }
    plan = result.plan
    diagnosis = result.diagnosis
  } else if (Array.isArray(result)) {
    // 旧形式（後方互換）: plan配列が直接返される
    plan = result
  }

  if (!plan || !Array.isArray(plan)) {
    await bot.chatWithDelay('目標を実行できません')

    // 詳細なエラーメッセージを構築
    let errorMessage = '目標を実行できません。'

    // 診断情報をチャットに表示
    if (diagnosis) {
      await sendDiagnosisToChat(bot, diagnosis)
      // コンソールには詳細ログ
      logDiagnosisDetails(diagnosis)

      // アクションが見つからない場合（作成できないアイテム）
      if (diagnosis.suggestions && diagnosis.suggestions.length > 0) {
        const firstSuggestion = diagnosis.suggestions[0]

        // アクションが存在しない場合
        if (firstSuggestion.message && firstSuggestion.message.includes('アクションが見つかりません')) {
          errorMessage += ` このアイテムは作成できません。使用可能なアイテム一覧を確認してください。`
        }
        // 材料不足の場合
        else if (firstSuggestion.preconditions && firstSuggestion.preconditions.length > 0) {
          const unsatisfied = firstSuggestion.preconditions.filter(p => !p.satisfied)
          if (unsatisfied.length > 0) {
            const missing = unsatisfied
              .map(p => {
                const current = p.current || 'なし'
                const required = p.required
                return `${p.key}(現在:${current}, 必要:${required})`
              })
              .join(', ')
            errorMessage += ` 材料不足: ${missing}`
          }
        }
      }
    }

    // 例外を投げて失敗を通知
    throw new Error(errorMessage)
  }

  logPlanDetails(goalName, plan)
  // signalをexecutorに渡す
  await executePlanWithReplanning(bot, goalName, plan, stateManager, signal)
}

/**
 * 診断情報をチャットに送信（LLM向け）
 * @param {Object} bot - Mineflayerボット
 * @param {Object} diagnosis - 診断結果
 */
async function sendDiagnosisToChat(bot, diagnosis) {
  if (diagnosis.error) {
    await bot.chatWithDelay(`エラー: ${diagnosis.error}`)
    return
  }

  if (!diagnosis.missingRequirements || diagnosis.missingRequirements.length === 0) {
    return
  }

  await bot.chatWithDelay('=== 不足している要件 ===')

  // 不足している要件を簡潔に表示
  for (const req of diagnosis.missingRequirements) {
    const current = typeof req.current === 'boolean' ? (req.current ? 'true' : 'false') : req.current
    const target = typeof req.target === 'boolean' ? (req.target ? 'true' : 'false') : req.target
    await bot.chatWithDelay(`${req.key}: 現在=${current}, 必要=${target}`)
  }

  await bot.chatWithDelay('---')
  await bot.chatWithDelay('GOAP実行不可: 素材が近くにないか道具が不足しています')
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
