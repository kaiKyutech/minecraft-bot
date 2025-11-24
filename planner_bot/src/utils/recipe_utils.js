const minecraftData = require("minecraft-data");
const prismarineRecipe = require("prismarine-recipe");

function ensureMcData(bot) {
  if (!bot.version) {
    throw new Error("bot.version が取得できるまで待ってください");
  }
  return minecraftData(bot.version);
}

function resolveItem(mcData, itemName, label) {
  const item = mcData.itemsByName[itemName];
  if (!item) {
    throw new Error(`${label} に指定されたアイテムが見つかりません: ${itemName}`);
  }
  return item;
}

function buildShapeNames(shape, mcData) {
  if (!shape) return null;

  return shape.map(row =>
    row.map(cell => {
      if (!cell || cell.id === -1) return null;
      const item = mcData.items[cell.id];
      return item ? item.name : null;
    })
  );
}

function aggregateInputs(recipe, mcData) {
  const counts = new Map();

  if (recipe.inShape) {
    for (const row of recipe.inShape) {
      for (const cell of row) {
        if (!cell || cell.id === -1) continue;
        const item = mcData.items[cell.id];
        if (!item) continue;
        const key = item.name;
        const next = (counts.get(key) || 0) + (cell.count || 1);
        counts.set(key, next);
      }
    }
  }

  if (recipe.ingredients) {
    for (const ing of recipe.ingredients) {
      if (!ing || ing.id === -1) continue;
      const item = mcData.items[ing.id];
      if (!item) continue;
      const key = item.name;
      const next = (counts.get(key) || 0) + Math.abs(ing.count || 1);
      counts.set(key, next);
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildRecipeDescriptor(recipe, mcData) {
  const outputs = [];
  if (recipe.result) {
    const item = mcData.items[recipe.result.id];
    if (item) {
      outputs.push({
        name: item.name,
        count: recipe.result.count || 1
      });
    }
  }

  const inputs = aggregateInputs(recipe, mcData);
  const shaped = !!recipe.inShape;
  const shape = buildShapeNames(recipe.inShape, mcData);

  return {
    station: recipe.requiresTable ? "crafting_table" : "hand",
    shaped,
    outputs,
    inputs,
    shape
  };
}

function normalizeIngredientInput(raw) {
  if (!raw) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw;
  return [];
}

function normalizeCount(count) {
  const num = Number(count);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.max(1, Math.floor(num));
}

function scaleDescriptor(descriptor, factor) {
  const scale = (arr) => arr.map(entry => ({ ...entry, count: (entry.count || 1) * factor }));
  return {
    ...descriptor,
    outputs: scale(descriptor.outputs || []),
    inputs: scale(descriptor.inputs || [])
  };
}

function listRecipesFor(bot, itemName, count = 1) {
  const mcData = ensureMcData(bot);
  const item = resolveItem(mcData, itemName, "item");
  const { Recipe } = prismarineRecipe(mcData);
  const factor = normalizeCount(count);

  const recipeEnums = mcData.recipes[item.id] || [];
  const recipes = recipeEnums.map(r => new Recipe(r));
  const seen = new Set();

  const descriptors = [];
  for (const recipe of recipes) {
    const descriptor = buildRecipeDescriptor(recipe, mcData);
    const key = JSON.stringify(descriptor);
    if (seen.has(key)) continue;
    seen.add(key);
    descriptors.push(scaleDescriptor(descriptor, factor));
  }

  return {
    item: item.name,
    count: factor,
    recipes: descriptors
  };
}

function recipeUsesIngredients(recipeDescriptor, ingredients, mode) {
  if (ingredients.length === 0) return false;

  const inputNames = new Set(recipeDescriptor.inputs.map(i => i.name));

  if (mode === "or") {
    return ingredients.some(name => inputNames.has(name));
  }

  // default: and
  return ingredients.every(name => inputNames.has(name));
}

function listRecipesUsing(bot, ingredientInput, mode = "and") {
  const mcData = ensureMcData(bot);
  const ingredients = normalizeIngredientInput(ingredientInput);
  if (ingredients.length === 0) {
    throw new Error("ingredients が指定されていません");
  }

  // validate ingredients exist
  ingredients.forEach(name => resolveItem(mcData, name, "ingredients"));

  const { Recipe } = prismarineRecipe(mcData);
  const results = [];
  const seen = new Set();

  for (const [idStr, recipeEnums] of Object.entries(mcData.recipes || {})) {
    const itemId = Number(idStr);
    const outputItem = mcData.items[itemId];
    if (!outputItem) continue;

    for (const recipeEnum of recipeEnums) {
      const recipe = new Recipe(recipeEnum);
      const descriptor = buildRecipeDescriptor(recipe, mcData);
      if (!recipeUsesIngredients(descriptor, ingredients, mode)) continue;

      const key = JSON.stringify({ item: outputItem.name, descriptor });
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        item: outputItem.name,
        ...descriptor
      });
    }
  }

  return {
    ingredients,
    mode,
    results
  };
}

module.exports = {
  listRecipesFor,
  listRecipesUsing
};
