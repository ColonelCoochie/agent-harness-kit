import {gateContinuity} from './fix-nine-rollout-release.mjs';
// Report/authority semantics belong to the separately reviewed deployment
// adapter. Its fixed path is deliberately fail-closed until implemented.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalHash, normalizedContract, rolloutFeatureId, rolloutReport, gateDirectory, expectedVerificationPlan,
  gateTimeout, validateVerificationEvidence, validatePassingTransition} from './fix-nine-rollout-evidence.mjs';
import {authenticateFile, authenticatePrefix, inventoryAdditions, pinFile, readJson} from './fix-nine-rollout-files.mjs';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const adapterPath = 'scripts/fix-nine-rollout-deployment.mjs';
export const requiredHelpers = [
  'scripts/fix-nine-rollout-inventory.mjs',
  'scripts/fix-nine-rollout-preflight.mjs', 'scripts/fix-nine-rollout-closure.mjs',
  'scripts/fix-nine-rollout-closure.test.mjs',
  'scripts/fix-nine-rollout-evidence.mjs', 'scripts/fix-nine-rollout-files.mjs',
  'scripts/fix-nine-rollout-auth.mjs', 'scripts/fix-nine-rollout-gate.mjs', 'scripts/fix-nine-rollout-release.mjs',
  'scripts/verify-fix-nine-rollout.mjs', adapterPath, 'scripts/fix-nine-rollout-signer.mjs', 'tests/fix-nine-rollout.test.mjs',
  'skill/codex-harness/scripts/lib/native-hook-client.mjs'
];

export async function productionDeployment({root, io, sourceRelease}) {
  assert.equal(path.resolve(root), sourceRoot, 'Production adapter requires the actual source root');
  await io.pin(adapterPath); // Validate regular containment before loading code.
  const adapter = await import('./fix-nine-rollout-deployment.mjs');
  assert.equal(typeof adapter.authenticateDeployment, 'function', 'Missing reviewed deployment authenticator');
  return adapter.authenticateDeployment({root, io, sourceRelease});
}

const uuidLog = relative => {
  const match = /^\.harness\/logs\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(stdout|stderr)\.log$/.exec(relative);
  assert(match, 'Command log is not a contained UUID stream'); return {id:match[1], stream:match[2]};
};
function uuidPairs(logs) {
  const pairs = new Map();
  for (const relative of logs) {
    const {id, stream} = uuidLog(relative), streams = pairs.get(id) ?? new Set();
    assert(!streams.has(stream)); streams.add(stream); pairs.set(id, streams);
  }
  assert([...pairs.values()].every(streams => streams.size === 2), 'UUID stream pair is incomplete');
}

