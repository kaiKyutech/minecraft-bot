const fs = require('fs')
const path = require('path')
const YAML = require('yaml')

const CONFIG_PATH = path.join(__dirname, '../../config/actions.yaml')
let domain

function loadDomain() {
  if (domain) return domain
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  domain = YAML.parse(raw)
  return domain
}

function plan(goalName, state) {
  const domainConfig = loadDomain()
  if (!domainConfig || domainConfig.goal !== goalName) {
    console.warn(`goal ${goalName} is not defined in actions.yaml`)
    return null
  }

  // TODO: GOAP/A* 実装
  console.warn('GOAP planner not implemented yet')
  return []
}

module.exports = {
  plan
}
