const { withContext, currentContext, interruptible, checkpoint, cancelled } = require('../utils/context')
const { failure, fromLegacy, errorResult } = require('../utils/result')
const { stopIdle } = require('../navigation/idle')
const { stopLookWatch } = require('../navigation/look')
const { drainDigging } = require('../utils/dig_execution')

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
    await drainDigging(bot)
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
    if (entry.interjection) {
      entry.interjection.reject(cancelled())
      entry.interjection = null
    }
    entry.signal?.removeEventListener('abort', entry.forwardAbort)
    if (entry.stopPhysical) entry.controller.signal.removeEventListener('abort', entry.stopPhysical)
    if (this.active === entry) this.active = null
    if (this.bot.currentAbortController === entry.controller) this.bot.currentAbortController = null
  }

  interject(kind, fn, options = {}) {
    if (options.signal?.aborted) return Promise.reject(cancelled())
    const entry = this.active
    if (!entry?.running || entry.kind !== 'goal') return this.run(kind, fn, options)
    checkpoint(this.bot, entry.controller.signal)
    if (entry.interjection) return Promise.reject(failure('INTERJECT_BUSY', 'An interjection is already pending or running'))
    require('./prepared_goals').invalidate(this.bot)
    return new Promise((resolve, reject) => {
      const abort = () => entry.controller.abort()
      options.signal?.addEventListener('abort', abort, { once: true })
      this.bot.once?.('end', abort)
      const finish = (callback, value) => {
        options.signal?.removeEventListener('abort', abort)
        this.bot.removeListener?.('end', abort)
        callback(value)
      }
      entry.interjection = { kind, fn, requestedAt: Date.now(),
        resolve: value => finish(resolve, value), reject: error => finish(reject, error) }
    })
  }

  // Called only at explicit safe boundaries in the goal's own async context.
  // Keep the same owner, controller, plan cursor and gather counter throughout.
  interjectBoundary(boundary, details = {}) {
    const entry = this.active, request = entry?.interjection
    if (!request || request.running) return null
    request.running = true
    return (async () => {
      const bot = this.bot, reporter = currentContext(bot).progress
      const metadata = { ...currentContext(bot).interjectStep, ...details, kind: request.kind, boundary }
      const startedAt = Date.now(), heldType = bot.heldItem?.type ?? null
      reporter?.emit('interject_start', { ...metadata, waitMs: startedAt - request.requestedAt })
      let value, error
      try {
        checkpoint(bot, entry.controller.signal)
        try { value = await request.fn() } catch (caught) { error = caught }
        // placeTorch equips a torch. Restore the goal's hand before resuming.
        checkpoint(bot, entry.controller.signal)
        if (heldType !== null) {
          const item = bot.inventory.items().find(item => item.type === heldType)
          if (item) await interruptible(bot, () => bot.equip(item, 'hand'))
          else await interruptible(bot, () => bot.unequip('hand'))
        } else await interruptible(bot, () => bot.unequip('hand'))
        checkpoint(bot, entry.controller.signal)
      } catch (caught) { error = caught }
      const result = error ? errorResult(error, 'PLACEMENT_FAILED') : fromLegacy(value, 'PLACEMENT_FAILED')
      reporter?.emit('interject_end', { ...metadata, result, waitMs: startedAt - request.requestedAt,
        durationMs: Date.now() - startedAt, totalMs: Date.now() - request.requestedAt,
        resume: entry.controller.signal.aborted ? 'stopped' : boundary.startsWith('gather_') ? 'same_skill' : 'check_preconditions' })
      if (!entry.controller.signal.aborted && boundary.startsWith('gather_')) {
        reporter?.emit('interject_resume', { ...metadata, mode: 'same_plan', continuation: 'same_skill' })
      }
      entry.interjection = null
      entry.interjected = true
      if (error) request.reject(error); else request.resolve(value)
      checkpoint(bot, entry.controller.signal)
    })()
  }

  run(kind, fn, options = {}) {
    if (options.signal?.aborted) return Promise.reject(cancelled())
    const prepared = require('./prepared_goals')
    prepared.invalidate(this.bot, options[prepared.HANDOFF])
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
        const value = await withContext({ bot: this.bot, signal: entry.controller.signal,
          interjectBoundary: kind === 'goal' ? (boundary, metadata) => this.interjectBoundary(boundary, metadata) : undefined,
          takeInterjected: kind === 'goal' ? () => { const changed = entry.interjected; entry.interjected = false; return changed } : undefined
        }, () => fn(entry.controller.signal))
        checkpoint(this.bot, entry.controller.signal)
        return value
      } catch (error) {
        // A timeout/failure must not leave a path running after its owner returns.
        entry.stopPhysical()
        throw error
      } finally {
        await drainDigging(this.bot)
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

  continueChest(fn, options = {}) {
    if (options.signal?.aborted) return Promise.reject(cancelled())
    require('./prepared_goals').invalidate(this.bot)
    const generation = this.generation
    const work = this.tail.then(async () => {
      if (generation !== this.generation) throw cancelled()
      checkpoint(this.bot, options.signal)
      const entry = this.active || { kind: 'chest', controller: new AbortController() }
      const abort = () => entry.controller.abort()
      options.signal?.addEventListener('abort', abort, { once: true })
      this.active = entry
      checkpoint(this.bot, entry.controller.signal)
      entry.running = true
      try {
        const value = await withContext({ bot: this.bot, signal: entry.controller.signal }, () => fn(entry.controller.signal))
        checkpoint(this.bot, entry.controller.signal)
        return value
      } finally {
        options.signal?.removeEventListener('abort', abort)
        entry.running = false
        if (entry.controller.signal.aborted) await this.cleanup()
        else if (!this.bot.currentChest && !this.bot.followTarget) this.release(entry)
      }
    })
    this.tail = work.catch(() => {})
    return work
  }

  stop() {
    require('./prepared_goals').invalidate(this.bot)
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
