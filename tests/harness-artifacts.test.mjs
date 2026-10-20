import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, open, opendir, readFile, readlink, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const exec = promisify(execFile), roots = [];
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(repository, 'skill/codex-harness/assets/project-runtime.mjs'), 'utf8');
const collectorSource = source.slice(source.indexOf('function repositoryCapturePath('), source.indexOf('\nfunction isPathInside(', source.indexOf('function repositoryCapturePath(')));
const allowedExtensions = new Function(source.match(/const ARTIFACT_METADATA_EXTENSIONS = [^\n]+/)[0] + ';return ARTIFACT_METADATA_EXTENSIONS;')();
const limits = { entries: 32768, manifestBytes: 16777216, depth: 64, elapsedMs: 300000, fileBytes: 17179869184 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const policy = { version: 1, metadataRoots: ['generated'], metadataExtensions: ['.png'] };
async function directory() { const root = await mkdtemp(path.join(os.tmpdir(), 'harness-artifacts-')); roots.push(root); return root; }
function api(root, io = {}) {
  return new Function('deps', `const {lstat,open,opendir,readlink,createHash,path,ROOT,REPOSITORY_CAPTURE_LIMITS,ARTIFACT_METADATA_EXTENSIONS}=deps;\n${collectorSource}\nreturn {capturePolicy,collector:(policy,integrity=false)=>repositoryCaptureCollector(REPOSITORY_CAPTURE_LIMITS,policy,integrity)};`)({ lstat, open, opendir, readlink, createHash, path, ROOT: root, REPOSITORY_CAPTURE_LIMITS: limits, ARTIFACT_METADATA_EXTENSIONS: allowedExtensions, ...io });
}
const requests = relative => [{ path: relative, status: '??' }];
async function fixture() {
  const root = await directory();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'artifacts', scripts: { test: 'node --version' } }));
  await initHarness(root, { name: 'artifacts', purpose: 'Deliberate artifact capture with full source scope' });
  await mkdir(path.join(root, 'src')); await writeFile(path.join(root, 'src/main.mjs'), '// original\n');
  await mkdir(path.join(root, 'generated')); await writeFile(path.join(root, 'generated/image.png'), 'original pixels');
  const config = await json(path.join(root, '.harness/config.json'));
  config.verification = { quick: [], full: ['node --version'], architecture: [], e2e: [], clean: [] };
  config.scope.capture = policy; await save(path.join(root, '.harness/config.json'), config);
  for (const args of [['init'], ['config', 'user.name', 'Harness Test'], ['config', 'user.email', 'harness@example.test'], ['add', '.'], ['commit', '-m', 'fixture']]) await exec('git', args, { cwd: root, windowsHide: true });
  // The dirty output's original digest must be sealed at start.
  await writeFile(path.join(root, 'generated/image.png'), 'baseline pixels');
  await run(root, 'claim');
  return root;
}
function run(root, ...args) {
  return exec(process.execPath, [path.join(root, '.harness/run.mjs'), ...args], { cwd: root, env: { ...process.env, CODEX_THREAD_ID: 'artifacts-fixture-worker' }, windowsHide: true, maxBuffer: 1024 * 1024 });
}
async function start(root, allow = 'src/**', command = 'node --version') {
  await run(root, 'add', 'artifact-feature', '--title', 'Artifact capture', '--description', 'Preserve scope and integrity', '--criterion', 'Commands succeed', '--command', command, '--allow', allow);
  await run(root, 'start', 'artifact-feature');
  const feature = (await json(path.join(root, '.harness/features.json'))).features[0];
  return { feature, baseline: await json(path.join(root, feature.scopeBaselineRef.path)) };
}

