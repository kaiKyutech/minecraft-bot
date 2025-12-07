const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const minecraftData = require('minecraft-data');
const { loadBlockCategories } = require('./state_builder');
const { createLogger } = require('../utils/logger');

const GENERATED_DIR = path.join(__dirname, '../../config/actions_generated');
const GENERATED_FILE = path.join(GENERATED_DIR, 'gather_auto.yaml');
const DEFAULT_COUNTS = [1, 3, 8];
// null/undefined ならフィルタなし、Setならそのカテゴリのみ生成
const TARGET_CATEGORIES = null;

let generationPromise = null;

/**
 * gather_actions.yaml の代替として、起動時にminecraft-dataから自動生成する。
 * 毎回上書き生成し、GOAPのドメイン読み込み時に参照できるようにする。
 * @param {string} version - minecraft-dataで使用するバージョン（bot.version推奨）
 */
function ensureGatherActionsGenerated(version) {
  if (generationPromise) return generationPromise;
  generationPromise = generateGatherActions(version);
  return generationPromise;
}

async function generateGatherActions(version) {
  const logger = createLogger({ category: 'setup' });
  const mcVersion = version || '1.20.1';

  let mcData;
  try {
    mcData = minecraftData(mcVersion);
  } catch (error) {
    logger.warn(`[AUTO-GATHER] minecraft-data("${mcVersion}") の読み込みに失敗: ${error.message}`);
    return [];
  }

  const categories = loadBlockCategories();
  const blockCategories = categories?.categories || {};
  const itemCategories = categories?.item_categories || {};

  const itemToCategoryCounts = buildItemCategoryLookup(itemCategories);
  // block_categories に載っているブロックは二重生成を避けるため除外
  const categoryBlockSet = new Set();
  for (const cfg of Object.values(blockCategories)) {
    (cfg.blocks || []).forEach((b) => categoryBlockSet.add(b));
  }
  const actions = [];

  for (const [categoryName, categoryConfig] of Object.entries(blockCategories)) {
    const blocks = categoryConfig.blocks || [];
    if (blocks.length === 0) continue;

    // 代表ブロックからツール要件を推定
    const representativeName = blocks.find((b) => mcData.blocksByName[b]);
    const representative = representativeName ? mcData.blocksByName[representativeName] : null;
    const categoryToolReq = representative ? resolveToolRequirement(mcData, representative) : null;
    const categoryDrop = representative ? getPrimaryDrop(mcData, representative) : null;

    // カテゴリgather（最寄りの任意ブロックを掘る）を追加
    actions.push(...buildCategoryActions(categoryName, categoryToolReq, categoryDrop));

    // フィルタがある場合のみ限定生成（個別ブロック）
    if (TARGET_CATEGORIES instanceof Set && !TARGET_CATEGORIES.has(categoryName)) continue;

    // カテゴリ内の全ブロックについてアクション生成（個別指定）
    for (const blockName of blocks) {
      const block = mcData.blocksByName[blockName];
      if (!block) continue;

      const dropName = getPrimaryDrop(mcData, block);
      if (!dropName) {
        logger.debug(`[AUTO-GATHER] ドロップ不明のためスキップ: ${blockName}`);
        continue;
      }

      const toolReq = resolveToolRequirement(mcData, block);
      const hardness = typeof block.hardness === 'number' ? block.hardness : 1;
      const variants = buildVariants(categoryName, toolReq);

      for (const variant of variants) {
        for (const count of DEFAULT_COUNTS) {
          const action = buildAction({
            categoryName,
            blockName,
            count,
            dropName,
            toolRequirement: variant.toolRequirement,
            costScale: variant.costScale,
            hardness,
            itemToCategoryCounts
          });
          actions.push(action);
        }
      }
    }
  }

  // 全ブロック個別gather（x1のみ）を追加（掘れるもの＆ドロップあり）
  const allBlocks = Object.values(mcData.blocksByName || {});
  const blacklist = new Set(['air', 'cave_air', 'void_air', 'barrier', 'bedrock', 'flowing_water', 'water', 'lava', 'flowing_lava']);
  for (const block of allBlocks) {
    if (!block || blacklist.has(block.name)) continue;
    if (categoryBlockSet.has(block.name)) continue; // 調整済みカテゴリに属するブロックはスキップ
    if (block.diggable === false) continue;

    const dropName = mcData.items[block.drops[0]]?.name || null;
    const effectiveDrop = dropName || block.name;
    const toolReq = resolveToolRequirement(mcData, block);
    const preconditions = {
      inventory_space: true,
      [`nearby.${block.name}`]: '>= 1'
    };
    if (toolReq?.precondition) {
      preconditions[toolReq.precondition] = true;
    }

    const effects = {};
    effects[`inventory.${block.name}`] = '+1';
    if (effectiveDrop && effectiveDrop !== block.name) {
      effects[`inventory.${effectiveDrop}`] = '+1';
    }

    const perUnit = toolReq ? 1 : 5;
    actions.push({
      name: `auto_gather_${block.name}_x1`,
      preconditions,
      effects,
      cost: perUnit,
      skill: 'gather',
      params: {
        itemName: block.name,
        count: 1
      }
    });
  }

  if (actions.length === 0) {
    logger.warn('[AUTO-GATHER] 生成されたアクションがありませんでした');
    return [];
  }

  // YAMLに出力
  try {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    if (fs.existsSync(GENERATED_FILE)) {
      const backupPath = path.join(GENERATED_DIR, 'gather_auto.backup.yaml');
      fs.copyFileSync(GENERATED_FILE, backupPath);
      logger.info(`[AUTO-GATHER] 既存ファイルをバックアップ: ${path.relative(process.cwd(), backupPath)}`);
    }
    const yaml = YAML.stringify({ actions });
    fs.writeFileSync(GENERATED_FILE, yaml, 'utf8');
    logger.info(`[AUTO-GATHER] ${actions.length} 個のgatherアクションを自動生成しました → ${path.relative(process.cwd(), GENERATED_FILE)}`);
  } catch (error) {
    logger.error(`[AUTO-GATHER] YAML出力に失敗: ${error.message}`);
  }

  return actions;
}

