const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const out=path.resolve(__dirname,'../../.cache/minecraft-bot/16-study')
const stats=values=>{const a=values.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);return {n:a.length,min:a[0],p50:a[Math.floor(a.length*.5)],p90:a[Math.min(a.length-1,Math.floor(a.length*.9))],max:a.at(-1)}}
const summary={}
for(const version of ['1.20.1','1.21.4']) {
  const read=name=>JSON.parse(fs.readFileSync(path.join(out,`${name}-${version}.json`)))
  const primary=read('live'),comparison=read('compare'),groups={}
  for(const kind of new Set(comparison.rows.map(r=>r.kind))) {
    const rows=comparison.rows.filter(r=>r.kind===kind)
    groups[kind]={success:rows.filter(r=>r.result.ok).length,prepareMs:stats(rows.map(r=>r.prepareMs)),firstStepMs:stats(rows.map(r=>r.firstStepMs)),firstSkillMs:stats(rows.map(r=>r.firstSkillMs)),
      handoffSkillMs:stats(rows.map(r=>r.handoffSkillMs)),distance:rows.map(r=>Math.hypot(r.p1.x-r.p0.x,r.p1.y-r.p0.y,r.p1.z-r.p0.z)),
      collectedLogs:rows.map(r=>(r.i1.oak_log||0)-(r.i0.oak_log||0)),oldOwnerUninterrupted:rows.every(r=>r.oldActiveAtPrepared&&!r.oldOwnerAbortedAtPrepared)}
  }
  const edges=fs.existsSync(path.join(out,`edges-${version}.json`))?read('edges').rows.map(r=>({kind:r.kind,ok:r.result.ok,final:r.final,preparationGoal:r.prepared.preparationGoal})):[]
  const mining=fs.existsSync(path.join(out,`mining-${version}.json`))?read('mining').rows.map(r=>({kind:r.kind,ok:r.result.ok,code:r.result.error?.code,rawIron:r.final.raw_iron||0,digs:r.digs})):[]
  const matrix=JSON.parse(fs.readFileSync(path.join(out,`matrix/matrix-${version}.json`)))
  const legacy={}
  if(fs.existsSync(path.join(out,`legacy-${version}.json`)))for(const kind of ['legacy-walk','legacy-goap']) {
    const rows=read('legacy').rows.filter(r=>r.kind===kind)
    if(rows.length)legacy[kind]={success:rows.filter(r=>r.result.ok).length,firstStepMs:stats(rows.map(r=>r.firstStepMs)),firstSkillMs:stats(rows.map(r=>r.firstSkillMs)),
      distance:rows.map(r=>Math.hypot(r.p1.x-r.p0.x,r.p1.y-r.p0.y,r.p1.z-r.p0.z)),collectedLogs:rows.map(r=>(r.i1.oak_log||0)-(r.i0.oak_log||0))}
  }
  summary[version]={representative:primary.rows.filter(r=>['walk','goap'].includes(r.kind)).map(r=>({kind:r.kind,goal:r.goal,ok:r.result.ok,reused:r.prepared.reused})),groups,legacy,edges,mining,matrix:{exact:matrix.exact,summary:matrix.summary,actions:matrix.actions}}
}
summary.hashes={}
for(const name of fs.readdirSync(out))if(/^(live|compare|edges|mining|legacy)-.*\.json$/.test(name))summary.hashes[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,name))).digest('hex')
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2))
for(const [version,data]of Object.entries(summary))if(version!=='hashes') {
  console.log(version,'representative',data.representative.filter(r=>r.ok).length+'/'+data.representative.length,'edges',data.edges.filter(r=>r.ok).length+'/'+data.edges.length)
  for(const [kind,g]of Object.entries(data.groups))console.log(kind,'prepare p50',g.prepareMs.p50.toFixed(1),'skill p50/p90',g.firstSkillMs.p50.toFixed(1),g.firstSkillMs.p90.toFixed(1),'distance',g.distance.map(x=>x.toFixed(2)).join(','),'logs',g.collectedLogs.join(','))
  for(const row of data.mining)console.log(row.kind,row.ok,row.code||'',row.rawIron)
  for(const [kind,g]of Object.entries(data.legacy))console.log(kind,'skill p50/p90',g.firstSkillMs.p50.toFixed(1),g.firstSkillMs.p90.toFixed(1),'distance',g.distance.map(x=>x.toFixed(2)).join(','),'logs',g.collectedLogs.join(','))
}