test('artifact capture: opt-in output metadata avoids reads while code and manifests retain byte hashes', async () => {
  const root = await directory(); await mkdir(path.join(root, 'generated'));
  for (const name of ['image.PNG', 'module.mjs', 'source.luau', 'script.ps1', 'contract.json', 'unknown.bin']) await writeFile(path.join(root, 'generated', name), 'original bytes');
  const opened = [], capture = api(root, { open: async (file, ...args) => { opened.push(path.basename(file)); return open(file, ...args); } });
  const rows = await capture.collector(policy).collect(requests('generated'));
  assert.match(rows.find(row => row.path.endsWith('image.PNG')).hash, /^metadata-v1:/);
  assert.ok(!opened.includes('image.PNG'));
  for (const name of ['module.mjs', 'source.luau', 'script.ps1', 'contract.json', 'unknown.bin']) {
    assert.ok(opened.includes(name)); assert.match(rows.find(row => row.path.endsWith(name)).hash, /^[a-f0-9]{64}$/);
  }
  const sealed = await capture.collector(policy, true).collect(requests('generated/image.PNG'));
  const strict = await capture.collector(null).collect(requests('generated/image.PNG'));
  assert.equal(sealed[0].contentHash, strict[0].hash); assert.equal(sealed[0].hash, rows.find(row => row.path.endsWith('image.PNG')).hash);
});

test('artifact policy: canonical exact roots and approved extensions fail closed', async () => {
  const capture = api(await directory());
  for (const root of ['.', '../outside', '/absolute', 'generated/', 'generated/**', '.harness/evidence', '.github/output', 'src/generated', 'scripts/output', 'tests/output', 'packages/output']) {
    assert.throws(() => capture.capturePolicy({ ...policy, metadataRoots: [root] }), /invalid|canonical|protected/);
  }
  for (const extension of ['.json', '.mjs', '.luau', '.ps1', '.py', '.yaml', '.txt', '.html', '.blend', '*', '.PNG']) assert.throws(() => capture.capturePolicy({ ...policy, metadataExtensions: [extension] }), /approved generated output/);
  assert.deepEqual(capture.capturePolicy(), { version: 1, metadataRoots: [], metadataExtensions: [] });
  assert.throws(() => capture.capturePolicy({ ...policy, unknown: true }), /scope.capture/);
});

test('artifact capture: metadata changes, directory membership, file types and ancestor seals remain visible', async t => {
  const root = await directory(); await mkdir(path.join(root, 'generated')); const file = path.join(root, 'generated/image.png'); await writeFile(file, 'before');
  const capture = api(root), cached = capture.collector(policy), before = await cached.collect(requests('generated'));
  const info = await lstat(file); await writeFile(file, 'after!'); await utimes(file, info.atime, info.mtime);
  await assert.rejects(cached.collect([]), /changed/);
  assert.notEqual((await capture.collector(policy).collect(requests('generated/image.png')))[0].hash, before.find(row => row.path.endsWith('image.png')).hash);
  const identical = (await capture.collector(policy).collect(requests('generated/image.png')))[0];
  await utimes(file, new Date(info.atimeMs + 20000), new Date(info.mtimeMs + 20000));
  assert.notEqual((await capture.collector(policy).collect(requests('generated/image.png')))[0].hash, identical.hash, 'metadata policy deliberately counts unchanged-byte touches as changes');
  await rename(file, file + '.old'); await mkdir(file);
  const changed = await capture.collector(policy).collect(requests('generated'));
  assert.equal(changed.find(row => row.path.endsWith('image.png')).type, 'directory'); assert.notEqual(changed[0].hash, before[0].hash);
  const external = await directory(); await writeFile(path.join(external, 'image.png'), 'external pixels');
  const link = path.join(root, 'generated/link');
  try { await symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('Host disallows symlink creation'); return; } throw error; }
  const links = await capture.collector(policy).collect(requests('generated/link'));
  assert.equal(links.length, 1); assert.equal(links[0].hash, hash(Buffer.concat([Buffer.from('120000\0'), await readlink(link, { encoding: 'buffer' })])));
  assert.equal((await capture.collector(policy).collect(requests('generated/link/image.png')))[0].hash, 'deleted');
});

test('artifact scope: baseline seals original bytes, frozen policy survives config edits, outside source still blocks', async () => {
  const root = await fixture(), { baseline } = await start(root, '.harness/config.json');
  const image = baseline.files.find(row => row.path === 'generated/image.png');
  assert.equal(image.contentHash, (await api(root).collector(null).collect(requests('generated/image.png')))[0].hash);
  const configPath = path.join(root, '.harness/config.json'), config = await json(configPath); config.scope.capture = { version: 1, metadataRoots: [], metadataExtensions: [] }; await save(configPath, config);
  const result = await run(root, 'verify', 'artifact-feature'); assert.match(result.stdout, /PASSING/);
  const feature = (await json(path.join(root, '.harness/features.json'))).features[0], evidence = await json(path.join(root, feature.evidence.at(-1)));
  assert.equal(evidence.repository.before.captureMode, 'artifact-metadata-v1'); assert.deepEqual(evidence.repository.before.capturePolicy, policy);
  const other = await fixture(); await start(other, 'generated/**'); await writeFile(path.join(other, 'src/main.mjs'), '// tampered\n');
  await assert.rejects(run(other, 'verify', 'artifact-feature'), error => /src\/main.mjs/.test(error.stdout));
});

