/**
 * ボットの状態を取得・更新するためのヘルパー
 */
class StateManager {
  constructor() {
    this.cache = null
  }

  async getState(bot) {
    if (!this.cache) {
      await this.refresh(bot)
    }
    return this.cache
  }

  async refresh(bot) {
    this.cache = {
      timestamp: Date.now(),
      inventory: this.extractInventory(bot),
      position: bot.entity?.position ? bot.entity.position.clone() : null,
      isDay: bot.time ? bot.time.isDay : true
      // TODO: 追加の状態をここに
    }
    return this.cache
  }

  extractInventory(bot) {
    const slots = bot.inventory?.items() || []
    const counts = {}
    for (const item of slots) {
      counts[item.name] = (counts[item.name] || 0) + item.count
    }
    return {
      raw: slots,
      counts
    }
  }
}

module.exports = new StateManager()
