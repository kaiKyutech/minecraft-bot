const { createBotApi } = require('../api')
const { action } = require('./parse')
const { errorResult } = require('../utils/result')
module.exports = async (bot, username, message, stateManager) => {
  try { const { name, params } = action(message, 'info'); return await createBotApi(bot, { stateManager }).info(name, params) }
  catch (error) { return errorResult(error) }
}