test('artifact scope: output changes outside scope and changes during acceptance are detected', async () => {
  const root = await fixture(); await start(root); await writeFile(path.join(root, 'generated/image.png'), 'new pixels');
  await assert.rejects(run(root, 'verify', 'artifact-feature'), error => /generated\/image.png/.test(error.stdout));
  const after = await fixture();
  await writeFile(path.join(after, 'mutate.cjs'), "require('node:fs').writeFileSync('generated/image.png', 'acceptance changed it');");
  await start(after, 'src/**', 'node mutate.cjs');
  await assert.rejects(run(after, 'verify', 'artifact-feature'), error => /post-verification scope check/.test(error.stdout));
});

test('artifact integrity: structural doctor avoids dirty bytes, explicit integrity sees bytes and historical corruption', async () => {
  const root = await fixture(); const { feature } = await start(root, 'generated/**');
  const initial = await run(root, 'doctor', '--integrity'); const first = initial.stdout.match(/INTEGRITY content-v1 ([a-f0-9]+)/)[1];
  const file = path.join(root, 'generated/image.png'), info = await lstat(file); await writeFile(file, 'changed! pixels'); await utimes(file, info.atime, info.mtime);
  const later = await run(root, 'doctor', '--integrity'); assert.notEqual(later.stdout.match(/INTEGRITY content-v1 ([a-f0-9]+)/)[1], first);
  // A tight capture budget makes any accidental ordinary doctor byte scan fail.
  const runtime = path.join(root, '.harness/run.mjs'); await writeFile(runtime, (await readFile(runtime, 'utf8')).replace('fileBytes: 16 * 1024 * 1024 * 1024', 'fileBytes: 1'));
  assert.match((await run(root, 'doctor')).stdout, /Structural state is healthy/);
  await assert.rejects(run(root, 'doctor', '--integrity'), error => /file-byte limit/.test(error.stdout));
  await assert.rejects(run(root, 'doctor', '--integrity=true'), error => /file-byte limit/.test(error.stdout));
  await assert.rejects(run(root, 'doctor', '--integrity', 'true'), error => /file-byte limit/.test(error.stdout));
  await assert.rejects(run(root, 'doctor', '--integrity=false'), error => /cannot fall back/.test(error.stderr));
  await writeFile(path.join(root, feature.scopeBaselineRef.path), '{}\n');
  await assert.rejects(run(root, 'doctor'), error => /baseline.*(?:hash|digest|integrity)|(?:hash|digest|integrity).*baseline/i.test(error.stdout));
});

test('artifact continuity: routine checkpoints are labelled and full transfer digests still reject content drift', async () => {
  const root = await fixture(); await start(root, 'generated/**');
  await run(root, 'checkpoint', '--summary', 'Routine checkpoint', '--next', 'Continue');
  let continuity = await json(path.join(root, '.harness/continuity.json'));
  assert.equal(continuity.checkpoint.repository.captureMode, 'artifact-metadata-v1');
  assert.ok(continuity.checkpoint.repository.changedFiles.some(row => row.fingerprint === 'metadata-v1'));
  await run(root, 'handoff', '--summary', 'Transfer', '--next', 'Inspect');
  continuity = await json(path.join(root, '.harness/continuity.json')); assert.equal(continuity.handoff.repository.captureMode, 'content-v1');
  await writeFile(path.join(root, 'generated/image.png'), 'changed bytes');
  await assert.rejects(exec(process.execPath, [path.join(root, '.harness/run.mjs'), 'resume', continuity.handoff.id], { cwd: root, env: { ...process.env, CODEX_THREAD_ID: 'fresh-artifacts-worker' }, windowsHide: true }), error => /worktree changed/.test(error.stderr));
});

test.after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });
