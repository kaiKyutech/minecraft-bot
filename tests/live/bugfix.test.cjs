const {test}=require('node:test');const assert=require('node:assert/strict');const {Vec3}=require('vec3');
const {connect,rcon,wait}=require('../helpers/live');const {createBotApi}=require('../../planner_bot/api');
process.env.LOG_LEVEL='error';
test('02 flat: all-stack chest transfer, grass fallback and movement timeout',{timeout:90000},async()=>{
 const bot=await connect('flat','Bugfix02');const api=createBotApi(bot,{logLevel:'error'});
 const setup=async commands=>{await rcon('flat',commands);await wait(500)};
 try{
  await setup(['tp Bugfix02 800 -60 800']);await wait(1200);
  await setup(['fill 793 -61 793 810 -61 810 stone','fill 793 -60 793 810 -54 810 air','setblock 802 -60 800 chest','clear Bugfix02','give Bugfix02 oak_planks 130']);
  assert.equal((await api.navigate('chestOpen',{coords:[802,-60,800]})).ok,true);
  assert.equal((await api.navigate('chestDeposit',{item:'oak_planks',count:-1})).data.count,130);
  assert.equal((await api.navigate('chestWithdraw',{item:'oak_planks',count:1})).data.count,1);
  assert.equal((await api.navigate('chestWithdraw',{item:'oak_planks',count:-1})).data.count,129);
  assert.equal((await api.navigate('chestWithdraw',{item:'oak_planks',count:-1})).ok,false);
  await api.navigate('chestClose');
  await setup(['setblock 802 -60 800 chest[facing=north,type=left]','setblock 803 -60 800 chest[facing=north,type=right]','clear Bugfix02','give Bugfix02 oak_planks 130']);
  assert.equal((await api.navigate('chestOpen',{coords:[802,-60,800]})).data.chest.totalSlots,54);
  assert.equal((await api.navigate('chestDeposit',{item:'oak_planks',count:-1})).data.count,130);
  assert.equal((await api.navigate('chestWithdraw',{item:'oak_planks',count:-1})).data.count,130);
  await api.navigate('chestClose');
  await setup(['clear Bugfix02','give Bugfix02 crafting_table','fill 798 -60 798 802 -60 802 grass','setblock 800 -60 800 air','tp Bugfix02 800.5 -60 800.5']);
  const placed=await api.executeSkill('place_block',{blockName:'crafting_table'});assert.equal(placed.ok,true,JSON.stringify(placed));
  assert.ok(bot.findBlock({matching:b=>b.name==='crafting_table',maxDistance:5}));
  const timeout=await api.executePrimitive('moveTo',{x:1200,y:-60,z:1200,timeout:50});
  assert.equal(timeout.ok,false);assert.equal(timeout.error.code,'TIMEOUT');assert.equal(bot.pathfinder.goal,null);
  const position=bot.entity.position.clone();await wait(500);assert.ok(position.distanceTo(bot.entity.position)<.5);
 }catch(error){console.error(error);throw error}finally{await api.stop();bot.quit()}
});
test('02 underground: one-block passage places furnace and smelts or fails finitely',{timeout:60000},async()=>{
 const bot=await connect('natural','BugfixIron02');const api=createBotApi(bot,{logLevel:'error'});
 try{
  await rcon('natural',['tp BugfixIron02 900 16 900']);await wait(1800);
  await rcon('natural',['fill 896 15 896 904 20 904 stone','fill 900 16 896 900 17 904 air','tp BugfixIron02 900.5 16 900.5','clear BugfixIron02','give BugfixIron02 furnace','give BugfixIron02 raw_iron 3','give BugfixIron02 acacia_planks 3','give BugfixIron02 cobblestone 12','give BugfixIron02 wooden_pickaxe','give BugfixIron02 stone_pickaxe']);await wait(500);
  const start=Date.now();const result=await api.executeGoal('inventory.iron_ingot:1',{signal:AbortSignal.timeout(45000)});
  assert.ok(result.ok||result.error.code==='REPEATED_FAILURE',JSON.stringify(result));
  if(result.ok)assert.ok(bot.inventory.items().some(i=>i.name==='iron_ingot'));console.log('02 tunnel',Date.now()-start,JSON.stringify(result));
 }finally{await api.stop();bot.quit()}
});
test('02 fallback: snow, cave air and an upper niche remain usable after six legacy candidates fail',{timeout:45000},async()=>{
 const bot=await connect('flat','PlacePolicy02'),api=createBotApi(bot,{logLevel:'error'});
 try{
  await rcon('flat',['tp PlacePolicy02 1200 -60 1200']);await wait(1200);
  for(const replacement of ['snow[layers=1]','cave_air']){
   await rcon('flat',['fill 1196 -61 1196 1204 -61 1204 stone','fill 1196 -60 1196 1204 -57 1204 air',`fill 1198 -60 1198 1202 -60 1202 ${replacement}`,'setblock 1200 -60 1200 air','clear PlacePolicy02','give PlacePolicy02 furnace','tp PlacePolicy02 1200.5 -60 1200.5']);await wait(400);
   const result=await api.executeSkill('place_block',{blockName:'furnace'});assert.equal(result.ok,true,JSON.stringify(result));
  }
  await rcon('flat',['fill 1198 -61 1198 1202 -57 1202 stone','fill 1200 -60 1200 1200 -59 1200 air','setblock 1201 -59 1200 air','clear PlacePolicy02','give PlacePolicy02 furnace','tp PlacePolicy02 1200.5 -60 1200.5']);await wait(400);
  const result=await api.executeSkill('place_block',{blockName:'furnace'});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(bot.blockAt(new Vec3(1201,-59,1200)).name,'furnace');
 }finally{await api.stop();bot.quit()}
});
