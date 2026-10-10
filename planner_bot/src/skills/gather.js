const { failure } = require('../utils/result')
const { interruptible, checkpoint } = require('../utils/context')
const { interjectBoundary } = require('../executor/interjection')
const primitives = require('../primitives')
const { createLogger } = require('../utils/logger')
const minecraftData = require('minecraft-data')
const { loadBlockCategories } = require('../planner/state_builder')
const { scanBlocks } = require('../utils/block_scanner')

// Replanning invokes gather again. Keep failed physical targets per bot, without
// retaining disconnected bots. TTL and FIFO bounds apply across item categories.
const avoidedTargetsByBot = new WeakMap()
function bounded(value, fallback, maximum) {
  return Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : fallback
}

/**
 * 中位スキル: gather
 * 前提：(必須)itemName (推奨)回数、範囲
 * - 上位レイヤーが指定した `itemName` のブロックを、要求回数だけ掘って回収します。
 * - インベントリ確認などの前提評価は行わず、呼び出し元が正しい "素材名" や "回数" や "範囲" を決めていることを前提とします。
 * - ブロック探索 → 接近 → 掘削 → ドロップ回収 を 1 ループとし、指定回数だけ繰り返します。
 */
module.exports = async function gather(bot, params = {}, stateManager) {
  if (!stateManager) throw failure('INVALID_ARGUMENT', 'stateManager が提供されていません')

  const loopCount = Number.isFinite(params.count) ? params.count : 1
  if (loopCount <= 0) return
  const logger = createLogger({ bot, category: 'skill', commandName: bot.currentCommandName })

  const itemName = await interruptible(bot, () => resolveItemName(params, bot))
  const matchCondition = itemName
  const collectName = params.collectItem === false ? null : itemName

  const maxDistance = params.maxDistance ?? 100
  const approachRange = params.approachRange ?? 2
  const collectRadius = params.collectRadius ?? 30
  const collectDelayMs = params.collectDelayMs ?? 200
  const maxAttempts = bounded(params.maxAttempts, 20, 64)
  const moveTimeoutMs = bounded(params.moveTimeoutMs, 30000, 60000)

  // whileループ開始前に1回だけ最適ツールを決定
  let selectedTool = null
  try {
    // サンプルブロックを探して、そのタイプに最適なツールを選択
    const sampleBlockInfo = await interruptible(bot, () => primitives.findBlock(bot, {
      match: matchCondition,
      maxDistance
    }))
    const sampleBlock = bot.blockAt(sampleBlockInfo.position)
    if (sampleBlock) {
      selectedTool = await interruptible(bot, () => primitives.findBestTool(bot, sampleBlock))
      if (selectedTool) {
        const mcData = require('minecraft-data')(bot.version)
        const toolName = mcData.items[selectedTool.type].name
        logger.info(`[GATHER] 最適ツールを選択: ${toolName}`)
      } else {
        logger.info(`[GATHER] 素手が最適と判定`)
      }
    }
  } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
    logger.info('[GATHER] ツール選択用のサンプルブロックが見つからず、素手で開始')
  }

  let completed = 0
  let attempts = 0
  let avoidedPositionKeys = avoidedTargetsByBot.get(bot)
  if (!avoidedPositionKeys) {
    avoidedPositionKeys = new Map()
    avoidedTargetsByBot.set(bot, avoidedPositionKeys)
  }
  const maxAvoidListSize = bounded(params.maxAvoidListSize, 32, 64)
  const avoidTtlMs = bounded(params.avoidTtlMs, 180000, 300000)
  const maxCandidates = bounded(params.maxCandidates, 64, 64)
  const searchSampleSize = bounded(params.searchSampleSize, 1, maxCandidates)
  const pruneAvoidance = () => {
    const now = Date.now()
    for (const [key, failedAt] of avoidedPositionKeys) {
      if (now - failedAt >= avoidTtlMs) avoidedPositionKeys.delete(key)
    }
    while (avoidedPositionKeys.size > maxAvoidListSize) {
      avoidedPositionKeys.delete(avoidedPositionKeys.keys().next().value)
    }
  }
  pruneAvoidance()

  const rememberFailedTarget = (position) => {
    if (!position) return
    const key = serializePosition(position)
    avoidedPositionKeys.delete(key)
    avoidedPositionKeys.set(key, Date.now())
    pruneAvoidance()
    logger.info(`[GATHER] 失敗したターゲットを回避リストに追加: ${key}`)
  }

  const acquireTarget = async () => {
    pruneAvoidance()
    let sampleSize = Math.min(maxCandidates, Math.max(searchSampleSize, avoidedPositionKeys.size + 1))
    while (true) {
      let candidates
      try {
        candidates = await interruptible(bot, () => primitives.findBlocks(bot, {
          match: matchCondition,
          maxDistance,
          count: sampleSize,
          useCube: params.useCube ?? true
        }))
      } catch (error) {
        checkpoint(bot)
        if (error?.name === 'AbortError') throw error
        throw failure('BLOCK_NOT_FOUND', '近くに対象ブロックが見つかりません')
      }

      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw failure('BLOCK_NOT_FOUND', '近くに対象ブロックが見つかりません')
      }

      // Pre-calculate distances to avoid redundant calculations during sort
      const candidatesWithDistance = candidates.map(c => ({
        candidate: c,
        distance: bot.entity.position.distanceTo(c.position)
      }))
      candidatesWithDistance.sort((a, b) => a.distance - b.distance)
      const sortedCandidates = candidatesWithDistance.map(c => c.candidate)

      for (const candidate of sortedCandidates) {
        const key = serializePosition(candidate.position)
        if (avoidedPositionKeys.has(key)) continue

        const block = bot.blockAt(candidate.position)
        if (!block) {
          rememberFailedTarget(candidate.position)
          continue
        }

        return {
          position: candidate.position.clone(),
          name: candidate.name,
          block
        }
      }

      if (sampleSize >= maxCandidates || candidates.length < sampleSize) {
        throw failure('BLOCK_NOT_FOUND', '利用可能なブロック候補が見つかりません')
      }
      sampleSize = Math.min(maxCandidates, sampleSize * 2)
    }
  }

  while (completed < loopCount) {
    // An issued move/dig finishes first; completed is never reset by a torch.
    const pending = interjectBoundary(bot, 'gather_block')
    if (pending) await pending
    if (attempts++ >= maxAttempts) {
      throw failure('EXECUTION_FAILED', '資源の収集に失敗しました: 試行回数が上限に達しました')
    }

    let blockInfo
    try {
      blockInfo = await interruptible(bot, () => acquireTarget())
    } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
      throw failure(error.code || 'BLOCK_NOT_FOUND', error.message || '近くに対象ブロックが見つかりません')
    }

    try {
      // ブロックまで接近
      await interruptible(bot, () => primitives.moveTo(bot, {
        position: blockInfo.position,
        range: approachRange,
        timeout: moveTimeoutMs
      }))

      const pending = interjectBoundary(bot, 'gather_arrived')
      if (pending) await pending

      // 掘削直前に選択したツールを再装備
      if (selectedTool) {
        try {
          await interruptible(bot, () => bot.equip(selectedTool, 'hand'))
          await interruptible(bot, () => delay(50)) // 装備完了を待つ
        } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
          logger.info(`[GATHER] ツール再装備に失敗: ${error.message}`)
        }
      } else {
        // 素手が最適な場合
        try {
          await interruptible(bot, () => bot.unequip('hand'))
          await interruptible(bot, () => delay(50)) // 装備解除完了を待つ
        } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
          // 素手にできない場合は無視
        }
      }

      // 掘削
      logger.info(`[GATHER] ブロック掘削開始: ${blockInfo.position}`)
      await interruptible(bot, () => primitives.digBlock(bot, { position: blockInfo.position }))
      logger.info(`[GATHER] ブロック掘削完了`)

      completed += 1
    } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
      if (error?.code === 'REPEATED_FAILURE') throw error
      rememberFailedTarget(blockInfo?.position)

      if (isRecoverableGatherError(error)) {
        logger.info(`[GATHER] ブロック収集でエラー: ${error.message} → 別候補で再試行`)
        await interruptible(bot, () => delay(params.retryDelayMs ?? 100))
        continue
      }

      throw failure(error.code || 'EXECUTION_FAILED', `資源の収集に失敗しました: ${error.message}`)
    }
  }

  const pending = interjectBoundary(bot, 'gather_dug')
  if (pending) await pending

  // 全ブロック掘削完了後、最後に1回だけドロップ回収
  if (collectName) {
    await interruptible(bot, () => delay(collectDelayMs)) // allow freshly spawned drops to register
    logger.info(`[GATHER] 全${completed}個の掘削完了、ドロップ回収を開始`)
    try {
      const collectDropsSkill = require('./collect_drops')
      await interruptible(bot, () => collectDropsSkill(bot, {
        radius: collectRadius,
        maxAttempts: 3
      }, stateManager))
      logger.info(`[GATHER] ドロップ回収完了`)
    } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
      logger.info(`[GATHER] ドロップ回収でエラー: ${error.message}`)
      // ドロップ回収失敗は致命的ではないので続行
    }
  }
}

