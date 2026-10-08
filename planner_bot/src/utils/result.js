function failure(code, message, details = null) {
  return Object.assign(new Error(message), { code, details })
}

function ok(data = null) { return { ok: true, data: data === undefined ? null : data, error: null } }

function errorResult(error, fallback = 'INTERNAL_ERROR') {
  const reasons = { circular_dependency: 'GOAL_CYCLE', max_depth_reached: 'GOAL_DEPTH_EXCEEDED' }
  const code = error.name === 'AbortError' ? 'CANCELLED' : error.code || reasons[error.reason] || (error.diagnosis?.missingEnvironment ? 'ENVIRONMENT_MISSING' : error.needsLLM ? 'PLAN_NOT_FOUND' : fallback)
  const details = { ...(error.details || {}) }
  for (const key of ['diagnosis', 'missingPreconditions', 'missingEnvironment', 'needsLLM', 'goalChain', 'reason']) {
    if (error[key] !== undefined) details[key] = error[key]
  }
  return { ok: false, data: null, error: { code, message: error.message || String(error), details: Object.keys(details).length ? details : null } }
}

const REASONS = { invalid_json: 'INVALID_ARGUMENT', invalid_usage: 'INVALID_ARGUMENT', missing_params: 'INVALID_ARGUMENT', missing_username: 'INVALID_ARGUMENT', invalid_format: 'INVALID_ARGUMENT', player_not_found: 'PLAYER_NOT_FOUND', entity_not_available: 'ENTITY_NOT_AVAILABLE', out_of_range: 'OUT_OF_RANGE' }

function fromLegacy(value, fallback = 'EXECUTION_FAILED') {
  if (value?.success === false) {
    const { success, error, message, code, ...details } = value
    return errorResult(failure(code || REASONS[value.reason] || fallback, error || message || value.reason || 'Operation failed', details), fallback)
  }
  if (value && Object.hasOwn(value, 'success')) {
    const { success, ...data } = value
    return ok(data)
  }
  return ok(value)
}

module.exports = { failure, ok, errorResult, fromLegacy }
