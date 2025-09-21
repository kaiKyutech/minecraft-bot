const primitives = require('../primitives')

/**
 * 中位スキル: gather
 * - 上位レイヤーが指定した `itemName` のブロックを、要求回数だけ掘って回収します。
 * - インベントリ確認などの前提評価は行わず、呼び出し元が正しい素材名や回数を決めていることを前提とします。
 * - ブロック探索 → 接近 → 掘削 → ドロップ回収 を 1 ループとし、指定回数だけ繰り返します。
 */
module.exports = async function gather(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')

  const loopCount = Number.isFinite(params.count) ? params.count : 1
  if (loopCount <= 0) return

  const itemName = resolveItemName(params)
  const matchCondition = itemName
  const collectName = params.collectItem === false ? null : itemName

  const maxDistance = params.maxDistance ?? 32
  const approachRange = params.approachRange ?? 2
  const collectRadius = params.collectRadius ?? 6
  const maxAttempts = params.maxAttempts ?? 20

  await stateManager.refresh(bot)

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
      // ブロックまで接近 → 掘削 → ドロップを回収
      await primitives.moveTo(bot, {
        position: blockInfo.position,
        range: approachRange
      })

      await primitives.digBlock(bot, { position: blockInfo.position })

      const collectAttempts = params.collectAttempts ?? 5
      const collectDelayMs = params.collectRetryDelayMs ?? 200
      let dropCount = 0

      for (let attempt = 0; attempt < collectAttempts; attempt++) {
        dropCount = await primitives.collectDrops(bot, {
          itemName: collectName,
          radius: collectRadius,
          waitMs: params.collectWaitMs
        })

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
 */
function resolveItemName(params) {
  if (typeof params.itemName === 'string' && params.itemName.length > 0) {
    return params.itemName
  }
  throw new Error('収集対象の素材名 (itemName) が指定されていません')
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
