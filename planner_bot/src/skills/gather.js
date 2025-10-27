const primitives = require('../primitives')
const minecraftData = require('minecraft-data')
const { loadBlockCategories } = require('../planner/state_builder')

/**
 * 中位スキル: gather
 * 前提：(必須)itemName (推奨)回数、範囲
 * - 上位レイヤーが指定した `itemName` のブロックを、要求回数だけ掘って回収します。
 * - インベントリ確認などの前提評価は行わず、呼び出し元が正しい "素材名" や "回数" や "範囲" を決めていることを前提とします。
 * - ブロック探索 → 接近 → 掘削 → ドロップ回収 を 1 ループとし、指定回数だけ繰り返します。
 */
module.exports = async function gather(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')

  const loopCount = Number.isFinite(params.count) ? params.count : 1
  if (loopCount <= 0) return

  const itemName = resolveItemName(params, bot)
  const matchCondition = itemName
  const collectName = params.collectItem === false ? null : itemName

  const maxDistance = params.maxDistance ?? 100
  const approachRange = params.approachRange ?? 2
  const collectRadius = params.collectRadius ?? 30
  const collectDelayMs = params.collectDelayMs ?? 200
  const maxAttempts = params.maxAttempts ?? 20

  // whileループ開始前に1回だけ最適ツールを決定
  let selectedTool = null
  try {
    // サンプルブロックを探して、そのタイプに最適なツールを選択
    const sampleBlockInfo = await primitives.findBlock(bot, {
      match: matchCondition,
      maxDistance
    })
    const sampleBlock = bot.blockAt(sampleBlockInfo.position)
    if (sampleBlock) {
      selectedTool = await primitives.findBestTool(bot, sampleBlock)
      if (selectedTool) {
        const mcData = require('minecraft-data')(bot.version)
        const toolName = mcData.items[selectedTool.type].name
        console.log(`[GATHER] 最適ツールを選択: ${toolName}`)
      } else {
        console.log(`[GATHER] 素手が最適と判定`)
      }
    }
  } catch (error) {
    console.log('[GATHER] ツール選択用のサンプルブロックが見つからず、素手で開始')
  }

  let completed = 0
  let attempts = 0
  const avoidedPositionKeys = new Set()
  const avoidedPositionOrder = []
  const maxAvoidListSize = params.maxAvoidListSize ?? 32
  const searchSampleSize = params.searchSampleSize ?? 1  // デフォルト候補数をさらに削減して探索負荷を軽減

  const rememberFailedTarget = (position) => {
    if (!position) return
    const key = serializePosition(position)
    if (avoidedPositionKeys.has(key)) return
    avoidedPositionKeys.add(key)
    avoidedPositionOrder.push(key)
    while (avoidedPositionOrder.length > maxAvoidListSize) {
      const oldest = avoidedPositionOrder.shift()
      if (oldest) avoidedPositionKeys.delete(oldest)
    }
    console.log(`[GATHER] 失敗したターゲットを回避リストに追加: ${key}`)
  }

  const acquireTarget = async () => {
    let candidates
    try {
      candidates = await primitives.findBlocks(bot, {
        match: matchCondition,
        maxDistance,
        count: searchSampleSize,
        useCube: params.useCube ?? true
      })
    } catch (error) {
      throw new Error('近くに対象ブロックが見つかりません')
    }

    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error('近くに対象ブロックが見つかりません')
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

    throw new Error('利用可能なブロック候補が見つかりません')
  }

  while (completed < loopCount) {
    if (attempts++ > maxAttempts) {
      throw new Error('資源の収集に失敗しました: 試行回数が上限に達しました')
    }

    let blockInfo
    try {
      blockInfo = await acquireTarget()
    } catch (error) {
      throw new Error(error.message || '近くに対象ブロックが見つかりません')
    }

    try {
      // ブロックまで接近
      await primitives.moveTo(bot, {
        position: blockInfo.position,
        range: approachRange
      })

      // 掘削直前に選択したツールを再装備
      if (selectedTool) {
        try {
          await bot.equip(selectedTool, 'hand')
          await delay(50) // 装備完了を待つ
        } catch (error) {
          console.log(`[GATHER] ツール再装備に失敗: ${error.message}`)
        }
      } else {
        // 素手が最適な場合
        try {
          await bot.unequip('hand')
          await delay(50) // 装備解除完了を待つ
        } catch (error) {
          // 素手にできない場合は無視
        }
      }

      // 掘削
      console.log(`[GATHER] ブロック掘削開始: ${blockInfo.position}`)
      await primitives.digBlock(bot, { position: blockInfo.position })
      console.log(`[GATHER] ブロック掘削完了`)

      completed += 1
    } catch (error) {
      rememberFailedTarget(blockInfo?.position)

      if (isRecoverableGatherError(error)) {
        console.log(`[GATHER] ブロック収集でエラー: ${error.message} → 別候補で再試行`)
        await delay(params.retryDelayMs ?? 100)
        continue
      }

      throw new Error(`資源の収集に失敗しました: ${error.message}`)
    }
  }

  // 全ブロック掘削完了後、最後に1回だけドロップ回収
  if (collectName) {
    await delay(collectDelayMs) // allow freshly spawned drops to register
    console.log(`[GATHER] 全${completed}個の掘削完了、ドロップ回収を開始`)
    try {
      const collectDropsSkill = require('./collect_drops')
      await collectDropsSkill(bot, {
        radius: collectRadius,
        maxAttempts: 3
      }, stateManager)
      console.log(`[GATHER] ドロップ回収完了`)
    } catch (error) {
      console.log(`[GATHER] ドロップ回収でエラー: ${error.message}`)
      // ドロップ回収失敗は致命的ではないので続行
    }
  }
}