// Source-only, temporary inventory admission for the fixed outer verification.
// Live filenames establish containment and a bounded count, never command identity.
// The completed schema5 manifest must subsequently account for every new file.
export async function authenticateGateInventory(root, sourceRelease) {
  let before;
  try { before = await readJson(root, `${gateDirectory}/before.json`); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  assert.equal(before.version, 1); assert.equal(before.root, path.resolve(root));
  assert.equal(before.nodeExecutable, process.execPath);
  assert(Number.isFinite(Date.parse(before.capturedAt)));
  assert.equal(before.feature.id, rolloutFeatureId); assert.equal(before.feature.status, 'active');
  assert.equal(before.state.path, '.harness/features.json');
  assert.equal(before.continuity.path, '.harness/continuity.json');
  assert.equal(before.bindings.config.path, '.harness/config.json');
  const config = JSON.parse(await authenticateFile(root, before.bindings.config));
  assert.deepEqual(config, before.config);
  const plan = expectedVerificationPlan(config, before.feature);
  assert.deepEqual(before.plan, plan);
  const invocationIdentity = {executable:process.execPath, args:['.harness/run.mjs', 'verify', rolloutFeatureId],
    cwd:path.resolve(root), actor:before.owner, executionCount:plan.executions.length, timeoutMs:gateTimeout(config, plan)};
  assert.deepEqual(before.invocationIdentity, invocationIdentity);
  const continuity = await gateContinuity(root,before.continuity,sourceRelease);
  assert.equal(continuity.phase, 'working'); assert.equal(continuity.handoff, null);
  assert.equal(continuity.owner?.source, 'CODEX_THREAD_ID');
  assert.equal(typeof before.owner, 'string'); assert(before.owner);
  assert.equal(continuity.owner.id, before.owner);
  const logs = await inventoryAdditions(root, '.harness/logs', before.history.inventory.logs);
  const evidence = await inventoryAdditions(root, '.harness/evidence', before.history.inventory.evidence);
  let invocation, completed = false;
  try { invocation = await readJson(root, `${gateDirectory}/invocation.json`); completed = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!completed) {
    const state = JSON.parse(await authenticateFile(root, before.state));
    assert.deepEqual(state.features.find(feature => feature.id === rolloutFeatureId), before.feature);
    assert.deepEqual(evidence, [], 'Pending verification appended evidence');
    await authenticateFile(root, before.history.events);
    const prefix = plan.executions.findIndex(entry => entry.criterionId === 'ac-1');
    assert(prefix >= 0);
    assert.equal(plan.executions[prefix].command, `node scripts/verify-fix-nine-rollout.mjs --report ${rolloutReport}`);
    assert(logs.length <= 2 * (prefix + 1), 'Pending command log prefix exceeded');
    uuidPairs(logs);
    return {mode:'pending', paths:logs};
  }
  const state = await readJson(root, '.harness/features.json');
  const after = state.features.find(feature => feature.id === rolloutFeatureId); assert(after);
  assert.deepEqual(state.features.map(feature => feature.id), before.history.featureIds);
  assert.deepEqual(state.features.filter(feature => feature.id !== rolloutFeatureId)
    .map(feature => ({id:feature.id, sha256:canonicalHash(feature)})), before.history.features);
  assert.deepEqual(Object.fromEntries(Object.entries(state).filter(([key]) => !['features', 'revision'].includes(key))), before.history.stateHeader);
  assert.equal(state.revision, before.history.revision + 1);
  assert.equal(after.evidence.length, before.feature.evidence.length + 1);
  assert.deepEqual(after.evidence.slice(0, -1), before.feature.evidence);
  const evidenceRef = await pinFile(root, after.evidence.at(-1));
  const record = JSON.parse(await authenticateFile(root, evidenceRef));
  const verified = validateVerificationEvidence(before, invocation, evidenceRef, record);
  validatePassingTransition(before, after, verified);
  assert.deepEqual(logs, verified.requiredLogs.map(ref => ref.path).sort(), 'Completed log inventory differs from schema5');
  uuidPairs(logs);
  const executionPairs = new Map();
  for (const ref of verified.requiredLogs) {
    const uuid = uuidLog(ref.path); assert.equal(uuid.stream, ref.stream);
    if (executionPairs.has(ref.executionId)) assert.equal(executionPairs.get(ref.executionId), uuid.id, 'Execution streams use different UUIDs');
    else executionPairs.set(ref.executionId, uuid.id);
  }
  assert.deepEqual(evidence, [evidenceRef.path], 'Completed evidence inventory differs from append');
  await authenticatePrefix(root, before.history.events);
  const pins = await Promise.all(logs.map(relative => pinFile(root, relative)));
  return {mode:'completed', paths:[...logs, ...evidence], pins:[...pins, evidenceRef,
    await pinFile(root, '.harness/features.json'), await pinFile(root, `${gateDirectory}/invocation.json`)]};
}

// Adapter result: exact authenticated refs plus authority/report/final closure.
// The adapter must authenticateSourceClosure, the reviewed authority anchor,
// exact ordered eleven apply/audit/independent CONTINUE records, native CAS and
// all historical preservation. Merely returning pinned JSON is insufficient.
export async function authenticateBindings({root = sourceRoot, deployment = productionDeployment, sourceRelease} = {}) {
  const io = {pin: relative => pinFile(root, relative), authenticate: ref => authenticateFile(root, ref),
    json: relative => readJson(root, relative)};
  const configRef = await io.pin('.harness/config.json');
  const config = JSON.parse(await io.authenticate(configRef));
  const stateRef = await io.pin('.harness/features.json');
  const state = JSON.parse(await io.authenticate(stateRef));
  assert.equal(state.features.filter(item => item.id === rolloutFeatureId).length, 1);
  const feature = state.features.find(item => item.id === rolloutFeatureId); assert(feature);
  const snapshot = normalizedContract(feature);
  assert.equal(feature.contract.version, 2);
  assert.deepEqual(feature.contract.snapshot, snapshot);
  assert.equal(feature.contract.hash, canonicalHash({contract: snapshot, scopeBaselineHash: feature.contract.scopeBaselineHash}));
  const baseline = feature.scopeBaselineRef;
  assert.equal(baseline.baselineHash, feature.contract.scopeBaselineHash);
  await io.authenticate({path: baseline.path, bytes: baseline.bytes, sha256: baseline.sha256});
  const deployed = await deployment({root, io, sourceRelease});
  assert.equal(deployed.version, 1); assert.equal(deployed.kind, 'fix-nine-rollout-authenticated-deployment');
  assert.equal(deployed.featureId, rolloutFeatureId);
  assert.equal(deployed.report.path, rolloutReport);
  assert.equal(deployed.authority.path, '.harness/fix-nine-rollout-001/authority.json');
  assert.equal(deployed.sourceClosure.path, '.harness/fix-nine-rollout-001/source-closure.json');
  const refs = [...deployed.references, deployed.report, deployed.authority, deployed.sourceClosure];
  const unique = new Map();
  for (const ref of refs) {
    if (unique.has(ref.path)) assert.deepEqual(unique.get(ref.path), ref, 'Conflicting deployment references');
    else { await io.authenticate(ref); unique.set(ref.path, ref); }
  }
  const closure = JSON.parse(await io.authenticate(deployed.sourceClosure));
  assert.deepEqual(closure.helperFiles.map(ref => ref.path).sort(), [...requiredHelpers].sort(), 'Final helper closure must be exact');
  assert.equal(new Set(closure.helperFiles.map(ref => ref.path)).size, requiredHelpers.length);
  for (const ref of closure.helperFiles) {
    await io.authenticate(ref);
    if (unique.has(ref.path)) assert.deepEqual(unique.get(ref.path), ref);
    unique.set(ref.path, ref);
  }
  // A deployment callback must not change the bytes used for our inputs.
  await io.authenticate(configRef); await io.authenticate(stateRef);
  await io.authenticate({path: baseline.path, bytes: baseline.bytes, sha256: baseline.sha256});
  // Bind generated runtime too, independently of the adapter's source graph.
  const runtime = await io.pin('.harness/run.mjs');
  return {config: configRef, configHash: canonicalHash(config),
    contract: {snapshot: normalizedContract(feature), value: feature.contract, baseline: feature.scopeBaselineRef},
    runtime, deployment: {report: deployed.report, authority: deployed.authority, sourceClosure: deployed.sourceClosure},
    references: [...unique.values()].sort((a, b) => a.path.localeCompare(b.path))};
}
