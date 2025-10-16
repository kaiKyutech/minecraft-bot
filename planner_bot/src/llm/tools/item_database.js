const mcData = require('minecraft-data')

/**
 * アイテムデータベース
 * Minecraftのアイテムを検索・管理する
 */
class ItemDatabase {
  constructor(bot) {
    this.mcData = mcData(bot.version)
    this.items = this.mcData.itemsArray
  }

  /**
   * アイテム名を正規化（minecraft:プレフィックスを除去）
   * @param {string} itemName - "diamond_pickaxe" or "minecraft:diamond_pickaxe"
   * @returns {string} - "diamond_pickaxe"
   */
  normalizeItemName(itemName) {
    if (itemName.startsWith('minecraft:')) {
      return itemName.substring(10)
    }
    return itemName
  }

  /**
   * アイテムを検索
   * @param {string} query - 検索クエリ（例: "diamond pickaxe", "minecraft:diamond_pickaxe", "diamond"）
   * @returns {Object} - { status, item?, candidates?, message? }
   *
   * status:
   *   - 'found': 1件のみヒット（item に正確なアイテム名）
   *   - 'multiple': 複数ヒット（candidates に候補リスト）
   *   - 'too_many': 多すぎる（candidates に上位10件）
   *   - 'not_found': 見つからない
   *   - 'error': エラー
   */
  search(query) {
    const normalizedQuery = this.normalizeItemName(query.toLowerCase().trim())
    const words = normalizedQuery.split(/[\s_]+/).filter(w => w.length > 0)

    if (words.length === 0) {
      return { status: 'error', message: 'クエリが空です' }
    }

    // 完全一致を優先（アンダースコア区切りまたはスペース区切り）
    const exactMatch = this.items.find(item => {
      const normalized = this.normalizeItemName(item.name)
      return normalized === normalizedQuery ||
             normalized === normalizedQuery.replace(/\s+/g, '_')
    })

    if (exactMatch) {
      return { status: 'found', item: this.normalizeItemName(exactMatch.name) }
    }

    // 部分一致（全ての単語が含まれる）
    const matches = this.items.filter(item => {
      const normalized = this.normalizeItemName(item.name)
      const itemWords = normalized.split('_')
      return words.every(queryWord =>
        itemWords.some(itemWord => itemWord.includes(queryWord))
      )
    })

    if (matches.length === 0) {
      // 1単語でも含まれるものを探す（緩い検索）
      const looseMatches = this.items.filter(item => {
        const normalized = this.normalizeItemName(item.name)
        return words.some(queryWord => normalized.includes(queryWord))
      })

      if (looseMatches.length > 0 && looseMatches.length <= 10) {
        return {
          status: 'multiple',
          candidates: looseMatches.map(m => this.normalizeItemName(m.name)),
          message: `近いアイテムが見つかりました (${looseMatches.length}件)`
        }
      }

      return {
        status: 'not_found',
        message: `アイテムが見つかりません: ${query}`
      }
    }

    if (matches.length === 1) {
      return { status: 'found', item: this.normalizeItemName(matches[0].name) }
    }

    // 複数マッチ（10件以内なら全て表示）
    if (matches.length <= 10) {
      return {
        status: 'multiple',
        candidates: matches.map(m => this.normalizeItemName(m.name)),
        message: `複数のアイテムが見つかりました (${matches.length}件)`
      }
    }

    // 多すぎる場合は上位10件のみ
    return {
      status: 'too_many',
      candidates: matches.slice(0, 10).map(m => this.normalizeItemName(m.name)),
      message: `アイテムが多すぎます (${matches.length}件)。上位10件のみ表示します。クエリをより具体的にしてください。`
    }
  }

  /**
   * アイテムが存在するか確認
   * @param {string} itemName - アイテムID（"diamond_pickaxe" or "minecraft:diamond_pickaxe"）
   * @returns {boolean}
   */
  exists(itemName) {
    const normalized = this.normalizeItemName(itemName)
    return this.items.some(item => this.normalizeItemName(item.name) === normalized)
  }

  /**
   * アイテムの表示名を取得
   * @param {string} itemName - アイテムID
   * @returns {string|null}
   */
  getDisplayName(itemName) {
    const normalized = this.normalizeItemName(itemName)
    const item = this.items.find(item => this.normalizeItemName(item.name) === normalized)
    return item ? item.displayName : null
  }

  /**
   * 全アイテム数を取得
   * @returns {number}
   */
  getTotalCount() {
    return this.items.length
  }

  /**
   * カテゴリ別アイテム数を取得（デバッグ用）
   * @returns {Object}
   */
  getStats() {
    const categories = {}
    for (const item of this.items) {
      const normalized = this.normalizeItemName(item.name)
      const category = normalized.includes('_') ? normalized.split('_')[1] : 'other'
      categories[category] = (categories[category] || 0) + 1
    }
    return {
      total: this.items.length,
      categories: Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    }
  }
}

module.exports = ItemDatabase
