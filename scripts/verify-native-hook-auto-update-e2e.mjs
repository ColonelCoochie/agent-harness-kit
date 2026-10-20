import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { featureId, sourceRoot, reportRelative, artifactDirectory, sha, stable, snapshot, json, unrelatedState, unrelatedUserConfig } from './native-hook-auto-update-e2e.mjs';
import { reviewNativeDefinitions } from '../skill/codex-harness/scripts/lib/hook-policy.mjs';

const absolute = relative => path.join(sourceRoot, relative);
const report = await json(absolute(reportRelative));
assert.equal(report.version, 1); assert.equal(report.featureId, featureId); assert.equal(report.status, 'passed'); assert.equal(report.pending, null);
assert.deepEqual(report.sourceInputs, ['package.json', 'bin', 'skill/codex-harness', 'tests']);
assert.deepEqual(report.copiedRootEntries, ['bin', 'package.json', 'skill', 'tests']);
for (const field of ['providerCredentials', 'sharedThreadIdentity', 'sharedSessionIdentity', 'copiedAuth', 'nativeTrustBypass']) assert.equal(report.environment[field], false);
assert.equal(report.globalConfig.before, report.globalConfig.after);
assert.equal(sha(await readFile(report.globalConfig.path)), report.globalConfig.before, 'Global config changed after isolated proof');
const gateBytes = await readFile(absolute(report.sourceGate.path)), gate = JSON.parse(gateBytes);
assert.equal(sha(gateBytes), report.sourceGate.sha256); assert.equal(gate.pass, true); assert.equal(gate.featureId, 'native-hook-update-policy');
assert.equal(report.sourceGate.commands, 11); assert.equal(gate.commands.length, 11); assert(gate.commands.every(item => item.exitCode === 0));
const transitionBytes = await readFile(absolute(report.transitionGate.path)), transition = JSON.parse(transitionBytes);
assert.equal(sha(transitionBytes), report.transitionGate.sha256); assert.equal(transition.pass, true); assert.equal(transition.featureId, 'canonical-hook-transition-001');
assert.equal(report.transitionGate.commands, transition.commands.length); assert(transition.commands.every(item => item.exitCode === 0));
const artifactPaths = new Set();
for (const artifact of report.artifacts) {
  assert(artifact.path.startsWith(`${artifactDirectory}/`));
  assert(!artifact.path.includes('..')); assert(!artifactPaths.has(artifact.path)); artifactPaths.add(artifact.path);
  const bytes = await readFile(absolute(artifact.path)); assert.equal(bytes.length, artifact.bytes); assert.equal(sha(bytes), artifact.sha256);
}
assert.equal(report.operations.length, 5);
assert.deepEqual(report.operations.map(item => item.label), ['prepare-source', 'enable', 'initial', 'runtime', 'canonical']);
for (const operation of report.operations) {
  assert(artifactPaths.has(operation.transcript.path));
  assert.deepEqual(operation.transcript, report.artifacts.find(item => item.path === operation.transcript.path));
  const transcript = await json(absolute(operation.transcript.path));
  assert.equal(transcript.exitCode, 0); assert.equal(operation.exitCode, 0);
  assert.deepEqual(transcript.args, operation.args);
}
const preparation = report.operations[0];
assert.deepEqual(preparation.args, ['init', report.kit, '--name', 'canonical-source-test-fixture', '--agents', 'codex']);
assert.equal(preparation.sourceTests, null); assert.equal(preparation.nativeHookApproval, null);
assert.equal(report.sourcePreparation.method, 'ordinary CLI init without native enrollment; no repository .harness files copied');
assert.equal(report.sourcePreparation.unchangedSourceDigest, preparation.sourceDigest);
assert.equal(report.sourcePreparation.unchangedSourceDigest, report.stages.initial.sourceDigest);
const preparedSource = (await json(absolute(report.stages.initial.artifact.path))).sourceSnapshot;
for (const [destination, record] of Object.entries(report.sourcePreparation.generated)) {
  assert.equal(sha(await readFile(path.join(report.kit, '.harness', destination))), record.sha256);
  assert.equal(preparedSource[record.source], record.sha256);
}
assert.equal(sha(await readFile(path.join(report.kit, '.harness/config.json'))), report.sourcePreparation.configHash);
const observations = {};
assert(artifactPaths.has(report.isolatedUserConfig.beforeArtifact.path));
assert.deepEqual(report.isolatedUserConfig.beforeArtifact, report.artifacts.find(item => item.path === report.isolatedUserConfig.beforeArtifact.path));
assert.equal(sha(await readFile(absolute(report.isolatedUserConfig.beforeArtifact.path))), report.isolatedUserConfig.beforeHash);
assert.equal(report.isolatedUserConfig.initial.file, report.isolatedUserConfig.path);
assert.deepEqual(report.isolatedUserConfig.initial.config.hooks.state, report.isolatedUserConfig.initial.trustState);
for (const label of ['initial', 'runtime', 'canonical']) {
  const stage = report.stages[label]; assert(artifactPaths.has(stage.artifact.path));
  assert.deepEqual(stage.artifact, report.artifacts.find(item => item.path === stage.artifact.path));
  const value = await json(absolute(stage.artifact.path)); observations[label] = value;
  assert.equal(value.targetConfigHash, report.targetConfigHash);
  assert.deepEqual(unrelatedUserConfig(value.baseUserConfig.config, value.definitions), report.isolatedUserConfig.initial.config);
  assert.deepEqual(value.baseUserConfig.config.hooks.state, value.baseUserConfig.trustState);
  assert.equal(value.label, label); assert.equal(value.nativeClient, 'production connectNativeHookClient; fresh app-server connection');
  assert.equal(sha(stable(value.sourceSnapshot)), value.sourceDigest); assert.equal(stage.sourceDigest, value.sourceDigest);
  assert.deepEqual(value.canonical, value.installed); assert.equal(value.runtime.sourceHash, value.runtime.installedHash);
  assert.equal(value.installedBootstrapHash, value.bootstrapHash);
  assert.equal(value.globalConfigHash, report.globalConfig.before);
  assert.equal(value.definitions.length, 6);
  // Recheck full captured fields, including native identity and options. This is
  // authenticated recorded evidence; it deliberately makes no claim of live RPC.
  const discovery = { data: [{ cwd: report.target, errors: [], hooks: value.definitions }] };
  assert.deepEqual(reviewNativeDefinitions(discovery, report.target, value.installed, value.canonical), value.definitions);
  for (const definition of value.definitions) { assert.equal(definition.trustStatus, 'trusted'); assert.equal(value.baseUserConfig.trustState[definition.key].trusted_hash, definition.currentHash); }
  assert.equal(value.baseUserConfig.trustState.unrelated.trusted_hash, 'sha256:' + '7'.repeat(64));
  const operation = report.operations.find(item => item.label === label);
  assert.equal(operation.exitCode, 0); assert.equal(operation.sourceDigest, value.sourceDigest);
  if (label !== 'initial') { assert.equal(operation.nativeHookApproval.status, 'trusted'); assert.equal(operation.nativeHookApproval.approved, 6); assert.equal(operation.nativeHookApproval.sourceDigest, value.sourceDigest); }
  else { assert.equal(operation.nativeHookApproval, null); assert.equal(operation.outputFormat, 'CLI text; approval result is not forwarded'); }
  assert.deepEqual(unrelatedState(value.baseUserConfig.trustState, value.definitions), unrelatedState(operation.beforeApproval.trustState, value.definitions));
  assert.equal(operation.sourceTests.actualExitCode, 0); assert.equal(operation.sourceTests.command, 'node --test tests/harness.test.mjs');
  assert.equal(operation.sourceTests.verifierSourceHash, value.sourceSnapshot['skill/codex-harness/scripts/lib/hook-policy.mjs']);
  for (const field of ['mocks', 'stubbedVerifier', 'proofCache']) assert.equal(operation.sourceTests[field], false);
  const controller = await json(absolute(operation.transcript.path)); assert.equal(controller.exitCode, 0);
  assert.deepEqual(controller.args, operation.args);
  if (label !== 'initial') assert.equal(JSON.parse(controller.stdout).nativeHookApproval.sourceDigest, value.sourceDigest);
  else assert(controller.stdout.startsWith(`Scaffolded project harness at ${report.target}`));
  assert.deepEqual(operation.args, label === 'initial' ? ['init', report.target, '--name', 'future-update-e2e', '--agents', 'codex', '--enroll-hooks'] : ['sync', report.target, '--json']);
}
const { initial, runtime, canonical } = observations;
const differences = (before, after) => Object.keys({ ...before, ...after }).filter(key => before[key] !== after[key]);
assert.deepEqual(differences(initial.sourceSnapshot, runtime.sourceSnapshot), ['skill/codex-harness/assets/project-runtime.mjs']);
assert.deepEqual(differences(runtime.sourceSnapshot, canonical.sourceSnapshot), ['skill/codex-harness/assets/codex-hooks.json.template']);
assert.notEqual(runtime.runtime.sourceHash, initial.runtime.sourceHash);
assert.equal(runtime.nativeConfigHash, initial.nativeConfigHash); assert.deepEqual(runtime.definitions, initial.definitions); assert.deepEqual(runtime.canonical, initial.canonical);
assert.equal(runtime.bootstrapHash, initial.bootstrapHash); assert.equal(canonical.bootstrapHash, initial.bootstrapHash);
assert.equal(sha(await readFile(path.join(report.target, '.harness/hooks/native-hook-bootstrap-v2.json'))), canonical.installedBootstrapHash);
assert.equal(canonical.runtime.sourceHash, runtime.runtime.sourceHash);
const expected = structuredClone(runtime.canonical);
expected.hooks.PreCompact[0].hooks[0].statusMessage += ' (isolated future canonical update)';
assert.deepEqual(canonical.canonical, expected);
for (const next of canonical.definitions) {
  const before = runtime.definitions.find(item => item.key === next.key); assert(before);
  if (next.eventName === 'preCompact') {
    assert.notEqual(next.currentHash, before.currentHash); assert.notEqual(next.statusMessage, before.statusMessage);
    assert.deepEqual({ ...next, currentHash: before.currentHash, statusMessage: before.statusMessage }, before, 'Preserve every other native entry field');
  }
  else assert.deepEqual(next, before);
  assert.equal(next.command, before.command); assert.equal(next.matcher, before.matcher);
}
assert.notEqual(canonical.nativeConfigHash, runtime.nativeConfigHash);
assert(report.preservation, 'Require authenticated raw config preservation evidence');
for (const record of [report.preservation.targetConfig, report.preservation.nativeConfig]) {
  assert.deepEqual(record, report.artifacts.find(item => item.path === record.path));
  assert.equal(sha(await readFile(absolute(record.path))), record.sha256);
}
const targetBytes = await readFile(path.join(report.target, '.harness/config.json'));
assert.deepEqual(targetBytes, await readFile(absolute(report.preservation.targetConfig.path)));
assert.equal(sha(targetBytes), report.preservation.targetHash);
for (const label of ['runtime', 'canonical']) {
  const operation = report.operations.find(item => item.label === label);
  const transcript = await json(absolute(operation.transcript.path));
  const entry = JSON.parse(transcript.stdout).readSet.find(item => item.path === '.harness/config.json');
  assert.equal(entry?.kind, 'file'); assert.equal(entry.hash, report.preservation.targetHash);
}
const nativeBytes = await readFile(path.join(report.home, 'config.toml'));
assert.deepEqual(nativeBytes, await readFile(absolute(report.preservation.nativeConfig.path)));
assert.equal(sha(nativeBytes), canonical.nativeConfigHash);
const nativeText = nativeBytes.toString('utf8'); assert.deepEqual(Buffer.from(nativeText), nativeBytes);
const priorCompact = runtime.definitions.find(item => item.eventName === 'preCompact');
const nextCompact = canonical.definitions.find(item => item.eventName === 'preCompact');
assert.equal(nativeText.split(nextCompact.currentHash).length, 2);
assert.equal(sha(nativeText.replace(nextCompact.currentHash, priorCompact.currentHash)), runtime.nativeConfigHash);
assert.equal(report.preservation.reconstructedHash, runtime.nativeConfigHash);
assert.deepEqual(await snapshot(report.kit), canonical.sourceSnapshot, 'Preserved isolated kit drifted');
assert.equal(sha(await readFile(path.join(report.target, '.harness/run.mjs'))), canonical.runtime.installedHash);
assert.deepEqual(await json(path.join(report.target, '.codex/hooks.json')), canonical.installed);
assert.equal(sha(await readFile(path.join(report.home, 'config.toml'))), canonical.nativeConfigHash);
assert.equal(sha(await readFile(path.join(report.target, '.harness/config.json'))), report.targetConfigHash);
assert.equal(canonical.targetConfigHash, report.targetConfigHash);
assert.equal((await json(path.join(sourceRoot, '.harness/config.json'))).policies.maxAttempts, 5);
assert.equal((await json(path.join(report.target, '.harness/config.json'))).policies.maxAttempts, 5);
assert.equal(report.nativeDispatch.status, 'not_exercised'); assert(report.nativeDispatch.gap.includes('six-event V2'));
console.log('PASS isolated native canonical auto-update evidence: six trusted definitions at each of three real default-verifier stages; exact runtime/template deltas; global config unchanged. Actual V2 event dispatch remains a separate live-host follow-up.');
