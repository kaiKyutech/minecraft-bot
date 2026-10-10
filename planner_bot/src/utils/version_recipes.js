const { failure } = require('./result')
// The planner sends names, never IDs from another registry. Resolve each craft
// against the live inventory, including mixed planks for interchangeable recipes.
function resolveCraftRecipe(bot, spec, itemName) {
  const data = bot.registry || require('minecraft-data')(bot.version)
  if (spec.result?.name !== itemName) throw failure('RECIPE_NOT_FOUND', 'Recipe output does not match requested item')
  const available = new Map()
  for (const item of bot.inventory.items()) available.set(item.name, (available.get(item.name) || 0) + item.count)
  const itemId = name => {
    if (name == null) return null
    if (name === 'category.plank') name = spec.planks?.find(n => (available.get(n) || 0) > 0)
    const id = data.itemsByName[name]?.id
    if (id === undefined || !(available.get(name) > 0)) throw failure('ITEM_NOT_FOUND', 'Required recipe ingredient is unavailable')
    available.set(name, available.get(name) - 1)
    return id
  }
  const raw = { result: { id: data.itemsByName[itemName].id, count: spec.result.count } }
  if (spec.inShape) raw.inShape = spec.inShape.map(row => row.map(itemId))
  else raw.ingredients = spec.ingredients.map(itemId)
  const { Recipe } = require('prismarine-recipe')(data)
  return new Recipe(raw)
}
module.exports = { resolveCraftRecipe }
