// Research-only VM copies. Never writes or monkey-patches production modules.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const plannerDir = path.join(root, 'planner_bot/src/planner');
const ops = require(path.join(plannerDir, 'state_operations'));
const goals = require(path.join(plannerDir, 'goals'));
const heuristic = require(path.join(plannerDir, 'heuristic'));
const { buildState } = require(path.join(plannerDir, 'state_builder'));
const domain = require(path.join(plannerDir, 'domain'));

function replace(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`Study anchor changed: ${anchor}`);
  return source.replace(anchor, replacement);
}
function compile(name, source, substitutes = {}) {
  const filename = path.join(plannerDir, name), real = createRequire(filename), module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${source}\n})`, { filename })
    (key => Object.hasOwn(substitutes, key) ? substitutes[key] : real(key), module, module.exports, filename, plannerDir);
  return module.exports;
}
function indexedHeuristic(maxPreconditions = false) {
  let source = fs.readFileSync(path.join(plannerDir, 'heuristic.js'), 'utf8');
  source = replace(source, 'const candidates = []', `const candidates = []\n  let index = studyIndexes.get(actions)\n  if (!index) { index = new Map(); for (const a of actions) for (const k of Object.keys(a.effects || {})) { if (!index.has(k)) index.set(k, []); index.get(k).push(a) }; studyIndexes.set(actions,index) }`);
  // Only this loop exists in findActionsForRequirement; other loops use candidateActions.
  source = replace(source, 'for (const action of actions)', 'for (const action of (index.get(key) || []))');
  if (maxPreconditions) source = replace(source, 'preconditionCost += subCost', 'preconditionCost = Math.max(preconditionCost, subCost)');
  source = 'const studyIndexes = new WeakMap()\n' + source;
  const relevance = require(path.join(plannerDir, 'relevance'));
  const dependencies = relevance.loadCompositeStateDependencies();
  return compile('heuristic.js', source, { './relevance': { ...relevance, loadCompositeStateDependencies: () => dependencies } });
}
// Expose the existing 03 estimator from a VM copy, keeping its exact coefficients.
const estimator = compile('goal_evaluator.js', fs.readFileSync(path.join(plannerDir, 'goal_evaluator.js'), 'utf8') + '\nmodule.exports.study = { environment, estimate };').study;

function makePlanner({ indexed = false, cachedSignature = false, maxPreconditions = false, weight = 1, timeCost = false, stale = false, limit = 200 } = {}) {
  const metrics = {};
  let signatureCache;
  const reset = () => { signatureCache = new WeakMap(); Object.assign(metrics, { iterations: 0, expanded: 0, actionChecks: 0, transitions: 0, heuristicCalls: 0, heuristicMs: 0, stalePops: 0, maxOpen: 0, uniqueExpanded: new Set(), discovered: new Set() }); };
  reset();
  const selectedHeuristic = indexed || maxPreconditions ? indexedHeuristic(maxPreconditions) : heuristic;
  const measuredHeuristic = { ...selectedHeuristic, calculateHeuristic(...args) { const t = performance.now(); metrics.heuristicCalls++; try { return weight * selectedHeuristic.calculateHeuristic(...args); } finally { metrics.heuristicMs += performance.now() - t; } } };
  let source = fs.readFileSync(path.join(plannerDir, 'goap.js'), 'utf8');
  source = 'const study = require("__study")\n' + source;
  source = replace(source, 'iterations++', 'iterations++; study.metrics.iterations++');
  source = replace(source, 'const current = open.pop()', `const current = open.pop()\n    study.metrics.maxOpen = Math.max(study.metrics.maxOpen,open.size+1)\n    const studySig = serializeState(current.state)\n    if (visited.get(studySig) < current.cost) { study.metrics.stalePops++; ${stale ? 'continue' : ''} }`);
  source = replace(source, 'for (const action of filteredActions) {', 'study.metrics.expanded++; study.metrics.uniqueExpanded.add(studySig)\n    for (const action of filteredActions) { study.metrics.actionChecks++;');
  source = replace(source, 'const nextState = applyEffects(action.effects, current.state)', 'study.metrics.transitions++; const nextState = applyEffects(action.effects, current.state)');
  source = replace(source, 'visited.set(signature, totalCost)', 'visited.set(signature, totalCost); study.metrics.discovered.add(signature); study.metrics.maxOpen = Math.max(study.metrics.maxOpen,open.size+1)');
  // Identical byte representation; cache only immutable object identities within one plan call.
  function serialize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (signatureCache.has(value)) return signatureCache.get(value);
    const encoded = Array.isArray(value) ? '[' + value.map(serialize).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + serialize(value[k])).join(',') + '}';
    signatureCache.set(value, encoded); return encoded;
  }
  const planModule = compile('goap.js', source, { '__study': { metrics }, './options': { MAX_ITERATIONS: limit, YIELD_INTERVAL: 50 }, './heuristic': measuredHeuristic,
    './state_operations': { ...ops, serializeState: cachedSignature ? serialize : ops.serializeState },
    './domain': { ...domain, loadDomain() { const loaded = domain.loadDomain(); if (!timeCost) return loaded;
      // Cost experiment: seconds from 03 base + overhead. Distances excluded to keep state-independent costs.
      return { actions: loaded.actions.map(a => ({ ...a, cost: Math.max(0.001, estimator.estimate([ops.toPlanStep(a)], { closest: new Map(), categories: {}, complete: true }).estimatedMs / 1000) })) };
    } } });
  const logs = [];
  const logger = { debug() {}, info() {}, warn(message) { logs.push(message); }, error(message) { logs.push(message); } };
  return { async run(goal, world, options = {}) {
    reset(); logs.length = 0;
    const start = performance.now(); let result, thrown;
    try { result = await planModule.plan(goal, world, logger, options); } catch (e) { thrown = { code: e.code, message: e.message }; }
    const durationMs = performance.now() - start;
    const reason = thrown ? thrown.code : result.plan ? 'success' : logs.some(x => x.includes('イテレーション上限')) ? 'iteration_limit' : metrics.iterations ? 'frontier_exhausted' : 'relaxed_unreachable';
    return { result, thrown, reason, durationMs, metrics: { ...metrics, uniqueExpanded: metrics.uniqueExpanded.size, discovered: metrics.discovered.size + 1 }, logs: [...logs] };
  } };
}
function targetFor(goal, world, actions = domain.loadDomain().actions) {
  const parsed = goals.parseGoalInput(goal); if (!parsed) throw new Error(`Invalid study goal ${goal}`);
  const action = actions.find(a => a.name === parsed.actionName);
  const target = goals.getGoalStateFromParsed(parsed, actions, action); if (!target) throw new Error(`Unknown study goal ${goal}`);
  return goals.adjustGoalForCurrentState(target, buildState(world), parsed);
}
function replay(goal, world, plan) {
  if (!plan) return null;
  const actions = domain.loadDomain().actions, byName = new Map(actions.map(a => [a.name, a]));
  let state = buildState(world); const failures = [];
  for (const [i, step] of plan.entries()) {
    const action = byName.get(step.action);
    if (!action) { failures.push({ i, reason: 'unknown_action' }); break; }
    if (!ops.arePreconditionsSatisfied(action.preconditions, state)) { failures.push({ i, action: step.action, reason: 'precondition' }); break; }
    state = ops.applyEffects(action.effects, state);
  }
  const satisfied = heuristic.isGoalSatisfied(targetFor(goal, world, actions), state);
  return { valid: failures.length === 0 && satisfied, satisfied, failures };
}
const environments = new WeakMap();
function estimate(plan, world) {
  if (!plan) return null;
  if (!environments.has(world)) environments.set(world, estimator.environment(world, Infinity));
  return estimator.estimate(plan, environments.get(world));
}
module.exports = { root, plannerDir, makePlanner, replay, targetFor, estimate, replace, indexedHeuristic };
