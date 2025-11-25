const goapPlanner = require('../planner/goap')
const { buildState } = require('../planner/state_builder')
const { executePlanWithReplanning } = require('../executor/goap_executor')
const { createLogger } = require('../utils/logger')

/**
 * !goal コマンドのハンドラ（再帰的サブゴール解決）
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} goalName - 目標名
 * @param {Object} stateManager - 状態マネージャー
 * @param {AbortSignal} signal - キャンセル用シグナル（オプション）
 * @param {number} depth - 再帰深度（内部使用）
 * @param {number} maxDepth - 最大再帰深度
 * @param {Array} executionHistory - 実行履歴（内部使用）
 */
async function handleGoalCommand(bot, username, goalName, stateManager, signal = null, depth = 0, maxDepth = 10, missingPreconditions = null, attemptedGoals = null) {
  // ルート呼び出しの場合のみ初期化
  if (depth === 0 && !missingPreconditions) {
    missingPreconditions = []
  }
  if (depth === 0 && !attemptedGoals) {
    attemptedGoals = new Set()
  }

  // 循環参照チェック
  if (attemptedGoals.has(goalName)) {
    const error = new Error(`目標が複雑すぎるか、近くに必要な材料がない可能性があります`)
    error.needsLLM = true
    error.reason = 'circular_dependency'
    error.missingPreconditions = missingPreconditions
    throw error
  }

  attemptedGoals.add(goalName)

  // 最大深度チェック
  if (depth >= maxDepth) {
    missingPreconditions.push(goalName)

    const error = new Error(`目標が複雑すぎるか、近くに必要な材料がない可能性があります`)
    error.needsLLM = true
    error.reason = 'max_depth_reached'
    error.goalChain = [goalName]
    error.missingPreconditions = missingPreconditions
    throw error
  }

  // プランニング前に必ず最新の状態を取得
  stateManager.silentRefresh = !bot.shouldLogCommand('goal')
  await stateManager.refresh(bot)
  stateManager.silentRefresh = false
  const worldState = await stateManager.getState(bot)

  // 連続プランニングの前にイベントループに制御を返す
  if (depth > 0) {
    await new Promise((resolve) => setImmediate(resolve))
  }

  const logger = createLogger({ bot, category: 'goap', commandName: bot.currentCommandName || 'goal' })
  const result = await goapPlanner.plan(goalName, worldState, logger)

  // goapPlanner.plan() は常に { plan: [...], diagnosis: {...} } 形式を返す
  const plan = result.plan
  const diagnosis = result.diagnosis

  if (!plan || !Array.isArray(plan)) {
    // プランニング失敗
    const loggerPlan = createLogger({ bot, category: 'goap.plan', commandName: bot.currentCommandName || 'goal' })
    loggerPlan.info(`目標「${goalName}」のプランニング失敗 (深度: ${depth}/${maxDepth})`)

    // 前提条件を記録
    missingPreconditions.push(goalName)

    // まず、現在のゴールの数量を1に減らして試せるかチェック
    const quantityRetry = tryReduceQuantityToOne(goalName)

    if (quantityRetry && !attemptedGoals.has(quantityRetry)) {
      const logger = createLogger({ bot, category: 'goap.plan', commandName: bot.currentCommandName || 'goal' })
      logger.info(`数量を1に減らして再試行: 「${quantityRetry}」`)

      try {
        // 数量削減は深度を消費しない（同じ深度で再試行）
        await handleGoalCommand(bot, username, quantityRetry, stateManager, signal, depth, maxDepth, missingPreconditions, attemptedGoals)

        const parsedGoal = parseQuantityGoal(goalName)
        if (parsedGoal) {
          await stateManager.refresh(bot)
          const latestWorld = await stateManager.getState(bot)
          const goapState = buildState(latestWorld)
          const currentValue = Number(getNestedStateValue(goapState, parsedGoal.base)) || 0
          const remaining = parsedGoal.quantity - currentValue

          if (remaining <= 0) {
        const logger = createLogger({ bot, category: 'goap.plan', commandName: bot.currentCommandName || 'goal' })
        logger.info(`必要数量を満たしたため目標「${goalName}」を完了とみなします。`)
        return
      }

          if (remaining < parsedGoal.quantity) {
            const nextGoal = `${parsedGoal.base}:${remaining}`
            const logger = createLogger({ bot, category: 'goap.plan', commandName: bot.currentCommandName || 'goal' })
            logger.info(`不足分 ${remaining} を取得します: 「${nextGoal}」`)
            attemptedGoals.delete(goalName)
            return await handleGoalCommand(bot, username, nextGoal, stateManager, signal, depth, maxDepth, missingPreconditions, attemptedGoals)
          }
        }

        // 数量1での取得に成功 → 進捗を確認できなかったため元のゴールを再試行
        const logger = createLogger({ bot, category: 'goap.plan', commandName: bot.currentCommandName || 'goal' })
        logger.info(`数量1での取得成功。目標「${goalName}」を再試行中...`)

        // 元のゴールを再度試す前に、試行済みセットから削除
        attemptedGoals.delete(goalName)
        return await handleGoalCommand(bot, username, goalName, stateManager, signal, depth, maxDepth, missingPreconditions, attemptedGoals)
      } catch (error) {
        // 数量1でも失敗 → 前提条件（サブゴール）の解決に進む
        bot.systemLog(`数量1でも失敗。前提条件を解決します...`)
        // ここでエラーを握りつぶして、下の「サブゴール抽出」ロジックに進む
      }
    }

    // 構造化された診断情報を先に構築（エラーログ用）
    const structuredDiagnosis = buildStructuredDiagnosis(diagnosis, goalName)

    // サブゴールを抽出（構造化された診断情報 + 生の診断情報から）
    let subgoal
    try {
      subgoal = extractFirstSubgoal(structuredDiagnosis, diagnosis, worldState)
    } catch (error) {
      // 環境状態が満たされていない → LLMの判断が必要
      const loggerPlan = createLogger({ bot, category: 'goap.plan', commandName: bot.currentCommandName || 'goal' })
      loggerPlan.info(`環境状態が満たされていません: ${error.missingEnvironment}`)

      missingPreconditions.push(error.missingEnvironment)

      structuredDiagnosis.missingEnvironment = error.missingEnvironment
      structuredDiagnosis.needsLLM = true

      loggerPlan.info('\n=== LLMの判断が必要 ===')
      loggerPlan.info(JSON.stringify(structuredDiagnosis, null, 2))
      loggerPlan.info('========================\n')

      // 会話履歴に記録
      bot.addMessage(bot.username, structuredDiagnosis, 'system_info')

      // エラーとして投げる
      const finalError = new Error(`目標「${goalName}」を実行できません: ${error.missingEnvironment} が見つかりません`)
      finalError.diagnosis = structuredDiagnosis
      finalError.needsLLM = true
      finalError.missingPreconditions = missingPreconditions
      throw finalError
    }

    if (!subgoal) {
      // サブゴールが抽出できない → LLMの判断が必要
      const loggerPlan = createLogger({ bot, category: 'goap.plan', commandName: bot.currentCommandName || 'goal' })
      loggerPlan.info('サブゴールを抽出できませんでした')

      structuredDiagnosis.needsLLM = true

      loggerPlan.info('\n=== 構造化された診断情報 ===')
      loggerPlan.info(JSON.stringify(structuredDiagnosis, null, 2))
      loggerPlan.info('============================\n')

      bot.addMessage(bot.username, structuredDiagnosis, 'system_info')
      logDiagnosisDetails(bot, diagnosis)

      const error = new Error(`目標「${goalName}」を実行できません`)
      error.diagnosis = structuredDiagnosis
      error.needsLLM = true
      error.missingPreconditions = missingPreconditions
      throw error
      }

      // サブゴールを再帰的に実行
      const loggerPlanInner = createLogger({ bot, category: 'goap.plan', commandName: bot.currentCommandName || 'goal' })
      loggerPlanInner.info(`サブゴール「${subgoal}」を実行中... (深度: ${depth + 1}/${maxDepth})`)

      try {
        await handleGoalCommand(bot, username, subgoal, stateManager, signal, depth + 1, maxDepth, missingPreconditions, attemptedGoals)
    } catch (error) {
      // サブゴールが失敗 → 親ゴール情報を追加してエラーを再スロー
      if (error.goalChain) {
        error.goalChain.unshift(goalName)
      } else {
        error.goalChain = [goalName, subgoal]
      }
      error.missingPreconditions = missingPreconditions
      throw error
    }

    // サブゴール成功 → 元のゴールを再試行
    bot.systemLog(`サブゴール「${subgoal}」完了。目標「${goalName}」を再試行中...`)
    // 元のゴールを再度試す前に、試行済みセットから削除
    attemptedGoals.delete(goalName)
    return await handleGoalCommand(bot, username, goalName, stateManager, signal, depth, maxDepth, missingPreconditions, attemptedGoals)
  }

  // プランニング成功 → 実行
  if (depth === 0) {
    logPlanDetails(bot, goalName, plan)
    const startMessage = `目標「${goalName}」を開始します`
    bot.systemLog(startMessage)
  } else {
    bot.systemLog(`サブゴール「${goalName}」を実行します (深度: ${depth})`)
  }

  await executePlanWithReplanning(bot, goalName, plan, stateManager, signal, missingPreconditions)

  if (depth === 0) {
    const completeMessage = `目標「${goalName}」を完了しました`
    bot.systemLog(completeMessage)
    attemptedGoals.delete(goalName)

    // ルート呼び出しの場合のみ結果を返す（成功時はmissingPreconditionsは空）
    return { missingPreconditions }
  } else {
    bot.systemLog(`サブゴール「${goalName}」を完了しました (深度: ${depth})`)
    attemptedGoals.delete(goalName)
  }
}

