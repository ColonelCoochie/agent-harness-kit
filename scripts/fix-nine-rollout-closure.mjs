import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {directory, featureId, sourceRoot, targets, pin, digest} from './fix-nine-rollout-preflight.mjs';

// This is a preparation artifact. It deliberately confers no target-write authority.
export const closurePath = `${directory}/source-closure-candidate.json`;
export const planPath = `${directory}/preparation-plan.json`;
const preflightPath = `${directory}/preflight.json`;
const nativePath = `${directory}/native-preservation.json`;
const evidencePath = '.harness/evidence/2026-10-17T20-21-48-251Z-source-historical-budget-compat-002.json';
const outputRoot = 'C:/Users/Jason/Documents/Codex/2026-10-17/re/outputs';
const anchors = {
  [preflightPath]: 'a6face9dca313af34a4d94a9e02f0b6d208776daa8e943ed54c7e90d9a1a6292',
  [nativePath]: '075ad24affd35954c13554f4d8304da86d5144ed437f2b597081c0ccddece625',
  [evidencePath]: 'cd2a778d008f94d69d87d8fbb14618cbf3c8469777b5cd8b4d4e19dd00d0a034',
  '.harness/source-historical-budget-compat-002/exo-readonly-audit.json': '3de735c4e08d9dc249c59e25c1c15db32e872d1ee7b73af08692c8bd7bef98b2'
};
const compatibilityChanges = {
  'skill/codex-harness/assets/project-runtime.mjs': 'b78faab69fbdfde92e4f815d4555256a65090044a288c50874b1fcb6dc01c12b',
  'skill/codex-harness/scripts/lib/core.mjs': '9d5c2a88e71afe4f921236e23cbcc248b4212edfa183bd26443c1992c7c3488c'
};
const additionalPaths = ['tests/harness-budget-compat.test.mjs'];
const preparationPaths = ['scripts/fix-nine-rollout-preflight.mjs', 'scripts/fix-nine-rollout-closure.mjs', 'scripts/fix-nine-rollout-closure.test.mjs', planPath];
const requiredCommands = [
  'node --check bin/agent-harness.mjs',
  'node --check bin/codex-harness.mjs',
  'node --check skill/codex-harness/scripts/harness.mjs',
  'node --check skill/codex-harness/scripts/lib/core.mjs',
  'node --check skill/codex-harness/assets/project-runtime.mjs',
  'node --check skill/codex-harness/assets/precompact-handoff.mjs',
  'node --check .harness/run.mjs',
  'node --check .harness/hooks/precompact-handoff.mjs',
  'node bin/agent-harness.mjs audit . --min-score 95',
  'node --test tests/harness.test.mjs',
  'node --test tests/harness-budget-compat.test.mjs'
];
const json = async file => JSON.parse(await readFile(path.resolve(sourceRoot, file), 'utf8'));
const validPin = ref => assert(ref && typeof ref.path === 'string' && Number.isSafeInteger(ref.bytes) && ref.bytes >= 0 && /^[a-f0-9]{64}$/.test(ref.sha256), 'Invalid content pin');
async function authenticate(ref, root = sourceRoot) {
  validPin(ref);
  assert.deepEqual(await pin(ref.path, root), ref, `Content changed: ${ref.path}`);
  return ref;
}
async function anchored(file) {
  const ref = await pin(file);
  assert.equal(ref.sha256, anchors[file], `Immutable anchor changed: ${file}`);
  return ref;
}

