import {gateContinuity, releaseState} from './fix-nine-rollout-release.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticateBindings, authenticateGateInventory, productionDeployment, sourceRoot} from './fix-nine-rollout-auth.mjs';
import {authenticateFile, authenticatePrefix, exclusiveJson, freezeInventory, pinFile, readJson, regularPath} from './fix-nine-rollout-files.mjs';
import {canonicalHash, expectedVerificationPlan, gateDirectory, gateTimeout, rolloutFeatureId, rolloutReport,
  validateVerificationEvidence, validatePassingTransition, validateGateReceipt} from './fix-nine-rollout-evidence.mjs';

export const beforePath = `${gateDirectory}/before.json`;
export const receiptPath = `${gateDirectory}/receipt.json`;
const invocationPath = `${gateDirectory}/invocation.json`;
const now = () => new Date().toISOString();

export function cleanEnvironment(config, owner) {
  const reserved = new Set(Object.values(config.security?.credentials?.providers ?? {})
    .flatMap(item => [item.targetEnvironment, ...(item.sources ?? [])]).map(key => key.toUpperCase()));
  const allowed = new Set((config.security?.environmentAllow ?? []).map(key => key.toUpperCase()));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())
    && !reserved.has(key.toUpperCase()) && !/(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key)));
  if (owner) env.CODEX_THREAD_ID = owner;
  return env;
}

// Fixed command only; no shell, retries, credential forwarding, or arbitrary
// executable/argv from report JSON. A close event confirms controller exit.
export async function invokeVerification({root, before, plan}) {
  const handles = {};
  const invocation = {executable: process.execPath, args: ['.harness/run.mjs', 'verify', rolloutFeatureId],
    cwd: root, actor: before.owner, executionCount: plan.executions.length,
    timeoutMs: gateTimeout(before.config, plan), startedAt: now()};
  let child, timedOut = false, confirmed = false, exitCode = null, signal = null, spawnError = null;
  const writes = {stdout: Promise.resolve(), stderr: Promise.resolve()};
  let writeError;
  try {
    for (const stream of ['stdout', 'stderr']) {
      const file = await regularPath(root, `${gateDirectory}/${stream}.log`, {absent: true});
      handles[stream] = await open(file, 'wx');
    }
    child = spawn(invocation.executable, invocation.args, {cwd: root, env: cleanEnvironment(before.config, before.owner),
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    const totals = {stdout: 0, stderr: 0};
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
      totals[stream] += bytes.length;
      let output;
      if (totals[stream] <= 2 * 1024 * 1024) output = bytes;
      else if (totals[stream] - bytes.length <= 2 * 1024 * 1024)
        output = '\n[outer output limit reached]\n';
      if (output) writes[stream] = writes[stream].then(() => handles[stream].write(output))
        .catch(error => { writeError ??= error; });
    });
    await new Promise(resolve => {
      let fallback;
      const deadline = setTimeout(() => {
        timedOut = true;
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
            {windowsHide: true, stdio: 'ignore'});
          killer.on('error', () => {});
        } else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
        fallback = setTimeout(() => {
          // Stop accepting bytes before closing files if termination remains
          // unknown. The durable invocation will reject sealing and any retry.
          child.stdout.destroy(); child.stderr.destroy(); child.unref(); resolve();
        }, 10000);
      }, invocation.timeoutMs);
      child.once('error', error => { spawnError = error.code ?? 'SPAWN_ERROR'; });
      child.once('close', (code, value) => {
        confirmed = true; exitCode = code; signal = value; clearTimeout(deadline); clearTimeout(fallback); resolve();
      });
    });
    await Promise.all(Object.values(writes));
    if (writeError) throw writeError;
  } finally {
    for (const handle of Object.values(handles)) { await handle.sync(); await handle.close(); }
  }
  return {...invocation, finishedAt: now(), pid: child?.pid ?? null,
    outcome: {confirmed, exitCode, controllerExitCode: exitCode, signal, timedOut, ...(spawnError ? {spawnError} : {})},
    logs: {stdout: await pinFile(root, `${gateDirectory}/stdout.log`), stderr: await pinFile(root, `${gateDirectory}/stderr.log`)}};
}