/**
 * 呼び出し元から渡された素材名（itemName）を検証して返します。
 * Minecraftに存在しないアイテム名の場合はエラーを投げます。
 */
async function resolveItemName(params, bot) {
  if (!params.itemName || typeof params.itemName !== 'string' || params.itemName.length === 0) {
    throw failure('INVALID_ARGUMENT', '収集対象の素材名 (itemName) が指定されていません')
  }

  if (!bot.version) {
    throw failure('BOT_NOT_READY', 'bot.version が取得できるまで待ってください')
  }

  const mcData = minecraftData(bot.version)
  const itemName = params.itemName

  // カテゴリ名の場合は近くで最適なブロックを選択
  const categories = loadBlockCategories(bot.version)
  if (categories?.categories?.[itemName]) {
    return await interruptible(bot, () => selectBestBlockFromCategory(bot, itemName, categories, mcData, params))
  }

  // 個別ブロック名として存在するかチェック
  const blockData = mcData.blocksByName[itemName]
  if (blockData) {
    return itemName
  }

  // アイテムとして存在するかチェック（ブロックでない場合）
  const itemData = mcData.itemsByName[itemName]
  if (itemData) {
    return itemName
  }

  // どちらにも存在しない場合はエラー
  throw failure('BOT_NOT_READY', `未知のアイテム名です: ${itemName} (Minecraft ${bot.version} には存在しません)`)
}