export function validatePrerequisite(evidence) {
  assert.equal(evidence.schemaVersion, 5);
  assert.equal(evidence.featureId, 'source-historical-budget-compat-002');
  assert.equal(evidence.attempt, 1);
  assert.equal(evidence.pass, true);
  assert.deepEqual(evidence.requiredLayers, ['quick', 'architecture', 'full']);
  assert.deepEqual(evidence.executedLayers, ['quick', 'architecture', 'full', 'acceptance']);
  const plan = evidence.verificationPlan;
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.evidenceSchemaVersion, 5);
  assert.equal(digest(plan), evidence.verificationHash);
  assert.equal(plan.feature.contractHash, evidence.contractHash);
  assert.equal(plan.config.hash, evidence.configHash);
  assert.equal(plan.executions.length, requiredCommands.length);
  assert.equal(evidence.commands.length, requiredCommands.length);
  for (let index = 0; index < requiredCommands.length; index++) {
    const command = evidence.commands[index];
    const planned = plan.executions[index];
    const layer = index < 8 ? 'quick' : index === 8 ? 'architecture' : index === 9 ? 'full' : 'acceptance';
    const id = index < 8 ? `layer:quick:${index + 1}` : index === 8 ? 'layer:architecture:1' : index === 9 ? 'layer:full:1' : 'acceptance:ac-1:1';
    assert.equal(command.command, requiredCommands[index]);
    assert.equal(command.executionId, id);
    assert.equal(command.executionOrder, index);
    assert.equal(command.layer, layer);
    assert.equal(command.criterionId, index === 10 ? 'ac-1' : null);
    assert.equal(planned.id, id);
    assert.equal(planned.order, index);
    assert.equal(planned.command, command.command);
    assert.equal(planned.commandHash, digest(command.command));
    assert.equal(planned.layer, layer);
    assert.equal(planned.criterionId, command.criterionId);
    assert.deepEqual(planned.credentials, []);
    assert.deepEqual(command.credentials, []);
    assert.equal(command.pass, true);
    assert.equal(command.exitCode, 0);
    assert.equal(command.timedOut, false);
    assert.equal(command.signal, null);
    assert.equal(command.terminationConfirmed, true);
    for (const stream of ['stdout', 'stderr']) assert.match(command.logs[stream], /^\.harness\/logs\/[a-zA-Z0-9-]+\.(stdout|stderr)\.log$/);
  }
}

