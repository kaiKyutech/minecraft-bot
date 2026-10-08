const { createBotApi } = require('../api')
const { action } = require('./parse')
const { errorResult } = require('../utils/result')
module.exports = async (bot, username, message, stateManager) => {
  try { const { name, params } = action(message, 'look'); return await createBotApi(bot, { stateManager }).look(name, params) }
  catch (error) { return errorResult(error) }
}
module.exports.stopLookWatch = require('../navigation/look').stopLookWatch
