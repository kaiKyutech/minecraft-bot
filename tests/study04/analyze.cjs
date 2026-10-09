const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'.cache/minecraft-bot/04-study');
const bench=JSON.parse(fs.readFileSync(path.join(dir,'benchmark.json'))),rows=bench.rows;
function median(a){a=[...a].sort((x,y)=>x-y);return a.length%2?a[Math.floor(a.length/2)]:(a[a.length/2-1]+a[a.length/2])/2;}
function p95(a){a=[...a].sort((x,y)=>x-y);return a[Math.ceil(a.length*.95)-1];}
function counts(a,key){return a.reduce((o,r)=>(o[r[key]]=(o[r[key]]||0)+1,o),{});}
const cases=[];
for(const state of bench.meta.states)for(const goal of bench.meta.goals)for(const variant of [...new Set(rows.map(r=>r.variant))]){
 const samples=rows.filter(r=>r.state===state.name&&r.goal===goal&&r.variant===variant);if(!samples.length)continue;
 const a=samples[0];
 if(samples.some(r=>r.reason!==a.reason||JSON.stringify(r.result)!==JSON.stringify(a.result)))throw new Error(`Non-deterministic outcome: ${state.name} ${goal} ${variant}`);
 cases.push({state:state.name,goal,variant,sampleCount:samples.length,reason:a.reason,provedImpossible:a.provedImpossible,medianMs:median(samples.map(r=>r.durationMs)),minMs:Math.min(...samples.map(r=>r.durationMs)),maxMs:Math.max(...samples.map(r=>r.durationMs)),iterations:a.metrics.iterations,expanded:a.metrics.expanded,uniqueExpanded:a.metrics.uniqueExpanded,discovered:a.metrics.discovered,actionChecks:a.metrics.actionChecks,transitions:a.metrics.transitions,heuristicCalls:a.metrics.heuristicCalls,heuristicMs:median(samples.map(r=>r.metrics.heuristicMs)),stalePops:a.metrics.stalePops,maxOpen:a.metrics.maxOpen,relevantActions:a.relevantActions,stepCount:a.stepCount,cost:a.cost,estimatedMs:a.estimatedMs,valid:a.validation?.valid??null,plan:a.result?.plan?.map(s=>s.action)??null,heuristicAudit:a.heuristicAudit});
}
const variants={};for(const variant of [...new Set(cases.map(r=>r.variant))]){
 const a=cases.filter(r=>r.variant===variant),base=cases.filter(r=>r.variant==='baseline'),paired=a.map(r=>[r,base.find(b=>b.state===r.state&&b.goal===r.goal)]);
 const both=paired.filter(([r,b])=>r.reason==='success'&&b.reason==='success');
 variants[variant]={cases:a.length,status:counts(a,'reason'),provedImpossible:a.filter(r=>r.provedImpossible).length,totalMedianMs:a.reduce((n,r)=>n+r.medianMs,0),medianCaseMs:median(a.map(r=>r.medianMs)),p95CaseMs:p95(a.map(r=>r.medianMs)),invalid:a.filter(r=>r.valid===false).length,iterations:a.reduce((n,r)=>n+r.iterations,0),heuristicMs:a.reduce((n,r)=>n+r.heuristicMs,0),newSuccess:paired.filter(([r,b])=>r.reason==='success'&&b.reason!=='success').length,lostSuccess:paired.filter(([r,b])=>r.reason!=='success'&&b.reason==='success').length,changedPlans:both.filter(([r,b])=>JSON.stringify(r.plan)!==JSON.stringify(b.plan)).length,estimateImproved:both.filter(([r,b])=>r.estimatedMs<b.estimatedMs).length,estimateWorse:both.filter(([r,b])=>r.estimatedMs>b.estimatedMs).length,totalEstimateDelta:both.reduce((n,[r,b])=>n+r.estimatedMs-b.estimatedMs,0)};
}
let live=[];if(fs.existsSync(path.join(dir,'live.json')))live=JSON.parse(fs.readFileSync(path.join(dir,'live.json'))).map(r=>({start:r.startIndex,position:r.initialPosition,goal:r.goal,durationMs:r.durationMs,ok:r.result?.ok,code:r.result?.error?.code||r.thrown?.code||null,details:r.result?.error?.details||null,finalPosition:r.finalPosition,inventory:r.inventory?.map(i=>({name:i.name,count:i.count})),failedSteps:r.events?.filter(e=>e.type==='step_failure').map(e=>({goal:e.goal,action:e.step?.action,code:e.code,message:e.message})),subgoalEntries:r.events?.filter(e=>e.type==='subgoal_enter').map(e=>({goal:e.goal,depth:e.depth})),replans:r.events?.filter(e=>e.type==='replan').length,timeouts:r.logs?.filter(l=>/timeout|long to decide/i.test(l))}));
const extended=fs.existsSync(path.join(dir,'extended.json'))?JSON.parse(fs.readFileSync(path.join(dir,'extended.json'))).map(r=>({state:r.state,goal:r.goal,variant:r.variant,limit:r.limit,deadlineMs:r.deadlineMs,reason:r.reason,durationMs:r.durationMs,iterations:r.metrics.iterations,discovered:r.metrics.discovered,valid:r.validation?.valid??null,estimatedMs:r.estimatedMs,plan:r.result?.plan?.map(s=>s.action)})):[];
const initialHeuristics=fs.existsSync(path.join(dir,'heuristic.json'))?JSON.parse(fs.readFileSync(path.join(dir,'heuristic.json'))):[];
const liveAudit=fs.existsSync(path.join(dir,'live-audit.json'))?JSON.parse(fs.readFileSync(path.join(dir,'live-audit.json'))):[];
const witnesses=fs.existsSync(path.join(dir,'witnesses.json'))?JSON.parse(fs.readFileSync(path.join(dir,'witnesses.json'))):[];
for(const c of live)c.initialPlanning=liveAudit.find(r=>r.start===c.start&&r.goal===c.goal)||null;
for(const c of cases)if(c.variant==='baseline')c.initialH=initialHeuristics.find(r=>r.state===c.state&&r.goal===c.goal)?.initialH??c.heuristicAudit?.initialH??null;
const result={meta:bench.meta,variants,states:bench.meta.states.map(s=>({name:s.name,baselineStatus:counts(cases.filter(r=>r.state===s.name&&r.variant==='baseline'),'reason')})),extended,live,witnesses,
 domain:fs.existsSync(path.join(dir,'domain.json'))?JSON.parse(fs.readFileSync(path.join(dir,'domain.json'))):null,
 generation:fs.existsSync(path.join(dir,'generation.json'))?JSON.parse(fs.readFileSync(path.join(dir,'generation.json'))):null,cases};
fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({meta:bench.meta,variants,states:result.states,extended,live},null,2));
