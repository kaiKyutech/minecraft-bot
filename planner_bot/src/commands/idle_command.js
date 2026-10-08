const { handleChatCommand } = require('./index')
module.exports = (bot, username, message, stateManager) => handleChatCommand(bot, username, message, stateManager)
module.exports.stopIdle = require('../navigation/idle').stopIdle
