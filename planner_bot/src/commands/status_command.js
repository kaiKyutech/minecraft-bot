module.exports = (bot, username, stateManager) => require('../api').createBotApi(bot, { stateManager }).status()
