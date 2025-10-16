const ItemDatabase = require('./tools/item_database')

/**
 * LLMからのコマンドを処理
 */
class CommandHandler {
  constructor(bot, stateManager) {
    this.bot = bot
    this.stateManager = stateManager
    this.itemDB = new ItemDatabase(bot)

    console.log(`[CommandHandler] アイテムデータベース初期化: ${this.itemDB.getTotalCount()}件のアイテムを読み込みました`)
  }

  /**
   * LLMのコマンド出力を処理
   * @param {string} command - "diamond_pickaxe:1" or "?search diamond"
   * @returns {Promise<string>} 実行結果
   */
  async handle(command) {
    if (!command || command === 'null' || command.trim() === '') {
      return '（コマンドなし）'
    }

    const trimmed = command.trim()

    // 検索コマンド
    if (trimmed.startsWith('?search ')) {
      const query = trimmed.substring(8).trim()
      return this.handleSearch(query)
    }

    // 通常のクラフトコマンド
    return await this.handleGoal(trimmed)
  }

  /**
   * 検索コマンドを処理
   * @param {string} query - 検索クエリ
   * @returns {string} 検索結果
   */
  handleSearch(query) {
    if (!query) {
      return 'エラー: 検索クエリが空です'
    }

    console.log(`[CommandHandler] アイテム検索: "${query}"`)
    const result = this.itemDB.search(query)

    switch (result.status) {
      case 'found':
        console.log(`[CommandHandler] 検索成功: ${result.item}`)
        return `アイテムが見つかりました: ${result.item}`

      case 'multiple':
        console.log(`[CommandHandler] 複数候補: ${result.candidates.length}件`)
        return `${result.message}\n候補:\n${result.candidates.map(c => `  - ${c}`).join('\n')}`

      case 'too_many':
        console.log(`[CommandHandler] 候補多数: 上位10件のみ表示`)
        return `${result.message}\n候補:\n${result.candidates.map(c => `  - ${c}`).join('\n')}`

      case 'not_found':
        console.log(`[CommandHandler] 検索失敗: ${query}`)
        return result.message

      case 'error':
        console.log(`[CommandHandler] エラー: ${result.message}`)
        return `エラー: ${result.message}`

      default:
        return 'エラー: 検索に失敗しました'
    }
  }

  /**
   * GOAPコマンドを処理
   * @param {string} command - "diamond_pickaxe:1" 形式
   * @returns {Promise<string>} 実行結果
   */
  async handleGoal(command) {
    // "diamond_pickaxe:1" または "minecraft:diamond_pickaxe:1" のようなコマンドをパース
    const match = command.match(/^([\w:]+):(\d+)$/)
    if (!match) {
      return `エラー: 不正なコマンド形式です: ${command}\n正しい形式: "アイテム名:個数" (例: "diamond_pickaxe:1")`
    }

    const [, itemName, count] = match

    console.log(`[CommandHandler] GOAPコマンド: ${itemName}:${count}`)

    // アイテムが存在するか確認
    const searchResult = this.itemDB.search(itemName)

    if (searchResult.status === 'not_found') {
      console.log(`[CommandHandler] アイテムが見つかりません: ${itemName}`)
      return `エラー: アイテムが見つかりません: ${itemName}\n?search コマンドで検索してください。`
    }

    if (searchResult.status === 'multiple' || searchResult.status === 'too_many') {
      console.log(`[CommandHandler] アイテム名が曖昧: ${searchResult.candidates.length}件の候補`)
      return `エラー: アイテム名が曖昧です。以下のいずれかを正確に指定してください:\n${searchResult.candidates.map(c => `  - ${c}`).join('\n')}`
    }

    // 正確なアイテムIDを取得（minecraft:プレフィックスなし）
    const exactItemName = searchResult.item

    // GOAPコマンドに変換
    const goapCommand = `!goal inventory.${exactItemName}:${count}`

    console.log(`[CommandHandler] GOAP実行: ${goapCommand}`)

    try {
      // 既存のGOAPシステムを呼び出し（将来の実装）
      // await this.executeGoap(goapCommand)

      // TODO: 実際のGOAP実行を実装
      return `[TODO] GOAP実行: ${goapCommand}\n目標: ${exactItemName} x${count}`
    } catch (error) {
      console.error(`[CommandHandler] GOAP実行エラー:`, error)
      return `エラー: ${error.message}`
    }
  }

  /**
   * GOAPシステムを実行（将来の実装）
   * @param {string} goapCommand - "!goal inventory.diamond_pickaxe:1"
   * @returns {Promise<void>}
   */
  async executeGoap(goapCommand) {
    // 既存のGOAPエグゼキュータを呼び出し
    // この部分は planner_bot/index.js の既存コードと統合する必要がある
    throw new Error('GOAP実行は未実装です')
  }
}

module.exports = CommandHandler