function buildItemCategoryLookup(itemCategories) {
  const lookup = new Map();
  for (const [categoryName, cfg] of Object.entries(itemCategories)) {
    if (cfg.type !== 'count') continue;
    for (const item of cfg.items || []) {
      if (!lookup.has(item)) lookup.set(item, new Set());
      lookup.get(item).add(categoryName);
    }
  }
  return lookup;
}

function getPrimaryDrop(mcData, block) {
  if (!block) return null;
  if (!Array.isArray(block.drops) || block.drops.length === 0) {
    // ドロップ未定義の場合はブロック自体を落とすものとして扱う
    return block.name;
  }
  const itemId = block.drops[0];
  const item = mcData.items[itemId];
  return item ? item.name : block.name;
}

function resolveToolRequirement(mcData, block) {
  if (!block.harvestTools) return null;
  const toolIds = Object.keys(block.harvestTools);
  const toolNames = toolIds
    .map((id) => mcData.items[id]?.name)
    .filter(Boolean);

  // shearsが指定されている場合は最優先（葉・雪など）
  const hasShears = toolNames.some((n) => n === 'shears');
  if (hasShears) return { precondition: 'inventory.category.shears', label: 'shears' };

  // shovel系（高速化用バリアント）
  const hasShovel = toolNames.some((n) => n && n.endsWith('_shovel'));
  if (hasShovel) return { precondition: 'inventory.category.shovel', label: 'shovel' };

  // pickaxe系は「必要な最小レベル」を採用する
  const hasWood = toolNames.some((n) => n === 'wooden_pickaxe' || n === 'golden_pickaxe');
  const hasStone = toolNames.some((n) => n === 'stone_pickaxe');
  const hasIron = toolNames.some((n) => n === 'iron_pickaxe');
  const hasDiamond = toolNames.some((n) => n === 'diamond_pickaxe' || n === 'netherite_pickaxe');

  // diamond/netherite のみ指定されている場合はダイヤ以上必須
  if (hasDiamond && !hasIron && !hasStone && !hasWood) {
    return { precondition: 'inventory.category.diamond_or_better_pickaxe', label: 'pickaxe' };
  }

  // iron 以上のみ指定
  if (hasIron && !hasStone && !hasWood) {
    return { precondition: 'inventory.category.iron_or_better_pickaxe', label: 'pickaxe' };
  }

  // stone 以上のみ指定
  if (hasStone && !hasWood) {
    return { precondition: 'inventory.category.stone_or_better_pickaxe', label: 'pickaxe' };
  }

  // 最低レベルのpickaxeでOK
  if (hasWood) {
    return { precondition: 'inventory.category.pickaxe', label: 'pickaxe' };
  }

  const hasAxe = toolNames.some((n) => n && n.endsWith('_axe'));
  if (hasAxe) return { precondition: 'inventory.category.axe', label: 'axe' };

  return null;
}

