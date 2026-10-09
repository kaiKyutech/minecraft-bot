const { performance } = require('node:perf_hooks')
const { failure } = require('../utils/result')

const sessions = new WeakMap()
const immediate = () => new Promise(resolve => setImmediate(resolve))
const air = new Set(['air', 'cave_air', 'void_air'])
const vegetation = new Set(['bamboo', 'bamboo_sapling', 'cactus', 'sugar_cane', 'snow', 'sea_pickle', 'lily_pad', 'chorus_plant', 'chorus_flower',
  'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem', 'azalea', 'flowering_azalea'])
function ground(block) {
  return block.boundingBox === 'block' && !block.material?.split(';').includes('plant') &&
    !air.has(block.name) && block.name !== 'water' && block.name !== 'lava' && !vegetation.has(block.name) &&
    !/(_leaves|_log|_wood|_stem|_hyphae|_roots|_wart_block|_carpet)$/.test(block.name)
}
function session(bot) {
  let s = sessions.get(bot)
  if (s) return s
  s = { chunks: new Map(), world: bot.world, registry: bot.registry, minY: bot.game.minY, height: bot.game.height }
  const chunkKey = p => `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`
  const update = (old, next) => {
    const p = next?.position || old?.position
    if (p) s.chunks.get(chunkKey(p))?.cells.delete((p.z & 15) * 16 + (p.x & 15))
  }
  const chunk = p => { if (p) s.chunks.delete(chunkKey(p)); else s.chunks.clear() }
  const reset = () => s.chunks.clear()
  const end = () => {
    bot.removeListener('blockUpdate', update)
    bot.removeListener('chunkColumnLoad', chunk)
    bot.removeListener('chunkColumnUnload', chunk)
    bot.removeListener('respawn', reset)
    sessions.delete(bot)
  }
  bot.on('blockUpdate', update)
  bot.on('chunkColumnLoad', chunk)
  bot.on('chunkColumnUnload', chunk)
  bot.on('respawn', reset)
  bot.once('end', end)
  sessions.set(bot, s)
  return s
}
function cancelled(signal) {
  if (signal?.aborted) throw failure('CANCELLED', 'Terrain observation cancelled')
}
function optionsFor(options) {
  const radius = options.radius ?? 64, step = options.step ?? 1, maxMs = options.maxMs ?? 1000
  if (!Number.isInteger(radius) || radius < 0 || radius > 128 ||
      !Number.isInteger(step) || step < 1 || step > 32 || !Number.isFinite(maxMs) || maxMs < 0 ||
      (options.signal !== undefined && (typeof options.signal?.aborted !== 'boolean' || typeof options.signal?.addEventListener !== 'function'))) {
    throw failure('INVALID_ARGUMENT', 'radius: integer 0..128; step: integer 1..32; maxMs: finite >=0; signal: AbortSignal')
  }
  return { radius, step, maxMs, signal: options.signal }
}

