import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planSync } from '../skill/codex-harness/scripts/lib/core.mjs';
import { targets, sourceRoot, sha, evidenceHashes, verifyInstallation } from './verify-context-rollout.mjs';
import { connect } from './live-host-e2e/native-client.mjs';

const reportPath = path.join(sourceRoot, '.harness/native-hook-rollout-report.json');
const artifacts = path.join(sourceRoot, '.harness/native-hook-rollout');
const sourceEvidence = '.harness/evidence/2026-10-16T00-44-43-798Z-live-host-e2e-verification-002.json';
const trustArtifact = '.harness/native-hook-rollout/reviewed-native-trust.json';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
function command(root, args, allowFailure = false) {
  const result = spawnSync(process.execPath, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: root.replaceAll('\\', '/') } });
  if (!allowFailure) assert.equal(result.status, 0, String(result.stderr || result.stdout || result.error?.message).slice(-1200));
  return result;
}
const session = root => JSON.parse(command(root, ['.harness/run.mjs', 'session', '--json']).stdout);
function idle(root, state) {
  return state.phase === 'working' && (root === sourceRoot ? state.owner?.id === process.env.CODEX_THREAD_ID : state.owner === null);
}
async function snapshot(root, plan) {
  const hashes = {};
  for (const entry of plan.readSet) if (entry.kind === 'file' && !['.codex/hooks.json', '.claude/settings.json'].includes(entry.path)) {
    hashes[entry.path] = sha(await readFile(path.join(root, entry.path)));
  }
  return { hashes, evidence: await evidenceHashes(root) };
}
async function preserved(root, baseline) {
  for (const [file, hash] of Object.entries(baseline.hashes)) assert.equal(sha(await readFile(path.join(root, file))), hash, `${root}: preserved ${file}`);
  for (const [file, hash] of Object.entries(baseline.evidence)) assert.equal(sha(await readFile(path.join(root, file))), hash, `${root}: historical evidence ${file}`);
}
function differences(before, after, at = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    assert.deepEqual(Object.keys(before).sort(), Object.keys(after).sort(), `${at}: only existing command fields may change`);
    return Object.keys(before).flatMap(key => differences(before[key], after[key], `${at}/${key}`));
  }
  return [{ field: at, before, after }];
}
async function reviewPlan(root, preview) {
  assert(!preview.blocked && preview.blockers.length === 0, 'Customized executable blocks apply');
  assert.equal(preview.migrations.length, 0, 'This rollout does not migrate project metadata');
  const actual = await planSync(root);
  assert.equal(actual.planHash, preview.planHash, 'Preview inputs drifted before review');
  const changes = [];
  for (const op of actual.operations.filter(op => op.action === 'write' || op.action === 'remove')) {
    assert.equal(op.action, 'write');
    assert(['.codex/hooks.json', '.claude/settings.json'].includes(op.path), `Unexpected rollout write ${op.path}`);
    const original = await json(path.join(root, op.path));
    const next = JSON.parse(op.bytes.toString('utf8'));
    const canonical = await json(path.join(sourceRoot, op.path));
    const diffs = differences(original, next);
    for (const diff of diffs) {
      const match = diff.field.match(/^\/hooks\/([^/]+)\/\d+\/hooks\/\d+\/(command|commandWindows)$/);
      assert(match, `Unexpected hook option change ${diff.field}`);
      assert(diff.before.includes('HARNESS_HOOK_LAUNCHER_V1'), 'Only generated launchers may migrate');
      assert(canonical.hooks[match[1]].some(group => group.hooks.some(hook => hook[match[2]] === diff.after)), 'Replacement must be exact reviewed source launcher');
    }
    changes.push({ path: op.path, beforeHash: op.beforeHash, afterHash: op.afterHash, fields: diffs.map(diff => diff.field) });
  }
  return changes;
}
async function previewAll() {
  await mkdir(artifacts, { recursive: true });
  // A completed or partial report is never silently replaced; successors reconcile it.
  await assert.rejects(readFile(reportPath), { code: 'ENOENT' });
  const oldReport = await json(path.join(sourceRoot, '.harness/context-rollout-report.json'));
  const report = { version: 1, featureId: 'native-hook-rollout-002', startedAt: new Date().toISOString(), actor: process.env.CODEX_THREAD_ID,
    sourceEvidence, sourceEvidenceHash: sha(await readFile(path.join(sourceRoot, sourceEvidence))), sourceHooksHash: sha(await readFile(path.join(sourceRoot, '.codex/hooks.json'))),
    scope: 'Only reviewed generated hook launcher fields and exact native global hook trust hashes. No project worker claim or recovery.', targets: [] };
  for (let index = 0; index < targets.length; index++) {
    const root = targets[index], state = session(root);
    if (!idle(root, state)) {
      report.targets.push({ root, status: 'pending_live_owner', owner: state.owner?.id ?? null, phase: state.phase });
      continue;
    }
    const preview = JSON.parse(command(sourceRoot, ['bin/agent-harness.mjs', 'sync', root, '--preview', '--json']).stdout);
    const changes = await reviewPlan(root, preview);
    const baseline = await snapshot(root, preview);
    const artifact = `.harness/native-hook-rollout/target-${index}-review.json`;
    const inherited = oldReport.targets.find(entry => entry.root === root);
    const record = { root, status: 'reviewed', planHash: preview.planHash, changes, reviewArtifact: artifact,
      preexistingDoctorFailures: inherited?.preexistingDoctorFailures ?? [] };
    await save(path.join(sourceRoot, artifact), { root, reviewedAt: new Date().toISOString(), plan: preview, changes, baseline });
    record.reviewArtifactHash = sha(await readFile(path.join(sourceRoot, artifact)));
    report.targets.push(record);
  }
  await save(reportPath, report);
  console.log(JSON.stringify({ reviewed: report.targets.filter(r => r.status === 'reviewed').length, pending: report.targets.filter(r => r.status !== 'reviewed').map(r => ({ root: r.root, owner: r.owner })),
    changes: report.targets.filter(r => r.changes?.length).map(r => ({ root: r.root, planHash: r.planHash, changes: r.changes })) }));
}
async function applyReady() {
  const report = await json(reportPath);
  for (const record of report.targets.filter(r => r.status === 'reviewed')) {
    assert(targets.includes(record.root));
    const reviewPath = path.join(sourceRoot, record.reviewArtifact);
    assert.equal(sha(await readFile(reviewPath)), record.reviewArtifactHash);
    const review = await json(reviewPath);
    const fresh = JSON.parse(command(sourceRoot, ['bin/agent-harness.mjs', 'sync', record.root, '--preview', '--json']).stdout);
    assert.equal(fresh.planHash, record.planHash, `${record.root}: stale reviewed plan`);
    assert.deepEqual(await reviewPlan(record.root, fresh), record.changes);
    await preserved(record.root, review.baseline);
    const current = session(record.root); // Immediately before the guarded apply; sync alone does not check logical ownership.
    if (!idle(record.root, current)) { record.status = 'pending_live_owner'; record.owner = current.owner?.id; await save(reportPath, report); continue; }
    const applied = JSON.parse(command(sourceRoot, ['bin/agent-harness.mjs', 'sync', record.root, '--expect-plan', record.planHash, '--json']).stdout);
    assert.equal(applied.planHash, record.planHash);
    await preserved(record.root, review.baseline);
    const after = JSON.parse(command(sourceRoot, ['bin/agent-harness.mjs', 'sync', record.root, '--preview', '--json']).stdout);
    assert.equal((await reviewPlan(record.root, after)).length, 0, 'Installed sync must be idempotent');
    const installationRecord = { preexistingDoctorFailures: record.preexistingDoctorFailures, preservedEvidence: review.baseline.evidence };
    record.verification = await verifyInstallation(record.root, installationRecord);
    record.status = 'installed'; record.idempotent = true; record.preservedState = true; record.appliedAt = new Date().toISOString();
    await save(reportPath, report);
    console.log(JSON.stringify({ root: record.root, status: record.status, writes: record.changes.map(c => c.path), doctor: record.verification.doctor }));
  }
}
export async function discovery(name) {
  const report = await json(reportPath), roots = report.targets.filter(r => ['installed', 'trusted'].includes(r.status)).map(r => r.root);
  const client = await connect({ cwd: sourceRoot, log: path.join(artifacts, `${name}-events.jsonl`) });
  try {
    const result = await client.rpc('hooks/list', { cwds: roots });
    await save(path.join(artifacts, `${name}.json`), result);
    const reviewed = await reviewDiscovery(result, roots);
    console.log(JSON.stringify({ roots: roots.length, definitions: reviewed.length, trusted: reviewed.filter(d => d.trustStatus === 'trusted').length }));
    return { report, result, reviewed };
  } finally { await client.close(); }
}
export async function reviewDiscovery(result, roots) {
  const canonical = await json(path.join(sourceRoot, '.codex/hooks.json'));
  const reviewed = [];
  for (const root of roots) {
    const groups = result.data.filter(g => path.resolve(g.cwd) === root);
    assert.equal(groups.length, 1, `${root}: one native discovery result`);
    const group = groups[0];
    assert(group && !group.errors?.length, `${root}: native discovery must succeed`);
    const installed = await json(path.join(root, '.codex/hooks.json'));
    for (const [event, expectedGroups] of Object.entries(canonical.hooks)) for (const expectedGroup of expectedGroups) for (const hook of expectedGroup.hooks) {
      assert(installed.hooks[event]?.some(g => JSON.stringify(g) === JSON.stringify(expectedGroup)), `${root}: exact source hook ${event}`);
      const matches = group.hooks.filter(d => d.eventName.toLowerCase() === event.toLowerCase() && d.command === (hook.commandWindows ?? hook.command));
      assert.equal(matches.length, 1, `${root}: one exact native definition ${event}`);
      const d = matches[0];
      assert.equal(d.sourcePath, path.join(root, '.codex/hooks.json'));
      assert.equal(d.handlerType, 'command'); assert.equal(d.enabled, true); assert.equal(d.source, 'project'); assert.equal(d.pluginId, null);
      assert.equal(d.matcher, expectedGroup.matcher ?? null); assert.equal(d.timeoutSec, hook.timeout ?? 600);
      assert.equal(d.async, hook.async ?? false); assert.equal(d.statusMessage, hook.statusMessage ?? null); assert.equal(d.additionalContextLimit, hook.additionalContextLimit ?? null);
      assert.match(d.currentHash, /^sha256:[0-9a-f]{64}$/); assert(d.key.startsWith(d.sourcePath + ':')); assert(!d.key.includes("'") && !/[\r\n]/.test(d.key));
      const { command: nativeCommand, ...metadata } = d;
      reviewed.push({ root, ...metadata, commandSha256: sha(nativeCommand) });
    }
  }
  return reviewed;
}
export function approvedDefinitions(definitions) {
  const result = definitions.map(({ trustStatus, displayOrder, ...definition }) => definition)
    .sort((a, b) => `${a.root}\0${a.key}`.localeCompare(`${b.root}\0${b.key}`));
  assert.equal(new Set(result.map(d => `${d.root}\0${d.key}`)).size, result.length, 'Duplicate approved native definition');
  return result;
}
export function assertApprovedDefinitions(actual, approved) {
  assert.deepEqual(approvedDefinitions(actual), approvedDefinitions(approved), 'Native definitions changed since review');
}
async function authenticateHookFiles(report, roots, expected = null) {
  assert.equal(sha(await readFile(path.join(sourceRoot, '.codex/hooks.json'))), report.sourceHooksHash, 'Reviewed source hooks changed');
  const hashes = {};
  for (const root of roots) hashes[root] = sha(await readFile(path.join(root, '.codex/hooks.json')));
  if (expected) assert.deepEqual(hashes, expected, 'Project hook files changed during trust');
  return hashes;
}
function trustTable(config, key) {
  const heading = `[hooks.state.'${key}']`;
  // Only exact complete table headings are eligible; an embedded substring is not a table.
  const starts = [...config.matchAll(/^\[.*\][ \t]*(?:#.*)?\r?$/gm)]
    .filter(match => match[0].replace(/[ \t]*(?:#.*)?\r?$/, '') === heading);
  assert(starts.length <= 1, 'Duplicate native trust table');
  if (!starts.length) return null;
  const start = starts[0].index;
  const rest = config.slice(start + starts[0][0].length);
  const following = /^[ \t]*\[/m.exec(rest);
  const stop = following ? start + starts[0][0].length + following.index : config.length;
  return { heading, start, stop, text: config.slice(start, stop) };
}
export function nativeTrustedHash(config, key) {
  const table = trustTable(config, key);
  const values = table ? [...table.text.matchAll(/^[ \t]*trusted_hash[ \t]*=[ \t]*"(sha256:[0-9a-f]{64})"[ \t]*(?:#.*)?\r?$/gm)] : [];
  assert.equal(values.length, 1, `Missing or ambiguous global trusted_hash: ${key}`);
  assert.equal((table.text.match(/^[ \t]*trusted_hash[ \t]*=/gm) ?? []).length, 1, 'Duplicate global trusted_hash');
  return values[0][1];
}
export function updateNativeTrust(config, definitions) {
  let next = config;
  for (const d of definitions) {
    assert(!/[\r\n']/.test(d.key));
    assert.match(d.currentHash, /^sha256:[0-9a-f]{64}$/);
    const table = trustTable(next, d.key), value = `trusted_hash = ${JSON.stringify(d.currentHash)}`;
    if (!table) next += `\n[hooks.state.'${d.key}']\n${value}\n`;
    else {
      assert((table.text.match(/^[ \t]*trusted_hash[ \t]*=/gm) ?? []).length <= 1, 'Duplicate global trusted_hash');
      const replacement = /^[ \t]*trusted_hash[ \t]*=/m.test(table.text)
        ? table.text.replace(/^[ \t]*trusted_hash[ \t]*=.*$/m, value)
        : table.text.replace(table.heading, `${table.heading}\n${value}`);
      next = next.slice(0, table.start) + replacement + next.slice(table.stop);
    }
  }
  for (const d of definitions) assert.equal(nativeTrustedHash(next, d.key), d.currentHash);
  return next;
}
export async function replaceConfigIfUnchanged(configPath, original, next) {
  const temporary = `${configPath}.native-trust-${randomUUID()}.tmp`;
  try {
    if (next !== original) await writeFile(temporary, next, { flag: 'wx', mode: (await stat(configPath)).mode });
    assert.equal(sha(await readFile(configPath)), sha(original), 'Global config changed during trust; review again');
    if (next !== original) await rename(temporary, configPath);
  } finally { await rm(temporary, { force: true }); }
}
export function validateTrustArtifact(report, artifactBytes, roots) {
  assert.equal(report.nativeTrustArtifact, trustArtifact, 'Missing reviewed trust artifact binding');
  assert.equal(sha(artifactBytes), report.nativeTrustArtifactHash, 'Reviewed trust artifact changed');
  const trust = JSON.parse(artifactBytes);
  assert.equal(trust.version, 1);
  assert.equal(trust.sourceHooksHash, report.sourceHooksHash);
  assert.equal(trust.trustBypass, false); assert.equal(trust.projectTrustOverride, false); assert.equal(trust.exactNativeHashes, true);
  assert.deepEqual(Object.keys(trust.rootHooksHashes).sort(), [...roots].sort(), 'Reviewed project hooks must cover exactly the approved roots');
  assert.deepEqual([...new Set(trust.definitions.map(d => d.root))].sort(), [...roots].sort(), 'Reviewed definitions must cover exactly the approved roots');
  approvedDefinitions(trust.definitions);
  return trust;
}
async function trustReviewed() {
  const report = await json(reportPath);
  const roots = report.targets.filter(r => ['installed', 'trusted'].includes(r.status)).map(r => r.root);
  assert(roots.length, 'No installed roots to trust');
  for (const root of roots) assert(idle(root, session(root)), `${root}: ownership changed before trust`);
  const result = await json(path.join(artifacts, 'native-before.json'));
  const approved = await reviewDiscovery(result, roots);
  const rootHooksHashes = await authenticateHookFiles(report, roots);
  const configPath = path.join(process.env.USERPROFILE, '.codex/config.toml');
  const original = await readFile(configPath, 'utf8');
  const client = await connect({ cwd: sourceRoot, log: path.join(artifacts, 'native-trust-current-events.jsonl') });
  let definitions;
  try {
    definitions = await reviewDiscovery(await client.rpc('hooks/list', { cwds: roots }), roots);
    assertApprovedDefinitions(definitions, approved);
    await authenticateHookFiles(report, roots, rootHooksHashes);
    for (const root of roots) assert(idle(root, session(root)), `${root}: ownership changed during trust`);
    const next = updateNativeTrust(original, definitions);
    await replaceConfigIfUnchanged(configPath, original, next);
    await save(path.join(sourceRoot, trustArtifact), { version: 1, at: new Date().toISOString(), sourceHooksHash: report.sourceHooksHash, rootHooksHashes,
      trustBypass: false, projectTrustOverride: false, definitions, globalConfigBeforeHash: sha(original), globalConfigAfterHash: sha(next), exactNativeHashes: true });
    report.nativeTrustArtifact = trustArtifact;
    report.nativeTrustArtifactHash = sha(await readFile(path.join(sourceRoot, trustArtifact)));
    await save(reportPath, report);
    console.log(JSON.stringify({ reviewed: definitions.length, updated: next !== original, exactNativeHashes: true }));
  } finally { await client.close(); }
}
async function confirm() {
  const { report, reviewed } = await discovery('native-after');
  const roots = report.targets.filter(r => ['installed', 'trusted'].includes(r.status)).map(r => r.root);
  const trust = validateTrustArtifact(report, await readFile(path.join(sourceRoot, trustArtifact)), roots);
  await authenticateHookFiles(report, roots, trust.rootHooksHashes);
  assertApprovedDefinitions(reviewed, trust.definitions);
  const config = await readFile(path.join(process.env.USERPROFILE, '.codex/config.toml'), 'utf8');
  for (const d of reviewed) assert.equal(nativeTrustedHash(config, d.key), d.currentHash);
  for (const record of report.targets.filter(r => r.status === 'installed')) {
    const definitions = reviewed.filter(d => d.root === record.root);
    assert.equal(definitions.length, 6);
    for (const d of definitions) { assert.equal(d.trustStatus, 'trusted'); assert(trust.definitions.some(t => t.key === d.key && t.currentHash === d.currentHash)); }
    record.status = 'trusted'; record.nativeTrust = definitions; record.trustedAt = new Date().toISOString();
  }
  report.totals = { targets: targets.length, installed: report.targets.filter(r => r.idempotent).length, trusted: report.targets.filter(r => r.status === 'trusted').length, pending: report.targets.filter(r => r.status !== 'trusted').length };
  report.updatedAt = new Date().toISOString();
  await save(reportPath, report);
  console.log(JSON.stringify(report.totals));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (action === 'preview') await previewAll();
  else if (action === 'apply-ready') await applyReady();
  else if (action === 'discover') await discovery('native-before');
  else if (action === 'trust-reviewed') await trustReviewed();
  else if (action === 'confirm') await confirm();
  else throw new Error('Choose preview | apply-ready | discover | trust-reviewed | confirm');
}
