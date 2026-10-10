// Read credentials only in memory. Report filenames/counts, never values or matching text.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.cache/minecraft-bot/16-study'),secrets=[]
for(const version of ['1.20.1','1.21.4']) {
  const filename=path.join(out,`server-${version}/server.properties`)
  if(!fs.existsSync(filename))continue
  const line=fs.readFileSync(filename,'utf8').split(/\r?\n/).find(line=>line.startsWith('rcon.password='))
  const value=line?.slice('rcon.password='.length)
  if(value)secrets.push(value)
}
if(!secrets.length)throw Error('No dedicated credential files available for verification')
const listed=command=>execFileSync('git',command,{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)
const files=new Set([...listed(['diff','--name-only','HEAD']),...listed(['ls-files','--others','--exclude-standard']),
  'requests/2026-10-09_from-isg/16_report.md'])
for(const filename of fs.readdirSync(out))if(/\.(log|json|gz)$/.test(filename))files.add(path.relative(root,path.join(out,filename)))
for(const version of ['1.20.1','1.21.4'])for(const name of ['study-stdout.log','study-stderr.log','logs/latest.log'])files.add(path.relative(root,path.join(out,`server-${version}`,name)))
let checked=0
for(const relative of files) {
  const filename=path.resolve(root,relative)
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())continue
  const bytes=fs.readFileSync(filename),text=filename.endsWith('.gz')?zlib.gunzipSync(bytes).toString():bytes.toString()
  if(secrets.some(value=>text.includes(value)))throw Error('Credential match detected in '+relative)
  checked++
}
console.log('Credential scan passed:',checked,'source/report/evidence files; no values printed.')
