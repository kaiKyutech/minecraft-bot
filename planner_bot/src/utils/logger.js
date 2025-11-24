/**
 * Logger utility
 * 環境変数でログ出力を制御しつつ、bot.systemLog があれば優先して使用する。
 *
 * 環境変数:
 * - LOG_COMMANDS: all | none | comma list (info,goal,skill,primitive,navigation,creative,chat,history,status,refresh,stop,echo)
 * - LOG_CATEGORIES: all | none | comma list (goap,goap.plan,goap.exec,skill,primitive,navigation,vision,state,chat,command,setup)
 * - LOG_LEVEL: error | warn | info | debug (default: info)
 */

const LEVELS = ['error', 'warn', 'info', 'debug']

function createLogger(options = {}) {
  const bot = options.bot || null
  const category = options.category || null
  const commandName = options.commandName || null

  const levelEnv = process.env.LOG_LEVEL ? process.env.LOG_LEVEL.toLowerCase() : 'info'
  const minLevelIdx = LEVELS.indexOf(levelEnv) >= 0 ? LEVELS.indexOf(levelEnv) : LEVELS.indexOf('info')

  const commandFilter = buildFilter(process.env.LOG_COMMANDS, { defaultMode: 'all' })
  const categoryFilter = buildFilter(process.env.LOG_CATEGORIES, { defaultMode: 'all' })

  function shouldLogLevel(level) {
    const idx = LEVELS.indexOf(level)
    return idx >= 0 && idx <= minLevelIdx
  }

  function shouldLogCategory(cat) {
    if (!cat) return true
    if (!categoryFilter.enabled) return true
    return categoryFilter.allowed.has(cat)
  }

  function shouldLogCommand(cmd) {
    if (!cmd) return true
    if (!commandFilter.enabled) return true
    return commandFilter.allowed.has(cmd)
  }

  function emit(level, ...args) {
    if (!shouldLogLevel(level)) return
    if (!shouldLogCategory(category)) return
    if (!shouldLogCommand(commandName)) return

    const writer = bot?.systemLog ? bot.systemLog.bind(bot) : console.log
    const msg = args.length === 1 ? args[0] : args.map(formatArg).join(' ')
    writer(msg)
  }

  return {
    error: (...args) => emit('error', ...args),
    warn: (...args) => emit('warn', ...args),
    info: (...args) => emit('info', ...args),
    log: (...args) => emit('info', ...args),
    debug: (...args) => emit('debug', ...args)
  }
}

function buildFilter(envValue, { defaultMode = 'all' } = {}) {
  if (!envValue || envValue.trim().length === 0) {
    return { enabled: defaultMode !== 'all', allowed: new Set(), defaultMode }
  }
  const normalized = envValue.trim().toLowerCase()
  if (normalized === 'all') {
    return { enabled: false, allowed: new Set(), defaultMode: 'all' }
  }
  if (normalized === 'none') {
    return { enabled: true, allowed: new Set(), defaultMode: 'none' }
  }
  const allowed = new Set(
    normalized
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
  return { enabled: true, allowed, defaultMode: 'custom' }
}

function formatArg(arg) {
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch (e) {
    return String(arg)
  }
}

module.exports = {
  createLogger
}
