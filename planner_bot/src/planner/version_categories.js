// Keep the legacy file and its ordering intact. New rules are opt-in per version.
const expanded = new WeakMap()
function selectedVersion(version) {
  return version || require('./domain').getSelectedVersion() || process.env.MC_VERSION || '1.20.1'
}
function categoriesFor(legacy, version) {
  if (selectedVersion(version) !== '1.21.4') return legacy
  if (expanded.has(legacy)) return expanded.get(legacy)
  const data = require('minecraft-data')('1.21.4'), next = structuredClone(legacy)
  for (const [section, field, registry] of [
    ['categories', 'blocks', data.blocksByName], ['item_categories', 'items', data.itemsByName]
  ]) for (const [category, pattern] of [['log', /_log$/], ['plank', /_planks$/]]) {
    const members = next[section][category][field]
    for (const name of Object.keys(registry).filter(name => pattern.test(name)).sort()) {
      if (!members.includes(name)) members.push(name)
    }
  }
  expanded.set(legacy, next)
  return next
}
module.exports = { selectedVersion, categoriesFor }
