const fs = require('fs')
const path = require('path')
const YAML = require('yaml')
const { createLogger } = require('../utils/logger')
const ACTIONS_DIR = path.join(__dirname, '../../config/actions')
// 自動生成アクションを使うかどうか（手動で切り替えやすいように固定値にしています）
const USE_AUTO_GATHER = true
const USE_AUTO_CRAFT = true
const ACTION_FILES = [
  'gather_actions.yaml',
  'hand_craft_actions.yaml',
  'workbench_craft_actions.yaml',
  'movement_actions.yaml',
  'furnace_actions.yaml',
  'equipment_actions.yaml'
]

function readDomain(GENERATED_ACTIONS_DIR, logger) {

  // 複数のアクションファイルを読み込んでマージ
  let allActions = []
  let hasGeneratedGather = false
  let hasGeneratedHandCraft = false
  let hasGeneratedWorkbenchCraft = false

  // 1) 自動生成されたアクションを優先して読み込む（backup.yamlは除外）
  if (fs.existsSync(GENERATED_ACTIONS_DIR)) {
    const generatedFiles = fs.readdirSync(GENERATED_ACTIONS_DIR)
      .filter(f => f.endsWith('.yaml') && !f.includes('.backup.')).sort()
    for (const filename of generatedFiles) {
      const lower = filename.toLowerCase()
      if (!USE_AUTO_GATHER && lower.includes('gather')) continue
      if (!USE_AUTO_CRAFT && (lower.includes('hand_craft') || lower.includes('workbench_craft'))) continue
      const filepath = path.join(GENERATED_ACTIONS_DIR, filename)
      try {
        const raw = fs.readFileSync(filepath, 'utf8')
        const parsed = YAML.parse(raw)
        if (parsed && Array.isArray(parsed.actions)) {
          allActions = allActions.concat(parsed.actions)
          const lower = filename.toLowerCase()
          if (lower.includes('gather')) hasGeneratedGather = true
          if (lower.includes('hand_craft')) hasGeneratedHandCraft = true
          if (lower.includes('workbench_craft')) hasGeneratedWorkbenchCraft = true
          const skillSet = new Set(parsed.actions.map(a => a && a.skill))
          if (skillSet.has('gather')) hasGeneratedGather = true
          if (skillSet.has('hand_craft')) hasGeneratedHandCraft = true
          if (skillSet.has('workbench_craft')) hasGeneratedWorkbenchCraft = true
          logger.info(`[GOAP] ${filename} (generated) から ${parsed.actions.length} 個のアクションを読み込みました`)
        }
      } catch (error) {
        logger.error(`[GOAP] ${filename} (generated) の読み込みに失敗: ${error.message}`)
      }
    }
  }

  // 2) 静的ファイルを読み込む（生成済みgatherがある場合は元のgather_actions.yamlをスキップ）
  for (const filename of ACTION_FILES) {
    if (filename === 'gather_actions.yaml' && hasGeneratedGather && USE_AUTO_GATHER) {
      logger.info('[GOAP] 自動生成されたgatherアクションを優先するため gather_actions.yaml はスキップしました')
      continue
    }
    if (filename === 'hand_craft_actions.yaml' && hasGeneratedHandCraft && USE_AUTO_CRAFT) {
      logger.info('[GOAP] 自動生成されたhand_craftアクションを優先するため hand_craft_actions.yaml はスキップしました')
      continue
    }
    if (filename === 'workbench_craft_actions.yaml' && hasGeneratedWorkbenchCraft && USE_AUTO_CRAFT) {
      logger.info('[GOAP] 自動生成されたworkbench_craftアクションを優先するため workbench_craft_actions.yaml はスキップしました')
      continue
    }
    const filepath = path.join(ACTIONS_DIR, filename)
    try {
      const raw = fs.readFileSync(filepath, 'utf8')
      const parsed = YAML.parse(raw)
      if (parsed && Array.isArray(parsed.actions)) {
        allActions = allActions.concat(parsed.actions)
        logger.info(`[GOAP] ${filename} から ${parsed.actions.length} 個のアクションを読み込みました`)
      }
    } catch (error) {
      logger.error(`[GOAP] ${filename} の読み込みに失敗: ${error.message}`)
    }
  }

  if (allActions.length === 0) {
    throw new Error('アクションが1つも読み込まれませんでした')
  }

  const domain = { actions: allActions }
  logger.info(`[GOAP] 合計 ${allActions.length} 個のアクションを読み込みました`)
  return domain
}

