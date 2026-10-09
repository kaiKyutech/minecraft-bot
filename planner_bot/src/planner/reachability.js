const {getStateValue}=require('./state_operations')
const {loadStateSchema}=require('./state_builder')
// Delete-relaxed presence closure: quantities and all negative constraints are
// ignored. Failure of this over-approximation proves impossibility, never success.
function needsPresence(condition){
 if(condition===true||condition==='true')return true
 if(typeof condition==='number')return condition>0
 if(typeof condition==='string'){
  const m=condition.trim().match(/^(>=|>|==)?\s*(-?\d+)$/)
  if(m)return Number(m[2])>0||(m[1]==='>'&&Number(m[2])===0)
 }
 return false
}
function positive(effect){
 if(effect===true)return true
 if(typeof effect==='number')return effect>0
 if(typeof effect==='string'){
  if(effect==='false')return false
  if(/^[+-]?\d+$/.test(effect.trim()))return Number(effect)>0
  return Boolean(effect)
 }
 return Boolean(effect)
}
function reachable(actions,state,deadline=Infinity,signal,details){
 const check=()=>{
  if(signal?.aborted)throw Object.assign(new Error('Cancelled'),{name:'AbortError',code:'CANCELLED'})
  if(performance.now()>=deadline){if(details)details.timedOut=true;return true}
  return false
 }
 if(details){details.facts=new Map();details.rounds=0;details.timedOut=false;details.complete=false}
 if(check())return null
 const keys=new Set(actions.flatMap(a=>[...Object.keys(a.preconditions||{}),...Object.keys(a.effects||{})]))
 const available=new Set([...keys].filter(key=>{const value=getStateValue(state,key);return typeof value==='number'?value>0:Boolean(value)}))
 if(details)for(const key of available)details.facts.set(key,{key,initial:true,round:0,firstAction:null,source:'initial',derivedFrom:null})
 const schema=loadStateSchema(),computed=Object.values(schema).flatMap(section=>typeof section==='object'?Object.entries(section):[]).filter(([,c])=>c?.computed)
 let changed=true
 while(changed){
  changed=false
  if(details)details.rounds++
  for(const action of actions){
   if(check())return null
   if(!Object.entries(action.preconditions||{}).every(([key,c])=>!needsPresence(c)||available.has(key)))continue
   for(const [key,effect]of Object.entries(action.effects||{}))if(positive(effect)&&!available.has(key)){
    available.add(key);changed=true
    if(details)details.facts.set(key,{key,initial:false,round:details.rounds,firstAction:action.name,source:'action',derivedFrom:null})
   }
  }
  for(const [key,c]of computed){
   const deps=c.depends_on||c.depends_on_inventory?.map(name=>'inventory.'+name)||[]
   const dep=deps.find(d=>available.has(d))
   if(dep!==undefined&&!available.has(key)){
    available.add(key);changed=true
    if(details)details.facts.set(key,{key,initial:false,round:details.rounds,firstAction:details.facts.get(dep)?.firstAction??null,source:'computed',derivedFrom:dep})
   }
  }
 }
 if(details)details.complete=true
 return available
}
module.exports={reachable,needsPresence}
