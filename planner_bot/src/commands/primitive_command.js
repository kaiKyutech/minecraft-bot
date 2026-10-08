const { createBotApi } = require('../api')
const { action } = require('./parse')
const { errorResult } = require('../utils/result')
module.exports = async (bot, username, message, stateManager) => {
  try { const { name, params } = action(message, 'primitive'); return await createBotApi(bot, { stateManager }).executePrimitive(name, params) }
  catch (error) { return errorResult(error) }
}