async function history(root, state) {
  const paths = [...new Set(state.features.flatMap(feature => feature.evidence))];
  assert(paths.every(relative => typeof relative === 'string' && relative.startsWith('.harness/evidence/')));
  const evidence = await Promise.all(paths.map(relative => pinFile(root, relative)));
  // Historical physical logs are authenticated as well as the evidence JSON.
  const logs = new Map();
  for (const ref of evidence) {
    const record = JSON.parse(await authenticateFile(root, ref));
    for (const command of record.commands ?? []) for (const relative of Object.values(command.logs ?? {})) {
      assert.equal(typeof relative, 'string'); assert(relative.startsWith('.harness/logs/'));
      if (!logs.has(relative)) logs.set(relative, await pinFile(root, relative));
    }
  }
  return {evidence, logs: [...logs.values()], inventory:{logs:await freezeInventory(root, '.harness/logs'),
    evidence:await freezeInventory(root, '.harness/evidence')}, features: state.features.filter(feature => feature.id !== rolloutFeatureId)
    .map(feature => ({id: feature.id, sha256: canonicalHash(feature)})),
    featureIds: state.features.map(feature => feature.id),
    stateHeader: Object.fromEntries(Object.entries(state).filter(([key]) => !['features', 'revision'].includes(key))),
    revision: state.revision, events: await pinFile(root, '.harness/events.jsonl')};
}
async function authenticateHistory(root, before, state) {
  assert.deepEqual(state.features.map(feature => feature.id), before.history.featureIds, 'Feature order changed');
  const current = state.features.filter(feature => feature.id !== rolloutFeatureId).map(feature => ({id: feature.id, sha256: canonicalHash(feature)}));
  assert.deepEqual(current, before.history.features, 'Preexisting feature/history changed');
  assert.deepEqual(Object.fromEntries(Object.entries(state).filter(([key]) => !['features', 'revision'].includes(key))), before.history.stateHeader);
  assert.equal(state.revision, before.history.revision + 1, 'Expected exactly one verification state change');
  for (const ref of [...before.history.evidence, ...before.history.logs]) await authenticateFile(root, ref);
  await authenticatePrefix(root, before.history.events);
}

async function authenticateCompleted({root, before, beforePin, invocation, deployment, sourceRelease}) {
  assert.equal(before.root, path.resolve(root)); assert.equal(before.nodeExecutable, process.execPath);
  assert(Number.isFinite(Date.parse(before.capturedAt)) && Date.parse(invocation.startedAt) >= Date.parse(before.capturedAt));
  assert.deepEqual(JSON.parse(await authenticateFile(root, beforePin)), before, 'Before snapshot changed');
  const continuity = await gateContinuity(root,before.continuity,sourceRelease);
  assert.equal(continuity.phase, 'working'); assert.equal(continuity.handoff, null);
  assert.equal(continuity.owner.source, 'CODEX_THREAD_ID'); assert.equal(continuity.owner.id, before.owner);
  const statePin = await pinFile(root, '.harness/features.json');
  const state = JSON.parse(await authenticateFile(root, statePin));
  const after = state.features.find(feature => feature.id === rolloutFeatureId); assert(after);
  assert.equal(after.evidence.length, before.feature.evidence.length + 1);
  assert.deepEqual(after.evidence.slice(0, -1), before.feature.evidence);
  for (const ref of before.evidencePrefix) await authenticateFile(root, ref);
  const evidenceRef = await pinFile(root, after.evidence.at(-1));
  const evidence = JSON.parse(await authenticateFile(root, evidenceRef));
  const verified = validateVerificationEvidence(before, invocation, evidenceRef, evidence);
  validatePassingTransition(before, after, verified);
  await authenticateHistory(root, before, state);
  await gateContinuity(root,before.continuity,sourceRelease);
  const commandLogs = [];
  for (const ref of verified.requiredLogs) commandLogs.push({...ref, ...await pinFile(root, ref.path)});
  for (const stream of ['stdout', 'stderr']) await authenticateFile(root, invocation.logs[stream]);
  const inventory = await authenticateGateInventory(root,sourceRelease); assert.equal(inventory.mode, 'completed');
  const bindings = await authenticateBindings({root, deployment, sourceRelease});
  assert.deepEqual(bindings, before.bindings, 'Current gate bindings changed');
  assert.equal(canonicalHash(before.config), bindings.configHash);
  assert.deepEqual(before.feature.contract, bindings.contract.value);
  assert.deepEqual(before.feature.scopeBaselineRef, bindings.contract.baseline);
  // Recheck every physical input after the only callback boundary. A callback
  // cannot replace already-validated state/evidence/log bytes before sealing.
  for (const ref of [beforePin, ...(sourceRelease ? [] : [before.continuity]), statePin, evidenceRef,
    ...before.history.evidence, ...before.history.logs, ...Object.values(invocation.logs),
    ...commandLogs.map(({path, bytes, sha256}) => ({path, bytes, sha256}))]) await authenticateFile(root, ref);
  await authenticatePrefix(root, before.history.events);
  assert.deepEqual(await authenticateGateInventory(root,sourceRelease), inventory, 'Gate inventory changed across deployment callback');
  if(sourceRelease) await releaseState(root,sourceRelease);
  return {verified: {...verified, commandLogs}, bindings};
}

