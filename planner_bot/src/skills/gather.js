const primitives = require('../primitives')
const minecraftData = require('minecraft-data')

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
  const collectRadius = params.collectRadius ?? 12
  const maxAttempts = params.maxAttempts ?? 20

  await stateManager.refresh(bot)

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

  while (completed < loopCount) {
    if (attempts++ > maxAttempts) {
      throw new Error('資源の収集に失敗しました: 試行回数が上限に達しました')
    }

    let blockInfo
    try {
      // 指定条件に合うブロックを近傍から 1 つ探索
      blockInfo = await primitives.findBlock(bot, {
        match: matchCondition,
        maxDistance
      })
    } catch (error) {
      throw new Error('近くに対象ブロックが見つかりません')
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
          const mcData = require('minecraft-data')(bot.version)
          const toolName = mcData.items[selectedTool.type].name
          console.log(`[GATHER] ${toolName}を再装備`)
        } catch (error) {
          console.log(`[GATHER] ツール再装備に失敗: ${error.message}`)
        }
      } else {
        // 素手が最適な場合
        try {
          await bot.unequip('hand')
          console.log(`[GATHER] 素手で掘削`)
        } catch (error) {
          // 素手にできない場合は無視
        }
      }

      //掘削
      await primitives.digBlock(bot, { position: blockInfo.position })

      //ドロップを回収
      const collectAttempts = params.collectAttempts ?? 5
      const collectDelayMs = params.collectRetryDelayMs ?? 200
      let dropCount = 0

      for (let attempt = 0; attempt < collectAttempts; attempt++) {
        // console.log(`[GATHER] 回収試行 ${attempt + 1}/${collectAttempts}`)
        dropCount = await primitives.collectDrops(bot, {
          itemName: collectName,
          radius: collectRadius,
          waitMs: params.collectWaitMs
        })

        // console.log(`[GATHER] 回収できたドロップ数: ${dropCount}`)
        if (dropCount > 0) break
        await delay(collectDelayMs)
      }

      if (dropCount === 0) {
        await primitives.moveTo(bot, {
          position: blockInfo.position,
          range: 0.6
        })
        await delay(collectDelayMs)
      }
    } catch (error) {
      throw new Error(`資源の収集に失敗しました: ${error.message}`)
    }

    completed += 1
    await stateManager.refresh(bot)
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

  // ブロックとして存在するかチェック
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
