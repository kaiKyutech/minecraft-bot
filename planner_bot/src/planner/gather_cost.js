const { loadBlockCategories } = require('./state_builder')
const MODEL = Object.freeze({ approachRange: 2, distanceWeight: 0.5, obstructionWeight: 2, maxTargets: 1, maxSamples: 512 })
const key = p => `${p.x},${p.y},${p.z}`
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
function check(options) {
  if (options.signal?.aborted) throw Object.assign(new Error('Cancelled'), { name:'AbortError', code:'CANCELLED' })
  if (options.deadline !== undefined && performance.now() >= options.deadline) throw Object.assign(new Error('Evaluation budget exceeded'), { code:'BUDGET_EXCEEDED' })
}

// A bounded geometric estimate, not pathfinding or proof of access. Only observed
// intervening blocks are charged; unobserved cells are not assumed solid.
async function gatherEffort(world, options = {}) {
  check(options)
  if (world?._gatherEffort) return world._gatherEffort
  const origin = world?.position, rows = world?.blocks?.list || []
  if (!valid(origin) || !rows.length) return {}
  // Numeric local voxel keys avoid allocating hundreds of thousands of strings
  // for ordinary observation spheres. Fall back for arbitrary remote snapshots.
  const base={x:Math.floor(origin.x),y:Math.floor(origin.y),z:Math.floor(origin.z)}
  const voxel=p=>{const x=p.x-base.x+512,y=p.y-base.y+512,z=p.z-base.z+512;return x>=0&&x<1024&&y>=0&&y<1024&&z>=0&&z<1024 ? (x*1024+y)*1024+z : key(p)}
  const categories = loadBlockCategories(options.version).categories || {}, membership = new Map()
  for (const [name,cfg] of Object.entries(categories)) for (const block of cfg.blocks || []) {
    if (!membership.has(block)) membership.set(block,[])
    membership.get(block).push(name)
  }
  const occupied = new Map(), nearest = new Map(), probes = new Set()
  let slice = performance.now()+2, n = 0
  const tick = async () => { check(options); if (performance.now() >= slice) { await new Promise(setImmediate); check(options); slice=performance.now()+2 } }
  const add=(name,position,distanceSquared)=>{
    let list=nearest.get(name)
    if (!list) { list=[]; nearest.set(name,list) }
    if (list.length === MODEL.maxTargets && distanceSquared >= list[MODEL.maxTargets-1].distance**2) return
    list.push({ position,distance:Math.sqrt(distanceSquared) });list.sort((a,b)=>a.distance-b.distance)
    if(list.length>MODEL.maxTargets)list.pop()
  }
  for (const row of rows) {
    if (++n % 1024 === 0) await tick()
    if (!row.name || !valid(row.position)) continue
    const position = row.position, distanceSquared = (position.x-origin.x)**2+(position.y-origin.y)**2+(position.z-origin.z)**2
    if(!Number.isFinite(distanceSquared))continue
    add(row.name,position,distanceSquared)
    for (const name of membership.get(row.name)||[]) if(name!==row.name)add(name,position,distanceSquared)
  }
  const faces=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
  const corridor=target=>{
    const end={x:target.position.x+0.5,y:target.position.y+0.5,z:target.position.z+0.5},start={x:origin.x,y:origin.y+1.62,z:origin.z}
    const samples=Math.min(MODEL.maxSamples,Math.ceil(Math.hypot(end.x-start.x,end.y-start.y,end.z-start.z)*2)),cells=[]
    for(let j=1;j<samples;j++){const t=j/samples;cells.push(voxel({x:Math.floor(start.x+(end.x-start.x)*t),y:Math.floor(start.y+(end.y-start.y)*t),z:Math.floor(start.z+(end.z-start.z)*t)}))}
    return cells
  }
  for(const targets of nearest.values())for(const target of targets){
    await tick()
    const p=target.position
    for(const [x,y,z]of faces)probes.add(voxel({x:p.x+x,y:p.y+y,z:p.z+z}))
    target.corridor=corridor(target)
    for(const cell of target.corridor)probes.add(cell)
  }
  // Retain only voxels needed by these bounded probes, rather than indexing
  // every stone block in the observation sphere.
  for(const row of rows){
    if(++n%1024===0)await tick()
    if(!valid(row.position))continue
    const cell=voxel(row.position)
    if(probes.has(cell))occupied.set(cell,row.name)
  }
  const result = {}
  for (const name of [...nearest.keys()].sort()) {
    await tick()
    const targets = nearest.get(name), costs = {}, obstacles = new Set(), targetKeys = new Set(targets.map(t=>voxel(t.position)))
    const solid=cell=>{const block=occupied.get(cell);return block&&!['air','cave_air','void_air','water','flowing_water'].includes(block)}
    for (const [i,target] of targets.entries()) {
      const p=target.position
      const buried=faces.every(([x,y,z])=>solid(voxel({x:p.x+x,y:p.y+y,z:p.z+z})))
      // Half-block samples approximate access to the nearest target, matching
      // gather's initial choice. Target quantity/digs remain in the base cost.
      for (const cellKey of buried?target.corridor:[]) {
        if (++n % 256 === 0) await tick()
        if (!targetKeys.has(cellKey) && solid(cellKey)) obstacles.add(cellKey)
      }
      costs[i+1] = { distance: target.distance, obstructionCount: obstacles.size }
    }
    result[name] = costs
  }
  check(options)
  return result
}

function costedActions(actions, effort) {
  return actions.map(action => {
    if (action.skill !== 'gather') return action
    const estimate = effort[action.params?.itemName]?.[1]
    if (!estimate) return action // Legacy count-only observations keep base costs.
    const base = Number.isFinite(action.cost) ? action.cost : 1
    const extra = Math.max(0,estimate.distance-MODEL.approachRange)*MODEL.distanceWeight + estimate.obstructionCount*MODEL.obstructionWeight
    return { ...action, cost: Math.round((base+extra)*1000)/1000 }
  })
}
module.exports = { gatherEffort, costedActions, MODEL }