// Fixture seams are explicit; the production guarded CLI supplies only the
// fixed authenticator and actual child runner below.
export async function runGateWorkflow({root, deployment, invoke, owner = process.env.CODEX_THREAD_ID}) {
  const sourceRelease = undefined;
  root = path.resolve(root);
  const continuity = await readJson(root, '.harness/continuity.json');
  assert.equal(continuity.phase, 'working'); assert.equal(continuity.handoff, null);
  assert.equal(continuity.owner?.source, 'CODEX_THREAD_ID');
  assert(owner && continuity.owner.id === owner, 'Gate requires current owned worker');
  const state = await readJson(root, '.harness/features.json');
  assert.equal(state.features.filter(feature => feature.id === rolloutFeatureId).length, 1);
  const feature = state.features.find(item => item.id === rolloutFeatureId);
  assert.equal(feature.status, 'active');
  const config = await readJson(root, '.harness/config.json');
  const plan = expectedVerificationPlan(config, feature);
  const bindings = await authenticateBindings({root, deployment});
  assert.equal(canonicalHash(config), bindings.configHash, 'Gate config differs from authenticated bytes');
  assert.deepEqual(feature.contract, bindings.contract.value);
  assert.deepEqual(feature.scopeBaselineRef, bindings.contract.baseline);
  assert.deepEqual(await readJson(root, '.harness/features.json'), state);
  const continuityPin = await pinFile(root, '.harness/continuity.json');
  assert.deepEqual(JSON.parse(await authenticateFile(root, continuityPin)), continuity);
  const before = {version: 1, gateId: randomUUID(), root, owner, nodeExecutable: process.execPath, config, feature, plan,
    state:await pinFile(root, '.harness/features.json'),
    invocationIdentity:{executable:process.execPath, args:['.harness/run.mjs', 'verify', rolloutFeatureId],
      cwd:root, actor:owner, executionCount:plan.executions.length, timeoutMs:gateTimeout(config, plan)},
    evidencePrefix: await Promise.all(feature.evidence.map(relative => pinFile(root, relative))), bindings,
    history: await history(root, state), continuity: continuityPin, capturedAt: now()};
  const directory = await regularPath(root, gateDirectory, {directory: true, absent: true});
  await mkdir(directory); // Exclusive gate reservation: a failed gate is retained.
  const beforePin = await exclusiveJson(root, beforePath, before);
  // Reauthenticate everything after reservation and before consuming an attempt.
  assert.deepEqual(await authenticateBindings({root, deployment}), bindings);
  assert.deepEqual(await readJson(root, '.harness/features.json'), state);
  await authenticateFile(root, before.continuity);
  for (const ref of [...before.history.evidence, ...before.history.logs]) await authenticateFile(root, ref);
  await authenticateFile(root, before.history.events);
  const invocation = await invoke({root, before, plan}); // Exactly once; no retry.
  await exclusiveJson(root, invocationPath, invocation); // Includes failed/unknown outcomes.
  const completed = await authenticateCompleted({root, before, beforePin, invocation, deployment, sourceRelease});
  const receipt = {version: 1, kind: 'fix-nine-rollout-outer-gate', featureId: rolloutFeatureId, gateId: before.gateId,
    before: beforePin, bindings: completed.bindings, invocation, verified: completed.verified, sealedAt: now()};
  validateGateReceipt(before, invocation, completed.verified, receipt, {beforePin, bindings: completed.bindings, observedAt: now()});
  await exclusiveJson(root, receiptPath, receipt);
  return authenticateGate({root, deployment});
}

export async function authenticateGate({root = sourceRoot, deployment = productionDeployment, sourceRelease} = {}) {
  const receiptPin = await pinFile(root, receiptPath), beforePin = await pinFile(root, beforePath),
    invocationPin = await pinFile(root, invocationPath);
  const receipt = JSON.parse(await authenticateFile(root, receiptPin)), before = JSON.parse(await authenticateFile(root, beforePin)),
    invocation = JSON.parse(await authenticateFile(root, invocationPin));
  assert.deepEqual(receipt.before, beforePin);
  assert.deepEqual(receipt.invocation, invocation);
  const completed = await authenticateCompleted({root, before, beforePin, invocation, deployment, sourceRelease});
  assert.deepEqual(receipt.verified.commandLogs, completed.verified.commandLogs, 'Command log bytes changed');
  validateGateReceipt(before, invocation, completed.verified, receipt, {beforePin, bindings: completed.bindings, observedAt: now()});
  for (const ref of [receiptPin, beforePin, invocationPin]) await authenticateFile(root, ref);
  return {pass: true, featureId: rolloutFeatureId, receipt: receiptPin};
}

export async function runGate() {
  assert.equal(path.resolve(process.cwd()), sourceRoot);
  return runGateWorkflow({root: sourceRoot, deployment: productionDeployment, invoke: invokeVerification});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(['run', 'authenticate'].includes(process.argv[2]));
    assert.deepEqual(process.argv.slice(3), ['--report', rolloutReport]);
    console.log(JSON.stringify(await (process.argv[2] === 'run' ? runGate() : authenticateGate())));
  } catch (error) {
    console.error(JSON.stringify({status: 'stopped-safely', errorSha256: canonicalHash(String(error))}));
    process.exitCode = 1;
  }
}
