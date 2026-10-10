process.env.LOG_LEVEL = 'error'
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), YAML = require('yaml'), assert = require('node:assert/strict')
const { load } = require('../helpers/module')
async function main() {
  const writes = {}, proxy = { ...fs, mkdirSync(){}, copyFileSync(){}, writeFileSync:(file,bytes)=>{writes[path.basename(file)]=YAML.parse(bytes).actions} }
  for (const [kind,fn] of [['gather','ensureGatherActionsGenerated'],['craft','ensureCraftActionsGenerated'],['equipment','ensureEquipmentActionsGenerated']]) {
    const generator = load(path.resolve(__dirname, `../../planner_bot/src/planner/${kind}_generator.js`), {fs:proxy})
    await generator[fn]('1.21.4')
  }
  const file = path.join(__dirname, 'generated-1214.json.gz')
  if (process.argv[2] === '--record') fs.writeFileSync(file,zlib.gzipSync(JSON.stringify(writes)))
  else assert.deepEqual(writes,JSON.parse(zlib.gunzipSync(fs.readFileSync(file))))
  console.log('1.21.4 generated definitions:', Object.fromEntries(Object.entries(writes).map(([k,v])=>[k,v.length])))
}
main().catch(e=>{console.error(e);process.exitCode=1})
