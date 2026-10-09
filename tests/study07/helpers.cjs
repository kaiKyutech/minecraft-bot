const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const root = path.resolve(__dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => JSON.parse(JSON.stringify(value));

async function rcon(world, commands) {
  const filename = world === 'flat'
    ? path.resolve(root, '../minecraft-server-vanilla/server.properties')
    : path.resolve(root, '.cache/minecraft-bot/07-study/server/server.properties');
  const props = Object.fromEntries(fs.readFileSync(filename, 'utf8').split(/\r?\n/)
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const socket = net.connect(Number(props['rcon.port']), '127.0.0.1');
  const pending = new Map(); let buffer = Buffer.alloc(0); let id = 1;
  socket.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
      const length = buffer.readInt32LE(0), responseId = buffer.readInt32LE(4);
      const body = buffer.toString('utf8', 12, length + 2);
      buffer = buffer.subarray(length + 4);
      if (responseId === -1) pending.get(1)?.reject(new Error('RCON authentication failed'));
      else pending.get(responseId)?.resolve(body);
    }
  });
  const send = (type, body) => new Promise((resolve, reject) => {
    const requestId = id++, bytes = Buffer.from(body), packet = Buffer.alloc(bytes.length + 14);
    packet.writeInt32LE(bytes.length + 10, 0); packet.writeInt32LE(requestId, 4);
    packet.writeInt32LE(type, 8); bytes.copy(packet, 12);
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('RCON timeout')); }, 10000);
    pending.set(requestId, { resolve: result => { clearTimeout(timer); pending.delete(requestId); resolve(result); },
      reject: error => { clearTimeout(timer); pending.delete(requestId); reject(error); } });
    socket.write(packet);
  });
  try {
    await once(socket, 'connect'); await send(3, props['rcon.password']);
    const results = [];
    for (const command of commands) results.push({ command, response: await send(2, command) });
    return results;
  } finally { socket.destroy(); }
}

async function connect(world, username, options = {}) {
  const { createAIBot } = require('../../planner_bot/src/bot/ai_bot');
  const bot = createAIBot(1, { host: '127.0.0.1', port: world === 'flat' ? 25565 : 25567,
    username, version: '1.20.1', aiBotCount: 1 }, options);
  let timeout;
  try {
    await Promise.race([once(bot, 'spawn'), new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('spawn timeout')),30000);})]);
    clearTimeout(timeout);
    await wait(2000); return bot;
  } catch (error) { clearTimeout(timeout);bot.quit(); throw error; }
}

// Keep the historical tracked domain byte-for-byte during observations.
// Refactored generators now write only into the versioned cache.
function preserveGenerated() {
  const dir = path.join(root, 'planner_bot/config/actions_generated');
  const files = new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]));
  return () => {
    for (const name of fs.readdirSync(dir)) if (!files.has(name)) fs.unlinkSync(path.join(dir, name));
    for (const [name, bytes] of files) fs.writeFileSync(path.join(dir, name), bytes);
  };
}
module.exports = { root, wait, clean, rcon, connect, preserveGenerated };
