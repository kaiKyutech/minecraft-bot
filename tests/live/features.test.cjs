const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {root,wait,rcon,connect,preserveGenerated,clean}=require('../helpers/live');
const {handleChatCommand}=require('../../planner_bot/src/commands');
const primitives=require('../../planner_bot/src/primitives');
const {Vec3}=require('vec3');
process.env.LOG_LEVEL='error';process.env.LOG_COMMANDS='none';

// Requires the two authorized test servers. Does not start/stop servers or use GPU.
test('flat: repeatable command, skill, primitive and GOAP features',{timeout:180000},async t=>{
  const restore=preserveGenerated();let bot,peer;const results=[];const check=async(name,fn)=>{const start=Date.now();await fn();t.diagnostic(name+": "+(Date.now()-start)+"ms");};
  const setup=async commands=>{const output=await rcon('flat',commands);for(const row of output)assert.doesNotMatch(row.response,/Unknown or incomplete|Too many blocks/);await wait(600);};
  try{
    bot=await connect('flat','RegressionFlat');peer=await connect('flat','RegressionPeer',{autoHandleWhisper:false});
    const run=async message=>{
      const start=Date.now();const value=await handleChatCommand(bot,'RegressionPeer',message,bot.stateManager);
      assert.equal(typeof value.ok,'boolean');assert.ok(Object.hasOwn(value,'data'));assert.ok(Object.hasOwn(value,'error'));
      results.push({input:message,durationMs:Date.now()-start,returned:value===undefined?{$undefined:true}:clean(value)});return value;
    };
    await setup(['tp RegressionFlat 300 -60 300','tp RegressionPeer 300 -60 304']);await wait(1500);
    await setup(['fill 290 -61 290 318 -61 318 grass_block','fill 290 -60 290 318 -55 318 air',
      'tp RegressionFlat 300 -60 300','tp RegressionPeer 300 -60 304','clear RegressionFlat',
      'setblock 302 -60 300 chest','setblock 304 -60 300 crafting_table','setblock 302 -60 302 furnace',
      'give RegressionFlat oak_planks 40','give RegressionFlat oak_log 2','give RegressionFlat cobblestone 4',
      'give RegressionFlat iron_helmet','give RegressionFlat raw_iron','give RegressionFlat coal 2']);
    await check('info, recipes, status and west scanning',async()=>{
      assert.equal((await run('!info all')).ok,true);assert.equal((await run('!status')).ok,true);
      assert.ok((await run('!info recipesFor {"item":"wooden_pickaxe"}')).data.recipes.length);
      assert.ok((await run('!info recipesUsing {"ingredients":["stick"]}')).data.results.length);
      const scan=await run('!info scanBlocks {"range":5,"yaw":90,"coneAngle":30,"maxChecks":-1}');
      assert.ok(scan.data.blocks.every(b=>b.relativePosition.x<=0));
    });
    await check('named locations, coordinates, following and direction',async()=>{
      assert.equal((await run('!navigation register {"name":"home"}')).ok,true);
      await run('!navigation register {"name":"point","coords":[306,-60,300]}');
      assert.equal((await run('!navigation goto {"name":"point"}')).ok,true);
      assert.equal((await run('!navigation gotoCoords {"coords":[300,-60,300]}')).ok,true);
      for(const mode of ['nearest','below','surface']){
        await setup(['tp RegressionFlat 300 -60 300']);
        assert.equal((await run(`!navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"${mode}"}`)).ok,true);
      }
      const above=await run('!navigation moveInDirection {"yaw":90,"distance":2,"verticalMode":"above"}');assert.equal(above.ok,false);assert.match(above.error.message,/上に立てる地面/);
      await setup(['tp RegressionFlat 300 -60 300']);
      assert.equal((await run('!navigation follow {"username":"RegressionPeer"}')).ok,true);
      assert.equal((await run('!navigation stopFollow {}')).data.message,'追跡していません');assert.equal(bot.followTarget,null);
    });
    await check('look, watch, idle and stop',async()=>{
      assert.equal((await run('!look direction {"yaw":90,"pitch":10}')).ok,true);
      assert.equal((await run('!look player {"username":"RegressionPeer"}')).ok,true);
      await run('!look watch {"username":"RegressionPeer","intervalMs":200}');await wait(250);
      assert.ok((await run('!stop')).data.stoppedActions.includes('look_watch'));
      await run('!idle_on {"intervalMs":200}');await wait(250);assert.ok((await run('!stop')).data.stoppedActions.includes('idle'));
    });
    await check('whisper event, chat, echo, explicit history',async()=>{
      const event=new Promise(resolve=>bot.once('newNaturalMessage',resolve));peer.whisper(bot.username,'regression hello');
      assert.equal((await event).content,'regression hello');assert.equal(bot.getConversationHistory().length,0);
      assert.equal((await run('!chat RegressionPeer hello')).ok,true);
      assert.equal((await run('!echo hello')).ok,true);assert.equal((await run('!history')).data.count,0);
      bot.addMessage('RegressionPeer','explicit','conversation');assert.equal((await run('!history RegressionPeer')).data.count,1);
    });
    await check('open chest, deposit, withdraw, close and stopping an open chest',async()=>{
      assert.equal((await run('!navigation chestOpen {"coords":[302,-60,300]}')).data.chest.totalSlots,27);
      assert.equal((await run('!navigation chestDeposit {"item":"oak_planks","count":3}')).data.count,3);await wait(200);
      assert.equal((await run('!navigation chestWithdraw {"item":"oak_planks","count":1}')).data.count,1);await wait(200);
      assert.equal((await run('!navigation chestClose {}')).ok,true);
      await run('!navigation chestOpen {"coords":[302,-60,300]}');assert.ok((await run('!stop')).data.stoppedActions.includes('chest'));
      await run('!navigation chestOpen {"coords":[302,-60,300]}');assert.equal((await run('!chat RegressionPeer closes chest')).ok,true);assert.equal(bot.currentChest,null);
    });
    await check('drop and pickup physically recover an RCON item entity',async()=>{
      assert.equal((await run('!navigation dropItem {"itemName":"cobblestone"}')).data.droppedCount,1);
      assert.equal((await run('!navigation dropItem {"targetPlayer":"RegressionPeer","itemName":"cobblestone"}')).data.droppedCount,1);
      await setup(['summon item 300 -60 302 {Item:{id:"minecraft:diamond",Count:1b},PickupDelay:0s}']);
      assert.equal((await run('!navigation pickupItems {"range":6,"itemName":"diamond"}')).ok,true);
      await wait(300);assert.ok(bot.inventory.items().some(i=>i.name==='diamond'));
    });
    await check('creative and skill placements, hand/workbench craft and equipment',async()=>{
      await setup(['tp RegressionFlat 300 -60 300']);
      assert.equal((await run('!creative placeBlock {"name":"oak_planks","coords":[300,-60,298]}')).ok,true);
      assert.equal(bot.blockAt(new Vec3(300,-60,298)).name,'oak_planks');
      assert.equal((await run('!creative placeBlock {"name":"oak_planks","coords":[300,-60,298]}')).error.code,'PLACEMENT_FAILED');
      assert.equal((await run('!creative placeBlock {"name":"oak_planks"}')).ok,true);
      assert.equal((await run('!skill hand_craft {"recipe":"stick","count":1}')).ok,true);
      assert.equal((await run('!skill workbench_craft {"recipe":"wooden_pickaxe"}')).ok,true);
      await run('!skill equip_mainhand {"item":"wooden_pickaxe"}');assert.equal(bot.heldItem.name,'wooden_pickaxe');
      await run('!skill equip_armor {"item":"iron_helmet","slot":"helmet"}');assert.equal(bot.inventory.slots[5].name,'iron_helmet');
      await run('!skill place_block {"blockName":"oak_planks"}');
    });
    await check('move, smelt, gather and collect skills',async()=>{
      await run('!skill move_to {"blockType":"furnace"}');
      await run('!skill furnace_smelt {"input":"raw_iron","fuel":"coal","output":"iron_ingot"}');
      assert.ok(bot.inventory.items().some(i=>i.name==='iron_ingot'));
      await setup(['tp RegressionFlat 300 -60 300','setblock 298 -60 300 oak_log']);
      await run('!skill gather {"itemName":"oak_log","maxDistance":5,"maxAttempts":2}');
      assert.equal(bot.blockAt(new Vec3(298,-60,300)).name,'air');await run('!skill collect_drops {"radius":3,"maxAttempts":1}');
    });
    await check('primitives, direct find/tool helper APIs and missing inputs',async()=>{
      for(const input of ['!primitive find_block {"match":"crafting_table","maxDistance":12}',
        '!primitive find_blocks {"match":["chest","furnace"],"count":2,"maxDistance":12}',
        '!primitive equip_item {"itemName":"wooden_pickaxe"}', '!primitive craft_item {"itemName":"stick"}',
        '!primitive move_to {"x":300,"y":-60,"z":300,"range":2,"timeout":2000}',
        '!primitive collect_drops {"radius":3}'])assert.equal((await run(input)).ok,true);
      await setup(['setblock 300 -60 298 oak_planks']);
      await run('!primitive dig_block {"x":300,"y":-60,"z":298}');assert.equal(bot.blockAt(new Vec3(300,-60,298)).name,'air');
      await run('!primitive equip_item {"itemName":"oak_planks"}');
      await run('!primitive place_block {"reference":{"x":299,"y":-61,"z":298}}');assert.equal(bot.blockAt(new Vec3(299,-60,298)).name,'oak_planks');
      const block=bot.blockAt(new Vec3(302,-60,300));const best=await primitives.findBestTool(bot,block);await primitives.equipBestToolForBlock(bot,block);
      results.push({input:'findBestTool / equipBestToolForBlock chest',returned:best?{name:best.name}:null});
      assert.equal((await run('!primitive craft_item {}')).error.code,'INVALID_ARGUMENT');
    });
    await check('GOAP success, impossible goal and interruption',async()=>{
      assert.equal((await run('!goal inventory.stick:4')).ok,true);
      assert.equal((await run('!goal inventory.cake:1')).ok,false);
      await setup(['clear RegressionFlat','fill 294 -60 304 294 -56 304 oak_log']);
      const goal=run('!goal inventory.wooden_pickaxe:1');await wait(300);
      assert.ok((await run('!stop')).data.stoppedActions.includes('GOAP task'));assert.equal((await goal).error.code,'CANCELLED');
    });
    await check('direct API signal, observations during movement and goal/movement replacement',async()=>{
      const api=require('../../planner_bot/src/api').createBotApi(bot,{logLevel:'error'});
      await setup(['tp RegressionFlat 300 -60 300','give RegressionFlat oak_planks 40']);
      const controller=new AbortController(),moving=api.navigate('gotoCoords',{coords:[330,-60,300]},{signal:controller.signal});await wait(200);
      const owner=bot.currentAbortController;
      const [world,info,status,refresh]=await Promise.all([api.observe(),api.info('all'),api.status(),api.refresh()]);
      assert.ok([world,info,status,refresh].every(x=>x.ok));
      assert.equal((await api.planGoal('inventory.stick:4',{worldState:world.data})).ok,true);
      assert.equal(bot.currentAbortController,owner);assert.equal(owner.signal.aborted,false);
      controller.abort();assert.equal((await moving).error.code,'CANCELLED');assert.equal(bot.currentAbortController,null);
      const goal=api.executeGoal('inventory.wooden_pickaxe:1');await wait(200);
      assert.equal((await api.navigate('gotoCoords',{coords:[300,-60,300]})).ok,true);assert.equal((await goal).error.code,'CANCELLED');
      const move=api.navigate('gotoCoords',{coords:[330,-60,300]});await wait(200);
      assert.equal((await api.executeGoal('inventory.stick:4')).ok,true);assert.equal((await move).error.code,'CANCELLED');
      const counts=bot.inventory.items().map(i=>[i.name,i.count]);await wait(500);assert.deepEqual(bot.inventory.items().map(i=>[i.name,i.count]),counts);
    });
  }catch(error){console.error('LIVE ROOT ERROR',error.stack);throw error;}finally{
    if(bot){try{await handleChatCommand(bot,'RegressionPeer','!stop',bot.stateManager);}catch{}bot.quit();}peer?.quit();restore();
    fs.mkdirSync(path.join(root,'tests/results'),{recursive:true});fs.writeFileSync(path.join(root,'tests/results/live-flat.json'),JSON.stringify(results,null,2));
  }
});

