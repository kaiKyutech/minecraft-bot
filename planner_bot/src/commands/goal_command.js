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
  const worldState = await stateManager.getState(bot)
  const result = await goapPlanner.plan(goalName, worldState)

  // goapPlanner.plan() は常に { plan: [...], diagnosis: {...} } 形式を返す
  const plan = result.plan
  const diagnosis = result.diagnosis

  if (!plan || !Array.isArray(plan)) {
    await bot.chatWithDelay(username, '目標を実行できません')

    // 詳細なエラーメッセージを構築
    let errorMessage = '目標を実行できません。'
    let diagnosisMessages = []

    // 診断情報をチャットに表示
    if (diagnosis) {
      diagnosisMessages = await sendDiagnosisToChat(bot, username, diagnosis)
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

    // エラーオブジェクトに診断メッセージを添付
    const error = new Error(errorMessage)
    error.diagnosisMessages = diagnosisMessages
    throw error
  }

  logPlanDetails(goalName, plan)
  // signalをexecutorに渡す
  await executePlanWithReplanning(bot, goalName, plan, stateManager, signal)

  // 成功通知
  await bot.chatWithDelay(username, `目標「${goalName}」を完了しました`)
}

/**
 * 診断情報をウィスパーで送信
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - 送信先ユーザー名
 * @param {Object} diagnosis - 診断結果
 * @returns {Array<string>} 送信したメッセージのリスト
 */
async function sendDiagnosisToChat(bot, username, diagnosis) {
  const messages = []

  if (diagnosis.error) {
    const msg = `エラー: ${diagnosis.error}`
    await bot.chatWithDelay(username, msg)
    messages.push(msg)
    return messages
  }

  if (!diagnosis.missingRequirements || diagnosis.missingRequirements.length === 0) {
    return messages
  }

  const header = '=== 不足している要件 ==='
  await bot.chatWithDelay(username, header)
  messages.push(header)

  // 不足している要件を簡潔に表示
  for (const req of diagnosis.missingRequirements) {
    const current = typeof req.current === 'boolean' ? (req.current ? 'true' : 'false') : req.current
    const target = typeof req.target === 'boolean' ? (req.target ? 'true' : 'false') : req.target
    const msg = `${req.key}: 現在=${current}, 必要=${target}`
    await bot.chatWithDelay(username, msg)
    messages.push(msg)
  }

  const separator = '---'
  await bot.chatWithDelay(username, separator)
  messages.push(separator)

  // 前提条件の詳細を追加
  if (diagnosis.suggestions && diagnosis.suggestions.length > 0) {
    const precondHeader = '=== 満たされていない前提条件 ==='
    await bot.chatWithDelay(username, precondHeader)
    messages.push(precondHeader)

    // 目標ごとにグループ化して最も低コストのオプションを表示
    const groupedByTarget = {}
    for (const suggestion of diagnosis.suggestions) {
      if (!groupedByTarget[suggestion.target]) {
        groupedByTarget[suggestion.target] = []
      }
      groupedByTarget[suggestion.target].push(suggestion)
    }

    for (const [target, suggestions] of Object.entries(groupedByTarget)) {
      // 最も低コストで前提条件が最も少ないものを選択
      const bestSuggestion = suggestions
        .filter(s => s.preconditions && s.preconditions.length > 0)
        .sort((a, b) => (a.cost || 999) - (b.cost || 999))[0]

      if (bestSuggestion && bestSuggestion.preconditions) {
        const actionMsg = `${target} を作成するには:`
        await bot.chatWithDelay(username, actionMsg)
        messages.push(actionMsg)

        // 満たされていない前提条件のみ表示
        const unsatisfied = bestSuggestion.preconditions.filter(p => !p.satisfied)
        if (unsatisfied.length > 0) {
          for (const precond of unsatisfied) {
            const formatValue = (val) => typeof val === 'boolean' ? (val ? 'true' : 'false') : val
            const msg = `  - ${precond.key}: 現在=${formatValue(precond.current)}, 必要=${precond.required}`
            await bot.chatWithDelay(username, msg)
            messages.push(msg)
          }
        } else {
          const msg = `  (全ての前提条件を満たしていますが、ルートが見つかりませんでした)`
          await bot.chatWithDelay(username, msg)
          messages.push(msg)
        }
      }
    }

    const separator2 = '---'
    await bot.chatWithDelay(username, separator2)
    messages.push(separator2)
  }

  const summary = 'GOAP実行不可: 上記の材料や道具を先に入手してください'
  await bot.chatWithDelay(username, summary)
  messages.push(summary)

  return messages
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