/**
 * 診断情報からサブゴールを抽出
 * 環境状態（nearby_*, visible_*）がfalseの場合はエラーを投げる
 * @param {Object} structuredDiagnosis - 構造化された診断結果
 * @param {Object} rawDiagnosis - 生の診断結果（複合状態の情報を含む）
 * @param {Object} worldState - 現在の世界状態
 * @returns {string|null} サブゴール名（例: "inventory.iron_ingot:3"）
 */
function extractFirstSubgoal(structuredDiagnosis, rawDiagnosis, worldState) {
  // ケース1: 通常の満たされていない前提条件がある場合
  if (structuredDiagnosis.unsatisfiedPreconditions && structuredDiagnosis.unsatisfiedPreconditions.length > 0) {
    const first = structuredDiagnosis.unsatisfiedPreconditions[0]

    if (first.missing && first.missing.length > 0) {
      // missing配列の中から、GOAPで解決可能な条件だけを探す
      for (const missingItem of first.missing) {
        const key = missingItem.key

        // 環境状態（nearby_*, visible_*）はGOAPで解決不可能
        if (isEnvironmentalState(key)) {
          // これらがfalseの場合はLLMの判断が必要
          const error = new Error(`環境状態「${key}」が満たされていません`)
          error.needsLLM = true
          error.missingEnvironment = key
          throw error
        }

        // 複合状態かどうかをチェック（rawDiagnosisから）
        const compositeSubgoal = checkCompositeState(key, rawDiagnosis)
        if (compositeSubgoal) {
          return compositeSubgoal
        }

        // それ以外（inventory.*, has_*, equipment.*）はサブゴールとして解決可能
        const subgoal = createSubgoalFromMissing(missingItem)
        return subgoal
      }
    }
  }

  // ケース2: 複合状態（composite state）の場合
  // unsatisfiedPreconditionsが空だが、missingRequirementsに複合状態がある
  if (structuredDiagnosis.missingRequirements && structuredDiagnosis.missingRequirements.length > 0) {
    const firstMissing = structuredDiagnosis.missingRequirements[0]
    const missingKey = firstMissing.key

    // rawDiagnosisのsuggestionsから対応する複合状態を探す
    if (rawDiagnosis.suggestions && rawDiagnosis.suggestions.length > 0) {
      for (const suggestion of rawDiagnosis.suggestions) {
        if (suggestion.target === missingKey && suggestion.isComputedState && suggestion.dependencies) {
          // 最初の（最も安価な）依存関係を選択
          const cheapestDependency = suggestion.dependencies[0]

          // "inventory.iron_pickaxe" -> "inventory.iron_pickaxe:1" の形式に変換
          return `${cheapestDependency}:1`
        }
      }
    }
  }

  return null
}

