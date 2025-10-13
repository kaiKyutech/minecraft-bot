const primitives = require('../primitives')

/**
 * 中位スキル: collect_drops
 * 周辺のドロップアイテムを汎用的に拾う
 *
 * 特定のアイテムではなく、近くにあるすべてのドロップを対象とする
 * リプランニング時の救済アクションとして使用される
 */
module.exports = async function collectDrops(bot, params = {}, stateManager) {
  if (!stateManager) throw new Error('stateManager が提供されていません')

  const radius = params.radius ?? 12
  const maxAttempts = params.maxAttempts ?? 3

  console.log(`[COLLECT_DROPS] 半径${radius}ブロック以内のドロップを回収します`)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 近くのドロップを検索
    const drops = Object.values(bot.entities)
      .filter(e => e && e.name === 'item')
      .filter(e => bot.entity.position.distanceTo(e.position) <= radius)
      .sort((a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position)
      )

    if (drops.length === 0) {
      console.log(`[COLLECT_DROPS] ドロップが見つかりません（試行${attempt + 1}/${maxAttempts}）`)
      if (attempt === maxAttempts - 1) {
        console.log('[COLLECT_DROPS] ドロップ回収完了（アイテムなし）')
        return
      }
      await delay(200)
      continue
    }

    console.log(`[COLLECT_DROPS] ${drops.length}個のドロップを発見、回収中...`)

    // 各ドロップに接近して拾う
    let collectedCount = 0
    for (const drop of drops) {
      try {
        // ドロップアイテムの位置を取得
        const dropPosition = drop.position.clone()
        console.log(`[COLLECT_DROPS] ドロップ位置: ${dropPosition.x.toFixed(1)}, ${dropPosition.y.toFixed(1)}, ${dropPosition.z.toFixed(1)}`)

        // ドロップに接近（1.2ブロック以内に入る）
        await primitives.moveTo(bot, {
          position: dropPosition,
          range: 1.2,
          timeout: 5000
        })

        // ピックアップ待機（サーバーの処理を待つ）
        await delay(300)

        // まだ存在するか確認
        if (!bot.entities[drop.id]) {
          collectedCount++
          console.log(`[COLLECT_DROPS] アイテムを回収しました（${collectedCount}/${drops.length}）`)
        } else {
          console.log(`[COLLECT_DROPS] アイテムがまだ存在します、さらに接近します`)
          // さらに近づく
          await primitives.moveTo(bot, {
            position: dropPosition,
            range: 0.5,
            timeout: 3000
          })
          await delay(300)

          if (!bot.entities[drop.id]) {
            collectedCount++
            console.log(`[COLLECT_DROPS] アイテムを回収しました（${collectedCount}/${drops.length}）`)
          } else {
            console.log(`[COLLECT_DROPS] アイテムを回収できませんでした`)
          }
        }
      } catch (error) {
        console.log(`[COLLECT_DROPS] ドロップ回収失敗（スキップ）: ${error.message}`)
        continue
      }
    }

    console.log(`[COLLECT_DROPS] ドロップ回収処理完了（回収: ${collectedCount}個）`)
    return
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