/**
 * 呼び出し元から渡された素材名（itemName）を検証して返します。
 * Minecraftに存在しないアイテム名の場合はエラーを投げます。
 */
function resolveItemName(params, bot) {
  if (!params.itemName || typeof params.itemName !== 'string' || params.itemName.length === 0) {
    throw new Error('収集対象の素材名 (itemName) が指定されていません')
  }

  if (!bot.version) {
    throw new Error('bot.version が取得できるまで待ってください')
  }

  const mcData = minecraftData(bot.version)
  const itemName = params.itemName

  // カテゴリ名の場合は近くで最適なブロックを選択
  const categories = loadBlockCategories()
  if (categories?.categories?.[itemName]) {
    return selectBestBlockFromCategory(bot, itemName, categories, mcData, params)
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
  throw new Error(`未知のアイテム名です: ${itemName} (Minecraft ${bot.version} には存在しません)`)
}

// カテゴリ選択のキャッシュ（botごと、カテゴリごと）
const blockSelectionCache = new Map()

function selectBestBlockFromCategory(bot, categoryName, categories, mcData, params = {}) {
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
        console.log(`[GATHER] カテゴリ「${categoryName}」から「${cachedBlock}」を選択（キャッシュ使用）`)
        return cachedBlock
      } else {
        console.log(`[GATHER] キャッシュされたブロック「${cachedBlock}」が見つからず、再探索します`)
        blockSelectionCache.delete(cacheKey)
      }
    } catch (error) {
      console.log(`[GATHER] キャッシュされたブロック「${cachedBlock}」の探索に失敗、再探索します`)
      blockSelectionCache.delete(cacheKey)
    }
  }

  // キャッシュがないか、キャッシュが使えない場合は全探索
  console.log(`[GATHER] カテゴリ「${categoryName}」から最適なブロックを選択中...`)

  let closestBlock = null
  let closestDistance = Infinity

  // すべてのブロック種類を試して、最も近いものを選択
  for (const blockName of categoryBlocks) {
    try {
      const block = bot.findBlock({
        matching: (block) => block && block.name === blockName,
        maxDistance,
        count: 1
      })

      if (block) {
        const distance = bot.entity.position.distanceTo(block.position)
        if (distance < closestDistance) {
          closestBlock = blockName
          closestDistance = distance
        }
      }
    } catch (error) {
      // この種類は見つからない、次を試す
      continue
    }
  }

  if (closestBlock) {
    console.log(`[GATHER] カテゴリ「${categoryName}」から「${closestBlock}」を選択（距離: ${closestDistance.toFixed(2)}）`)
    // キャッシュに保存
    blockSelectionCache.set(cacheKey, closestBlock)
    return closestBlock
  }

  // どの種類も見つからない場合
  throw new Error(`カテゴリ「${categoryName}」のブロックが近くに見つかりません: ${categoryBlocks.join(', ')}`)
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
    message.includes('path was stopped') ||
    message.includes('goal was changed before it could be completed') ||
    message.includes('moveto timeout') ||
    message.includes('digging aborted') ||
    message.includes('このブロックは掘れません') ||
    message.includes('指定位置にブロックが存在しません')
  )
}
