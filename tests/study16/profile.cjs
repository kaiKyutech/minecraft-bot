const fs=require('node:fs'),path=require('node:path'),wt=require('node:worker_threads')
const root=path.resolve(__dirname,'../..'),spans=[],requests=[]
const absolute=()=>performance.timeOrigin+performance.now()
const NativeWorker=wt.Worker
wt.Worker=class extends NativeWorker {
 constructor(file,options){
  if(!String(file).endsWith('planning_worker.js')){super(file,options);return}
  super(path.join(__dirname,'worker-profile.cjs'),{...options,workerData:{target:String(file),root}})
  this.on('message',message=>{if(message._study){const row=requests.find(r=>r.id===message.id);if(row)Object.assign(row,{received:absolute(),worker:message._study})}})
 }
 postMessage(message,...args){if(message.id)requests.push({id:message.id,method:message.method,goal:message.goal,posted:absolute()});return super.postMessage(message,...args)}
}
function wrap(object,key,label=key){const original=object[key];object[key]=async function(...args){const start=absolute(),row={label,start,args:label.includes('plan')?args[0]:undefined};spans.push(row);try{return await original.apply(this,args)}finally{row.end=absolute();row.ms=row.end-start}}}
const goap=require(path.join(root,'planner_bot/src/planner/goap')),service=require(path.join(root,'planner_bot/src/planner/planning_service'))
wrap(goap,'prepareDomain','domain');wrap(goap,'plan','goap.plan');wrap(service,'prepare','service.prepare');wrap(service,'plan','service.plan');wrap(service,'evaluate','service.evaluate')
wrap(require(path.join(root,'planner_bot/src/planner/gather_cost')),'gatherEffort','effort')
wrap(require(path.join(root,'planner_bot/src/executor/precondition_checker')),'analyseStepPreconditions','precondition')
const skills=require(path.join(root,'planner_bot/src/skills'))
let afterSkill=null,beforeSkill=null
for(const name of Object.keys(skills)){const original=skills[name];if(typeof original!=='function')continue;skills[name]=async function(...args){const start=absolute(),row={label:'skill.'+name,start,params:args[1]};spans.push(row);try{if(beforeSkill)await beforeSkill(name,args);const result=await original.apply(this,args);if(afterSkill)await afterSkill(name,args);return result}finally{row.end=absolute();row.ms=row.end-start}}}
module.exports={root,spans,requests,absolute,wrap,setHook:hook=>{afterSkill=hook},setBeforeHook:hook=>{beforeSkill=hook}}
