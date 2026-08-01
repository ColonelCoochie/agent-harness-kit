import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { initHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const execFileAsync = promisify(execFile);
const temporary = [];
const pass = 'node -e "process.exit(0)"';

async function project(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `agent-harness-lock-${name}-`));
  temporary.push(root);
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name,
    scripts: { test: pass }
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'README.md'), `# ${name}\n`);
  await initHarness(root, { name, purpose: `${name} exercises mutation-lock ownership.` });
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.scope.enforcement = 'optional';
  config.verification.quick = [];
  config.verification.full = [pass];
  config.verification.architecture = [];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return root;
}

async function runtime(root, ...args) {
  return execFileAsync(process.execPath, [path.join(root, '.harness', 'run.mjs'), ...args], {
    cwd: root,
    windowsHide: true
  });
}

test.after(async () => {
  for (const root of temporary) await rm(root, { recursive: true, force: true });
});

test('does not evict a live lock owner solely because the lock is old', async () => {
  const root = await project('live-owner');
  const lockDir = path.join(root, '.harness', 'state.lock');
  await mkdir(lockDir);
  await writeFile(path.join(lockDir, 'owner.json'), `${JSON.stringify({
    pid: process.pid,
    command: ['test-live-owner'],
    acquiredAt: new Date(Date.now() - 600_000).toISOString()
  }, null, 2)}\n`);
  const old = new Date(Date.now() - 600_000);
  await utimes(lockDir, old, old);

  await assert.rejects(
    () => runtime(root, 'add', 'must-not-start', '--title', 'Must not start', '--description', 'A live lock owns the mutation boundary.', '--criterion', 'The no-op passes.', '--command', pass, '--allow', 'src/**'),
    (error) => /locked by another operation/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)
  );

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const owner = JSON.parse(await readFile(path.join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(state.features.length, 0);
  assert.equal(owner.pid, process.pid);
});

test('an owner releases only the lock instance that it acquired', async () => {
  const root = await project('ownership-token');
  await writeFile(path.join(root, 'replace-lock.mjs'), `
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
const lockDir = '.harness/state.lock';
rmSync(lockDir, { recursive: true, force: true });
mkdirSync(lockDir);
writeFileSync(\`${'${lockDir}'}/owner.json\`, JSON.stringify({ pid: process.pid, token: 'replacement' }, null, 2));
`);
  await runtime(root, 'add', 'feat-001', '--title', 'Replace lock', '--description', 'The command replaces the lock instance.', '--criterion', 'The replacement command runs.', '--command', 'node replace-lock.mjs', '--allow', 'replace-lock.mjs');
  await runtime(root, 'start', 'feat-001');
  await runtime(root, 'verify', 'feat-001');

  const owner = JSON.parse(await readFile(path.join(root, '.harness', 'state.lock', 'owner.json'), 'utf8'));
  assert.equal(owner.token, 'replacement');
});
