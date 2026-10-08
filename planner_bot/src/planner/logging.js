const { AsyncLocalStorage } = require('node:async_hooks')
const { createLogger } = require('../utils/logger')
const planningLog = new AsyncLocalStorage()
function getLogger() { return planningLog.getStore() || createLogger({ category: 'goap' }) }
function planningLogger(logger) {
  if (!logger || typeof logger.info !== 'function' || typeof logger.warn !== 'function') return createLogger({ category: 'goap' })
  return {
    info: logger.info.bind(logger), warn: logger.warn.bind(logger),
    error: (logger.error || logger.warn).bind(logger),
    debug: (logger.debug || logger.info).bind(logger)
  }
}
module.exports = { planningLog, getLogger, planningLogger }