function buildVariants(categoryName, toolRequirement) {
  // 1) harvestToolsに基づく「必須ツール」バリアント
  const variants = [{
    toolRequirement,
    costScale: 1
  }];

  // 2) ログなど、ツール不要だが効率ツールがあり得るカテゴリに対しては「素手」も作る
  if (!toolRequirement) {
    variants.push({
      toolRequirement: null,
      costScale: categoryName === 'log' ? 3 : 1.5  // 素手は高コストに
    });
    // 斧を推奨するカテゴリには斧バリアントを追加
    if (categoryName === 'log') {
      variants.push({
        toolRequirement: { precondition: 'inventory.category.axe', label: 'axe' },
        costScale: 0.8
      });
    }
  }

  return dedupeVariants(variants);
}

function dedupeVariants(variants) {
  const seen = new Set();
  return variants.filter((v) => {
    const key = v.toolRequirement?.precondition || 'none';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAction({ categoryName, blockName, count, dropName, toolRequirement, costScale, hardness, itemToCategoryCounts }) {
  const toolLabel = toolRequirement ? toolRequirement.label : 'barehand';
  const name = `auto_gather_${blockName}_${toolLabel}_x${count}`;

  const effects = {};
  // 掘ったブロック（blockName）のみ加算（ドロップはカテゴリ/代表に任せる）
  effects[`inventory.${blockName}`] = `+${count}`;

  // 個別ブロックgatherは個別アイテムのみ加算（カテゴリは含めない）

  const preconditions = {
    inventory_space: true,
    [`nearby.${blockName}`]: `>= ${count}`
  };
  if (toolRequirement?.precondition) {
    preconditions[toolRequirement.precondition] = true;
  }

  // コスト: ツールありなら1/ブロック、素手なら5/ブロック + まとめ取り割引
  const perUnit = toolRequirement ? 1 : 5;
  // 割引係数（カテゴリ優先で安くするためにさらに強めにする）
  const discounts = { 1: 1.0, 3: 0.5, 8: 0.25 };
  const discount = discounts[count] ?? 1.0;
  const cost = Math.max(1, Math.round(perUnit * count * discount));

  return {
    name,
    preconditions,
    effects,
    cost,
    skill: 'gather',
    params: {
      itemName: blockName,
      count
    }
  };
}

function buildCategoryActions(categoryName, toolRequirement, categoryDrop) {
  // カテゴリを指定して最寄りのブロックを掘るバリエーション（コストは個別より安く設定）
  const actions = [];
  const preBase = {
    inventory_space: true,
    [`nearby.category.${categoryName}`]: '>= 1'
  };

  const perUnitTool = 1;
  const perUnitBare = 5;
  const discounts = { 1: 0.5, 3: 0.35, 8: 0.2 }; // カテゴリ優先のため個別より安め

  for (const count of DEFAULT_COUNTS) {
    // ツール要件があるカテゴリ（石/鉱石など）はツール前提のみ
    if (toolRequirement && toolRequirement.precondition) {
      const label = toolRequirement.label || 'pickaxe'
      actions.push({
        name: `auto_gather_${categoryName}_category_${label}_x${count}`,
        preconditions: { ...preBase, [`nearby.category.${categoryName}`]: `>= ${count}`, [toolRequirement.precondition]: true },
        effects: {
          [`inventory.category.${categoryName}`]: `+${count}`,
          ...(categoryDrop && categoryName !== 'log' ? { [`inventory.${categoryDrop}`]: `+${count}` } : {})
        },
        cost: Math.max(1, Math.round(perUnitTool * count * (discounts[count] ?? 1))),
        skill: 'gather',
        params: {
          itemName: categoryName,
          count
        }
      });
      continue;
    }

    // ツール要件が無いカテゴリ（logなど）は素手＋（場合によっては斧）を用意
    actions.push({
      name: `auto_gather_${categoryName}_category_barehand_x${count}`,
      preconditions: { ...preBase, [`nearby.category.${categoryName}`]: `>= ${count}` },
      effects: {
        [`inventory.category.${categoryName}`]: `+${count}`
      },
      cost: Math.max(1, Math.round(perUnitBare * count * (discounts[count] ?? 1))),
      skill: 'gather',
      params: {
        itemName: categoryName,
        count
      }
    });

    // logカテゴリだけは斧バリアントも用意（コストはさらに低く）
    if (categoryName === 'log') {
      const axeDiscount = discounts[count] ?? 1;
      actions.push({
        name: `auto_gather_${categoryName}_category_axe_x${count}`,
        preconditions: { ...preBase, [`nearby.category.${categoryName}`]: `>= ${count}`, 'inventory.category.axe': true },
        effects: {
          [`inventory.category.${categoryName}`]: `+${count}`
        },
        cost: Math.max(1, Math.round(perUnitTool * count * axeDiscount * 0.8)), // 斧はさらに割引
        skill: 'gather',
        params: {
          itemName: categoryName,
          count
        }
      });
    }
  }

  return actions;
}

module.exports = {
  ensureGatherActionsGenerated,
  generateGatherActions
};
