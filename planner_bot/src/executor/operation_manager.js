const { withContext, checkpoint, cancelled } = require('../utils/context')
const { stopIdle } = require('../navigation/idle')
const { stopLookWatch } = require('../navigation/look')

const managers = new WeakMap()

class OperationManager {
  constructor(bot) {
    this.bot = bot
    this.generation = 0
    this.latest = null
    this.active = null
    this.tail = Promise.resolve()
    this.visionTail = Promise.resolve()
  }

  busy() {
    return Boolean((this.latest?.pending && !this.latest.controller.signal.aborted) || this.active?.running || this.bot.followTarget || this.bot.currentAbortController)
  }

  interrupt() {
    this.latest?.controller.abort()
    this.active?.controller.abort()
    // Also support a legacy caller holding an execution controller.
    this.bot.currentAbortController?.abort()
  }

  describe() {
    const bot = this.bot, actions = []
    if (this.active?.running || bot.currentAbortController) actions.push(this.active?.kind === 'goal' || !this.active ? 'GOAP task' : this.active.kind)
    if (bot.currentChest) actions.push('chest')
    if (bot.followTarget) actions.push(`follow (${bot.followTarget})`)
    if (bot.idleInterval) actions.push('idle')
    if (bot.lookWatchInterval) actions.push('look_watch')
    return actions
  }

  async cleanup() {
    const bot = this.bot
    stopIdle(bot)
    stopLookWatch(bot)
    await Promise.allSettled([bot._idleTickPromise, ...(bot._lookWatchPending || [])].filter(Boolean))
    if (bot.currentChest) {
      try { await bot.currentChest.close() } finally { bot.currentChest = null; bot.currentChestPosition = null }
    }
    if (bot.followTarget) {
      bot.followTarget = null
      bot.pathfinder?.setGoal(null)
    }
    if (this.active) this.release(this.active)
    bot.currentAbortController = null
  }

  release(entry) {
    entry.signal?.removeEventListener('abort', entry.forwardAbort)
    entry.controller.signal.removeEventListener('abort', entry.stopPhysical)
    if (this.active === entry) this.active = null
    if (this.bot.currentAbortController === entry.controller) this.bot.currentAbortController = null
  }

  run(kind, fn, options = {}) {
    if (options.signal?.aborted) return Promise.reject(cancelled())
    const entry = { kind, controller: new AbortController(), signal: options.signal, generation: ++this.generation, running: false, pending: true }
    entry.forwardAbort = () => {
      entry.controller.abort()
      if (!entry.running && this.active === entry) this.stop().catch(() => {})
    }
    entry.stopPhysical = () => {
      if (this.active !== entry) return
      this.bot.pathfinder?.setGoal(null)
      try { this.bot.stopDigging?.() } catch (_) {}
    }
    this.interrupt()
    this.latest = entry
    entry.signal?.addEventListener('abort', entry.forwardAbort, { once: true })
    entry.controller.signal.addEventListener('abort', entry.stopPhysical)
    const work = this.tail.then(async () => {
      await this.cleanup()
      entry.pending = false
      checkpoint(this.bot, entry.controller.signal)
      if (entry.generation !== this.generation) throw cancelled()
      this.active = entry
      this.bot.currentAbortController = entry.controller
      entry.running = true
      try {
        const value = await withContext({ bot: this.bot, signal: entry.controller.signal }, () => fn(entry.controller.signal))
        checkpoint(this.bot, entry.controller.signal)
        return value
      } catch (error) {
        // A timeout/failure must not leave a path running after its owner returns.
        entry.stopPhysical()
        throw error
      } finally {
        entry.running = false
        if (!this.bot.followTarget && !this.bot.currentChest) this.release(entry)
        else if (this.bot.currentAbortController === entry.controller) this.bot.currentAbortController = null
      }
    }).finally(() => {
      entry.pending = false
      if (this.active !== entry) this.release(entry)
    })
    this.tail = work.catch(() => {})
    return work
  }

  continueChest(fn) {
    const generation = this.generation
    const work = this.tail.then(async () => {
      if (generation !== this.generation) throw cancelled()
      const entry = this.active
      if (entry) { checkpoint(this.bot, entry.controller.signal); entry.running = true }
      try {
        const value = await withContext({ bot: this.bot, signal: entry?.controller.signal || null }, () => fn(entry?.controller.signal))
        if (entry) checkpoint(this.bot, entry.controller.signal)
        return value
      } finally {
        if (entry) {
          entry.running = false
          if (!this.bot.currentChest && !this.bot.followTarget) this.release(entry)
        }
      }
    })
    this.tail = work.catch(() => {})
    return work
  }

  stop() {
    const stoppedActions = this.describe()
    this.generation++
    this.interrupt()
    const work = this.tail.then(async () => {
      await this.cleanup()
      return {
        stoppedActions,
        message: stoppedActions.length ? `停止しました: ${stoppedActions.join(', ')}` : '停止する操作がありませんでした'
      }
    })
    this.tail = work.catch(() => {})
    return work
  }

  capture(fn) {
    const work = this.visionTail.then(fn)
    this.visionTail = work.catch(() => {})
    return work
  }
}

function operationsFor(bot) {
  if (!managers.has(bot)) managers.set(bot, new OperationManager(bot))
  return managers.get(bot)
}

module.exports = { operationsFor }
