const fs = require('node:fs')
const before = require('./before.json'), after = require('./after.json'), water = require('./water-arrival.json')[0]
const rows = before.map(b => {
 const a = b.name === 'slope-west' ? water : after.find(a => a.name === b.name && a.repeat === b.repeat)
 return {name:b.name,repeat:b.repeat,before:{ms:b.ms,reason:b.result.data.reason,distanceReduced:b.result.data.distanceReduced,source:'before.json'},
  after:{ms:a.ms,reason:a.result.data.reason,distanceReduced:a.result.data.distanceReduced,source:b.name==='slope-west'?'water-arrival.json':'after.json'}}
})
fs.writeFileSync('tests/study11/comparison.json', JSON.stringify(rows,null,2))
