const { failure } = require('./result')
const { interruptible, checkpoint, currentContext, withContext } = require('./context')
const { watchServerBlock } = require('./server_block_updates')
const { createLogger } = require('./logger')
const installed = new WeakSet(), pending = new WeakMap(), scopes = new WeakMap()

// Pathfinder calls bot.dig directly as well. Install at the execution boundary
// so both path clearing and gather use the same server confirmation.
function installDigExecution(bot) {
  if (installed.has(bot) || typeof bot.dig !== 'function') return
  installed.add(bot)
  const rawDig = bot.dig.bind(bot), active = new Set()
  pending.set(bot, active)
  bot.dig = (block, ...args) => {
    // physicsTick callbacks can originate outside the operation's async context.
    const context = scopes.get(bot) || currentContext(bot)
    const work = withContext({...context, bot, signal:context.signal || bot.currentAbortController?.signal},
      () => confirmedDig(bot, block, rawDig, args))
    active.add(work)
    work.then(() => active.delete(work), () => active.delete(work))
    return work
  }
}

async function confirmedDig(bot, initialBlock, rawDig, args) {
  if (!initialBlock?.position) throw failure('BLOCK_NOT_FOUND', '指定位置にブロックが存在しません')
  const position = initialBlock.position.clone()
  const logger = createLogger({bot, category:'primitive', commandName:bot.currentCommandName})
  const server = watchServerBlock(bot, position)
  try {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const landingDeadline = Date.now() + 1000
    while (bot.entity?.onGround === false && Date.now() < landingDeadline) {
      await interruptible(bot, () => new Promise(resolve => setTimeout(resolve, 25)))
    }
    checkpoint(bot)
    // Keep watching between attempts: a late authoritative air packet can
    // arrive while the next landing wait is in progress.
    if(server.isAir)return
    const block = bot.blockAt(position)
    if (!block) throw failure('BLOCK_NOT_FOUND', '指定位置にブロックが存在しません')
    if (!bot.canDigBlock(block)) throw failure('BLOCK_NOT_FOUND', `このブロックは掘れません: ${block.name}`)
    const startTime = Date.now(), predictedMs = bot.digTime(block)
    const diagnostic = {block, attempt, startedAt:startTime, predictedMs, onGround:bot.entity.onGround}
    logger.info(`[DIG] ${block.name} 採掘開始、予想時間: ${(predictedMs/1000).toFixed(2)}秒、ツール: ${bot.heldItem?.name || '素手'}`)
    try {
      // These execution diagnostics refer to raw mineflayer start/completion,
      // before waiting for the separate authoritative server update.
      bot.emit('digExecutionAttempt', diagnostic)
      try {
        await interruptible(bot, () => rawDig(block, ...args))
        bot.emit('digExecutionClientDone', diagnostic)
      } catch (error) {
        bot.emit('digExecutionClientDone', {...diagnostic, error})
        throw error
      }
      if (await server.waitForAir(1000)) {
        checkpoint(bot)
        logger.info(`[DIG] ${block.name} サーバー破壊確認、実際の時間: ${((Date.now()-startTime)/1000).toFixed(2)}秒`)
        return
      }
      logger.info(`[DIG] サーバーの破壊確認なし、再試行 ${attempt}/3: ${position}`)
      if (attempt === 3) throw failure('BLOCK_NOT_FOUND', `このブロックは掘れません: サーバーが破壊を確認しませんでした (${position})`, {position, attempts:attempt})
    } finally {
      // Undo optimistic local air only; an authoritative solid correction wins.
      if (!server.isAir && bot.blockAt(position)?.name === 'air') bot._updateBlockState(position, server.stateId ?? block.stateId)
    }
  }
  } finally { server.close() }
}

async function drainDigging(bot) {
  const active = pending.get(bot)
  while (active?.size) await Promise.allSettled([...active])
}
function diggingScope(bot, signal) {
  installDigExecution(bot)
  const previous=scopes.get(bot),context=currentContext(bot),controller=new AbortController()
  const parent=signal || context.signal || bot.currentAbortController?.signal
  const scope={...context,bot,signal:parent?AbortSignal.any([parent,controller.signal]):controller.signal}
  scopes.set(bot,scope)
  return async () => {
    controller.abort()
    await drainDigging(bot)
    // Drain pathfinder's catch/reset callbacks as well as the dig promises.
    await new Promise(resolve => setImmediate(resolve))
    if(scopes.get(bot)===scope){if(previous)scopes.set(bot,previous);else scopes.delete(bot)}
  }
}
module.exports = { installDigExecution, drainDigging, diggingScope }
