// Manual observation recorder. Never launches a browser or a viewer.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const util = require('node:util');
const { performance } = require('node:perf_hooks');
const { root, wait, clean, rcon, connect, preserveGenerated } = require('../helpers/live');
const out = path.join(root, 'tests/fixtures'); fs.mkdirSync(out, { recursive: true });
const world = process.argv[2] || 'flat';
const transcript = [];
let active = null;
const originalLog = console.log, originalWarn = console.warn, originalError = console.error;
for (const name of ['log', 'warn', 'error']) console[name] = (...args) => {
  const line = util.format(...args); if (active) active.logs.push(line);
};
const goals = ['oak_planks:4','stick:4','crafting_table:1','wooden_pickaxe:1','wooden_sword:1',
  'stone_pickaxe:1','furnace:1','torch:4','iron_ingot:3','iron_pickaxe:1','diamond_pickaxe:1','chest:1','bread:1','cake:1'].map(x => `inventory.${x}`);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const restore = preserveGenerated();
let bot, peer;
async function record(input, fn) {
  const entry = { world, input, logs: [] }; active = entry;
  const before = bot && clean({ position: bot.entity.position, items: bot.inventory.items().map(i => ({name:i.name,count:i.count})), yaw:bot.entity.yaw, pitch:bot.entity.pitch });
  const start = performance.now();
  try { const value = await fn(); entry.returned = value === undefined ? { $undefined: true } : clean(value); }
  catch (error) { entry.thrown = { name: error.name, message: error.message }; }
  entry.durationMs = performance.now() - start; entry.before = before;
  if (bot) entry.after = clean({ position: bot.entity.position, items: bot.inventory.items().map(i => ({name:i.name,count:i.count})), yaw:bot.entity.yaw, pitch:bot.entity.pitch });
  transcript.push(entry); active = null;
  originalLog(`[OBSERVE ${world}] ${input}: ${entry.thrown ? entry.thrown.message : 'returned'} (${Math.round(entry.durationMs)}ms)`);
  return entry;
}
async function setup(commands) { const result = await rcon(world, commands); await wait(350); return result; }
async function snapshot(label) {
  const sm = bot.stateManager; sm.silentRefresh = true;
  await record(`stateManager.refresh / ${label}`, () => sm.refresh(bot));
  const state = clean(await sm.getState(bot));
  fs.writeFileSync(path.join(out, `${world}-${label}.json.gz`), zlib.gzipSync(JSON.stringify(state)));
  const planner = require('../../planner_bot/src/planner/goap');
  const expected = {};
  for (const goal of goals) expected[goal] = (await record(`goap.plan ${label} ${goal}`, () => planner.plan(goal, state, quiet))).returned;
  fs.writeFileSync(path.join(out, `${world}-${label}-plans.json`), JSON.stringify(expected, null, 2));
}
async function main() {
  bot = await connect(world, `Survey${world}`);
  const { handleChatCommand } = require('../../planner_bot/src/commands');
  const command = message => record(message, () => handleChatCommand(bot, 'SurveyPeer', message, bot.stateManager));
  await setup([`clear ${bot.username}`]);
  if (world === 'flat') await setup([`tp ${bot.username} 10 -60 6`]);
  // Generate from the negotiated server version before loading the planner domain.
  for (const [file, fn] of [['gather','ensureGatherActionsGenerated'],['craft','ensureCraftActionsGenerated'],['equipment','ensureEquipmentActionsGenerated']])
    await record(`generate ${file} 1.20.1`, () => require(`../../planner_bot/src/planner/${file}_generator`)[fn](bot.version));
  await snapshot('empty');
  const spawn = bot.entity.position.floored();
  await setup([`give ${bot.username} oak_log 3`, `give ${bot.username} wooden_pickaxe`, `give ${bot.username} coal 2`]);
  await snapshot('stocked');
  if (world === 'natural') {
    for (const target of ['wooden_pickaxe','stone_pickaxe','furnace']) {
      await setup([`clear ${bot.username}`, `tp ${bot.username} ${spawn.x} ${spawn.y} ${spawn.z}`]);
      const pending = command(`!goal inventory.${target}:1`);
      const timer = setTimeout(() => handleChatCommand(bot,'SurveyPeer','!stop',bot.stateManager), 90000);
      await pending; clearTimeout(timer);
    }
    return;
  }
  // A repeatable isolated flat arena, away from previous structures.
  await setup(['fill 190 -61 190 220 -61 220 grass_block','fill 190 -60 190 220 -56 220 air',
    `tp ${bot.username} 200 -60 200`,`clear ${bot.username}`,'setblock 202 -60 200 chest',
    'setblock 204 -60 200 crafting_table','setblock 202 -60 202 furnace']);
  peer = await connect(world, 'SurveyPeer', {autoHandleWhisper:false});
  await setup(['tp SurveyPeer 200 -60 204']);
  for (const message of ['!status','!refresh','!info all','!info','!info absent','!info all {',
    '!info recipesFor {"item":"wooden_pickaxe"}','!info recipesFor {"item":"absent"}',
    '!info recipesUsing {"ingredients":["oak_planks","stick"]}','!info recipesUsing {"ingredient":"stick","mode":"or"}',
    '!info recipesFor {}','!info scanBlocks {"range":6,"maxChecks":-1,"yaw":90,"coneAngle":30}',
    '!navigation','!navigation absent {}','!navigation gotoCoords {"x":1,"y":2,"z":3}',
    '!navigation goto {"name":"absent"}','!navigation register {"name":"home"}',
    '!navigation register {"name":"table","blockType":"crafting_table"}',
    '!navigation register {"name":"point","coords":[206,-60,200]}','!navigation goto {"name":"point"}',
    '!navigation gotoCoords {"coords":[200,-60,200]}']) await command(message);
  for (const verticalMode of ['nearest','above','below','surface']) {
    await setup([`tp ${bot.username} 200 -60 200`]);
    await command(`!navigation moveInDirection ${JSON.stringify({yaw:90,distance:2,verticalMode})}`);
  }
  await setup([`tp ${bot.username} 200 -60 200`]);
  for (const message of ['!navigation follow {"username":"SurveyPeer"}','!navigation stopFollow {}',
    '!navigation stopFollow {}','!navigation follow {"username":"absent"}',
    '!look direction {"yaw":90,"pitch":15}','!look player {"username":"SurveyPeer"}',
    '!look watch {"username":"SurveyPeer","intervalMs":200}','!stop',
    '!look direction {}','!look player {"username":"absent"}',
    '!idle_on {"intervalMs":200,"playerLookChance":1}','!stop','!stop',
    '!chat SurveyPeer hello','!chat {"username":"SurveyPeer","message":"hello json","maxDistance":150}',
    '!chat absent hello','!chat {','!chat SurveyPeer','!echo echo-test','!history','!history SurveyPeer,Surveyflat',
    '!idle','!goal','!unknown']) await command(message);
  await record('natural whisper / event', async () => {
    const event = new Promise(resolve => bot.once('newNaturalMessage', resolve));
    peer.whisper(bot.username, 'natural-test'); return await event;
  });
  await record('command whisper auto handling', async () => {
    peer.whisper(bot.username,'!history'); await wait(500); return {history:bot.getConversationHistory(), lastCommandName:bot.lastCommandName};
  });
  await record('addMessage / filters / FIFO', async () => {
    bot.addMessage('SurveyPeer','human','conversation'); bot.addMessage(bot.username,{message:'bot'},'system_info');
    const filtered = bot.getConversationHistory({username:'SurveyPeer'});
    for(let i=0;i<101;i++) bot.addMessage(bot.username,`fifo ${i}`,'conversation');
    return {filtered, count:bot.getConversationHistory().length, first:bot.getConversationHistory()[0], latestSequence:bot.conversationSequence};
  });
  await setup([`give ${bot.username} oak_planks 32`,`give ${bot.username} cobblestone 4`, `give ${bot.username} iron_helmet`, `give ${bot.username} coal 2`, `give ${bot.username} raw_iron 1`, `give ${bot.username} oak_log 2`]);
  for (const message of ['!navigation chestDeposit {"item":"oak_planks"}',
    '!navigation chestOpen {"coords":[200,-61,200]}','!navigation chestOpen {"coords":[202,-60,200]}',
    '!navigation chestDeposit {"item":"oak_planks","count":3}','!navigation chestWithdraw {"item":"oak_planks","count":1}',
    '!navigation chestWithdraw {"item":"oak_planks","count":-1}',
    '!navigation chestWithdraw {"item":"diamond"}','!navigation chestClose {}','!navigation chestClose {}',
    '!navigation dropItem {"itemName":"cobblestone","count":1}',
    '!navigation pickupItems {"range":6}','!navigation pickupItems {"range":1,"itemName":"diamond"}',
    '!navigation dropItem {"itemName":"cobblestone","targetPlayer":"SurveyPeer"}',
    '!navigation dropItem {"itemName":"diamond"}',
    '!creative placeBlock {"name":"oak_planks","coords":[200,-60,198]}',
    '!creative placeBlock {"name":"oak_planks","coords":[200,-61,198]}',
    '!creative placeBlock {"name":"oak_planks"}','!creative placeBlock {}','!creative absent {}']) await command(message);
  for (const message of ['!skill','!skill absent','!skill gather {','!primitive','!primitive absent','!primitive move_to {',
    '!skill hand_craft {"recipe":"stick","count":1}',
    '!skill workbench_craft {"recipe":"wooden_pickaxe","count":1}',
    '!skill equip_mainhand {"item":"wooden_pickaxe"}',
    '!skill equip_armor {"item":"iron_helmet","slot":"head"}',
    '!skill move_to {"blockType":"furnace"}',
    '!skill furnace_smelt {"input":"raw_iron","fuel":"coal","output":"iron_ingot"}',
    '!skill place_block {"blockName":"oak_planks"}',
    '!skill gather {"itemName":"oak_log","count":1,"maxDistance":8,"maxAttempts":2}',
    '!skill collect_drops {"radius":3,"maxAttempts":1}',
    '!primitive find_block {"match":"crafting_table","maxDistance":12}',
    '!primitive find_blocks {"match":["furnace","chest"],"count":2,"maxDistance":12}',
    '!primitive equip_item {"itemName":"wooden_pickaxe"}',
    '!primitive craft_item {"itemName":"stick"}',
    '!primitive move_to {"x":200,"y":-60,"z":200,"range":2,"timeout":2000}',
    '!primitive collect_drops {"radius":3}','!primitive dig_block {"x":200,"y":-60,"z":198}',
    '!primitive place_block {"reference":{"x":199,"y":-61,"z":198}}']) await command(message);
  await setup([`clear ${bot.username}`,`tp ${bot.username} 200 -60 200`,'setblock 198 -60 200 oak_log']);
  await command('!skill gather {"itemName":"oak_log","count":1,"maxDistance":8,"maxAttempts":2}');
  await command('!goal inventory.stick:4');
  await command('!goal absent_goal');
  await command('!goal inventory.cake:1');
  // Cancel a real multi-step task shortly after it starts.
  await setup([`clear ${bot.username}`,'fill 193 -60 203 193 -56 203 oak_log']);
  await record('!goal inventory.wooden_pickaxe:1 + !stop (300ms)', async () => {
    const running = handleChatCommand(bot,'SurveyPeer','!goal inventory.wooden_pickaxe:1',bot.stateManager);
    await wait(300); const stopped = await handleChatCommand(bot,'SurveyPeer','!stop',bot.stateManager);
    return {stopped, goalResult:await running};
  });
  // Underground and narrow chamber, with an explicit short primitive timeout.
  await setup(['fill 200 -63 200 204 -63 204 stone','fill 200 -62 200 204 -62 204 air',`tp ${bot.username} 202 -62 202`]);
  await snapshot('underground');
  await command('!primitive move_to {"x":202,"y":-60,"z":202,"timeout":1000}');
  await command('!stop');
}
main().catch(error => { originalError(error); process.exitCode=1; }).finally(async () => {
  fs.writeFileSync(path.join(out, `${world}-observations.json.gz`), zlib.gzipSync(JSON.stringify(transcript)));
  if(bot) { try { await require('../../planner_bot/src/commands').handleChatCommand(bot,'SurveyPeer','!stop',bot.stateManager); } catch {} bot.quit(); }
  peer?.quit(); restore();
  console.log=originalLog; console.warn=originalWarn; console.error=originalError;
  setTimeout(() => process.exit(process.exitCode || 0), 500);
});
