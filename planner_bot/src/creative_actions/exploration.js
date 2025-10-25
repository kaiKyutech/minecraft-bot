const { Vec3 } = require('vec3')

/**
 * Exploration Actions - 周辺探索と地形分析
 * GOAPではなくLLMが直接制御する創造的行動
 */

module.exports = {
  /**
   * 周辺ブロック情報を取得
   *
   * 実装状態: 基本機能は完成、拡張検討中
   *
   * 現在の実装:
   * - 指定範囲内のブロックをスキャンしてJSON形式で返す
   * - タイプフィルタリング対応（例: diamond_ore のみ）
   * - 距離順ソート、相対位置計算、タイプ別カウント
   *
   * 未実装・検討中の課題:
   * - 3D構造の表現方法（洞窟の階層、建物の複数階など）
   * - 空間の「通路」「部屋」としての意味的解釈
   * - より効率的なスキャン（現在はfindBlocks()を複数回呼び出し）
   * - 大量ブロックの扱い（現在は1000個上限）
   *
   * 用途:
   * - ダイアモンド鉱石の発見
   * - 洞窟入口の検出（air/cave_airの塊）
   * - 特定ブロックの位置特定
   *
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {range?: number, types?: string[]}
   */
  async scanBlocks(bot, stateManager, params) {
    const range = params.range !== undefined ? params.range : 32
    const filterTypes = params.types // undefined or array of block names

    console.log(`[EXPLORATION] Scanning blocks within ${range} blocks...`)
    if (filterTypes) {
      console.log(`[EXPLORATION] Filtering by types: ${filterTypes.join(', ')}`)
    }

    const currentPos = bot.entity.position
    const blocks = []
    const typeCounts = {}

    // bot.findBlocks()を使って範囲内のブロックを探索
    // filterTypesがある場合は指定されたタイプのみ、ない場合は全タイプ
    let blockIds
    if (filterTypes && filterTypes.length > 0) {
      // 指定されたブロック名をIDに変換
      blockIds = filterTypes
        .map(typeName => bot.registry.blocksByName[typeName]?.id)
        .filter(id => id !== undefined)

      if (blockIds.length === 0) {
        throw new Error(`指定されたブロックタイプが見つかりません: ${filterTypes.join(', ')}`)
      }
    } else {
      // 全ブロックタイプを対象（空気ブロックは除外）
      blockIds = Object.values(bot.registry.blocksByName)
        .filter(block => !block.name.includes('air'))
        .map(block => block.id)
    }

    // findBlocks()は最大で128個までしか返さないため、タイプごとに分けて検索
    const maxBlocks = 1000 // 返すブロック数の上限
    const foundPositions = []

    for (const blockId of blockIds) {
      if (foundPositions.length >= maxBlocks) break

      const positions = bot.findBlocks({
        matching: blockId,
        maxDistance: range,
        count: Math.min(128, maxBlocks - foundPositions.length)
      })

      foundPositions.push(...positions)
    }

    console.log(`[EXPLORATION] Found ${foundPositions.length} blocks`)

    // 各ブロックの情報を収集
    for (const pos of foundPositions) {
      const block = bot.blockAt(pos)
      if (!block) continue

      const blockName = block.name
      const distance = Math.floor(currentPos.distanceTo(pos))
      const relativePos = {
        x: pos.x - Math.floor(currentPos.x),
        y: pos.y - Math.floor(currentPos.y),
        z: pos.z - Math.floor(currentPos.z)
      }

      blocks.push({
        name: blockName,
        position: {
          x: pos.x,
          y: pos.y,
          z: pos.z
        },
        relativePosition: relativePos,
        distance: distance
      })

      // タイプごとのカウント
      typeCounts[blockName] = (typeCounts[blockName] || 0) + 1
    }

    // 距離でソート（近い順）
    blocks.sort((a, b) => a.distance - b.distance)

    // サマリー情報
    const summary = {
      totalBlocks: blocks.length,
      uniqueTypes: Object.keys(typeCounts).length,
      typeCounts: typeCounts,
      scanRange: range,
      scanCenter: {
        x: Math.floor(currentPos.x),
        y: Math.floor(currentPos.y),
        z: Math.floor(currentPos.z)
      }
    }

    console.log(`[EXPLORATION] Scan complete:`)
    console.log(`[EXPLORATION]   Total blocks: ${summary.totalBlocks}`)
    console.log(`[EXPLORATION]   Unique types: ${summary.uniqueTypes}`)
    console.log(`[EXPLORATION]   Type counts:`, typeCounts)

    return {
      success: true,
      message: `${summary.totalBlocks}個のブロックをスキャンしました`,
      blocks: blocks,
      summary: summary
    }
  },

  /**
   * 俯瞰ヒートマップ生成（未実装）
   *
   * 実装状態: 未実装、設計検討中
   *
   * 当初の構想:
   * - 指定範囲の地形を上から見た2Dヒートマップ画像を生成
   * - 高さ（Y座標）をカラーグラデーションで表現
   * - 木、石、洞窟入口などのマーカーを追加
   * - LLMが地形を視覚的に理解して移動判断できるようにする
   *
   * 設計上の課題（実装保留中）:
   * - 洞窟内や建物内での使用方法が不明確
   *   → 複数階層をどう表現するか？
   *   → 天井がある場合、どの高さを「地表」とするか？
   * - 2D表現では3D構造（オーバーハング、複数階）が失われる
   * - 汎用性：屋外・洞窟内・建物内すべてで使える設計が必要
   *
   * 検討中の代替案:
   * 1. 複数の高さスライス（水平断面図を複数枚）
   * 2. 断面図（縦方向の2D断面）
   * 3. 3Dボクセル表現（JSONで構造化データ）
   * 4. 近傍グラフ表現（移動可能な方向とその特性）
   *
   * 次のステップ:
   * - 主な用途（洞窟探索 vs 地表探索）を明確化
   * - LLMへの情報提供形式（画像 vs JSON）を決定
   * - 複雑な3D環境での可視化手法を設計
   *
   * @param {Object} bot - Mineflayerボット
   * @param {Object} stateManager - 状態マネージャー
   * @param {Object} params - {range?: number, resolution?: number}
   */
  async topDownMap(bot, stateManager, params) {
    throw new Error('topDownMap is not yet implemented - design in progress')
  }
}
