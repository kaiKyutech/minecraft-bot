const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')

const createStateManager = require('./src/planner/state_manager')
const goapPlanner = require('./src/planner/goap')
const skills = require('./src/skills')
const primitives = require('./src/primitives')

debugLog('initialising planner bot')

const stateManager = createStateManager()

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'PlannerBot',
  version: process.env.MC_VERSION || false
})

bot.loadPlugin(pathfinder)

bot.once('spawn', () => {
  debugLog('bot spawned, ready to receive goals')

  // remmychatプラグイン対策: 複数のチャンネル加入を試行
  setTimeout(() => {
    tryJoinGlobalChannel()
  }, 2000)
})

// remmychat対応: ローカルチャンネル参加
async function tryJoinGlobalChannel() {
  try {
    bot.chat('/remchat channel local')
    await delay(1500)
  } catch (error) {
    console.log('[CHANNEL] Failed to join local channel')
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  debugLog(`chat from ${username}: ${message}`)


  const trimmed = message.trim()

  if (/^!primitive(\s|$)/.test(trimmed)) {
    await handlePrimitiveCommand(trimmed)
    return
  }

  if (/^!skill(\s|$)/.test(trimmed)) {
    await handleSkillCommand(trimmed)
    return
  }

  if (!trimmed.startsWith('!goal ')) return

  const goalName = trimmed.replace('!goal ', '').trim()
  bot.chat(`受信した目標: ${goalName}`)

  try {
    const worldState = await stateManager.getState(bot)
    const plan = goapPlanner.plan(goalName, worldState)

    if (!plan) {
      bot.chat('実行可能なプランが見つかりませんでした。')
      return
    }

    // 詳細プランをログ出力
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

    bot.chat(`計画されたアクション: ${plan.map((step) => step.action).join(' -> ')}`)

    let currentPlan = [...plan] // プランのコピー
    let stepIndex = 0

    while (stepIndex < currentPlan.length) {
      const step = currentPlan[stepIndex]

      // スキルがない場合は目標アクション（実行不要）
      if (!step.skill) {
        console.log(`目標達成: ${step.action}`)
        stepIndex++
        continue
      }

      const skill = skills[step.skill]
      if (typeof skill !== 'function') {
        throw new Error(`スキル ${step.skill} が見つかりません`)
      }

      // 現在の状態でこのステップがまだ有効かチェック
      const currentState = await stateManager.getState(bot)
      const builtState = goapPlanner.buildState ? goapPlanner.buildState(currentState) : require('./src/planner/state_builder').buildState(currentState)

      if (!areStepPreconditionsSatisfied(step, builtState)) {
        console.log(`[REACTIVE_GOAP] ステップ "${step.action}" の前提条件が満たされていません。リプランニングを実行...`)
        console.log(`[REACTIVE_GOAP] 目標: ${goalName}`)

        // リプランニング実行
        const newPlan = goapPlanner.plan(goalName, currentState)
        if (!newPlan) {
          throw new Error('リプランニングに失敗しました。実行可能なプランが見つかりません。')
        }

        console.log(`[REACTIVE_GOAP] 新しいプラン長: ${newPlan.length}`)
        console.log(`[REACTIVE_GOAP] 新しいプラン: ${newPlan.map(s => s.action).join(' -> ')}`)
        console.log(`[REACTIVE_GOAP] 新プランの詳細:`)
        newPlan.forEach((planStep, index) => {
          console.log(`  ${index + 1}. ${planStep.action} (skill: ${planStep.skill || 'なし'})`)
        })
        bot.chat(`プラン変更: ${newPlan.map(s => s.action).join(' -> ')}`)

        currentPlan = newPlan
        stepIndex = 0
        continue
      }

      bot.chat(`実行: ${step.action}`)
      console.log(`[EXECUTION] ステップ ${stepIndex + 1}/${currentPlan.length}: ${step.action}`)

      await skill(bot, step.params || {}, stateManager)
      await stateManager.refresh(bot)

      console.log(`[EXECUTION] ステップ "${step.action}" 完了`)
      stepIndex++
    }

    console.log(`[EXECUTION] 全${currentPlan.length}ステップ完了`)
    console.log(`[EXECUTION] 最終プラン: ${currentPlan.map(s => s.action).join(' -> ')}`)
    bot.chat('目標を完了しました!')
  } catch (error) {
    console.error('goal execution error', error)
    bot.chat(`目標の実行中に失敗しました: ${error.message}`)
  }
})

bot.on('error', (err) => {
  console.error('bot error', err)
})

bot.on('end', () => {
  debugLog('bot connection ended')
})

function debugLog(message) {
  if (process.env.PLANNER_DEBUG === '1') {
    console.log(`[planner] ${message}`)
  }
}

