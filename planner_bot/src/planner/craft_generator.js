const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const minecraftData = require("minecraft-data");
const { createLogger } = require("../utils/logger");
const { loadBlockCategories } = require("./state_builder");

const GENERATED_DIR = path.join(__dirname, "../../config/actions_generated");
const HAND_FILE = path.join(GENERATED_DIR, "hand_craft_auto.yaml");
const WORKBENCH_FILE = path.join(GENERATED_DIR, "workbench_craft_auto.yaml");
const DEFAULT_COST = 10;
// countカテゴリを材料として扱う際に、カテゴリ化を許可するもの（plankは任意種で代用可）
const CATEGORY_INGREDIENTS_ALLOWED = new Set(["plank"]);

let generationPromise = null;

/**
 * hand_craft / workbench_craft のアクションを minecraft-data から自動生成する。
 * gather と同様に、起動ごとに毎回ファイルを上書き生成する。
 * @param {string} version - minecraft-data で使用するバージョン
 */
function ensureCraftActionsGenerated(version) {
  if (generationPromise) return generationPromise;
  generationPromise = generateCraftActions(version);
  return generationPromise;
}

async function generateCraftActions(version) {
  const logger = createLogger({ category: "setup" });
  const mcVersion = version || "1.20.1";

  let mcData;
  try {
    mcData = minecraftData(mcVersion);
  } catch (error) {
    logger.warn(`[AUTO-CRAFT] minecraft-data("${mcVersion}") の読み込みに失敗: ${error.message}`);
    return { hand: [], workbench: [] };
  }

  const { allowedHand, allowedWorkbench } = loadAllowedRecipesFromStatic();
  const categories = loadBlockCategories();
  const itemCategories = categories?.item_categories || {};
  const itemToCountCategories = buildItemCategoryLookup(itemCategories, "count");
  const itemToBooleanCategories = buildItemCategoryLookup(itemCategories, "boolean");
  const categoryVariantResults = findCategoryVariantResults(mcData.recipes || {}, mcData, itemToCountCategories);

  const recipes = mcData.recipes || {};
  const handActions = [];
  const workbenchActions = [];
  let addedLogToPlankCategory = false;
  const seen = {
    hand: new Set(),
    workbench: new Set()
  };

  for (const [resultIdStr, recipeList] of Object.entries(recipes)) {
    if (!Array.isArray(recipeList) || recipeList.length === 0) continue;
    const resultId = Number(resultIdStr);
    const resultItem = mcData.items[resultId];
    if (!resultItem) continue;
    const resultName = resultItem.name;

    for (let idx = 0; idx < recipeList.length; idx++) {
      const recipe = recipeList[idx];
      const parsed = parseRecipe(recipe, mcData);
      if (!parsed) continue;

      const { ingredients, craftingType } = parsed;
      if (ingredients.size === 0) continue;

      // 原木→板はカテゴリ版を1つだけ追加（任意の原木→板カテゴリ）
      if (
        craftingType === "hand" &&
        resultName.endsWith("_planks") &&
        hasIngredientCategory(ingredients, itemToCountCategories, "log") &&
        !addedLogToPlankCategory
      ) {
        handActions.push(buildLogToPlankCategoryAction());
        addedLogToPlankCategory = true;
      }

      const resultCount = Math.max(1, recipe?.result?.count || 1);
      const targetList = craftingType === "hand" ? handActions : workbenchActions;
      const targetSeen = seen[craftingType];
      const allowCategory = categoryVariantResults.has(resultName);
      const hasAllowedCategoryIngredient = allowCategory && hasAnyAllowedIngredientCategory(ingredients, itemToCountCategories);
      const useItemCategories = allowCategory && hasAllowedCategoryIngredient;

      // 生成対象フィルタ（最小構成用）
      if (craftingType === "hand") {
        if (!isHandAllowed(resultName, allowedHand)) continue;
      } else {
        if (!allowedWorkbench.has(resultName)) continue;
      }

      // 同一成果物は最初の1件だけにする
      if (targetSeen.has(resultName)) continue;
      targetSeen.add(resultName);

      const { preconditions, effects } = buildActionParts({
        ingredients,
        resultName,
        resultCount,
        craftingType,
        itemToCountCategories,
        itemToBooleanCategories,
        includeCountCategoryEffects: false,
        useItemCategories
      });

      const actionName = `auto_${craftingType}_craft_${resultName}`;

      targetList.push({
        name: actionName,
        preconditions,
        effects,
        cost: DEFAULT_COST,
        skill: craftingType === "hand" ? "hand_craft" : "workbench_craft",
        params: {
          recipe: resultName,
          count: 1
        }
      });
    }
  }

  writeYaml(logger, HAND_FILE, handActions, "hand_craft");
  writeYaml(logger, WORKBENCH_FILE, workbenchActions, "workbench_craft");

  return {
    hand: handActions,
    workbench: workbenchActions
  };
}

function parseRecipe(recipe, mcData) {
  if (!recipe) return null;

  if (recipe.inShape) {
    const { counts, width, height } = extractFromShape(recipe.inShape, mcData);
    if (counts.size === 0) return null;
    const craftingType = width <= 2 && height <= 2 ? "hand" : "workbench";
    return { ingredients: counts, craftingType };
  }

  if (recipe.ingredients) {
    const counts = new Map();
    for (const ingredientId of recipe.ingredients) {
      const item = mcData.items[ingredientId];
      if (!item) continue;
      counts.set(item.name, (counts.get(item.name) || 0) + 1);
    }
    if (counts.size === 0) return null;
    const craftingType = recipe.ingredients.length <= 4 ? "hand" : "workbench";
    return { ingredients: counts, craftingType };
  }

  return null;
}

function extractFromShape(inShape, mcData) {
  const counts = new Map();
  let height = Array.isArray(inShape) ? inShape.length : 0;
  let width = 0;

  if (!Array.isArray(inShape)) {
    return { counts, width: 0, height: 0 };
  }

  for (const row of inShape) {
    if (!Array.isArray(row)) continue;
    width = Math.max(width, row.length);
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      const item = mcData.items[cell];
      if (!item) continue;
      counts.set(item.name, (counts.get(item.name) || 0) + 1);
    }
  }

  return { counts, width, height };
}

function buildActionParts({
  ingredients,
  resultName,
  resultCount,
  craftingType,
  itemToCountCategories,
  itemToBooleanCategories = new Map(),
  includeCountCategoryEffects = false,
  useItemCategories = false,
  includeResultBooleanCategories = true
}) {
  const numericEffects = new Map();
  const preconditions = {};
  const categoryNeeds = useItemCategories ? new Map() : null; // category名 -> 必要数

  // 前提: 材料の所持
  for (const [itemName, qty] of ingredients.entries()) {
    const countCats = useItemCategories ? Array.from(itemToCountCategories.get(itemName) || []) : [];
    const categoryForIngredient = useItemCategories
      ? countCats.find((cat) => CATEGORY_INGREDIENTS_ALLOWED.has(cat))
      : null;

    if (useItemCategories && categoryForIngredient) {
      // plankなど任意種で代用できる材料はカテゴリ前提に置き換える
      preconditions[`inventory.category.${categoryForIngredient}`] = `>= ${qty}`;
      addNumericEffect(numericEffects, `inventory.category.${categoryForIngredient}`, -qty);
      categoryNeeds.set(categoryForIngredient, (categoryNeeds.get(categoryForIngredient) || 0) + qty);
    } else {
      preconditions[`inventory.${itemName}`] = `>= ${qty}`;
      addNumericEffect(numericEffects, `inventory.${itemName}`, -qty);
    }

    if (useItemCategories) {
      for (const cat of countCats) {
        if (categoryForIngredient && cat === categoryForIngredient) continue;
        categoryNeeds.set(cat, (categoryNeeds.get(cat) || 0) + qty);
        addNumericEffect(numericEffects, `inventory.category.${cat}`, -qty);
      }
    }
  }

  if (craftingType === "workbench") {
    preconditions.nearby_workbench = true;
  }

  if (useItemCategories && categoryNeeds) {
    for (const [cat, need] of categoryNeeds.entries()) {
      preconditions[`inventory.category.${cat}`] = `>= ${need}`;
    }
  }

  // 成果物の追加
  addNumericEffect(numericEffects, `inventory.${resultName}`, resultCount);
  if (useItemCategories && includeCountCategoryEffects) {
    for (const cat of itemToCountCategories.get(resultName) || []) {
      addNumericEffect(numericEffects, `inventory.category.${cat}`, resultCount);
    }
  }

  const effects = {};

  for (const [key, delta] of numericEffects.entries()) {
    if (delta === 0) continue;
    effects[key] = delta > 0 ? `+${delta}` : `${delta}`;
  }
  if (includeResultBooleanCategories) {
    for (const cat of itemToBooleanCategories.get(resultName) || []) {
      effects[`inventory.category.${cat}`] = true;
    }
  }

  return { preconditions, effects };
}

function addNumericEffect(map, key, delta) {
  map.set(key, (map.get(key) || 0) + delta);
}

function buildItemCategoryLookup(itemCategories, typeFilter) {
  const lookup = new Map();

  for (const [categoryName, cfg] of Object.entries(itemCategories)) {
    if (cfg.type !== typeFilter) continue;
    for (const item of cfg.items || []) {
      if (!lookup.has(item)) lookup.set(item, new Set());
      lookup.get(item).add(categoryName);
    }
  }

  return lookup;
}

