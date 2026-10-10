// Each version runs in a separate process, matching the public restart contract.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const source = `process.env.LOG_LEVEL='error';const fs=require('fs'),goap=require('./planner_bot/src/planner/goap');
goap.prepareDomain(process.argv[1],{info(){},debug(){},warn(){},error(){}}).then(()=>{
process.stdout.write(fs.readFileSync('.cache/minecraft-bot/actions/'+process.argv[1]+'/manifest.json'))
}).catch(e=>{console.error(e);process.exitCode=1})`
const run = version => JSON.parse(execFileSync(process.execPath, ['-e', source, version], { cwd: root, encoding: 'utf8' }))
const first = run('1.20.1'), current = run('1.21.4'), restored = run('1.20.1')
assert.deepEqual(first, restored)
assert.notEqual(first.categoriesHash, current.categoriesHash)
assert.notDeepEqual(first.files, current.files)
fs.writeFileSync(path.join(root, '.cache/minecraft-bot/14-study/restart.json'), JSON.stringify({ first, current, restored, identical: true }, null, 2))
console.log('1.20.1 -> 1.21.4 -> 1.20.1: categories and all four generated files restored exactly')