/**
 * キーが複合状態かどうかをチェックし、複合状態なら最安のサブゴールを返す
 * @param {string} key - 状態キー（例: "inventory.category.iron_or_better_pickaxe"）
 * @param {Object} rawDiagnosis - 生の診断結果
 * @returns {string|null} 複合状態の最安サブゴール（例: "inventory.iron_pickaxe:1"）、または複合状態でない場合はnull
 */
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

/**
 * ゴールの数量を1に減らして再試行用のゴールを生成
 * @param {string} goalName - 元のゴール名（例: "inventory.diamond:3"）
 * @returns {string|null} 数量1のゴール名（例: "inventory.diamond:1"）、または変換不可能な場合はnull
 */
function tryReduceQuantityToOne(goalName) {
  const parsed = parseQuantityGoal(goalName)
  if (!parsed || parsed.quantity <= 1) {
    return null
  }
  return `${parsed.base}:1`
}

/**
 * キーが環境状態かどうかを判定
 * @param {string} key - 状態キー
 * @returns {boolean}
 */
function isEnvironmentalState(key) {
  // 環境状態のパターン
  return key.startsWith('nearby_') ||
         key.startsWith('visible_') ||
         key === 'is_day' ||
         key === 'is_night'
}

/**
 * missing情報からサブゴールを生成
 * @param {Object} missingItem - { key, current, required }
 * @returns {string} サブゴール名
 */