export function validateSourceClosure(value, {preflight, native, evidence}) {
  assert.equal(value.version, 1);
  assert.equal(value.kind, 'fix-nine-rollout-source-closure-candidate');
  assert.equal(value.featureId, featureId);
  assert.equal(value.executionAuthorized, false);
  assert.equal(value.status, 'SOURCE_COMPOSED_PREPARATION_ONLY');
  assert.deepEqual(value.targetRoots, targets);
  assert.deepEqual(preflight.targetRoots, targets);
  assert.equal(preflight.executionAuthorized, false);
  assert.equal(preflight.native.status, 'blocked');
  assert.deepEqual(value.native.originalFailure, preflight.native);
  assert.equal(value.native.reconciledAdditively, true);
  assert.equal(Object.keys(native.trust).length, 84);
  assert.equal(native.definitions.length, 66);
  assert.equal(Object.keys(native.retainedOtherTrust).length, 18);
  assert.equal(native.sourceReviewedApprovals.length, 6);
  assert.deepEqual(value.native.baseline, native);
  assert.deepEqual(value.native.authorizedTransitions, []);
  assert.deepEqual(native.receipts[1].cwds, targets);
  assert.equal(native.receipts[0].method, 'config/read');
  assert.equal(native.receipts[0].includeLayers, true);
  assert.deepEqual(native.receipts[0].rawBefore, native.receipts[0].rawAfter);
  for (const row of native.definitions) {
    assert.equal(native.trust[row.key], row.currentHash);
    assert.equal(row.trustStatus, 'trusted');
    assert.equal(row.enabled, true);
  }
  const retained = Object.fromEntries(Object.entries(native.trust).filter(([key]) => !native.definitions.some(row => row.key === key)));
  assert.deepEqual(retained, native.retainedOtherTrust);
  assert.equal(value.source.files.length, 37);
  assert.deepEqual(value.source.files.map(row => row.path), preflight.source.files.map(row => row.path));
  const changed = [];
  for (let index = 0; index < value.source.files.length; index++) {
    const current = value.source.files[index];
    const initial = preflight.source.files[index];
    validPin(current);
    if (compatibilityChanges[current.path]) {
      assert.equal(current.sha256, compatibilityChanges[current.path]);
      assert.notEqual(current.sha256, initial.sha256);
      changed.push({before: initial, after: current});
    } else assert.deepEqual(current, initial);
  }
  assert.equal(changed.length, 2);
  assert.deepEqual(value.source.compatibilityChanges, changed);
  assert.equal(value.source.closureSha256, digest(value.source.files));
  assert.deepEqual(value.source.additional.map(row => row.path), additionalPaths);
  value.source.additional.forEach(validPin);
  assert.equal(value.source.managed.length, 15);
  assert.deepEqual(value.source.managed.map(row => [row.installed.path, row.asset.path]), preflight.source.managed.map(row => [row.installed.path, row.asset.path]));
  for (const row of value.source.managed) {
    validPin(row.installed); validPin(row.asset);
    assert.equal(row.installed.bytes, row.asset.bytes);
    assert.equal(row.installed.sha256, row.asset.sha256);
  }
  assert.equal(value.source.managedSha256, digest(value.source.managed));
  assert.deepEqual(value.source.frozen, preflight.source.frozen);
  assert.deepEqual(value.preparationFiles.map(row => row.path), preparationPaths);
  value.preparationFiles.forEach(validPin);
  assert.deepEqual(value.historical, [...preflight.immutableHistorical, preflight.historicalAuthority, preflight.historicalPolicy]);
  assert.deepEqual(value.enrollment, preflight.policy);
  assert.deepEqual(value.originalPreflightPlans, preflight.targets.map(row => ({index: row.index, root: row.root, preservation: row.preservation, plan: row.plan, planHash: row.planHash})));
  assert.equal(value.originalPlansRequireRefresh, true);
  assert.deepEqual(value.originalPreflightPlans.map(row => row.root), targets);
  validatePrerequisite(evidence);
  assert.equal(value.prerequisite.evidence.sha256, anchors[evidencePath]);
  assert.equal(value.prerequisite.contractHash, evidence.contractHash);
  assert.equal(value.prerequisite.configHash, evidence.configHash);
  assert.equal(value.prerequisite.verificationHash, evidence.verificationHash);
  assert.deepEqual(value.prerequisite.commands.map(({logs, ...row}) => row), evidence.commands.map(row => ({id: row.executionId, order: row.executionOrder, command: row.command, layer: row.layer, criterionId: row.criterionId, credentials: row.credentials, pass: row.pass, exitCode: row.exitCode, timedOut: row.timedOut, signal: row.signal, terminationConfirmed: row.terminationConfirmed})));
  for (let index = 0; index < value.prerequisite.commands.length; index++) for (const stream of ['stdout', 'stderr']) {
    const ref = value.prerequisite.commands[index].logs[stream]; validPin(ref);
    assert.equal(ref.path, evidence.commands[index].logs[stream]);
  }
  assert.equal(value.exo.holdCleared, false);
  assert.equal(value.exo.currentPostDeploymentStartupRequired, true);
  assert.equal(value.exo.independentAuditContinueRequired, true);
  assert.equal(value.exo.historicalMaxAttempts, 23);
  assert.equal(value.exo.historicalAttempts, 4);
  assert.equal(value.exo.effectiveMaxAttempts, 5);
  return true;
}

