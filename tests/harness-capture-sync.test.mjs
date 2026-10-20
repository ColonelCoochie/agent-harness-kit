import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, mkdir, open, opendir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initHarness, parseArgs, planSync, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const exec = promisify(execFile), roots = [];
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeSource = await readFile(path.join(repository, 'skill/codex-harness/assets/project-runtime.mjs'), 'utf8');
const collectorSource = runtimeSource.slice(runtimeSource.indexOf('function repositoryCapturePath('), runtimeSource.indexOf('\nfunction isPathInside(', runtimeSource.indexOf('function repositoryCapturePath(')));
const limits = { entries: 32768, manifestBytes: 16777216, depth: 64, elapsedMs: 300000, fileBytes: 17179869184 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
async function directory(name) { const root = await mkdtemp(path.join(os.tmpdir(), 'capture-sync-' + name + '-')); roots.push(root); return root; }
async function fixture(name, agents) {
  const root = await directory(name); await writeFile(path.join(root, 'package.json'), JSON.stringify({ name, scripts: { test: 'node --version' } }));
  await initHarness(root, { name, purpose: 'Capture and safe sync fixture', ...(agents ? { agents } : {}) }); return root;
}
async function isolatedKit(name, editCore = value => value) {
  const root = await directory(name), skill = path.join(root, 'kit');
  await mkdir(path.join(skill, 'scripts/lib'), { recursive: true });
  await cp(path.join(repository, 'skill/codex-harness/scripts/lib'), path.join(skill, 'scripts/lib'), { recursive: true });
  await cp(path.join(repository, 'skill/codex-harness/assets'), path.join(skill, 'assets'), { recursive: true });
  const core = path.join(skill, 'scripts/lib/core.mjs');
  await writeFile(core, editCore(await readFile(path.join(repository, 'skill/codex-harness/scripts/lib/core.mjs'), 'utf8')));
  return { root, skill, api: await import(pathToFileURL(core).href) };
}
async function tree(root, base = '') {
  const rows = [];
  for (const entry of (await readdir(path.join(root, base), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { rows.push([relative, 'directory']); rows.push(...await tree(root, relative)); }
    else if (entry.isSymbolicLink()) rows.push([relative, 'symlink', String(await readlink(path.join(root, relative)))]);
    else rows.push([relative, hash(await readFile(path.join(root, relative)))]);
  }
  return rows;
}
function collector(root, overrides = {}, io = {}) {
  return new Function('deps', `const {lstat,open,opendir,readlink,createHash,path,ROOT,REPOSITORY_CAPTURE_LIMITS}=deps;\n${collectorSource}\nreturn repositoryCaptureCollector();`)({ lstat, open, opendir, readlink, createHash, path, ROOT: root, REPOSITORY_CAPTURE_LIMITS: { ...limits, ...overrides }, ...io });
}
const requests = relative => [{ path: relative, status: '??' }];

test('capture: directory membership and descendant content have separate stable fingerprints', async () => {
  const root = await directory('directory'); await mkdir(path.join(root, 'new/nested'), { recursive: true });
  await writeFile(path.join(root, 'new/nested/file.txt'), 'before');
  const before = await collector(root).collect(requests('new/'));
  assert.equal(before.length, 3); assert.equal(before.find(row => row.path === 'new').type, 'directory');
  await writeFile(path.join(root, 'new/nested/file.txt'), 'after');
  const edited = await collector(root).collect(requests('new'));
  assert.equal(edited.find(row => row.path === 'new/nested').hash, before.find(row => row.path === 'new/nested').hash);
  assert.notEqual(edited.find(row => row.path.endsWith('file.txt')).hash, before.find(row => row.path.endsWith('file.txt')).hash);
  await rename(path.join(root, 'new/nested/file.txt'), path.join(root, 'new/nested/renamed.txt'));
  const renamed = await collector(root).collect(requests('new'));
  assert.notEqual(renamed.find(row => row.path === 'new/nested').hash, edited.find(row => row.path === 'new/nested').hash);
  await rm(path.join(root, 'new/nested/renamed.txt')); await mkdir(path.join(root, 'new/nested/renamed.txt'));
  const kind = await collector(root).collect(requests('new'));
  assert.notEqual(kind.find(row => row.path === 'new/nested').hash, renamed.find(row => row.path === 'new/nested').hash);
});

test('capture: regular files stream through 1 MiB reads and retain historical mode-plus-bytes SHA256', async () => {
  const root = await directory('stream'), bytes = Buffer.alloc(3 * 1024 * 1024 + 117, 0x6a), reads = [];
  await writeFile(path.join(root, 'large.bin'), bytes);
  const wrappedOpen = async (...args) => { const handle = await open(...args); return { stat: () => handle.stat(), close: () => handle.close(), read: (...args) => { reads.push(args[2]); return handle.read(...args); } }; };
  const rows = await collector(root, {}, { open: wrappedOpen }).collect(requests('large.bin'));
  const mode = (await lstat(path.join(root, 'large.bin'))).mode & 0o111 ? '100755' : '100644';
  assert.equal(rows[0].hash, createHash('sha256').update(mode + '\0').update(bytes).digest('hex'));
  assert.ok(reads.length >= 5); assert.ok(reads.every(size => size === 1024 * 1024));
});

test('capture: cumulative limits fail closed and cached seals detect later changes', async () => {
  const root = await directory('limits'); await mkdir(path.join(root, 'one/two'), { recursive: true }); await writeFile(path.join(root, 'one/two/file'), 'payload');
  for (const [override, message] of [[{ entries: 2 }, /entry limit/], [{ manifestBytes: 4 }, /manifest limit/], [{ depth: 2 }, /depth limit/], [{ elapsedMs: -1 }, /elapsed limit/], [{ fileBytes: 6 }, /file-byte limit/]]) {
    await assert.rejects(collector(root, override).collect(requests('one')), message);
  }
  const cached = collector(root); await cached.collect(requests('one')); await writeFile(path.join(root, 'one/two/file'), 'changed!');
  await assert.rejects(cached.collect([]), /captured identity changed|ancestor changed/);
  const membership = collector(root); await membership.collect(requests('one')); await writeFile(path.join(root, 'one/added'), 'new');
  await assert.rejects(membership.collect([]), /changed/);
});

test('capture: overlapping requests deduplicate and conflicting statuses or traversal fail closed', async () => {
  const root = await directory('overlap'); await mkdir(path.join(root, 'one')); await writeFile(path.join(root, 'one/file'), 'same');
  const rows = await collector(root).collect([...requests('one'), ...requests('one/file'), ...requests('one')]); assert.equal(rows.length, 2);
  await assert.rejects(collector(root).collect([...requests('one'), { path: 'one/file', status: 'D ' }]), /conflicting overlapping/);
  for (const relative of ['../escape', '/absolute', 'one/../file', 'one//file', 'one\0file', '\ud800']) await assert.rejects(collector(root).collect(requests(relative)), /invalid repository/);
  assert.equal((await collector(root).collect(requests('missing/parent/file')))[0].hash, 'deleted');
  await writeFile(path.join(root, 'blocker'), 'file'); assert.equal((await collector(root).collect(requests('blocker/child')))[0].hash, 'deleted');
});

test('capture: symlinks retain link-byte hashes and obstruct descendants without following targets', async t => {
  const root = await directory('symlink'), external = await directory('external'); await writeFile(path.join(external, 'secret'), 'external');
  try { await symlink(external, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Host disallows symlink creation'); return; } throw error; }
  const rows = await collector(root).collect(requests('link'));
  assert.equal(rows.length, 1); assert.equal(rows[0].hash, createHash('sha256').update('120000\0').update(await readlink(path.join(root, 'link'), { encoding: 'buffer' })).digest('hex'));
  assert.equal((await collector(root).collect(requests('link/secret')))[0].hash, 'deleted');
});

test('capture: POSIX directory descendants preserve literal backslash filenames', { skip: process.platform === 'win32' }, async () => {
  const root = await directory('backslash'); await mkdir(path.join(root, 'one')); await writeFile(path.join(root, 'one/a\\b'), 'supported');
  assert.ok((await collector(root).collect(requests('one'))).some(row => row.path === 'one/a\\b'));
});

test('sync: preview is deterministic and leaves every file and directory untouched even with a stale lock', async () => {
  const root = await fixture('preview'); await rm(path.join(root, '.harness/hooks'), { recursive: true });
  await mkdir(path.join(root, '.harness/state.lock')); await writeFile(path.join(root, '.harness/state.lock/owner.json'), '{"pid":9999999}');
  const before = await tree(root), first = await syncHarness(root, { preview: true }), second = await planSync(root);
  assert.equal(first.planHash, second.planHash); assert.deepEqual(await tree(root), before);
  assert.ok(first.operations.some(item => item.action === 'write' && item.path.includes('/hooks/')));
  const cli = await exec(process.execPath, [path.join(repository, 'bin/agent-harness.mjs'), 'sync', root, '--preview', '--json'], { cwd: root, windowsHide: true });
  assert.equal(JSON.parse(cli.stdout).planHash, first.planHash); assert.deepEqual(await tree(root), before);
});

test('sync: mixed custom executables block all writes and never get adopted into metadata', async () => {
  const root = await fixture('custom'), inventoryPath = path.join(root, '.harness/managed-files.json');
  const prior = await readFile(inventoryPath); await writeFile(path.join(root, '.harness/run.mjs'), '// local capture changes\n'); await writeFile(path.join(root, '.harness/hooks/precompact-handoff.mjs'), '// local hook changes\n');
  await rm(path.join(root, '.harness/quality.md')); const before = await tree(root);
  const preview = await planSync(root); assert.equal(preview.blocked, true); assert.equal(preview.blockers.length, 2);
  await assert.rejects(syncHarness(root), /Sync blocked/); assert.deepEqual(await tree(root), before); assert.deepEqual(await readFile(inventoryPath), prior);
  const replacement = { '.harness/run.mjs': hash(await readFile(path.join(root, '.harness/run.mjs'))) };
  await assert.rejects(syncHarness(root, { replacements: replacement }), /Sync blocked/); assert.deepEqual(await tree(root), before);
  replacement['.harness/hooks/precompact-handoff.mjs'] = hash(await readFile(path.join(root, '.harness/hooks/precompact-handoff.mjs')));
  const reviewed = await planSync(root, { replacements: replacement }); assert.equal(reviewed.blocked, false);
  await syncHarness(root, { replacements: replacement, expectedPlanHash: reviewed.planHash });
  assert.deepEqual(await readFile(path.join(root, '.harness/run.mjs')), await readFile(path.join(repository, 'skill/codex-harness/assets/project-runtime.mjs')));
  assert.equal((await planSync(root)).blocked, false);
});

test('sync: stale hashes and stale read sets reject before any durable write', async () => {
  const root = await fixture('stale'); const runtime = path.join(root, '.harness/run.mjs'); await writeFile(runtime, '// local\n');
  const replacements = { '.harness/run.mjs': hash(await readFile(runtime)) }, preview = await planSync(root, { replacements });
  await writeFile(runtime, '// local changed\n'); let before = await tree(root);
  await assert.rejects(syncHarness(root, { replacements }), /Stale reviewed replacement/); assert.deepEqual(await tree(root), before);
  replacements['.harness/run.mjs'] = hash(await readFile(runtime));
  await assert.rejects(syncHarness(root, { replacements, expectedPlanHash: preview.planHash }), /Stale expected sync plan/); assert.deepEqual(await tree(root), before);
  const fresh = await planSync(root, { replacements });
  const configPath = path.join(root, '.harness/config.json'), config = await json(configPath); config.project.purpose = 'Changed after review'; await save(configPath, config); before = await tree(root);
  await assert.rejects(syncHarness(root, { replacements, expectedPlanHash: fresh.planHash }), /Stale expected sync plan/); assert.deepEqual(await tree(root), before);
  for (const relative of ['.harness/evidence/record.json', '.harness/baselines/blob.json', '../outside', '.codex/hooks.json']) {
    await assert.rejects(syncHarness(root, { replacements: { [relative]: 'a'.repeat(64) } }), /not an enabled runtime\/hook/);
  }
});

test('sync: reviewed replacement CLI accepts inline equals and repeated paths', async () => {
  const root = await fixture('inline'); const relative = '.harness/run.mjs'; await writeFile(path.join(root, relative), '// customized\n');
  const expected = hash(await readFile(path.join(root, relative)));
  assert.deepEqual(parseArgs(['--replace-reviewed=' + relative + '=' + expected, '--replace-reviewed', '.harness/hooks/precompact-handoff.mjs=' + 'b'.repeat(64)]).replaceReviewed, [relative + '=' + expected, '.harness/hooks/precompact-handoff.mjs=' + 'b'.repeat(64)]);
  const args = [path.join(repository, 'bin/agent-harness.mjs'), 'sync', root, '--preview', '--json', '--replace-reviewed=' + relative + '=' + expected];
  const before = await tree(root), preview = JSON.parse((await exec(process.execPath, args, { cwd: root, windowsHide: true })).stdout);
  assert.equal(preview.blocked, false); assert.deepEqual(await tree(root), before);
});

test('sync: postplanning target and source drift fail under the state lock before any managed write', async () => {
  for (const sourceDrift of [false, true]) {
    // An isolated module inserts one adversarial write at the actual apply
    // boundary. Production planning, locking and revalidation are unchanged.
    const injection = sourceDrift
      ? "await writeFile(path.join(ASSET_DIR, 'project-runtime.mjs'), '// changed source after planning\\n');"
      : "await writeFile(path.join(plan.target, '.harness/config.json'), '{\\\"changedAfterPlanning\\\":true}\\n');";
    const kit = await isolatedKit('revalidation', value => value.replace('    await validateSyncPlan(plan);', '    ' + injection + '\n    await validateSyncPlan(plan);'));
    const root = path.join(kit.root, 'project'); await mkdir(root); await writeFile(path.join(root, 'package.json'), '{"name":"revalidation"}'); await kit.api.initHarness(root, { name: 'revalidation' });
    await rm(path.join(root, '.harness/quality.md')); const before = await tree(root);
    await assert.rejects(kit.api.syncHarness(root), /Stale sync plan input/);
    const after = await tree(root), retained = rows => rows.filter(([relative]) => sourceDrift || relative !== '.harness/config.json');
    assert.deepEqual(retained(after), retained(before)); assert.ok(!after.some(([relative]) => relative.includes('state.lock')));
  }
});

test('sync: exact bundled predecessors upgrade without an inventory while unknown siblings block the mixed plan', async () => {
  const kit = await isolatedKit('bundled'), root = path.join(kit.root, 'project'); await mkdir(root); await writeFile(path.join(root, 'package.json'), '{"name":"bundled"}'); await kit.api.initHarness(root, { name: 'bundled' });
  const source = path.join(kit.skill, 'assets/project-runtime.mjs'), old = await readFile(source);
  const identitiesPath = path.join(kit.skill, 'assets/migrations/runtime-v6/executable-identities.json'), identities = await json(identitiesPath);
  identities.files['project-runtime.mjs'] = [hash(old)]; await save(identitiesPath, identities); await writeFile(source, Buffer.concat([old, Buffer.from('\n// synthetic canonical successor\n')]));
  await rm(path.join(root, '.harness/managed-files.json'));
  const plan = await kit.api.planSync(root); assert.equal(plan.blocked, false); assert.equal(plan.result.status, 'written');
  await writeFile(path.join(root, '.harness/hooks/precompact-handoff.mjs'), '// unknown sibling\n'); const before = await tree(root);
  await assert.rejects(kit.api.syncHarness(root), /Sync blocked/); assert.deepEqual(await tree(root), before);
  const replacements = { '.harness/hooks/precompact-handoff.mjs': hash(await readFile(path.join(root, '.harness/hooks/precompact-handoff.mjs'))) };
  await kit.api.syncHarness(root, { replacements }); assert.deepEqual(await readFile(path.join(root, '.harness/run.mjs')), await readFile(source));
});

test('sync: migration preserves additional frozen scope metadata and contract fields', async () => {
  const root = await fixture('scope-metadata'), statePath = path.join(root, '.harness/features.json'), state = await json(statePath);
  const feature = { id: 'frozen', title: 'Frozen', description: 'Preserved', dependencies: [], status: 'blocked', requiredLayers: ['full'], scope: { allow: ['src/**'], deny: [], projectTag: { historical: 'retain' } }, acceptance: [], evidence: [], blocker: 'Historical', attempts: 0, repeatedFailures: 0, lastFailureFingerprint: null, contract: { version: 2, scopeBaselineHash: 'unchanged', hash: 'unchanged' } };
  state.features.push(feature); await save(statePath, state); await syncHarness(root);
  assert.deepEqual((await json(statePath)).features[0], feature);
});

test('sync: known managed predecessors upgrade while history, review notes and parked transfer IDs remain byte-preserved', async () => {
  const root = await fixture('history'), runtime = path.join(root, '.harness/run.mjs'), inventoryPath = path.join(root, '.harness/managed-files.json');
  await writeFile(runtime, '// managed predecessor fixture\n'); const inventory = await json(inventoryPath); inventory.files['.harness/run.mjs'] = hash(await readFile(runtime)); await save(inventoryPath, inventory);
  const continuity = await json(path.join(root, '.harness/continuity.json')); continuity.phase = 'awaiting_resume'; continuity.handoff = { id: 'retain-this-transfer' }; await save(path.join(root, '.harness/continuity.json'), continuity);
  await mkdir(path.join(root, '.harness/baselines')); await writeFile(path.join(root, '.harness/baselines/legacy.json'), '{"historical":"sealed"}\n'); await writeFile(path.join(root, '.harness/evidence/legacy.json'), '{"historical":"pass"}\n');
  await writeFile(path.join(root, '.harness/loops/goal.md'), 'custom goal\n'); await syncHarness(root);
  await writeFile(path.join(root, '.harness/loops/goal.v6.addition.md'), 'custom review notes\n');
  const retained = await Promise.all(['config.json', 'features.json', 'continuity.json', 'baselines/legacy.json', 'evidence/legacy.json', 'loops/goal.v6.addition.md'].map(name => readFile(path.join(root, '.harness', name))));
  await syncHarness(root);
  assert.deepEqual(await Promise.all(['config.json', 'features.json', 'continuity.json', 'baselines/legacy.json', 'evidence/legacy.json', 'loops/goal.v6.addition.md'].map(name => readFile(path.join(root, '.harness', name)))), retained);
  assert.equal((await json(path.join(root, '.harness/continuity.json'))).handoff.id, 'retain-this-transfer');
});

test('sync: disabled adapters and their customized executable copies stay untouched', async () => {
  const root = await fixture('disabled', 'github-copilot');
  assert.ok(!(await tree(root)).some(([name]) => name.startsWith('.harness/hooks/') || name === 'CLAUDE.md' || name.startsWith('.codex/')));
  await mkdir(path.join(root, '.harness/hooks'), { recursive: true }); await writeFile(path.join(root, '.harness/hooks/precompact-handoff.mjs'), '// intentionally disabled custom adapter\n');
  await writeFile(path.join(root, 'CLAUDE.md'), 'product prompt\n'); const before = await tree(root);
  await syncHarness(root); assert.deepEqual(await tree(root), before);
  assert.deepEqual((await json(path.join(root, '.harness/config.json'))).agents.enabled, ['github-copilot']);
});

test('redaction: actual capture handles delayed opaque values after 12000/24000/60000 whitespace within deadline', async () => {
  const root = await fixture('linear-redaction');
  await exec('git', ['init'], { cwd: root, windowsHide: true });
  const env = { ...process.env, CODEX_THREAD_ID: 'capture-performance-worker' };
  const run = (...args) => exec(process.execPath, [path.join(root, '.harness/run.mjs'), ...args], { cwd: root, env, windowsHide: true, maxBuffer: 1024 * 1024 });
  await run('claim');
  for (const spaces of [12000, 24000, 60000]) {
    await writeFile(path.join(root, 'output.cjs'), `process.stdout.write('password '+ ' '.repeat(${spaces})); process.stderr.write('authorization: bearer '+ ' '.repeat(${spaces})); setTimeout(()=>{process.stdout.write('OPAQUE-CAPTURE-PASSWORD\\n');process.stderr.write('OPAQUE-CAPTURE-BEARER\\n');},30);`);
    const config = await json(path.join(root, '.harness/config.json')); config.verification.full = ['node output.cjs']; config.policies.commandTimeoutMs = 1000; await save(path.join(root, '.harness/config.json'), config);
    const began = Date.now(), result = await run('check', 'full');
    assert.doesNotMatch(result.stdout, /OPAQUE-CAPTURE-PASSWORD|OPAQUE-CAPTURE-BEARER/); assert.match(result.stdout, /REDACTED/); assert.doesNotMatch(result.stdout, /timeout/);
    assert.ok(Date.now() - began < 1800, 'capture must remain inside the command deadline with process startup allowance');
  }
});

test.after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });
