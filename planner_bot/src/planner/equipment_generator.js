const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const minecraftData = require("minecraft-data");
const { createLogger } = require("../utils/logger");

const GENERATED_DIR = path.join(__dirname, "../../config/actions_generated");
const GENERATED_FILE = path.join(GENERATED_DIR, "equipment_auto.yaml");
const DEFAULT_COST = 1;

let generationPromise = null;

/**
 * equipment の自動生成（メインハンド装備）
 * 全アイテム（stackSize > 0, air/barrier除く）を equip_mainhand で持てるようにする。
 * @param {string} version - minecraft-data で使用するバージョン
 */
function ensureEquipmentActionsGenerated(version) {
  if (generationPromise) return generationPromise;
  generationPromise = generateEquipmentActions(version);
  return generationPromise;
}

async function generateEquipmentActions(version) {
  const logger = createLogger({ category: "setup" });
  const mcVersion = version || "1.20.1";

  let mcData;
  try {
    mcData = minecraftData(mcVersion);
  } catch (error) {
    logger.warn(`[AUTO-EQUIP] minecraft-data("${mcVersion}") の読み込みに失敗: ${error.message}`);
    return [];
  }

  const blacklist = new Set(["air", "cave_air", "void_air", "barrier", "light"]);
  const actions = [];
  const seen = new Set();

  for (const item of Object.values(mcData.itemsByName || {})) {
    if (!item) continue;
    if (blacklist.has(item.name)) continue;
    if (!item.stackSize || item.stackSize <= 0) continue;
    if (seen.has(item.name)) continue;
    seen.add(item.name);

    actions.push({
      name: `auto_equip_mainhand_${item.name}`,
      preconditions: {
        [`inventory.${item.name}`]: ">= 1"
      },
      effects: {
        [`equipment.${item.name}`]: true
      },
      cost: DEFAULT_COST,
      skill: "equip_mainhand",
      params: {
        item: item.name
      }
    });
  }

  try {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    const yaml = YAML.stringify({ actions });
    fs.writeFileSync(GENERATED_FILE, yaml, "utf8");
    logger.info(
      `[AUTO-EQUIP] ${actions.length} 個のequipアクションを自動生成しました → ${path.relative(
        process.cwd(),
        GENERATED_FILE
      )}`
    );
  } catch (error) {
    logger.error(`[AUTO-EQUIP] YAML 出力に失敗: ${error.message}`);
  }

  return actions;
}

module.exports = {
  ensureEquipmentActionsGenerated,
  generateEquipmentActions
};
