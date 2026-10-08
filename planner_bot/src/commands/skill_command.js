const { createBotApi } = require('../api')
const { action } = require('./parse')
const { errorResult } = require('../utils/result')
module.exports = async (bot, username, message, stateManager) => {
  try { const { name, params } = action(message, 'skill'); return await createBotApi(bot, { stateManager }).executeSkill(name, params) }
  catch (error) { return errorResult(error) }
}