async function observeTerrain(bot, options = {}) {
  const started = performance.now(), { radius, step, maxMs, signal } = optionsFor(options)
  cancelled(signal)
  if (!bot.world?.getColumn || !bot.registry?.blocksByStateId ||
      !Number.isInteger(bot.game?.minY) || !Number.isInteger(bot.game?.height) || bot.game.height <= 0) {
    throw failure('BOT_NOT_READY', 'Loaded world, registry and dimension bounds required')
  }
  const s = session(bot), minY = bot.game.minY, height = bot.game.height
  const world = bot.world, registry = bot.registry
  if (s.world !== bot.world || s.registry !== bot.registry || s.minY !== minY || s.height !== height) {
    s.chunks.clear(); Object.assign(s, { world: bot.world, registry: bot.registry, minY, height })
  }
  const center = { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) }
  const size = Math.floor(2 * radius / step) + 1, total = size * size
  const x0 = center.x - radius, z0 = center.z - radius
  const cells = [], names = [null], nameIds = new Map()
  let known = 0, unloaded = 0, processed = 0, reads = 0, cacheHits = 0, timedOut = false
  let sliceEnd = performance.now() + 2, work = 0
  const deadline = started + maxMs
  const nameId = name => {
    if (!name) return 0
    if (!nameIds.has(name)) { nameIds.set(name, names.length); names.push(name) }
    return nameIds.get(name)
  }
  // Yield for both vertical reads and cached projection; large warm grids also stay cooperative.
  const pause = () => {
    if (++work % 128 !== 0) return null
    cancelled(signal)
    if (performance.now() >= deadline) return true
    if (performance.now() < sliceEnd) return null
    return immediate().then(() => { sliceEnd = performance.now() + 2 })
  }
  const checkWorld = () => {
    cancelled(signal)
    if (bot.world !== world || bot.registry !== registry || bot.game.minY !== minY || bot.game.height !== height) {
      throw failure('BOT_NOT_READY', 'World or dimension changed during terrain observation; retry after spawn')
    }
  }
  outer: for (let index = 0; index < total; index++) {
    const x = x0 + (index % size) * step, z = z0 + Math.floor(index / size) * step
    for (;;) {
      cancelled(signal)
      if (performance.now() >= deadline) { timedOut = true; break outer }
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16), key = `${cx},${cz}`
      const column = bot.world.getColumn(cx, cz)
      if (!column) {
        s.chunks.delete(key); cells.push(null); unloaded++; processed++
        const rest = pause()
        if (rest) {
          if (rest !== true) await rest
          checkWorld()
          if (performance.now() >= deadline) { timedOut = processed < total; break outer }
        }
        break
      }
      let chunk = s.chunks.get(key)
      if (!chunk || chunk.column !== column) {
        chunk = { column, cells: new Map() }; s.chunks.set(key, chunk)
        // Bound memory even if a caller roams through many loaded chunks.
        if (s.chunks.size > 512) s.chunks.delete(s.chunks.keys().next().value)
      } else { s.chunks.delete(key); s.chunks.set(key, chunk) }
      const local = (z & 15) * 16 + (x & 15)
      let cell = chunk.cells.get(local)
      if (!cell) {
        cell = { y: minY + height - 1, top: null, ground: null, fluid: null, done: false }
        chunk.cells.set(local, cell)
      } else if (cell.done) cacheHits++
      const p = { x: x & 15, y: cell.y, z: z & 15 }
      let invalidated = false
      while (!cell.done) {
        p.y = cell.y--
        const block = bot.registry.blocksByStateId[column.getBlockStateId(p)]
        reads++
        if (!block) throw failure('INTERNAL_ERROR', 'Unknown block state in terrain column')
        if (!air.has(block.name)) {
          const value = { y: p.y, name: block.name }
          if (!cell.top) cell.top = value
          if (!cell.fluid && (block.name === 'water' || block.name === 'lava')) cell.fluid = value
          if (ground(block)) { cell.ground = value; cell.done = true }
        }
        if (cell.y < minY) cell.done = true
        const rest = pause()
        if (rest) {
          if (rest !== true) await rest
          checkWorld()
          if (performance.now() >= deadline) { timedOut = true; break outer }
          // Updates/unload/reset received while yielding must discard the partial column.
          if (s.chunks.get(key) !== chunk || chunk.cells.get(local) !== cell) { invalidated = true; break }
        }
      }
      if (invalidated) continue
      cells.push([cell.ground?.y ?? null, nameId(cell.ground?.name), cell.top?.y ?? null,
        nameId(cell.top?.name), cell.fluid?.y ?? null, nameId(cell.fluid?.name)])
      known++; processed++
      const rest = pause()
      if (rest) {
        if (rest !== true) await rest
        checkWorld()
        if (performance.now() >= deadline) { timedOut = processed < total; break outer }
      }
      break
    }
  }
  // Padding is bounded (66049 cells) and allocated without a synchronous projection pass.
  cells.length = total
  cells.fill(null, processed)
  cancelled(signal)
  return { center, radius, step, width: size, height: size,
    bounds: { minX: x0, maxX: x0 + (size - 1) * step, minZ: z0, maxZ: z0 + (size - 1) * step, minY, maxY: minY + height - 1 },
    order: 'north-to-south rows, west-to-east columns',
    fields: ['groundY', 'groundName', 'topY', 'topName', 'fluidY', 'fluidName'], names, cells,
    known, unknown: total - known, unknownRatio: (total - known) / total, unloaded, pending: total - processed,
    timedOut, complete: processed === total, reads, cacheHits, durationMs: performance.now() - started }
}

// Internal test/measurement hook; the public API uses world events for invalidation.
module.exports = { observeTerrain, clearTerrainCache: bot => sessions.get(bot)?.chunks.clear() }
