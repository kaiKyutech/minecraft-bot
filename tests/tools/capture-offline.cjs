// Run intentionally only when establishing a new baseline; npm test never writes fixtures.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),YAML=require('yaml');
const {load}=require('../helpers/module');
const {buildState}=require('../../planner_bot/src/planner/state_builder');
const out=path.resolve(__dirname,'../fixtures');
async function main(){
  for(const name of fs.readdirSync(out).filter(x=>/-(empty|stocked|underground)\.json\.gz$/.test(x))) {
    const state=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(out,name))));
    fs.writeFileSync(path.join(out,name.replace('.json.gz','-facts.json')),JSON.stringify(buildState(state),null,2));
  }
  const expected={};
  for(const [kind,fn]of [['gather','ensureGatherActionsGenerated'],['craft','ensureCraftActionsGenerated'],['equipment','ensureEquipmentActionsGenerated']]){
    const proxy={...fs,mkdirSync(){},copyFileSync(){},writeFileSync:(file,bytes)=>{expected[path.basename(file)]=YAML.parse(bytes).actions;}};
    await load(path.resolve(__dirname,`../../planner_bot/src/planner/${kind}_generator.js`),{fs:proxy})[fn]('1.20.1');
  }
  fs.writeFileSync(path.join(out,'generated-actions.json'),JSON.stringify(expected,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
