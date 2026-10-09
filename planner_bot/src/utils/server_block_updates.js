const minecraftData = require('minecraft-data')
const { interruptible } = require('./context')
const { failure } = require('./result')

// blockUpdate also fires for mineflayer's optimistic local changes. Only these
// incoming protocol packets are evidence of the server's state at this position.
function watchServerBlock(bot, position) {
  if (!bot._client?.on) throw failure('BOT_NOT_READY', 'Server block updates are unavailable')
  const data = bot.registry || minecraftData(bot.version)
  const air = new Set(['air', 'cave_air', 'void_air'].flatMap(name => {
    const block = data.blocksByName[name]
    return block ? Array.from({length: block.maxStateId - block.minStateId + 1}, (_, i) => block.minStateId + i) : []
  }))
  let stateId = null
  const update = (x, y, z, state) => {
    if (x === position.x && y === position.y && z === position.z) stateId = state
  }
  const single = p => update(p.location.x, p.location.y, p.location.z, p.type)
  const multiple = p => {
    const packed = bot.supportFeature('usesMultiblockSingleLong')
    const section = bot.supportFeature('usesMultiblock3DChunkCoords')
    const c = section ? p.chunkCoordinates : {x:p.chunkX, y:0, z:p.chunkZ}
    for (const r of p.records) {
      const v = packed ? BigInt(r) : null
      update(c.x * 16 + (packed ? Number((v >> 8n) & 15n) : r.horizontalPos >> 4),
        c.y * 16 + (packed ? Number(v & 15n) : r.y),
        c.z * 16 + (packed ? Number((v >> 4n) & 15n) : r.horizontalPos & 15),
        packed ? Number(v >> 12n) : r.blockId)
    }
  }
  bot._client.on('block_change', single)
  bot._client.on('multi_block_change', multiple)
  return {
    get stateId() { return stateId },
    get isAir() { return air.has(stateId) },
    async waitForAir(maxMs) {
      const deadline = Date.now() + maxMs
      while (!air.has(stateId) && Date.now() < deadline) {
        await interruptible(bot, () => new Promise(resolve => setTimeout(resolve, 25)))
      }
      return air.has(stateId)
    },
    close() {
      bot._client.removeListener('block_change', single)
      bot._client.removeListener('multi_block_change', multiple)
    }
  }
}
module.exports = { watchServerBlock }
