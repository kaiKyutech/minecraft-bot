const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {root,wait}=require('../helpers/live');
async function run(label,environment,expected,cwd=root){
  const child=spawn(process.execPath,[path.join(root,'planner_bot/index.js')],{cwd,env:{...process.env,...environment},windowsHide:true});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  let exitCode;child.on('exit',c=>exitCode=c);const start=Date.now();
  try{
    while(exitCode===undefined&&!expected.test(stdout+stderr)&&Date.now()-start<30000)await wait(100);
    if(!expected.test(stdout+stderr))throw new Error(`standalone ${label}: expected output absent`);
    await wait(500);return {label,durationMs:Date.now()-start,stdout,stderr,exitCode:exitCode??null};
  }finally{if(exitCode===undefined)child.kill('SIGTERM');await wait(400);}
}
async function main(){
  const results=[];
  for(const count of [1,2])results.push(await run(`${count} bot(s)`,{MC_HOST:'127.0.0.1',MC_PORT:'25565',MC_USERNAME:'SurveyStart',MC_VERSION:'1.20.1',AI_BOT_COUNT:String(count)},count===1?/SurveyStart spawned/:/SurveyStart2 spawned/));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'minecraft-bot-startup-'));
  try{results.push(await run('missing configuration',{MC_HOST:'',MC_PORT:''},/ERROR: .env file is not configured properly/,temp));}
  finally{fs.rmdirSync(temp);}
  fs.writeFileSync(path.join(root,'tests/fixtures/standalone.json'),JSON.stringify(results,null,2));
  console.log(results.map(x=>({label:x.label,durationMs:x.durationMs,exitCode:x.exitCode})));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
