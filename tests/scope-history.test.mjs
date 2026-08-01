import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { initHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const execFileAsync = promisify(execFile);
const temporary = [];
const pass = 'node -e "process.exit(0)"';

async function project(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `agent-harness-scope-history-${name}-`));
  temporary.push(root);
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name,
    scripts: { test: pass }
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'README.md'), `# ${name}\n`);
  await initHarness(root, { name, purpose: `${name} exercises committed scope history.` });
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.verification.quick = [];
  config.verification.full = [pass];
  config.verification.architecture = [];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await execFileAsync('git', ['init'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['config', 'user.email', 'harness@example.test'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['config', 'user.name', 'Harness Test'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['add', '.'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'initial project'], { cwd: root, windowsHide: true });
  return root;
}

async function runtime(root, ...args) {
  return execFileAsync(process.execPath, [path.join(root, '.harness', 'run.mjs'), ...args], {
    cwd: root,
    windowsHide: true
  });
}

async function addAndStart(root, allow = 'src/**') {
  await runtime(root, 'add', 'feat-001',
    '--title', 'Committed scope',
    '--description', 'Committed changes remain inside declared scope.',
    '--criterion', 'The no-op check passes.',
    '--command', pass,
    '--allow', allow);
  await runtime(root, 'start', 'feat-001');
}

async function commit(root, paths, message) {
  await execFileAsync('git', ['add', ...paths], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', message], { cwd: root, windowsHide: true });
}

async function latestEvidence(root) {
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const feature = state.features.find((candidate) => candidate.id === 'feat-001');
  const evidence = JSON.parse(await readFile(path.join(root, feature.evidence.at(-1)), 'utf8'));
  return { feature, evidence };
}

test.after(async () => {
  for (const root of temporary) await rm(root, { recursive: true, force: true });
});

test('rejects an out-of-scope change committed after feature start', async () => {
  const root = await project('reject-outside');
  await addAndStart(root);
  await writeFile(path.join(root, 'README.md'), '# committed outside scope\n');
  await commit(root, ['README.md'], 'commit forbidden file');

  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));
  const { feature, evidence } = await latestEvidence(root);
  assert.equal(feature.status, 'active');
  assert.deepEqual(evidence.scopeViolations, ['README.md']);
  assert.ok(evidence.changedFiles.includes('README.md'));
});

test('accepts and reports an in-scope committed change', async () => {
  const root = await project('accept-inside');
  await addAndStart(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'allowed.mjs'), 'export const allowed = true;\n');
  await commit(root, ['src/allowed.mjs'], 'commit allowed file');

  assert.match((await runtime(root, 'verify', 'feat-001')).stdout, /PASSING feat-001/);
  const { evidence } = await latestEvidence(root);
  assert.deepEqual(evidence.scopeViolations, []);
  assert.ok(evidence.changedFiles.includes('src/allowed.mjs'));
});

test('checks both sides of a committed rename', async () => {
  const root = await project('rename-both-sides');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'original.mjs'), 'export const value = 1;\n');
  await commit(root, ['src/original.mjs'], 'add tracked source');
  await addAndStart(root, 'docs/**');
  await mkdir(path.join(root, 'docs'));
  await rename(path.join(root, 'src', 'original.mjs'), path.join(root, 'docs', 'moved.mjs'));
  await execFileAsync('git', ['add', '-A'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'commit rename'], { cwd: root, windowsHide: true });

  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));
  const { evidence } = await latestEvidence(root);
  assert.deepEqual(evidence.scopeViolations, ['src/original.mjs']);
  assert.ok(evidence.changedFiles.includes('docs/moved.mjs'));
  assert.ok(evidence.changedFiles.includes('src/original.mjs'));
});

test('does not attribute pre-existing dirty content merely because it was committed', async () => {
  const root = await project('dirty-baseline');
  await writeFile(path.join(root, 'README.md'), '# pre-existing user work\n');
  await addAndStart(root);
  await commit(root, ['README.md'], 'preserve pre-existing user work');

  assert.match((await runtime(root, 'verify', 'feat-001')).stdout, /PASSING feat-001/);
  const { evidence } = await latestEvidence(root);
  assert.ok(!evidence.changedFiles.includes('README.md'));
});

test('fails closed when the current HEAD is unrelated to the start HEAD', async () => {
  const root = await project('unrelated-head');
  await addAndStart(root);
  const unrelated = (await execFileAsync('git', ['commit-tree', 'HEAD^{tree}', '-m', 'unrelated root'], {
    cwd: root,
    windowsHide: true
  })).stdout.trim();
  await execFileAsync('git', ['reset', '--soft', unrelated], { cwd: root, windowsHide: true });

  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));
  const { evidence } = await latestEvidence(root);
  assert.ok(evidence.scopeViolations.some((item) => item.startsWith('[scope-history-unavailable]')));
});