const CACHE_ROOT = path.resolve(__dirname, '../../../.cache/minecraft-bot/actions')
const GENERATED_FILES = ['equipment_auto.yaml', 'gather_auto.yaml', 'hand_craft_auto.yaml', 'workbench_craft_auto.yaml']
let selectedVersion = null
let preparation = null
let preparedDomain = null

function domainError(code, message) {
  return Object.assign(new Error(message), { code })
}

function prepareDomain(version, logger = createLogger({ category: 'setup' })) {
  const resolved = version || selectedVersion || process.env.MC_VERSION || '1.20.1'
  if (typeof resolved !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(resolved)) {
    return Promise.reject(domainError('INVALID_ARGUMENT', 'Minecraft version must be a version number'))
  }
  if (selectedVersion && selectedVersion !== resolved) {
    return Promise.reject(domainError('VERSION_CONFLICT', `This process uses Minecraft ${selectedVersion}; requested ${resolved}`))
  }
  if (preparation) return preparation
  selectedVersion = resolved
  preparation = (async () => {
    const outputDir = path.join(CACHE_ROOT, resolved)
    fs.mkdirSync(outputDir, { recursive: true })
    // Only a complete freshly generated domain is published to callers.
    const staging = fs.mkdtempSync(path.join(outputDir, 'prepare-'))
    const { ensureGatherActionsGenerated } = require('./gather_generator')
    const { ensureCraftActionsGenerated } = require('./craft_generator')
    const { ensureEquipmentActionsGenerated } = require('./equipment_generator')
    await ensureGatherActionsGenerated(resolved, staging)
    await ensureCraftActionsGenerated(resolved, staging)
    await ensureEquipmentActionsGenerated(resolved, staging)
    for (const filename of GENERATED_FILES) {
      const parsed = YAML.parse(fs.readFileSync(path.join(staging, filename), 'utf8'))
      if (!Array.isArray(parsed?.actions) || parsed.actions.length === 0) {
        throw new Error(`Missing generated actions: ${filename}`)
      }
    }
    const next = readDomain(staging, logger)
    const manifest = {
      version: resolved,
      generatorRevision: resolved === '1.21.4' ? 'variants-and-categories-v1' : 'legacy-v1',
      minecraftDataVersion: require('minecraft-data/package.json').version,
      categoriesHash: require('node:crypto').createHash('sha256')
        .update(JSON.stringify(require('./state_builder').loadBlockCategories(resolved))).digest('hex'),
      files: Object.fromEntries(GENERATED_FILES.map(filename => [filename, require('node:crypto').createHash('sha256')
        .update(fs.readFileSync(path.join(staging, filename))).digest('hex')]))
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    for (const filename of GENERATED_FILES) fs.renameSync(path.join(staging, filename), path.join(outputDir, filename))
    fs.renameSync(path.join(staging, 'manifest.json'), path.join(outputDir, 'manifest.json'))
    fs.rmdirSync(staging)
    preparedDomain = next
    return next
  })().catch(error => {
    preparation = null
    throw Object.assign(error, { code: 'DOMAIN_PREPARATION_FAILED' })
  })
  return preparation
}

function loadDomain() {
  if (!preparedDomain) throw domainError('DOMAIN_NOT_READY', 'Call prepareDomain(version) before reading the domain')
  return preparedDomain
}

function selectVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(version)) throw domainError('INVALID_ARGUMENT','Minecraft version must be a version number')
  if (selectedVersion && selectedVersion !== version) throw domainError('VERSION_CONFLICT', 'This process uses Minecraft '+selectedVersion+'; requested '+version)
  selectedVersion=version
}
function adoptPreparedDomain(version, domain) {
  selectVersion(version)
  if (!preparedDomain) { preparedDomain=domain; preparation=Promise.resolve(domain) }
  return preparedDomain
}
module.exports = { prepareDomain, loadDomain, USE_AUTO_GATHER, USE_AUTO_CRAFT, selectVersion, adoptPreparedDomain, getSelectedVersion: () => selectedVersion }