async function handlePrimitiveCommand(raw) {
  // !primitive の後の部分を取得（スペースやタブを考慮して柔軟に処理）
  const body = raw.replace(/^!primitive\s*/, '').trim()
  if (!body) {
    bot.chat('プリミティブ名を指定してください')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()

  const primitiveName = snakeToCamel(nameToken)
  const primitiveFn = primitives[primitiveName]

  if (typeof primitiveFn !== 'function') {
    bot.chat(`未知のプリミティブです: ${nameToken}`)
    return
  }

  let params = {}
  if (paramString) {
    try {
      params = JSON.parse(paramString)
    } catch (error) {
      bot.chat('パラメータは JSON 形式で指定してください')
      debugLog(`primitive param parse error: ${error.message}`)
      return
    }
  }

  bot.chat(`プリミティブ実行: ${nameToken}`)
  try {
    const result = await primitiveFn(bot, params)
    await stateManager.refresh(bot)
    if (typeof result !== 'undefined') {
      debugLog(`primitive result: ${JSON.stringify(result)}`)
    }
    bot.chat('完了しました')
  } catch (error) {
    console.error('primitive execution error', error)
    bot.chat(`プリミティブ実行に失敗しました: ${error.message}`)
  }
}

function snakeToCamel(value) {
  return value.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function areStepPreconditionsSatisfied(step, currentState) {
  // GOAPアクションから前提条件を取得するため、アクションを検索
  const domain = require('./src/planner/goap').loadDomain?.() || (() => {
    const fs = require('fs')
    const path = require('path')
    const YAML = require('yaml')
    const ACTIONS_DIR = path.join(__dirname, 'config/actions')
    const ACTION_FILES = ['gather_actions.yaml', 'hand_craft_actions.yaml', 'workbench_craft_actions.yaml', 'movement_actions.yaml']

    let allActions = []
    for (const filename of ACTION_FILES) {
      try {
        const raw = fs.readFileSync(path.join(ACTIONS_DIR, filename), 'utf8')
        const parsed = YAML.parse(raw)
        if (parsed?.actions) allActions = allActions.concat(parsed.actions)
      } catch (error) {
        console.error(`Failed to load ${filename}:`, error.message)
      }
    }
    return { actions: allActions }
  })()

  const action = domain.actions.find(a => a.name === step.action)
  if (!action || !action.preconditions) return true // 前提条件なしは常にOK

  // 前提条件をチェック
  return Object.entries(action.preconditions).every(([key, condition]) => {
    const value = currentState[key]
    return evaluateCondition(value, condition)
  })
}

function evaluateCondition(value, condition) {
  if (typeof condition === 'boolean') {
    return Boolean(value) === condition
  }

  if (typeof condition === 'number') {
    return Number(value) === condition
  }

  if (typeof condition === 'string') {
    const trimmed = condition.trim()

    if (trimmed === 'true' || trimmed === 'false') {
      return Boolean(value) === (trimmed === 'true')
    }

    const comparison = trimmed.match(/^(>=|<=|==|!=|>|<)\s*(-?\d+)$/)
    if (comparison) {
      const [, operator, rawNumber] = comparison
      const target = Number(rawNumber)
      const actual = Number(value) || 0
      switch (operator) {
        case '>': return actual > target
        case '>=': return actual >= target
        case '<': return actual < target
        case '<=': return actual <= target
        case '==': return actual === target
        case '!=': return actual !== target
        default: return false
      }
    }

    if (/^-?\d+$/.test(trimmed)) {
      return Number(value) === Number(trimmed)
    }
  }

  return value === condition
}

async function handleSkillCommand(raw) {
  console.log(`[SKILL DEBUG] Raw command: "${raw}"`)

  // !skill の後の部分を取得（スペースやタブを考慮して柔軟に処理）
  const body = raw.replace(/^!skill\s*/, '').trim()

  console.log(`[SKILL DEBUG] Body after processing: "${body}"`)

  if (!body) {
    console.log('[SKILL DEBUG] Body is empty, sending error message')
    bot.chat('スキル名を指定してください')
    return
  }

  const [nameToken, ...rest] = body.split(' ')
  const paramString = rest.join(' ').trim()
  console.log(`[SKILL DEBUG] nameToken: "${nameToken}", paramString: "${paramString}"`)

  const skillFn = skills[nameToken]
  if (typeof skillFn !== 'function') {
    console.log(`[SKILL DEBUG] Skill not found: ${nameToken}`)
    bot.chat(`未知のスキルです: ${nameToken}`)
    return
  }

  let params = {}
  if (paramString) {
    try {
      params = JSON.parse(paramString)
    } catch (error) {
      bot.chat('スキルのパラメータは JSON 形式で指定してください')
      debugLog(`skill param parse error: ${error.message}`)
      return
    }
  }

  bot.chat(`スキル実行: ${nameToken}`)
  try {
    await skillFn(bot, params, stateManager)
    await stateManager.refresh(bot)
    bot.chat('スキルが完了しました')
  } catch (error) {
    console.error(`[SKILL ERROR] ${nameToken}:`, error)
    bot.chat(`スキル実行に失敗しました: ${error.message}`)
  }
}
