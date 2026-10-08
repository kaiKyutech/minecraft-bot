module.exports = (bot, username, goal, stateManager, signal) => require('../api').createBotApi(bot, { stateManager }).executeGoal(goal, { signal, username })
