const gather = require('./gather')
const handCraft = require('./hand_craft')
const workbenchCraft = require('./workbench_craft')
const moveTo = require('./move_to')
const placeBlock = require('./place_block')
const furnaceSmelt = require('./furnace_smelt')
const collectDrops = require('./collect_drops')
const equipArmor = require('./equip_armor')
const equipMainhand = require('./equip_mainhand')

module.exports = {
  gather,
  hand_craft: handCraft,
  workbench_craft: workbenchCraft,
  move_to: moveTo,
  place_block: placeBlock,
  furnace_smelt: furnaceSmelt,
  collect_drops: collectDrops,
  equip_armor: equipArmor,
  equip_mainhand: equipMainhand
}