function hasIngredientCategory(ingredients, itemToCountCategories, targetCategory) {
  for (const itemName of ingredients.keys()) {
    const cats = itemToCountCategories.get(itemName) || [];
    if (cats instanceof Set ? cats.has(targetCategory) : Array.isArray(cats) ? cats.includes(targetCategory) : false) {
      return true;
    }
  }
  return false;
}

function hasAnyAllowedIngredientCategory(ingredients, itemToCountCategories) {
  for (const allowed of CATEGORY_INGREDIENTS_ALLOWED) {
    if (hasIngredientCategory(ingredients, itemToCountCategories, allowed)) {
      return true;
    }
  }
  return false;
}

function buildLogToPlankCategoryAction() {
  return {
    name: "auto_hand_craft_planks_from_logs_category",
    preconditions: {
      "inventory.category.log": ">= 1"
    },
    effects: {
      "inventory.category.log": "-1",
      "inventory.category.plank": "+4"
    },
    cost: DEFAULT_COST,
    skill: "hand_craft",
    params: {
      recipe: "log_to_planks",
      count: 1
    }
  };
}

function writeYaml(logger, filepath, actions, label) {
  try {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    const yaml = YAML.stringify({ actions });
    fs.writeFileSync(filepath, yaml, "utf8");
    logger.info(`[AUTO-CRAFT] ${actions.length} 個の${label}アクションを自動生成しました → ${path.relative(process.cwd(), filepath)}`);
  } catch (error) {
    logger.error(`[AUTO-CRAFT] ${label} の YAML 出力に失敗: ${error.message}`);
  }
}

module.exports = {
  ensureCraftActionsGenerated,
  generateCraftActions
};

// 同一成果物で CATEGORY_INGREDIENTS_ALLOWED に属する材料が複数種存在する場合、
// カテゴリ前提でまとめられる成果物名を収集する
function findCategoryVariantResults(recipes, mcData, itemToCountCategories) {
  const results = new Set();

  for (const [resultIdStr, recipeList] of Object.entries(recipes)) {
    if (!Array.isArray(recipeList) || recipeList.length === 0) continue;
    const resultItem = mcData.items[Number(resultIdStr)];
    if (!resultItem) continue;

    const categoryToItems = new Map(); // category -> Set(itemName)

    for (const recipe of recipeList) {
      const parsed = parseRecipe(recipe, mcData);
      if (!parsed) continue;
      for (const itemName of parsed.ingredients.keys()) {
        for (const cat of itemToCountCategories.get(itemName) || []) {
          if (!CATEGORY_INGREDIENTS_ALLOWED.has(cat)) continue;
          if (!categoryToItems.has(cat)) categoryToItems.set(cat, new Set());
          categoryToItems.get(cat).add(itemName);
        }
      }
    }

    for (const items of categoryToItems.values()) {
      if (items.size > 1) {
        results.add(resultItem.name);
        break;
      }
    }
  }

  return results;
}

// 既存の静的 YAML から生成対象レシピ名を収集し、最小構成で自動生成する
function loadAllowedRecipesFromStatic() {
  const handPath = path.join(__dirname, "../../config/actions/hand_craft_actions.yaml");
  const workPath = path.join(__dirname, "../../config/actions/workbench_craft_actions.yaml");

  const allowedHand = {
    exact: new Set(["stick", "crafting_table", "torch", "bread"]),
    suffix: ["_planks"]
  };
  const allowedWorkbench = new Set();

  try {
    const raw = fs.readFileSync(handPath, "utf8");
    const parsed = YAML.parse(raw);
    for (const action of parsed?.actions || []) {
      const recipe = action?.params?.recipe;
      if (typeof recipe !== "string") continue;
      if (recipe === "log_to_planks") continue; // suffixで拾う
      if (recipe === "planks_to_sticks") {
        allowedHand.exact.add("stick");
        continue;
      }
      if (recipe === "crafting_table") {
        allowedHand.exact.add("crafting_table");
        continue;
      }
      if (recipe === "torch_from_charcoal" || recipe === "torch_from_coal") {
        allowedHand.exact.add("torch");
        continue;
      }
      allowedHand.exact.add(recipe);
    }
  } catch (_) {}

  try {
    const raw = fs.readFileSync(workPath, "utf8");
    const parsed = YAML.parse(raw);
    for (const action of parsed?.actions || []) {
      const recipe = action?.params?.recipe;
      if (typeof recipe === "string") {
        allowedWorkbench.add(recipe);
      }
    }
  } catch (_) {}

  return { allowedHand, allowedWorkbench };
}

function isHandAllowed(resultName, allowed) {
  if (allowed.exact.has(resultName)) return true;
  return allowed.suffix.some((suf) => resultName.endsWith(suf));
}
