const gather = require('./gather')
const handCraft = require('./hand_craft')
const workbenchCraft = require('./workbench_craft')
const moveTo = require('./move_to')
const placeBlock = require('./place_block')

module.exports = {
  gather,
  hand_craft: handCraft,
  workbench_craft: workbenchCraft,
  move_to: moveTo,
  place_block: placeBlock
}
