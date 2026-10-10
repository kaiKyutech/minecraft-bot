const { currentContext } = require('../utils/context')

// Return null without creating a promise when no request is pending.
function interjectBoundary(bot, boundary, metadata) {
  return currentContext(bot).interjectBoundary?.(boundary, metadata)
}

module.exports = { interjectBoundary }
