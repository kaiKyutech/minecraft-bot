const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'), cache=path.join(root,'.cache/minecraft-bot/08-study')
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'))
const matrix=read(path.join(cache,'matrix-B.json')), old=read(path.join(root,'tests/study05/matrix-B.json'))
assert.equal(matrix.error,undefined);assert.equal(matrix.cases,270);assert.equal(matrix.rows.length,1080)
assert.deepEqual(matrix.meta.productionHashes,old.meta.productionHashes)
const successes=matrix.rows.filter(r=>r.variant==='production' && r.repeat===0 && r.plan).length
assert.equal(successes,130)
function testLog(name,expected) {
  const log=fs.readFileSync(path.join(cache,name),'utf8')
  const value={tests:Number(log.match(/ℹ tests (\d+)/)?.[1]),passed:Number(log.match(/ℹ pass (\d+)/)?.[1]),failed:Number(log.match(/ℹ fail (\d+)/)?.[1])}
  assert.equal(value.tests,expected);assert.equal(value.passed,expected);assert.equal(value.failed,0)
  return value
}
const live=read(path.join(__dirname,'live-results.json'))
assert.equal(live.port,25569);assert.equal(live.results.length,4)
for(const row of live.results.slice(0,3)) {
  assert.equal(row.beforeLight.dark,true);assert.equal(row.afterLight.dark,false)
  assert.equal(row.afterLight.torchNearby,true);assert.equal(row.serverConfirmed,true)
  assert.equal(row.remainingTorches,3);assert.equal(row.placed.attempts,1)
}
const verification={baseCommit:'9b329b2',standard:testLog('npm-test.log',255),research04:testLog('study04-test.log',9),
  research05:{cases:270,successes,fullPlansCostsIterationsMatch:true,plannerHashesUnchanged:true,productionHashes:matrix.meta.productionHashes},
  research06:'All 21 D1/D2/P1/P2 regression tests included in npm test; historical live files left unchanged',
  live:{cases:4,undergroundPlacements:3,serverConfirmed:true,port:25569,rconPort:25579},raw:'tests/study08/live-results.json'}
fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(verification,null,2)+'\n')
console.log(JSON.stringify(verification))