function createSubgoalFromMissing(missingItem) {
  const key = missingItem.key

  // currentを数値に変換（"なし"の場合は0）
  let currentValue = 0
  if (typeof missingItem.current === 'number') {
    currentValue = missingItem.current
  } else if (typeof missingItem.current === 'string') {
    const parsed = parseInt(missingItem.current)
    currentValue = isNaN(parsed) ? 0 : parsed
  }

  // ">=3" のような形式から数値を抽出
  const requiredMatch = String(missingItem.required).match(/>=(\d+)/)

  if (requiredMatch) {
    const requiredValue = parseInt(requiredMatch[1])
    const shortage = requiredValue - currentValue
    const logger = createLogger({ category: 'goap.plan', commandName: 'goal' })
    logger.debug(`[DEBUG] Creating subgoal: ${key}, current=${currentValue}, required=${requiredValue}, shortage=${shortage}`)
    return `${key}:${shortage}`
  }

  // boolean の場合
  if (missingItem.required === true || missingItem.required === 'true') {
    return `${key}:true`
  }

  // デフォルト
  return `${key}:1`
}

function parseQuantityGoal(goalName) {
  const match = goalName.match(/^(.+):(\d+)$/)
  if (!match) {
    return null
  }
  return { base: match[1], quantity: Number(match[2]) }
}