test('natural: repeatable empty-inventory wooden pickaxe, stone pickaxe, furnace',{timeout:240000},async t=>{
  const restore=preserveGenerated();let bot;const results=[];const check=async(name,fn)=>{const start=Date.now();await fn();t.diagnostic(name+": "+(Date.now()-start)+"ms");};
  try{
    bot=await connect('natural','RegressionNat');
    let logs=[];bot.logWriter=message=>logs.push(String(message));
    await rcon('natural',['tp RegressionNat 500 80 500']);await wait(2500);
    // Controlled resources on a natural-world test platform. Keeps tests reproducible
    // after the original trees and rock have been consumed by prior observations.
    for(const item of (process.env.LIVE_GOALS||'wooden_pickaxe,stone_pickaxe,furnace').split(','))await check(item,async()=>{
      await rcon('natural',['fill 490 79 490 518 79 518 dirt','fill 490 80 490 518 86 518 air',
        'fill 497 80 502 499 80 504 cobblestone',
        'fill 495 80 498 495 80 502 oak_log','setblock 502 80 500 crafting_table',
        'clear RegressionNat','tp RegressionNat 500 80 500']);await wait(1000);
      logs=[];
      const start=Date.now();const running=item==='furnace' ? require('../../planner_bot/src/api').createBotApi(bot).executeGoal(`inventory.${item}:1`) : handleChatCommand(bot,'Observer',`!goal inventory.${item}:1`,bot.stateManager);
      const timer=setTimeout(()=>handleChatCommand(bot,'Observer','!stop',bot.stateManager),65000);
      let value;try{value=await running;}finally{clearTimeout(timer);}
      results.push({input:`!goal inventory.${item}:1`,durationMs:Date.now()-start,returned:value,position:clean(bot.entity.position),inventory:bot.inventory.items().map(i=>({name:i.name,count:i.count})),logs});
      assert.equal(value.ok,true);assert.ok(bot.inventory.items().some(i=>i.name===item));
    });
  }finally{bot?.quit();restore();fs.mkdirSync(path.join(root,'tests/results'),{recursive:true});fs.writeFileSync(path.join(root,'tests/results/live-natural.json'),JSON.stringify(results,null,2));}
});
