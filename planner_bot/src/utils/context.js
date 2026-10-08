const { AsyncLocalStorage } = require('node:async_hooks')
const storage = new AsyncLocalStorage()

function withContext(context, fn) {
  return storage.run({ ...storage.getStore(), ...context }, fn)
}

function currentContext(bot) {
  const context = storage.getStore()
  return context && (!bot || !context.bot || context.bot === bot) ? context : {}
}

function cancelled() {
  return Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'CANCELLED' })
}

function checkpoint(bot, signal = currentContext(bot).signal) {
  if (signal?.aborted) throw cancelled()
}

// Await the actual operation (including its rejection); never leave it running
// after reporting cancellation. The next side effect must pass another check.
async function interruptible(bot, fn) {
  checkpoint(bot)
  try {
    const result = await fn()
    checkpoint(bot)
    return result
  } catch (error) {
    checkpoint(bot)
    throw error
  }
}

module.exports = { withContext, currentContext, checkpoint, cancelled, interruptible }
