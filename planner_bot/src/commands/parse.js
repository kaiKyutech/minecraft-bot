const { failure } = require('../utils/result')

function json(text) {
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch (cause) { throw failure('INVALID_ARGUMENT', `パラメータのJSON解析に失敗: ${cause.message}`) }
}

function action(message, prefix) {
  const body = message.replace(new RegExp(`^!${prefix}\\s*`), '').trim()
  const [name, ...rest] = body.split(' ')
  if (!name) throw failure('INVALID_ARGUMENT', `${prefix} の操作名を指定してください`)
  return { name, params: json(rest.join(' ')) }
}

module.exports = { json, action }
