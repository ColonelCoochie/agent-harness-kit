// Pure validation only. Callers must authenticate every referenced file against
// reviewed pins before relying on a result, including the returned command logs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const rolloutFeatureId = 'fix-nine-rollout-001';
export const rolloutReport = '.harness/fix-nine-rollout-001-report.json';
export const gateDirectory = '.harness/fix-nine-rollout-001/gate';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const canonicalHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const unique = values => [...new Set(values)];
const timestamp = value => { assert.equal(typeof value, 'string'); const time = Date.parse(value); assert(Number.isFinite(time), 'Invalid timestamp'); return time; };
const positive = value => assert(Number.isSafeInteger(value) && value > 0, 'Expected a positive safe integer');

export function validatePin(ref, prefix) {
  assert(ref && typeof ref.path === 'string');
  assert(ref.path.startsWith(prefix) && !/[\\\x00-\x1f]/.test(ref.path), 'Invalid reference path');
  assert(ref.path.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid reference traversal');
  assert(Number.isSafeInteger(ref.bytes) && ref.bytes >= 0, 'Invalid byte count');
  assert.match(ref.sha256, /^[a-f0-9]{64}$/);
  return true;
}

export function normalizedContract(feature) {
  return {id:feature.id, title:feature.title, description:feature.description,
    dependencies:feature.dependencies, scope:feature.scope, acceptance:feature.acceptance,
    requiredLayers:feature.requiredLayers ?? ['full'],
    ...(Object.hasOwn(feature, 'verificationBudget') ? {verificationBudget:feature.verificationBudget} : {})};
}

// Reconstruct the runtime's complete schema-v2 manifest, rather than trusting
// IDs, layers, credential requests or command hashes from an evidence document.
export function expectedVerificationPlan(config, feature) {
  assert.equal(config.policies.maxAttempts, 5, 'Reviewed global budget changed');
  assert.equal(config.policies.maxRepeatedFailures, 2, 'Reviewed failure cap changed');
  positive(config.policies.commandTimeoutMs);
  assert(Number.isSafeInteger(feature.attempts) && feature.attempts >= 0);
  const featureMaxAttempts = feature.verificationBudget?.maxAttempts ?? null;
  if (Object.hasOwn(feature, 'verificationBudget')) {
    assert.deepEqual(Object.keys(feature.verificationBudget), ['maxAttempts']);
    positive(featureMaxAttempts);
  }
  const effectiveMaxAttempts = Math.min(5, featureMaxAttempts ?? 5);
  assert(feature.attempts < effectiveMaxAttempts, 'Attempt budget exhausted');
  const snapshot = normalizedContract(feature);
  assert.equal(feature.contract.version, 2);
  assert.deepEqual(feature.contract.snapshot, snapshot, 'Contract snapshot changed');
  assert.equal(feature.contract.hash, canonicalHash({contract:snapshot, scopeBaselineHash:feature.contract.scopeBaselineHash}));
  const layers = unique([
    ...(config.completion?.alwaysRunWhenConfigured ?? []).filter(layer => config.verification?.[layer]?.length > 0),
    ...(config.completion?.baseLayers ?? ['full']), ...(feature.requiredLayers ?? ['full'])
  ]);
  const entries = layers.flatMap(layer => {
    assert(Array.isArray(config.verification?.[layer]) && config.verification[layer].length > 0, 'Required layer has no commands');
    return config.verification[layer].map(entry => ({...(typeof entry === 'string' ? {command:entry} : entry), layer, criterionId:null}));
  });
  assert(feature.acceptance.length > 0);
  assert.equal(new Set(feature.acceptance.map(item => item.id)).size, feature.acceptance.length);
  entries.push(...feature.acceptance.map(entry => ({...entry, layer:'acceptance', criterionId:entry.id})));
  const counts = new Map();
  const executions = entries.map((entry, order) => {
    assert.equal(typeof entry.command, 'string'); assert(entry.command.length > 0);
    assert.deepEqual(entry.credentials ?? [], [], 'Rollout commands must request no credentials');
    const kind = entry.layer === 'acceptance' ? 'acceptance' : 'layer';
    const group = `${kind}:${kind === 'acceptance' ? entry.criterionId : entry.layer}`;
    const occurrence = (counts.get(group) ?? 0) + 1; counts.set(group, occurrence);
    return {id:`${kind}:${encodeURIComponent(kind === 'acceptance' ? entry.criterionId : entry.layer)}:${occurrence}`,
      order, kind, layer:entry.layer, criterionId:entry.criterionId, command:entry.command,
      commandHash:canonicalHash(entry.command), commandRedacted:false, credentials:[],
      expected:{pass:true, exitCode:0, timedOut:false}};
  });
  const acceptance = executions.filter(entry => entry.kind === 'acceptance');
  return {schemaVersion:2, evidenceSchemaVersion:5, harnessVersion:6,
    feature:{id:feature.id, contractHash:feature.contract.hash,
      ...(Object.hasOwn(feature, 'verificationBudget') ? {verificationBudget:feature.verificationBudget} : {})},
    config:{hash:canonicalHash(config)}, requiredLayers:layers.map((id, order) => ({id, order})), executions,
    acceptanceCriteria:feature.acceptance.map((criterion, order) => ({id:criterion.id, order,
      description:criterion.description, executionId:acceptance[order].id, command:acceptance[order].command,
      commandHash:acceptance[order].commandHash, commandRedacted:false, credentials:[]})),
    scope:{enforcement:config.scope?.enforcement ?? null, allow:feature.scope?.allow ?? [], deny:feature.scope?.deny ?? [],
      baselineHash:feature.contract.scopeBaselineHash ?? null, expectedViolations:[]},
    executionPolicy:{commandTimeoutMs:config.policies.commandTimeoutMs,
      attemptBudget:{version:1, globalMaxAttempts:5, featureMaxAttempts, effectiveMaxAttempts, attemptsBefore:feature.attempts}},
    evidencePolicy:{redactOutput:Boolean(config.security?.redactOutput), environmentAllow:config.security?.environmentAllow ?? []}};
}

export function gateTimeout(config, plan) {
  const value = config.policies.commandTimeoutMs * (plan.executions.length + 1);
  positive(value); assert(value <= 2147473647, 'Outer deadline exceeds supported range'); return value;
}

export function validateGateInvocation(before, invocation, plan) {
  assert.equal(before.feature.id, rolloutFeatureId);
  assert.equal(before.feature.status, 'active');
  assert.equal(invocation.executable, before.nodeExecutable);
  assert.equal(typeof before.nodeExecutable, 'string'); assert(before.nodeExecutable.length > 0);
  assert.deepEqual(invocation.args, ['.harness/run.mjs', 'verify', rolloutFeatureId]);
  assert.equal(typeof before.root, 'string'); assert(before.root.length > 0); assert.equal(invocation.cwd, before.root);
  assert.equal(typeof before.owner, 'string'); assert(before.owner.length > 0); assert.equal(invocation.actor, before.owner);
  assert.equal(invocation.executionCount, plan.executions.length);
  assert.equal(invocation.timeoutMs, gateTimeout(before.config, plan));
  assert.equal(invocation.outcome.confirmed, true, 'Outer termination is unconfirmed');
  assert.equal(invocation.outcome.exitCode, 0); assert.equal(invocation.outcome.controllerExitCode, 0);
  assert.equal(invocation.outcome.signal, null); assert.equal(invocation.outcome.timedOut, false);
  assert(timestamp(invocation.finishedAt) >= timestamp(invocation.startedAt));
  for (const stream of ['stdout', 'stderr']) {
    validatePin(invocation.logs[stream], `${gateDirectory}/`);
    assert.equal(invocation.logs[stream].path, `${gateDirectory}/${stream}.log`);
  }
  return true;
}

export function validateVerificationEvidence(before, invocation, evidenceRef, evidence) {
  const plan = expectedVerificationPlan(before.config, before.feature);
  validateGateInvocation(before, invocation, plan);
  validatePin(evidenceRef, '.harness/evidence/');
  assert(evidenceRef.path.endsWith(`-${rolloutFeatureId}.json`));
  assert.deepEqual(before.feature.evidence, before.evidencePrefix.map(ref => ref.path));
  assert.equal(new Set(before.evidencePrefix.map(ref => ref.path)).size, before.evidencePrefix.length);
  for (const ref of before.evidencePrefix) validatePin(ref, '.harness/evidence/');
  assert(!before.evidencePrefix.some(ref => ref.path === evidenceRef.path), 'Evidence path was reused');
  assert.equal(evidence.schemaVersion, 5); assert.equal(evidence.harnessVersion, 6);
  assert.equal(evidence.featureId, rolloutFeatureId); assert.equal(evidence.pass, true);
  assert.equal(evidence.contractHash, before.feature.contract.hash); assert.equal(evidence.configHash, canonicalHash(before.config));
  assert.deepEqual(evidence.verificationPlan, plan, 'Evidence plan differs from current configured plan');
  assert.equal(evidence.verificationHash, canonicalHash(plan));
  assert.equal(evidence.attempt, before.feature.attempts + 1);
  assert.deepEqual(evidence.scopeViolations, []);
  assert.deepEqual(evidence.requiredLayers, plan.requiredLayers.map(layer => layer.id));
  assert.deepEqual(evidence.executedLayers, unique(plan.executions.map(entry => entry.layer)));
  const times = [invocation.startedAt, evidence.startedAt, evidence.finishedAt, invocation.finishedAt].map(timestamp);
  assert(times.every((value, index) => index === 0 || value >= times[index - 1]), 'Evidence is outside actual verify invocation');
  assert.equal(evidence.commands.length, plan.executions.length);
  const requiredLogs = [];
  for (const [index, entry] of plan.executions.entries()) {
    const result = evidence.commands[index];
    for (const [key, expected] of Object.entries({executionId:entry.id, executionOrder:index, command:entry.command,
      layer:entry.layer, criterionId:entry.criterionId, credentials:[], pass:true, exitCode:0,
      timedOut:false, signal:null, terminationConfirmed:true})) assert.deepEqual(result[key], expected, `Command ${index}: ${key}`);
    assert(Number.isFinite(result.durationMs) && result.durationMs >= 0);
    for (const stream of ['stdout', 'stderr']) {
      const name = result.logs[stream];
      assert.equal(typeof name, 'string');
      assert.match(name, /^\.harness\/logs\/[A-Za-z0-9_-]+\.(stdout|stderr)\.log$/);
      assert(name.endsWith(`.${stream}.log`));
      requiredLogs.push({executionId:entry.id, stream, path:name});
    }
  }
  assert.equal(new Set(requiredLogs.map(ref => ref.path)).size, requiredLogs.length, 'Command logs were reused');
  assert.equal(plan.executions.filter(entry => entry.command === 'node --test tests/harness.test.mjs').length, 1);
  assert.equal(plan.executions.find(entry => entry.criterionId === 'ac-1')?.command,
    `node scripts/verify-fix-nine-rollout.mjs --report ${rolloutReport}`);
  assert.equal(plan.executions.find(entry => entry.criterionId === 'ac-2')?.command, 'node scripts/test-rollout.mjs');
  return {evidence:evidenceRef, requiredLogs, verificationHash:canonicalHash(plan),
    lastVerification:{at:evidence.finishedAt, pass:true}};
}

export function validatePassingTransition(before, after, verified) {
  assert.deepEqual(after, {...before.feature, status:'passing', attempts:before.feature.attempts + 1,
    evidence:[...before.feature.evidence, verified.evidence.path], lastVerification:verified.lastVerification,
    repeatedFailures:0, lastFailureFingerprint:null, updatedAt:verified.lastVerification.at}, 'Unexpected feature state transition');
  return true;
}

// A caller creates this only after awaiting actual verify and authenticating its
// evidence/log bytes. This pure check cannot authenticate files or run verify.
export function validateGateReceipt(before, invocation, verified, receipt, {beforePin, bindings, observedAt}) {
  validatePin(beforePin, `${gateDirectory}/`); assert.equal(beforePin.path, `${gateDirectory}/before.json`);
  assert.equal(typeof before.gateId, 'string'); assert.match(before.gateId, /^[a-f0-9-]{36}$/);
  assert.equal(receipt.version, 1); assert.equal(receipt.kind, 'fix-nine-rollout-outer-gate');
  assert.equal(receipt.featureId, rolloutFeatureId); assert.equal(receipt.gateId, before.gateId);
  assert.deepEqual(receipt.before, beforePin); assert.deepEqual(receipt.bindings, bindings);
  assert.deepEqual(receipt.invocation, invocation); assert.deepEqual(receipt.verified, verified);
  assert(timestamp(receipt.sealedAt) >= timestamp(invocation.finishedAt), 'Receipt predates completed verify');
  assert(timestamp(receipt.sealedAt) <= timestamp(observedAt), 'Receipt timestamp is in the future');
  return true;
}
