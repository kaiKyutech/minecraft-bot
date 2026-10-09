process.env.LOG_LEVEL='error';
const fs=require('node:fs'),path=require('node:path'),YAML=require('yaml');
const {load}=require('../helpers/module');
const output=path.resolve(__dirname,'../../.cache/minecraft-bot/04-study');
// Real generation and YAML parsing, virtual file writes only. No dependency changes.
async function main(){
 const rounds=[];
 for(let round=0;round<3;round++)for(const [kind,method]of [['gather','generateGatherActions'],['craft','generateCraftActions'],['equipment','generateEquipmentActions']]){
  const writes=[],proxy={...fs,mkdirSync(){},writeFileSync(file,bytes){writes.push({file:path.basename(file),bytes:String(bytes)})}};
  const generator=load(path.resolve(__dirname,`../../planner_bot/src/planner/${kind}_generator.js`),{fs:proxy});
  const start=performance.now();await generator[method]('1.20.1',output);const generateMs=performance.now()-start;
  const parseStart=performance.now(),files=writes.map(w=>({file:w.file,bytes:Buffer.byteLength(w.bytes),actions:YAML.parse(w.bytes).actions.length}));
  rounds.push({round,kind,generateMs,parseMs:performance.now()-parseStart,files});
 }
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'generation.json'),JSON.stringify(rounds,null,2));console.log(JSON.stringify(rounds,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
