// Run the unchanged study14 verifier; redirect only its ignored output directory.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
const root=path.resolve(__dirname,'../..'),filename=path.join(root,'tests/study14/matrix.cjs'),mod={exports:{}}
const original=fs.readFileSync(filename,'utf8'),needle="'../../.cache/minecraft-bot/14-study'"
if(original.split(needle).length!==2)throw Error('Matrix output anchor changed')
const source=original.replace(needle,"'../../.cache/minecraft-bot/16-study/matrix'")+'\nmodule.exports.studyMain=main;'
vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${source}\n})`,{filename})(createRequire(filename),mod,mod.exports,filename,path.dirname(filename))
mod.exports.studyMain().catch(e=>{console.error(e);process.exitCode=1})