// カテゴリ選択のキャッシュ（botごと、カテゴリごと）
const blockSelectionCache = new Map()

async function selectBestBlockFromCategory(bot, categoryName, categories, mcData, params = {}) {
  const categoryBlocks = categories.categories[categoryName].blocks
  const maxDistance = typeof params.maxDistance === 'number' ? params.maxDistance : 100
  const cacheKey = `${bot.username}_${categoryName}_${Math.round(maxDistance)}`

  // キャッシュがあれば、まずそれを試す
  const cachedBlock = blockSelectionCache.get(cacheKey)
  if (cachedBlock) {
    try {
      const block = bot.findBlock({
        matching: (block) => block && block.name === cachedBlock,
        maxDistance,
        count: 1
      })

      if (block) {
        const logger = createLogger({ bot, category: 'skill' })
        logger.info(`[GATHER] カテゴリ「${categoryName}」から「${cachedBlock}」を選択（キャッシュ使用）`)
        return cachedBlock
      } else {
        const logger = createLogger({ bot, category: 'skill' })
        logger.info(`[GATHER] キャッシュされたブロック「${cachedBlock}」が見つからず、再探索します`)
        blockSelectionCache.delete(cacheKey)
      }
    } catch (error) {
      checkpoint(bot)
      if (error?.name === 'AbortError') throw error
      const logger = createLogger({ bot, category: 'skill' })
      logger.info(`[GATHER] キャッシュされたブロック「${cachedBlock}」の探索に失敗、再探索します`)
      blockSelectionCache.delete(cacheKey)
    }
  }

  // キャッシュがないか、キャッシュが使えない場合は scanBlocks で全探索（1回だけ）
  const logger = createLogger({ bot, category: 'skill' })
  logger.info(`[GATHER] カテゴリ「${categoryName}」から最適なブロックを選択中...`)

  const result = await interruptible(bot, () => scanBlocks(bot, {
    range: maxDistance,
    types: categoryBlocks,
    maxChecks: -1,  // 無制限（全範囲を探索）
    collectBlocks: true
  }))

  if (result.blocks.length === 0) {
    throw failure('BLOCK_NOT_FOUND', `カテゴリ「${categoryName}」のブロックが範囲内に見つかりません: ${categoryBlocks.join(', ')}`)
  }

  // scanBlocks は距離順にソート済み
  const closest = result.blocks[0]
  logger.info(`[GATHER] カテゴリ「${categoryName}」から「${closest.name}」を選択（距離: ${closest.distance}）`)

  // キャッシュに保存
  blockSelectionCache.set(cacheKey, closest.name)
  return closest.name
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getInventoryItemCount(bot, itemName) {
  return bot.inventory.items().reduce((sum, item) => {
    if (item && item.name === itemName) {
      return sum + item.count
    }
    return sum
  }, 0)
}

function serializePosition(position) {
  if (!position) return 'unknown'
  return `${position.x}|${position.y}|${position.z}`
}

function isRecoverableGatherError(error) {
  if (!error || !error.message) return false
  const message = error.message.toLowerCase()

  return (
    message.includes('took to long to decide path to goal') ||
    message.includes('took too long to decide path to goal') ||
    message.includes('no path to the goal') ||
    message.includes('path was stopped') ||
    message.includes('goal was changed before it could be completed') ||
    message.includes('moveto timeout') ||
    message.includes('digging aborted') ||
    message.includes('このブロックは掘れません') ||
    message.includes('指定位置にブロックが存在しません')
  )
}
