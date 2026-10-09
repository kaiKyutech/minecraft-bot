// Read-only Git archive, inside this repo's ignored cache. Never checks out a ref.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function sourceRuntime(commit='da4488c'){
 if(!/^[0-9a-f]{7,40}$/.test(commit))throw Error('Runtime ref must be a commit hash');
 const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/minecraft-bot/05-study',`runtime-${commit}`);
 const entry=path.join(out,'planner_bot/api.js');
 if(!fs.existsSync(path.join(out,'complete'))){
  fs.mkdirSync(out,{recursive:true});const zip=path.join(out,'source.zip');
  execFileSync('git',['archive','--format=zip','-o',zip,commit,'planner_bot'],{cwd:root,windowsHide:true});
  const quote=s=>"'"+s.replace(/'/g,"''")+"'";
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(out)} -Force`],{windowsHide:true});
  fs.writeFileSync(path.join(out,'complete'),commit);
 }
 return require(entry);
}
module.exports={sourceRuntime};
