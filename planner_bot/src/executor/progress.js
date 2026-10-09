const {randomUUID}=require('node:crypto')
const {currentContext}=require('../utils/context')
const {createLogger}=require('../utils/logger')
class Progress {
 constructor(bot,onProgress){this.bot=bot;this.callback=onProgress;this.operationId=randomUUID();this.sequence=0;this.planId=0;this.stack=[]}
 emit(type,payload={}){
  if(!this.callback)return
  const event=structuredClone({operationId:this.operationId,sequence:++this.sequence,timestamp:Date.now(),type,goal:this.stack.at(-1),depth:Math.max(0,this.stack.length-1),...payload})
  const failed=error=>createLogger({bot:this.bot,category:'goap.exec'}).warn(`onProgress callback failed: ${error.message||error}`)
  try{Promise.resolve(this.callback(event)).catch(failed)}catch(error){failed(error)}
 }
 plan(goal,plan,type='plan'){const planId=++this.planId;this.emit(type,{goal,planId,plan,stepCount:plan.length});return planId}
}
const progress=bot=>currentContext(bot).progress
module.exports={Progress,progress}
