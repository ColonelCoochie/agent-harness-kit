import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { canonicalCodexHooks, reviewNativeDefinitions } from '../skill/codex-harness/scripts/lib/hook-policy.mjs';
import { connectNativeHookClient } from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';
import { selectReport, reportArtifactDirectory } from './native-hook-report-selection.mjs';

export const featureId = 'native-hook-auto-update-e2e-001';
export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const reportRelative = selectReport();
export const artifactDirectory = reportArtifactDirectory(reportRelative);
const sourceGate = '.harness/evidence/2026-10-16T03-19-02-841Z-native-hook-update-policy.json';
const transitionGate = '.harness/evidence/2026-10-16T04-11-51-756Z-canonical-hook-transition-001.json';
const executable = 'C:/Users/Jason/AppData/Local/OpenAI/Codex/bin/9614f1d9b40d9c4f/codex.exe';
const unrelatedHash = 'sha256:' + '7'.repeat(64);
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
const absolute = relative => path.join(sourceRoot, relative);
const hostKeys = new Set(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']);
const cleanEnvironment = home => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => hostKeys.has(key))), CODEX_HOME: home, CODEX_EXECUTABLE: executable });
export async function snapshot(root) {
  const entries = {};
  async function visit(relative) {
    const destination = path.join(root, relative), information = await lstat(destination);
    assert(!information.isSymbolicLink(), 'Source snapshot must reject symbolic links');
    if (information.isDirectory()) for (const child of (await readdir(destination)).sort()) await visit(path.join(relative, child));
    else { assert(information.isFile()); entries[relative.replaceAll('\\', '/')] = sha(await readFile(destination)); }
  }
  for (const relative of ['package.json', 'bin', 'skill/codex-harness', 'tests']) await visit(relative);
  return entries;
}
async function artifact(report, name, bytes) {
  const relative = `${report.artifactDirectory || artifactDirectory}/${name}`;
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await writeFile(absolute(relative), data, { flag: 'wx' });
  const record = { path: relative, bytes: data.length, sha256: sha(data) };
  report.artifacts.push(record);
  return record;
}
async function save(report, { exclusive = false } = {}) { await writeFile(absolute(reportRelative), JSON.stringify(report, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' }); }
async function globalHash(report) { return sha(await readFile(report.globalConfig.path)); }
async function diagnoseInitialFailure() {
  const report = await json(absolute(reportRelative));
  assert.equal(report.pending?.label, 'initial');
  assert.deepEqual(Object.keys(report.stages), []);
  const priorRecord = report.artifacts.find(item => item.path.endsWith('/initial-controller.json'));
  const priorBytes = await readFile(absolute(priorRecord.path));
  assert.equal(sha(priorBytes), priorRecord.sha256);
  const prior = JSON.parse(priorBytes);
  assert.equal(prior.exitCode, 1);
  assert.match(prior.stderr, /Canonical source verification failed; trust unchanged/);
  assert.equal(sha(stable(await snapshot(report.kit))), report.pending.sourceDigest);
  assert.equal(await globalHash(report), report.globalConfig.before);
  const client = await connectNativeHookClient({ cwd: report.target, home: report.home, executable, env: cleanEnvironment(report.home) });
  let discovery, config;
  try {
    discovery = await client.rpc('hooks/list', { cwds: [report.target] });
    config = await client.rpc('config/read', { includeLayers: true });
  } finally { await client.close(); }
  const base = config.layers.filter(layer => layer.name?.type === 'user' && !layer.name.profile && path.resolve(layer.name.file) === path.join(report.home, 'config.toml'));
  assert.equal(base.length, 1);
  assert.deepEqual(base[0].config.hooks.state, { unrelated: { trusted_hash: unrelatedHash } });
  const definitions = reviewNativeDefinitions(discovery, report.target, await json(path.join(report.target, '.codex/hooks.json')), await canonicalCodexHooks(report.kit));
  assert.equal(definitions.length, 6);
  assert(definitions.every(definition => definition.trustStatus !== 'trusted'));
  const readback = await artifact(report, 'failed-initial-readback.json', JSON.stringify({ observedAt: new Date().toISOString(), definitions, baseUserConfig: base[0], globalConfigHash: await globalHash(report) }, null, 2) + '\n');
  const environment = Object.fromEntries(Object.entries(cleanEnvironment(report.home)).filter(([key]) => hostKeys.has(key)));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', 'tests/harness-continuity.test.mjs'], { cwd: report.kit, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0;
    const capture = kind => data => {
      bytes += data.length;
      if (bytes > 2000000) { child.kill(); reject(new Error('Diagnostic exceeded bounded capture')); return; }
      if (kind === 'stdout') stdout += data; else stderr += data;
    };
    child.stdout.on('data', capture('stdout')); child.stderr.on('data', capture('stderr'));
    child.once('error', reject); child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /ENOENT/);
  const failedTests = [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  assert.equal(failedTests.length, 8);
  const transcript = await artifact(report, 'failed-continuity-diagnostic.json', JSON.stringify({ command: 'node --test tests/harness-continuity.test.mjs', ...result }, null, 2) + '\n');
  report.diagnostic = { readback, transcript, failedTests, cause: 'Continuity fixtures require generated source-checkout .harness files excluded from the exact source copy.', sourceDigest: report.pending.sourceDigest };
  report.status = 'failed_initial_source_tests'; report.pending = null;
  assert.equal(await globalHash(report), report.globalConfig.before);
  await save(report);
  console.log(JSON.stringify({ status: report.status, failures: failedTests.length, cause: report.diagnostic.cause }));
}
async function archiveFailedInitial() {
  const report = await json(absolute(reportRelative));
  assert(['failed_initial_source_tests', 'failed_canonical_review'].includes(report.status)); assert.equal(report.pending, null);
  if (report.status === 'failed_canonical_review') assert.equal(report.canonicalFailure.unchangedNativeState, true);
  assert.equal(await globalHash(report), report.globalConfig.before);
  for (const record of report.artifacts) assert.equal(sha(await readFile(absolute(record.path))), record.sha256);
  const bytes = await readFile(absolute(reportRelative));
  const archive = `${report.artifactDirectory || artifactDirectory}/failed-report-${sha(bytes)}.json`;
  await rename(absolute(reportRelative), absolute(archive));
  console.log(JSON.stringify({ status: 'archived_known_failure', report: archive, sha256: sha(bytes), scratchPreserved: report.kit }));
}
async function readBaseUserConfig(report) {
  const client = await connectNativeHookClient({ cwd: report.target, home: report.home, executable, env: cleanEnvironment(report.home) });
  try {
    const config = await client.rpc('config/read', { includeLayers: true });
    const layers = config.layers?.filter(layer => layer.name?.type === 'user' && !layer.name.profile && path.resolve(layer.name.file) === path.join(report.home, 'config.toml'));
    assert.equal(layers?.length, 1);
    return { file: layers[0].name.file, version: layers[0].version, config: layers[0].config, trustState: layers[0].config.hooks.state };
  } finally { await client.close(); }
}
export const unrelatedState = (state, definitions) => Object.fromEntries(Object.entries(state).filter(([key]) => !definitions.some(item => item.key === key)));
export function unrelatedUserConfig(config, definitions) {
  const preserved = structuredClone(config);
  preserved.hooks.state = unrelatedState(preserved.hooks.state, definitions);
  return preserved;
}
async function command(report, label, args) {
  assert.equal(report.pending, null, 'Reconcile a pending operation before another command; no blind retries');
  const source = await snapshot(report.kit);
  const preparation = label === 'prepare-source';
  const textOutput = preparation || label === 'initial';
  const beforeApproval = label === 'enable' || preparation ? null : await readBaseUserConfig(report);
  report.pending = { label, args, startedAt: new Date().toISOString(), sourceDigest: sha(stable(source)) };
  await save(report);
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(report.kit, 'bin/agent-harness.mjs'), ...args], { cwd: report.kit, env: cleanEnvironment(report.home), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0;
    const capture = kind => data => {
      bytes += data.length;
      if (bytes > 2000000) { child.kill(); reject(new Error('Bounded CLI capture exceeded two megabytes; reconcile pending operation')); return; }
      if (kind === 'stdout') stdout += data; else stderr += data;
    };
    child.stdout.on('data', capture('stdout')); child.stderr.on('data', capture('stderr'));
    child.once('error', reject);
    child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
  const transcript = await artifact(report, `${label}-controller.json`, JSON.stringify({ args, executable: process.execPath, cli: path.join(report.kit, 'bin/agent-harness.mjs'), startedAt: report.pending.startedAt, durationMs: Date.now() - started, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n');
  await save(report); // Preserve authenticated diagnostics even when a definite failure interrupts this phase.
  assert.equal(await globalHash(report), report.globalConfig.before, 'Real global Codex configuration changed');
  assert.equal(result.exitCode, 0, `${label}: CLI failed; inspect authenticated artifact and reconcile rather than retry`);
  const output = textOutput ? {} : JSON.parse(result.stdout);
  if (textOutput) assert(result.stdout.startsWith(`Scaffolded project harness at ${preparation ? report.kit : report.target}`));
  assert.deepEqual(await snapshot(report.kit), source, 'Source changed during actual approval');
  if (label !== 'enable' && !textOutput) {
    assert.equal(output.nativeHookApproval?.status, 'trusted');
    assert.equal(output.nativeHookApproval.approved, 6);
    assert.equal(output.nativeHookApproval.sourceDigest, report.pending.sourceDigest);
  }
  const record = { label, args, transcript, sourceDigest: report.pending.sourceDigest, exitCode: result.exitCode,
    beforeApproval, outputFormat: textOutput ? 'CLI text; approval result is not forwarded' : 'JSON', nativeHookApproval: output.nativeHookApproval ?? null,
    sourceTests: label === 'enable' || preparation ? null : { implementation: 'unchanged production verifySourceTests', command: 'node --test tests/harness.test.mjs', actualExitCode: 0, evidence: 'The unmodified default verifier must return successfully before the production controller can approve; successful child TAP is not forwarded by that verifier.', verifierSourceHash: source['skill/codex-harness/scripts/lib/hook-policy.mjs'], mocks: false, stubbedVerifier: false, proofCache: false } };
  report.operations.push(record);
  report.pending = null;
  await save(report);
  return record;
}
async function observe(report, label) {
  const source = await snapshot(report.kit);
  const canonical = await canonicalCodexHooks(report.kit);
  const installed = await json(path.join(report.target, '.codex/hooks.json'));
  assert.deepEqual(installed, canonical);
  const client = await connectNativeHookClient({ cwd: report.target, home: report.home, executable, env: cleanEnvironment(report.home) });
  let discovery, config;
  try { discovery = await client.rpc('hooks/list', { cwds: [report.target] }); config = await client.rpc('config/read', { includeLayers: true }); }
  finally { await client.close(); }
  const definitions = reviewNativeDefinitions(discovery, report.target, installed, canonical);
  const layers = config.layers?.filter(layer => layer.name?.type === 'user' && !layer.name.profile && path.resolve(layer.name.file) === path.join(report.home, 'config.toml'));
  assert.equal(layers?.length, 1);
  const base = layers[0];
  assert.equal(typeof base.version, 'string');
  assert.equal(base.config.hooks.state.unrelated.trusted_hash, unrelatedHash);
  assert.equal(definitions.length, 6);
  for (const definition of definitions) { assert.equal(definition.trustStatus, 'trusted'); assert.equal(base.config.hooks.state[definition.key].trusted_hash, definition.currentHash); }
  const operation = report.operations.find(item => item.label === label);
  assert.deepEqual(unrelatedState(base.config.hooks.state, definitions), unrelatedState(operation.beforeApproval.trustState, definitions), 'Approval must preserve every unrelated trust object and key');
  assert.deepEqual(unrelatedUserConfig(base.config, definitions), report.isolatedUserConfig.initial.config, 'Approval must preserve the complete unrelated isolated user configuration');
  const targetConfigHash = sha(await readFile(path.join(report.target, '.harness/config.json')));
  report.targetConfigHash ??= targetConfigHash;
  assert.equal(targetConfigHash, report.targetConfigHash, 'Ordinary sync must preserve target configuration');
  assert.equal(await globalHash(report), report.globalConfig.before);
  const observation = { label, observedAt: new Date().toISOString(), nativeClient: 'production connectNativeHookClient; fresh app-server connection', canonical, installed, definitions,
    baseUserConfig: { file: base.name.file, version: base.version, config: base.config, trustState: base.config.hooks.state },
    targetConfigHash,
    sourceDigest: sha(stable(source)), sourceSnapshot: source,
    runtime: { sourceHash: sha(await readFile(path.join(report.kit, 'skill/codex-harness/assets/project-runtime.mjs'))), installedHash: sha(await readFile(path.join(report.target, '.harness/run.mjs'))) },
    bootstrapHash: sha(await readFile(path.join(report.kit, 'skill/codex-harness/assets/native-hook-bootstrap-v2.json'))),
    installedBootstrapHash: sha(await readFile(path.join(report.target, '.harness/hooks/native-hook-bootstrap-v2.json'))),
    nativeConfigHash: sha(await readFile(path.join(report.home, 'config.toml'))), globalConfigHash: await globalHash(report), unrelatedHash };
  assert.equal(observation.runtime.sourceHash, observation.runtime.installedHash);
  assert.equal(observation.installedBootstrapHash, observation.bootstrapHash);
  const record = await artifact(report, `${label}-observation.json`, JSON.stringify(observation, null, 2) + '\n');
  report.stages[label] = { artifact: record, sourceDigest: observation.sourceDigest };
  await save(report);
  return observation;
}
async function diagnoseCanonicalFailure() {
  const report = await json(absolute(reportRelative));
  assert.equal(report.pending?.label, 'canonical'); assert(!report.stages.canonical);
  const transcript = report.artifacts.findLast(item => item.path.endsWith('/canonical-controller.json'));
  const bytes = await readFile(absolute(transcript.path)); assert.equal(sha(bytes), transcript.sha256);
  const controller = JSON.parse(bytes); assert.equal(controller.exitCode, 1);
  assert.match(controller.stderr, /Customized or duplicated canonical hook requires review: PreCompact/);
  const client = await connectNativeHookClient({ cwd: report.target, home: report.home, executable, env: cleanEnvironment(report.home) });
  let discovery, config;
  try { discovery = await client.rpc('hooks/list', { cwds: [report.target] }); config = await client.rpc('config/read', { includeLayers: true }); }
  finally { await client.close(); }
  const installed = await json(path.join(report.target, '.codex/hooks.json'));
  const definitions = reviewNativeDefinitions(discovery, report.target, installed, installed);
  const runtime = await json(absolute(report.stages.runtime.artifact.path));
  const readback = { observedAt: new Date().toISOString(), sourceDigest: sha(stable(await snapshot(report.kit))),
    installed, definitions, userLayers: config.layers.filter(layer => layer.name?.type === 'user'),
    targetConfigHash: sha(await readFile(path.join(report.target, '.harness/config.json'))),
    nativeConfigHash: sha(await readFile(path.join(report.home, 'config.toml'))),
    globalConfigHash: await globalHash(report) };
  assert.equal(readback.sourceDigest, report.pending.sourceDigest);
  assert.deepEqual(readback.installed, runtime.installed);
  assert.deepEqual(readback.definitions, runtime.definitions);
  assert.equal(readback.nativeConfigHash, runtime.nativeConfigHash);
  assert.equal(readback.globalConfigHash, report.globalConfig.before);
  const observation = await artifact(report, 'canonical-failure-readback.json', JSON.stringify(readback, null, 2) + '\n');
  report.canonicalFailure = { transcript, readback: observation, definiteExitCode: 1,
    reason: controller.stderr.trim(), unchangedNativeState: true, retryAttempted: false };
  report.status = 'failed_canonical_review'; report.pending = null;
  await save(report);
  console.log(JSON.stringify({ status: report.status, unchangedNativeState: true, retryAttempted: false }));
}
async function authenticatePreservation() {
  const report = await json(absolute(reportRelative));
  assert.equal(report.status, 'passed'); assert.equal(report.pending, null);
  assert(!report.preservation, 'Preserve the first measured preservation record');
  const runtime = await json(absolute(report.stages.runtime.artifact.path));
  const canonical = await json(absolute(report.stages.canonical.artifact.path));
  const targetBytes = await readFile(path.join(report.target, '.harness/config.json'));
  const targetHash = sha(targetBytes);
  for (const label of ['runtime', 'canonical']) {
    const operation = report.operations.find(item => item.label === label);
    const bytes = await readFile(absolute(operation.transcript.path));
    assert.equal(sha(bytes), operation.transcript.sha256);
    const transcript = JSON.parse(bytes); assert.equal(transcript.exitCode, 0);
    const entry = JSON.parse(transcript.stdout).readSet.find(item => item.path === '.harness/config.json');
    assert.equal(entry?.kind, 'file'); assert.equal(entry.hash, targetHash);
  }
  const nativeBytes = await readFile(path.join(report.home, 'config.toml'));
  assert.equal(sha(nativeBytes), canonical.nativeConfigHash);
  const before = runtime.definitions.find(item => item.eventName === 'preCompact');
  const after = canonical.definitions.find(item => item.eventName === 'preCompact');
  const nativeText = nativeBytes.toString('utf8');
  assert.deepEqual(Buffer.from(nativeText), nativeBytes, 'Reconstruction requires exact UTF-8 bytes');
  assert.equal(nativeText.split(after.currentHash).length, 2, 'Replace exactly the single approved hash');
  const reconstructedHash = sha(nativeText.replace(after.currentHash, before.currentHash));
  assert.equal(reconstructedHash, runtime.nativeConfigHash, 'Every other native config byte must be preserved');
  const targetConfig = await artifact(report, 'preserved-target-config.json', targetBytes);
  const nativeConfig = await artifact(report, 'preserved-native-config.toml', nativeBytes);
  report.preservation = { targetConfig, nativeConfig, targetHash, reconstructedHash,
    targetMethod: 'Authenticated runtime and canonical controller readSet hashes equal final raw target config bytes',
    nativeMethod: 'Replace exactly one final PreCompact trusted hash with authenticated runtime hash; every other raw TOML byte is identical',
    nativeHashFields: 'Actual native entries expose currentHash and trustStatus; the user layer exposes trusted_hash, with no separate userHash field' };
  assert.equal(await globalHash(report), report.globalConfig.before);
  await save(report);
  console.log(JSON.stringify({ status: 'preservation_authenticated', targetHash, reconstructedHash }));
}
async function prepare() {
  try { await lstat(absolute(reportRelative)); throw new Error('Existing report must be continued or reconciled, never replaced'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'agent-harness-native-auto-update-'));
  const kit = path.join(scratch, 'KIT'), target = path.join(scratch, 'TARGET'), home = path.join(scratch, 'HOME');
  const runArtifacts = `${artifactDirectory}/${path.basename(scratch)}`;
  for (const directory of [kit, target, home, absolute(artifactDirectory)]) await mkdir(directory, { recursive: true });
  await mkdir(absolute(runArtifacts));
  for (const relative of ['package.json', 'bin', 'skill/codex-harness', 'tests']) await cp(absolute(relative), path.join(kit, relative), { recursive: true, dereference: false });
  assert.deepEqual(await snapshot(kit), await snapshot(sourceRoot));
  assert.deepEqual((await readdir(kit)).sort(), ['bin', 'package.json', 'skill', 'tests']);
  // A literal quoted TOML key preserves Windows separators and dots as one project key.
  const literalTarget = target.toLowerCase();
  assert(!literalTarget.includes("'"));
  await writeFile(path.join(home, 'config.toml'), `[projects.'${literalTarget}']\ntrust_level = "trusted"\n\n[hooks.state.unrelated]\ntrusted_hash = "${unrelatedHash}"\n`, { flag: 'wx' });
  assert.deepEqual(await readdir(home), ['config.toml']);
  const realConfig = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
  const gateBytes = await readFile(absolute(sourceGate)), gate = JSON.parse(gateBytes);
  const transitionBytes = await readFile(absolute(transitionGate)), transition = JSON.parse(transitionBytes);
  assert.equal(transition.pass, true); assert.equal(transition.featureId, 'canonical-hook-transition-001');
  assert.equal(gate.pass, true); assert.equal(gate.featureId, 'native-hook-update-policy');
  const report = { version: 1, featureId, status: 'in_progress', startedAt: new Date().toISOString(), scratch, kit, target, home, executable,
    globalConfig: { path: realConfig, before: sha(await readFile(realConfig)), after: null }, sourceGate: { path: sourceGate, sha256: sha(gateBytes), pass: true, commands: gate.commands.length },
    transitionGate: { path: transitionGate, sha256: sha(transitionBytes), pass: true, commands: transition.commands.length },
    environment: { providerCredentials: false, sharedThreadIdentity: false, sharedSessionIdentity: false, copiedAuth: false, nativeTrustBypass: false, projectTrustSeededOnlyInFixture: true },
    sourceInputs: ['package.json', 'bin', 'skill/codex-harness', 'tests'], copiedRootEntries: ['bin', 'package.json', 'skill', 'tests'], artifactDirectory: runArtifacts, operations: [], artifacts: [], stages: {}, pending: null,
    nativeDispatch: { status: 'not_exercised', gap: 'This isolated credential-free proof verifies real native discovery and config approval. It does not establish actual six-event V2 model lifecycle dispatch. Follow-up: use the existing actual native live-host client in the already authorized real host, preserve global config state, and observe approved V2 hooks without copying credentials or bypassing native trust.', priorActualLifecycleReport: '.harness/live-host-e2e-report.json' } };
  report.isolatedUserConfig = { path: path.join(home, 'config.toml'), beforeHash: sha(await readFile(path.join(home, 'config.toml'))), initial: await readBaseUserConfig(report) };
  report.isolatedUserConfig.beforeArtifact = await artifact(report, 'before-user-config.toml', await readFile(path.join(home, 'config.toml')));
  await save(report, { exclusive: true });
  return report;
}
export async function runPhase(phase) {
  if (phase === 'diagnose-initial') return diagnoseInitialFailure();
  if (phase === 'authenticate') return authenticatePreservation();
  if (phase === 'diagnose-canonical') return diagnoseCanonicalFailure();
  if (phase === 'archive-failed') return archiveFailedInitial();
  const report = phase === 'initial' ? await prepare() : await json(absolute(reportRelative));
  assert.equal(report.status, 'in_progress');
  assert.equal(report.pending, null, 'An unknown operation must be reconciled by fresh native/config readback; never blindly replay');
  assert.equal(await globalHash(report), report.globalConfig.before);
  if (phase === 'initial') {
    await command(report, 'prepare-source', ['init', report.kit, '--name', 'canonical-source-test-fixture', '--agents', 'codex']);
    const generated = {};
    for (const [destination, source] of [['run.mjs', 'project-runtime.mjs'], ['context-budget.mjs', 'context-budget.mjs'], ['hooks/native-hook-identity.mjs', 'native-hook-identity.mjs'], ['hooks/precompact-handoff.mjs', 'precompact-handoff.mjs'], ['hooks/sessionstart-routing.mjs', 'sessionstart-routing.mjs']]) {
      const hash = sha(await readFile(path.join(report.kit, '.harness', destination)));
      assert.equal(hash, sha(await readFile(path.join(report.kit, 'skill/codex-harness/assets', source))));
      generated[destination] = { source: `skill/codex-harness/assets/${source}`, sha256: hash };
    }
    report.sourcePreparation = { method: 'ordinary CLI init without native enrollment; no repository .harness files copied', generated, configHash: sha(await readFile(path.join(report.kit, '.harness/config.json'))), unchangedSourceDigest: sha(stable(await snapshot(report.kit))) };
    assert.equal(report.sourcePreparation.unchangedSourceDigest, report.operations[0].sourceDigest);
    await save(report);
    await command(report, 'enable', ['hook-policy', 'enable', report.kit, '--project', report.target, '--json']);
    await command(report, 'initial', ['init', report.target, '--name', 'future-update-e2e', '--agents', 'codex', '--enroll-hooks']);
    await observe(report, 'initial');
  } else if (phase === 'runtime') {
    assert(report.stages.initial && !report.stages.runtime);
    const before = await json(absolute(report.stages.initial.artifact.path));
    await writeFile(path.join(report.kit, 'skill/codex-harness/assets/project-runtime.mjs'), await readFile(path.join(report.kit, 'skill/codex-harness/assets/project-runtime.mjs'), 'utf8') + '\n// Isolated native auto-update E2E: harmless runtime delta.\n');
    await command(report, 'runtime', ['sync', report.target, '--json']);
    const after = await observe(report, 'runtime');
    assert.notEqual(after.runtime.sourceHash, before.runtime.sourceHash);
    assert.equal(after.bootstrapHash, before.bootstrapHash);
    assert.deepEqual(after.canonical, before.canonical);
    assert.deepEqual(after.definitions, before.definitions);
    assert.equal(after.nativeConfigHash, before.nativeConfigHash);
  } else if (phase === 'canonical') {
    assert(report.stages.runtime && !report.stages.canonical);
    const before = await json(absolute(report.stages.runtime.artifact.path));
    const templatePath = path.join(report.kit, 'skill/codex-harness/assets/codex-hooks.json.template');
    const original = await readFile(templatePath, 'utf8'), oldMessage = before.canonical.hooks.PreCompact[0].hooks[0].statusMessage;
    assert.equal(original.split(JSON.stringify(oldMessage)).length, 2, 'Change only the exact PreCompact status string');
    await writeFile(templatePath, original.replace(JSON.stringify(oldMessage), JSON.stringify(oldMessage + ' (isolated future canonical update)')));
    await command(report, 'canonical', ['sync', report.target, '--json']);
    const after = await observe(report, 'canonical');
    const prior = before.definitions.find(item => item.eventName === 'preCompact'), next = after.definitions.find(item => item.eventName === 'preCompact');
    assert.notEqual(next.currentHash, prior.currentHash, 'The real native hash must include this changed canonical field; do not pretend a no-op proves approval refresh');
    assert.equal(next.key, prior.key); assert.equal(next.command, prior.command); assert.equal(next.matcher, prior.matcher);
    assert.equal(after.bootstrapHash, before.bootstrapHash);
    assert.equal(after.runtime.sourceHash, before.runtime.sourceHash);
    report.globalConfig.after = await globalHash(report);
    assert.equal(report.globalConfig.after, report.globalConfig.before);
    report.status = 'passed'; report.finishedAt = new Date().toISOString();
    await save(report);
  } else throw new Error('Select --phase initial|runtime|canonical');
  console.log(JSON.stringify({ featureId, phase, status: report.status, stages: Object.keys(report.stages), report: reportRelative }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--phase');
  await runPhase(index < 0 ? '' : process.argv[index + 1]);
}
