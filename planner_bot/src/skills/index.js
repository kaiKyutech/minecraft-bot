const gatherLogs = require('./gather_logs')
const craftPlanks = require('./craft_planks')
const craftSticks = require('./craft_sticks')
const ensureWorkbench = require('./ensure_workbench')
const craftWoodenPickaxe = require('./craft_wooden_pickaxe')

module.exports = {
  gather_logs: gatherLogs,
  craft_planks: craftPlanks,
  craft_sticks: craftSticks,
  ensure_workbench: ensureWorkbench,
  craft_wooden_pickaxe: craftWoodenPickaxe
}