export async function buildSourceClosure() {
  const preflightRef = await anchored(preflightPath);
  const nativeRef = await anchored(nativePath);
  const evidenceRef = await anchored(evidencePath);
  const auditRef = await anchored('.harness/source-historical-budget-compat-002/exo-readonly-audit.json');
  const [preflight, native, evidence, features, config] = await Promise.all([json(preflightPath), json(nativePath), json(evidencePath), json('.harness/features.json'), json('.harness/config.json')]);
  validatePrerequisite(evidence);
  const sourceFeature = (Array.isArray(features) ? features : features.features).find(row => row.id === evidence.featureId);
  assert.equal(sourceFeature.status, 'passing'); assert.equal(sourceFeature.attempts, 1);
  assert.equal(sourceFeature.contract.hash, evidence.contractHash);
  assert.deepEqual(sourceFeature.evidence, [evidencePath]);
  assert.equal(config.policies.maxAttempts, 5);
  assert.equal(config.policies.maxRepeatedFailures, 2);
  const files = await Promise.all(preflight.source.files.map(row => pin(row.path)));
  const managed = await Promise.all(preflight.source.managed.map(async row => ({installed: await pin(row.installed.path), asset: await pin(row.asset.path)})));
  const historical = [...preflight.immutableHistorical, preflight.historicalAuthority, preflight.historicalPolicy];
  await Promise.all(historical.map(ref => authenticate(ref)));
  await Promise.all(preflight.source.frozen.map(ref => authenticate(ref)));
  await Promise.all(preflight.targets.flatMap(row => [row.preservation, row.plan]).map(ref => authenticate(ref)));
  await authenticate(preflight.policy.raw);
  const enrollment = await json(preflight.policy.raw.path);
  assert.equal(digest(enrollment), preflight.policy.valueSha256);
  assert.equal(enrollment.sourceRoot, sourceRoot);
  assert.deepEqual(enrollment.projects.slice().sort(), targets.slice().sort());
  await Promise.all([preflight.source.gateExport, preflight.source.sourceManifest].map(ref => authenticate(ref, outputRoot)));
  const commands = await Promise.all(evidence.commands.map(async row => ({id: row.executionId, order: row.executionOrder, command: row.command, layer: row.layer, criterionId: row.criterionId, credentials: row.credentials, pass: row.pass, exitCode: row.exitCode, timedOut: row.timedOut, signal: row.signal, terminationConfirmed: row.terminationConfirmed, logs: {stdout: await pin(row.logs.stdout), stderr: await pin(row.logs.stderr)}})));
  const value = {
    version: 1, kind: 'fix-nine-rollout-source-closure-candidate', featureId, at: new Date().toISOString(),
    status: 'SOURCE_COMPOSED_PREPARATION_ONLY', executionAuthorized: false, targetRoots: targets,
    initialPreflight: preflightRef, nativeSupplement: nativeRef, historical,
    source: {files, compatibilityChanges: files.flatMap((after, index) => after.sha256 !== preflight.source.files[index].sha256 ? [{before: preflight.source.files[index], after}] : []), additional: await Promise.all(additionalPaths.map(file => pin(file))), managed, frozen: preflight.source.frozen, closureSha256: digest(files), managedSha256: digest(managed), originalNineFixManifest: preflight.source.sourceManifest, originalIntegrationGateExport: preflight.source.gateExport},
    preparationFiles: await Promise.all(preparationPaths.map(file => pin(file))),
    prerequisite: {evidence: evidenceRef, attempt: 1, schemaVersion: 5, pass: true, contractHash: evidence.contractHash, configHash: evidence.configHash, verificationHash: evidence.verificationHash, commands, exoPreservationAudit: auditRef},
    enrollment: preflight.policy,
    originalPreflightPlans: preflight.targets.map(row => ({index: row.index, root: row.root, preservation: row.preservation, plan: row.plan, planHash: row.planHash})), originalPlansRequireRefresh: true,
    native: {originalFailure: preflight.native, reconciledAdditively: true, baseline: native, authorizedTransitions: []},
    exo: {holdCleared: false, currentPostDeploymentStartupRequired: true, independentAuditContinueRequired: true, historicalMaxAttempts: 23, historicalAttempts: 4, effectiveMaxAttempts: 5}
  };
  validateSourceClosure(value, {preflight, native, evidence});
  return value;
}

export async function authenticateSourceClosure(file = closurePath) {
  const stored = await json(file);
  const current = await buildSourceClosure();
  const {at: _storedAt, ...storedBody} = stored;
  const {at: _currentAt, ...currentBody} = current;
  assert.deepEqual(storedBody, currentBody, 'Prepared closure differs from authenticated current source');
  return pin(file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'prepare') {
    const value = await buildSourceClosure();
    await writeFile(path.join(sourceRoot, closurePath), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({closure: await authenticateSourceClosure(), sourceFiles: 37, managedFiles: 15, targetCount: 11, trustMappings: 84, executionAuthorized: false}));
  } else if (mode === 'check') console.log(JSON.stringify({closure: await authenticateSourceClosure(), executionAuthorized: false}));
  else throw new Error('Use prepare (exclusive additive candidate) or check (read-only authentication)');
}
