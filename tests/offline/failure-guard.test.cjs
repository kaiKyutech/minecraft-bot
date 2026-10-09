const {test}=require('node:test');const assert=require('node:assert/strict');const {FailureGuard}=require('../../planner_bot/src/executor/failure_guard');
test('different failing steps in an unchanged state stop after ten failures',()=>{
 const guard=new FailureGuard(),world={inventory:{counts:{}}};
 for(let i=0;i<9;i++)guard.note('g',{action:`a${i}`},new Error(`failure${i}`),world);
 assert.throws(()=>guard.note('g',{action:'a9'},new Error('failure9'),world),e=>e.code==='REPEATED_FAILURE'&&e.details.limitKind==='no_progress'&&e.details.attempts===10);
});
test('real inventory progress resets failure counts; timestamps and camera do not',()=>{
 const guard=new FailureGuard(),step={action:'gather'},reason=new Error('blocked'),world={timestamp:1,inventory:{counts:{log:0}},position:{x:1.1,y:10,z:1}};
 guard.note('g',step,reason,world);world.timestamp=2;world.position.x=1.2;guard.note('g',step,reason,world);
 world.inventory.counts.log=1;guard.note('g',step,reason,world);guard.note('g',step,reason,world);
 assert.throws(()=>guard.note('g',step,reason,world),{code:'REPEATED_FAILURE'});
});
