import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planSync} from '../skill/codex-harness/scripts/lib/core.mjs';
import {connectNativeHookClient} from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';

export const featureId = 'fix-nine-rollout-001';
export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const directory = `.harness/${featureId}`;
export const targets = [
  sourceRoot,
  'C:\\Users\\Jason\\Coding\\CoochieTerminal',
  'C:\\Users\\Jason\\Documents\\Claude\\Projects\\Stock Compendium',
  'C:\\Users\\Jason\\Documents\\ChatGPT\\CoochieCalendar',
  'C:\\Users\\Jason\\Documents\\ChatGPT\\ReverseEngineer',
  'C:\\Users\\Jason\\Documents\\ChatGPT\\RobloxDeployer',
  'C:\\Users\\Jason\\Documents\\StrategyTester',
  'C:\\Users\\Jason\\Documents\\CoochieScreener',
  'C:\\Users\\Jason\\Documents\\Codex\\2026-07-20\\my-goal-is-to-build-an\\work\\final-forward-test',
  'C:\\Users\\Jason\\Documents\\Codex\\2026-07-20\\my-goal-is-to-build-an\\work\\forward-test-sample',
  'C:\\Users\\Jason\\Documents\\CoochieScreener\\.local\\agent-harness-kit'
];
const outputRoot = 'C:/Users/Jason/Documents/Codex/2026-10-17/re/outputs';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const digest = value => sha(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item));
export async function pin(file, root = sourceRoot) {
  const bytes = await readFile(path.resolve(root, file));
  return {path: file, bytes: bytes.length, sha256: sha(bytes)};
}
async function json(file, root = sourceRoot) { return JSON.parse(await readFile(path.resolve(root, file), 'utf8')); }
async function exclusive(file, value) {
  const target = path.resolve(sourceRoot, file);
  await mkdir(path.dirname(target), {recursive: true});
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  return pin(file);
}
async function optional(file, root) { try { return await pin(file, root); } catch (error) { if (error.code === 'ENOENT') return {path: file, missing: true}; throw error; } }
async function tree(root, relative = '.harness') {
  const rows = [];
  for (const item of await readdir(path.join(root, relative), {withFileTypes: true})) {
    const name = relative + '/' + item.name;
    if (root === sourceRoot && (name === directory || name === `${directory}-report.json`)) continue;
    if (item.isSymbolicLink()) throw new Error('Preservation inventory refuses symlink: ' + name);
    if (item.isDirectory()) rows.push(...await tree(root, name));
    else if (item.isFile()) rows.push(await pin(name, root));
    else throw new Error('Unsupported preservation entry: ' + name);
  }
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function nativeWithoutTrust(config) {
  const copy = structuredClone(config);
  for (const [key, state] of Object.entries(copy.hooks?.state ?? {})) {
    delete state.trusted_hash;
    if (!Object.keys(state).length) delete copy.hooks.state[key];
  }
  return copy;
}
export async function nativePreflight() {
  const configFile = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
  const before = await pin(configFile);
  const client = await connectNativeHookClient({executable: 'C:/Users/Jason/AppData/Local/OpenAI/Codex/bin/e78bad9887fa50cf/codex.exe'});
  try {
    const result = await client.rpc('config/read', {includeLayers: true});
    const layers = result.layers?.filter(row => row.name?.type === 'user' && !row.name.profile && path.resolve(row.name.file) === configFile);
    assert.equal(layers?.length, 1, 'Require exact native user layer');
    const layer = layers[0];
    const discovery = await client.rpc('hooks/list', {cwds: targets});
    assert.deepEqual(discovery.data.map(row => row.cwd), targets, 'Native discovery order changed');
    assert(discovery.data.every(row => !row.errors?.length), 'Native discovery errors');
    const definitions = discovery.data.flatMap(row => row.hooks.filter(hook => hook.source === 'project' && hook.sourcePath === path.join(row.cwd, '.codex/hooks.json')).map(hook => ({
      root: row.cwd, key: hook.key, currentHash: hook.currentHash, trustStatus: hook.trustStatus,
      eventName: hook.eventName, sourcePath: hook.sourcePath, enabled: hook.enabled,
      displayOrder: hook.displayOrder, definitionSha256: digest(hook), commandSha256: digest(hook.command)
    })));
    assert.equal(definitions.length, 66, 'Expected eleven sets of six native definitions');
    assert.equal(new Set(definitions.map(row => row.key)).size, 66);
    assert(definitions.every(row => row.trustStatus === 'trusted' && row.enabled !== false), 'Existing approvals must be trusted');
    const trust = Object.fromEntries(Object.entries(layer.config.hooks?.state ?? {}).map(([key, value]) => [key, value.trusted_hash ?? null]));
    assert.deepEqual(await pin(configFile), before, 'Native raw settings changed during read-only preflight');
    return {raw: before, layerVersion: layer.version, semanticSha256: digest(layer.config), unrelatedSha256: digest(nativeWithoutTrust(layer.config)), trust, definitions,
      receipts: [{method: 'config/read', includeLayers: true, rawBefore: before, rawAfter: before}, {method: 'hooks/list', cwds: targets, count: definitions.length}],
      sourceReviewedApprovals: definitions.filter(row => row.root === sourceRoot), retainedOtherTrust: Object.fromEntries(Object.entries(trust).filter(([key]) => !definitions.some(row => row.key === key)))};
  } finally { await client.close(); }
}

export async function capturePreflight() {
  const session = await json('.harness/continuity.json');
  const owner = session.owner ?? session.worker?.owner;
  assert.equal(owner?.id ?? owner, process.env.CODEX_THREAD_ID, 'Preflight requires the active source worker');
  const oldReportPath = '.harness/native-hook-v2-rollout-004-report.json';
  const old = await json(oldReportPath);
  assert.deepEqual(old.targets.map(row => row.root), targets, 'Historical canonical target set differs');
  const immutable = [
    {path: oldReportPath, bytes: 48610, sha256: 'aa578dcdd2f7c6c054c3e59473a137f7c50f7e93b08441fa83f48d671ead43c3'},
    {path: old.all11.path, bytes: 32008, sha256: 'a42129a4cab8313beddefa551cc381c24d7441385d434c692d470cee6ab2f8e8'},
    {path: '.harness/native-hook-v2-rollout-004-gate/receipt.json', bytes: 60692, sha256: '14a59483b373dfc8b7cab533bf3500ee05fea3457f644b4bb3f61fc63da9c20f'}
  ];
  for (const expected of immutable) assert.deepEqual(await pin(expected.path), expected, 'Prior completed evidence changed');
  const sourceManifest = await json('harness-nine-source-patch-manifest.json', outputRoot);
  const gate = await json('harness-live-integration-gate-export-manifest.json', outputRoot);
  assert.equal(gate.outcome, 'PASS'); assert.equal(gate.hashChecksPass, true); assert.equal(sourceManifest.sourceFiles.length, 37); assert.equal(gate.managedChecks.length, 15);
  const source = await Promise.all(sourceManifest.sourceFiles.map(file => pin(file)));
  const managed = [];
  for (const row of gate.managedChecks) {
    const installed = await pin(row.path), asset = await pin('skill/codex-harness/assets/' + row.sourceAsset);
    assert.equal(installed.sha256, row.expectedSha256); assert.equal(asset.sha256, installed.sha256);
    managed.push({installed, asset});
  }
  const frozen = await Promise.all(['v1', 'v2', 'v3'].map(version => pin(`skill/codex-harness/assets/native-hook-bootstrap-${version}.json`)));
  const targetRows = [];
  for (const [index, root] of targets.entries()) {
    assert.equal((await realpath(root)).toLowerCase(), root.toLowerCase(), 'Canonical root mismatch');
    assert((await lstat(path.join(root, '.harness'))).isDirectory());
    const config = await json('.harness/config.json', root), state = await json('.harness/features.json', root), continuity = await json('.harness/continuity.json', root);
    assert.equal(config.policies.maxAttempts, 5); assert.equal(config.policies.maxRepeatedFailures, 2);
    const preservationPath = `${directory}/target-${index}-preservation.json`;
    const previousPreservation = await optional(preservationPath, sourceRoot);
    const preservation = previousPreservation.missing ? await exclusive(preservationPath, {version: 1, root, files: await tree(root)}) : previousPreservation;
    let plan, failure;
    const planPath = `${directory}/target-${index}-plan.json`, previousPlan = await optional(planPath, sourceRoot);
    try { plan = previousPlan.missing ? await planSync(root) : await json(planPath); } catch (error) { failure = {name: error.name, message: error.message}; }
    const planRef = plan ? previousPlan.missing ? await exclusive(planPath, plan) : previousPlan : null;
    if (plan) for (const file of ['.harness/config.json', '.harness/features.json', '.harness/continuity.json']) assert.equal((await pin(file, root)).sha256, plan.readSet.find(row => row.path === file)?.hash, 'Captured control input changed before preflight completion');
    const legacyActorRecords = state.features.flatMap(feature => (feature.budgetRevisions ?? []).flatMap((revision, revisionIndex) => typeof revision.actor === 'string' ? [] : [{featureId: feature.id, revisionIndex, actorSha256: digest(revision.actor), revisionSha256: digest(revision)}]));
    targetRows.push({index, root, preservation, plan: planRef, planHash: plan?.planHash ?? null, blocked: plan?.blocked ?? true, blockers: plan?.blockers ?? [], failure: failure ?? null,
      maxAttempts: config.policies.maxAttempts, maxRepeatedFailures: config.policies.maxRepeatedFailures,
      config: await pin('.harness/config.json', root), features: await pin('.harness/features.json', root), continuity: await pin('.harness/continuity.json', root),
      historicalFeatures: state.features.filter(feature => root !== sourceRoot || feature.id !== featureId).map(feature => ({id: feature.id, sha256: digest(feature)})),
      continuityFields: Object.keys(continuity), legacyActorRecords,
      customSurfaces: await Promise.all(['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', '.codex/hooks.json', '.codex/config.toml', '.claude/settings.json'].map(file => optional(file, root)))});
  }
  const policyFile = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'agent-harness-hook-policy.json');
  const policy = await json(policyFile);
  assert.equal(policy.sourceRoot, sourceRoot); assert.deepEqual(policy.projects.slice().sort(), targets.slice().sort());
  let native;
  try { native = await nativePreflight(); }
  catch (error) { native = {status: 'blocked', raw: await pin(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml')), failure: {name: error.name, message: error.message}, reconciliation: 'Read-only transport terminated before any write method was sent. No native settings write or deployment was attempted.'}; }
  const preflight = {version: 1, kind: 'fix-nine-rollout-preflight', featureId, at: new Date().toISOString(), worker: process.env.CODEX_THREAD_ID,
    targetRoots: targets, immutableHistorical: immutable, historicalAuthority: old.authority, historicalPolicy: old.policyRef,
    source: {files: source, managed, frozen, closureSha256: digest(source), gateExport: await pin('harness-live-integration-gate-export-manifest.json', outputRoot), sourceManifest: await pin('harness-nine-source-patch-manifest.json', outputRoot)},
    policy: {raw: await pin(policyFile), sourceRoot: policy.sourceRoot, projects: policy.projects, valueSha256: digest(policy)}, native, targets: targetRows,
    exo: {index: 4, hold: 'HOLD until verified new rollout and independent audit CONTINUE', historicalActorsMustRemainByteEquivalent: true},
    externalFindings: await Promise.all(['exo-budget-actor-review.json', 'exo-hold-evidence-review.json'].map(file => pin(file, outputRoot))),
    executionAuthorized: false, pending: ['Independent review of this preflight and concrete plan', 'Review and seal new execution and acceptance helpers before target writes', 'Preservative resolution of historical Exo actor compatibility', 'Explicit disposition of six pre-existing Exo integrity mismatches and current HOLD', ...(native.status === 'blocked' ? ['Successful native read-only baseline before execution authority seal'] : [])]};
  const ref = await exclusive(`${directory}/preflight.json`, preflight);
  console.log(JSON.stringify({preflight: ref, targetCount: targets.length, sourceFiles: source.length, managedFiles: managed.length, nativeDefinitions: native.definitions?.length ?? null, nativeStatus: native.status ?? 'captured',
    blockedTargets: targetRows.filter(row => row.blocked || row.failure).map(row => ({index: row.index, blockers: row.blockers, failure: row.failure})), legacyActors: targetRows.flatMap(row => row.legacyActorRecords.map(item => ({index: row.index, ...item})))}));
  return preflight;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await capturePreflight();
