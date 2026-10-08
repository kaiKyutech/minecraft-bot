const { handleChatCommand } = require('./index')
module.exports = (bot, username, body, stateManager) => handleChatCommand(bot, username, body.startsWith('!creative ') ? body : '!creative ' + body, stateManager)
