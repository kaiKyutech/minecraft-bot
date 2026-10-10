// Version 1.21.4: retain all distinct recipes, independent of registry ordering.
// Generalize planks only when every configured plank has the same recipe shape,
// non-plank ingredients, output identity and output count.
const crypto = require('node:crypto')
function recipeNames(recipe, data) {
  const name = id => id == null || id === -1 ? null : data.items[id]?.name
  if (recipe.inShape) return { inShape: recipe.inShape.map(row => row.map(name)) }
  if (recipe.ingredients) return { ingredients: recipe.ingredients.map(name).sort() }
  return null
}
function counts(spec) {
  const result = {}
  for (const name of (spec.inShape || [spec.ingredients]).flat()) {
    if (name) result[name] = (result[name] || 0) + 1
  }
  return result
}
function hashName(signature) {
  // Public action goals accept letters and underscores, not digits.
  return crypto.createHash('sha256').update(signature).digest('hex').replace(/[0-9a-f]/g, x => 'abcdefghijklmnop'[parseInt(x, 16)])
}
function generateVariants(data, categories, genericPlanks) {
  const hand = [], workbench = [], planks = categories.item_categories.plank.items
  const legacy = require('minecraft-data')('1.20.1')
  const plankSet = new Set(planks), families = new Map(), entries = []
  for (const [resultId, recipes] of Object.entries(data.recipes || {})) {
    const result = data.items[resultId]?.name
    if (!result) continue
    for (const recipe of recipes) {
      const spec = recipeNames(recipe, data)
      if (!spec || Object.keys(counts(spec)).length === 0) continue
      const kind = spec.inShape
        ? spec.inShape.length <= 2 && spec.inShape.every(row => row.length <= 2) ? 'hand' : 'workbench'
        : spec.ingredients.length <= 4 ? 'hand' : 'workbench'
      const outputCount = recipe.result.count || 1
      const normalize = n => plankSet.has(n) ? 'category.plank' : n
      const normalized = spec.inShape ? { inShape: spec.inShape.map(row => row.map(normalize)) }
        : { ingredients: spec.ingredients.map(normalize).sort() }
      const family = JSON.stringify([result, outputCount, kind, normalized])
      if (!families.has(family)) families.set(family, new Set())
      const used = Object.keys(counts(spec)).filter(n => plankSet.has(n))
      // Uniform replacements demonstrate interchangeability of all plank slots.
      if (used.length === 1) families.get(family).add(used[0])
      entries.push({ result, outputCount, kind, spec, normalized, family })
    }
  }
  const unique = new Map()
  for (const entry of entries.sort((a, b) => JSON.stringify(a.spec).localeCompare(JSON.stringify(b.spec)))) {
    const generalized = planks.every(n => families.get(entry.family).has(n))
    const spec = generalized ? entry.normalized : entry.spec
    const ingredients = counts(spec)
    const signature = JSON.stringify([entry.result, entry.outputCount, entry.kind, Object.entries(ingredients).sort()])
    if (!unique.has(signature)) unique.set(signature, { ...entry, spec, ingredients, signature, generalized })
  }
  hand.push(genericPlanks)
  const seen = new Set()
  const preferred = entry => {
    const oldItem = legacy.itemsByName[entry.result]
    const recipe = oldItem && legacy.recipes[oldItem.id]?.[0]
    const old = recipe && recipeNames(recipe, legacy)
    if (!old) return false
    const ingredients = counts(old)
    if (entry.generalized) for (const name of Object.keys(ingredients)) if (plankSet.has(name)) {
      ingredients['category.plank'] = (ingredients['category.plank'] || 0) + ingredients[name]
      delete ingredients[name]
    }
    return JSON.stringify(Object.entries(ingredients).sort()) === JSON.stringify(Object.entries(entry.ingredients).sort()) &&
      (recipe.result.count || 1) === entry.outputCount
  }
  // Keep the earlier registry's representative for common outputs, and retain
  // alternatives after it. This is a general ordering rule, not an item patch.
  const order = (a, b) => data.itemsByName[a.result].id - data.itemsByName[b.result].id ||
    Number(preferred(b)) - Number(preferred(a)) || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)
  for (const entry of [...unique.values()].sort(order)) {
    const { result, outputCount, kind, spec, ingredients, signature, generalized } = entry
    const preconditions = {}, effects = {}, deltas = new Map()
    const delta = (name, quantity) => deltas.set(name, (deltas.get(name) || 0) + quantity)
    for (const [name, quantity] of Object.entries(ingredients)) {
      preconditions['inventory.' + name] = '>= ' + quantity
      delta('inventory.' + name, -quantity)
      if (!name.startsWith('category.')) for (const [category, cfg] of Object.entries(categories.item_categories)) {
        if (cfg.type === 'count' && cfg.items.includes(name)) delta('inventory.category.' + category, -quantity)
      }
    }
    if (kind === 'workbench') preconditions.nearby_workbench = true
    delta('inventory.' + result, outputCount)
    for (const [category, cfg] of Object.entries(categories.item_categories)) if (cfg.items.includes(result)) {
      if (cfg.type === 'count') delta('inventory.category.' + category, outputCount)
      else effects['inventory.category.' + category] = true
    }
    for (const [key, value] of deltas) if (value) effects[key] = value > 0 ? '+' + value : String(value)
    const resultLabel = result.replace(/\d/g, n => ['zero','one','two','three','four','five','six','seven','eight','nine'][n])
    const base = `auto_${kind}_craft_${resultLabel}`, name = seen.has(base) ? base + '_variant_' + hashName(signature) : base
    seen.add(base)
    const craftingRecipe = { ...spec, result: { name: result, count: outputCount }, ...(generalized ? { planks: [...planks] } : {}) }
    ;(kind === 'hand' ? hand : workbench).push({ name, preconditions, effects, cost: 10,
      skill: kind === 'hand' ? 'hand_craft' : 'workbench_craft', params: { recipe: result, count: 1, craftingRecipe } })
  }
  return { hand, workbench }
}
module.exports = { generateVariants, recipeNames, counts }
