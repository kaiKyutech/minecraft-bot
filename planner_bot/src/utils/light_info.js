const { Vec3 } = require('vec3')
const { failure } = require('./result')

const TORCHES = new Set(['torch', 'wall_torch'])

function lightOptions(options = {}) {
  const darkBelow = options.darkBelow ?? 8
  const torchRadius = options.torchRadius ?? 5
  if (!Number.isInteger(darkBelow) || darkBelow < 0 || darkBelow > 16 ||
      !Number.isInteger(torchRadius) || torchRadius < 0 || torchRadius > 8) {
    throw failure('INVALID_ARGUMENT', 'darkBelow must be 0..16; torchRadius must be 0..8 (integers)')
  }
  return { darkBelow, torchRadius }
}

// Read independently of the resumable resource scan: a just-placed torch must
// be visible even when maxChecks/maxMs is zero or a resource cache is complete.
function lightInfo(bot, options = {}) {
  const { darkBelow, torchRadius } = lightOptions(options)
  const position = bot.entity.position
  const eye = bot.blockAt(position.offset(0, 1.62, 0))
  const block = eye?.light ?? null, sky = eye?.skyLight ?? null
  const level = block === null || sky === null ? null : Math.max(block, sky)
  const base = position.floored()
  const minY = bot.game?.minY ?? -64, top = minY + (bot.game?.height ?? 384)
  let torchNearby = false, missing = false
  search: for (let x = -torchRadius; x <= torchRadius; x++) {
    for (let y = -torchRadius; y <= torchRadius; y++) {
      for (let z = -torchRadius; z <= torchRadius; z++) {
        if (x*x + y*y + z*z > torchRadius*torchRadius) continue
        const point = new Vec3(base.x + x, base.y + y, base.z + z)
        if (point.y < minY || point.y >= top) continue
        const near = bot.blockAt(point)
        if (!near) missing = true
        else if (TORCHES.has(near.name)) { torchNearby = true; break search }
      }
    }
  }
  if (!torchNearby && missing) torchNearby = null
  const dark = torchNearby === true || (level !== null && level >= darkBelow)
    ? false : level === null || torchNearby === null ? null : true
  return { block, sky, level, dark, torchNearby }
}

module.exports = { lightInfo, lightOptions, TORCHES }
