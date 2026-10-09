const {test}=require('node:test');const assert=require('node:assert/strict');
const nav=require('../../planner_bot/src/navigation/actions');
function fixture(){
  const chest={inventoryStart:27,inventoryEnd:63,slots:Array(63).fill(null)};
  const item=(count,slot)=>({name:'oak_planks',type:5,metadata:0,count,slot});
  chest.slots[0]=item(64,0);chest.slots[1]=item(6,1);chest.slots[27]=item(5,27);
  chest.items=()=>chest.slots.slice(27).filter(Boolean);
  const calls=[];
  chest.withdraw=async(type,meta,count)=>calls.push(['withdraw',count]);
  chest.deposit=async(type,meta,count)=>calls.push(['deposit',count]);
  const bot={currentChest:chest,inventory:{items:()=>[item(64,9),item(6,10)]},systemLog(){}};
  return {bot,calls,chest};
}
test('withdraw all uses only container slots and sums stacks',async()=>{
 const f=fixture();const result=await nav.chestWithdraw(f.bot,{}, {item:'oak_planks',count:-1});
 assert.equal(result.count,70);assert.equal(f.calls.reduce((s,c)=>s+c[1],0),70);
});
test('deposit all sums player stacks rather than the first stack',async()=>{
 const f=fixture();f.chest.slots[28]={...f.chest.slots[27],count:65,slot:28};
 const result=await nav.chestDeposit(f.bot,{}, {item:'oak_planks',count:-1});assert.equal(result.count,70);
});
test('player items cannot be withdrawn from an empty container',async()=>{
 const f=fixture();f.chest.slots[0]=f.chest.slots[1]=null;
 const result=await nav.chestWithdraw(f.bot,{}, {item:'oak_planks',count:-1});assert.equal(result.success,false);assert.equal(f.calls.length,0);
});
