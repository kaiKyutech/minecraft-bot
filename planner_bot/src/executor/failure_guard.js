const { failure } = require('../utils/result')

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

// Time, look direction and sub-block movement cannot repair a failed action.
function stateSignature(world = {}, bot) {
  const position = bot?.entity?.position || world.position
  const local = []
  if (position && bot?.blockAt) {
    const base = position.floored()
    for (let x=-2;x<=2;x++) for (let y=-1;y<=2;y++) for (let z=-2;z<=2;z++) {
      const block = bot.blockAt(base.offset(x,y,z))
      local.push(block ? [block.name, block.stateId] : null)
    }
  }
  return JSON.stringify(canonical({ inventory: world.inventory?.counts || {}, equipment: world.equipment,
    nearby: world.nearby, flags: world.nearby_blocks, position: position && [Math.floor(position.x),Math.floor(position.y),Math.floor(position.z)], local }))
}

class FailureGuard {
  constructor() { this.counts = new Map(); this.state = null; this.stalled = 0 }
  note(goal, step, reason, world, bot) {
    const state = stateSignature(world, bot)
    if (state !== this.state) { this.state = state; this.stalled = 0; this.counts.clear() }
    const key = JSON.stringify(canonical({ action: step.action, params: step.params || {}, code: reason.code, reason: reason.message }))
    const attempts = (this.counts.get(key) || 0) + 1
    this.counts.set(key, attempts); this.stalled++
    if (attempts >= 3 || this.stalled >= 10) {
      const repeated = attempts >= 3
      throw failure('REPEATED_FAILURE', `Execution made no progress: ${step.action}`, {
        goal, action: step.action, params: step.params || {}, code: reason.code || 'EXECUTION_FAILED', reason: reason.message,
        attempts: repeated ? attempts : this.stalled, limit: repeated ? 3 : 10, limitKind: repeated ? 'same_failure' : 'no_progress'
      })
    }
  }
}
module.exports = { FailureGuard, stateSignature }