function getNestedStateValue(state, key) {
  if (!key.includes('.')) {
    return state[key]
  }

  const parts = key.split('.')
  let value = state
  for (const part of parts) {
    value = value?.[part]
    if (value === undefined) {
      return undefined
    }
  }
  return value
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
function logDiagnosisDetails(bot, diagnosis) {
  const logger = createLogger({ bot, category: 'goap.plan', commandName: bot?.currentCommandName || 'goal' })

  if (diagnosis.error) {
    logger.info('=== GOAL DIAGNOSIS ===')
    logger.info(`エラー: ${diagnosis.error}`)
    logger.info('======================')
    return
  }

  if (!diagnosis.missingRequirements || diagnosis.missingRequirements.length === 0) {
    return
  }

  logger.info('\n=== GOAL DIAGNOSIS ===')
  logger.info('満たされていない要件:')

  for (const req of diagnosis.missingRequirements) {
    logger.info(`  - ${req.key}: 現在=${req.current}, 目標=${req.target}`)
  }

  if (diagnosis.suggestions && diagnosis.suggestions.length > 0) {
    logger.info('\n提案: 以下の方法で達成できます:\n')

    // 目標ごとにグループ化
    const groupedByTarget = {}
    for (const suggestion of diagnosis.suggestions) {
      if (!groupedByTarget[suggestion.target]) {
        groupedByTarget[suggestion.target] = []
      }
      groupedByTarget[suggestion.target].push(suggestion)
    }

    for (const [target, suggestions] of Object.entries(groupedByTarget)) {
      logger.info(`${target} を達成する方法:`)

      for (let i = 0; i < suggestions.length; i++) {
        const suggestion = suggestions[i]

        // 複合状態の特別処理
        if (suggestion.isComputedState && suggestion.dependencies) {
          logger.info(`  ${target} は複合状態（自動計算）です。`)
          logger.info(`  以下のいずれかを作成/入手すれば自動的に true になります:\n`)

          for (const dep of suggestion.dependencies) {
            logger.info(`    - ${dep} を作成`)
          }
          logger.info('')
          continue
        }

        if (suggestion.message) {
          logger.info(`  オプション${i + 1}: ${suggestion.message}`)
          continue
        }

        if (!suggestion.action) continue

        const costStr = suggestion.cost !== undefined ? ` (コスト=${suggestion.cost})` : ''
        const statusStr = suggestion.allSatisfied ? ' ✓ 全ての前提条件を満たしています！' : ''
        logger.info(`  オプション${i + 1}: ${suggestion.action}${costStr}${statusStr}`)

        if (suggestion.preconditions && suggestion.preconditions.length > 0) {
          logger.info('    前提条件:')
          for (const precond of suggestion.preconditions) {
            const mark = precond.satisfied ? '✓' : '✗'
            const requiredStr = formatRequiredValue(precond.required)
            logger.info(`      ${mark} ${precond.key}: 現在=${precond.current}, 必要=${requiredStr}`)
          }
        }
        logger.info('')
      }
    }
  }

  logger.info('======================\n')
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
function logPlanDetails(bot, goalName, plan) {
  const logger = createLogger({ bot, category: 'goap.plan', commandName: bot?.currentCommandName || 'goal' })
  logger.info('=== GOAP PLAN DETAILS ===')
  logger.info(`目標: ${goalName}`)
  logger.info(`プラン長: ${plan.length} ステップ`)
  logger.info('詳細:')

  plan.forEach((step, index) => {
    logger.info(`  ${index + 1}. ${step.action}`)
    logger.info(`     スキル: ${step.skill || 'なし'}`)
    logger.info(`     パラメータ: ${JSON.stringify(step.params || {})}`)

    if (step.preconditions && Object.keys(step.preconditions).length > 0) {
      logger.info(`     前提条件: ${JSON.stringify(step.preconditions)}`)
    }
    if (step.effects && Object.keys(step.effects).length > 0) {
      logger.info(`     効果: ${JSON.stringify(step.effects)}`)
    }

    logger.info(`     コスト: ${step.cost || 0}`)
    logger.info('')
  })

  const totalCost = plan.reduce((sum, step) => sum + (step.cost || 0), 0)
  logger.info(`総コスト: ${totalCost}`)
  logger.info('========================')
}

module.exports = handleGoalCommand
module.exports.checkCompositeState = checkCompositeState
module.exports.buildStructuredDiagnosis = buildStructuredDiagnosis
