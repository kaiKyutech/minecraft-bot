const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {Vec3}=require('vec3');const {load}=require('../helpers/module');
test('moveTo TIMEOUT clears the goal and drains goto before returning',async()=>{
 let goal,finish,drained=false;
 const bot={version:'1.20.1',entity:{position:new Vec3(0,10,0)},pathfinder:{setMovements(){},goto(g){goal=g;return new Promise((resolve,reject)=>{finish=()=>{drained=true;reject(new Error('goal cleared'))}})},setGoal(g){goal=g;finish()}}};
 const primitives=load(path.resolve(__dirname,'../../planner_bot/src/primitives.js'),{'mineflayer-pathfinder':{Movements:class{},goals:{GoalBlock:class{}}},'minecraft-data':()=>({blocksByName:{}})});
 await assert.rejects(primitives.moveTo(bot,{x:20,y:10,z:0,timeout:10}),{code:'TIMEOUT'});assert.equal(goal,null);assert.equal(drained,true);
});
