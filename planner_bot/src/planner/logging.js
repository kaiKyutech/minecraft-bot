const { AsyncLocalStorage } = require('node:async_hooks')
const { createLogger } = require('../utils/logger')
const planningLog = new AsyncLocalStorage()
function getLogger() { return planningLog.getStore() || createLogger({ category: 'goap' }) }
module.exports = { planningLog, getLogger }
