const {parentPort,workerData}=require('node:worker_threads'),path=require('node:path')
const jobs=[],absolute=()=>performance.timeOrigin+performance.now()
parentPort.on('message',request=>{if(request.id)jobs.push({id:request.id,method:request.method,arrived:absolute(),spans:[]})})
let active=null
function wrap(object,key,label){const original=object[key];object[key]=async function(...args){if(!active){active=jobs.find(j=>!j.started);if(active)active.started=absolute()}const row={label,start:absolute()};active?.spans.push(row);try{return await original.apply(this,args)}finally{row.end=absolute();row.ms=row.end-row.start}}}
wrap(require(path.join(workerData.root,'planner_bot/src/planner/goap')),'prepareDomain','prepare')
wrap(require(path.join(workerData.root,'planner_bot/src/planner/goap')),'plan','plan')
wrap(require(path.join(workerData.root,'planner_bot/src/planner/goal_evaluator')),'evaluate','evaluate')
const post=parentPort.postMessage.bind(parentPort)
parentPort.postMessage=message=>{const job=jobs.find(j=>j.id===message.id);if(job){job.finished=absolute();message._study=job;if(active===job)active=null;jobs.splice(jobs.indexOf(job),1)}post(message)}
require(workerData.target)
