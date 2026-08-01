import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { initHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const execFileAsync = promisify(execFile);
const temporary = [];
const node = `"${process.execPath}"`;
const pass = `${node} -e "process.exit(0)"`;
const canary = 'ambient-canary-value-1234';

async function project(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `agent-harness-environment-${name}-`));
  temporary.push(root);
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name,
    scripts: { test: pass }
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'README.md'), `# ${name}\n`);
  await writeFile(path.join(root, 'probe.mjs'), `
import { writeFileSync } from 'node:fs';
writeFileSync('spawned.json', JSON.stringify({
  ambient: process.env.HARNESS_AMBIENT_CANARY ?? null,
  providerPresent: Boolean(process.env.OPENAI_API_KEY)
}));
`);
  await initHarness(root, { name, purpose: `${name} exercises the command environment boundary.` });
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

async function setEnvironmentPolicy(root, value, { remove = false } = {}) {
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (remove) delete config.security.environmentAllow;
  else config.security.environmentAllow = value;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function runtime(root, environment, ...args) {
  return execFileAsync(process.execPath, [path.join(root, '.harness', 'run.mjs'), ...args], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ...environment }
  });
}

async function addAndStart(root, { credential = false } = {}) {
  const args = [
    'add', 'feat-001',
    '--title', 'Environment boundary',
    '--description', 'Configured commands receive only declared environment values.',
    '--criterion', 'The probe executes within policy.',
    '--command', `${node} probe.mjs`,
    '--allow', 'spawned.json'
  ];
  if (credential) args.push('--credential', 'openai');
  await runtime(root, {}, ...args);
  await runtime(root, {}, 'start', 'feat-001');
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

test.after(async () => {
  for (const root of temporary) await rm(root, { recursive: true, force: true });
});

for (const variant of [
  { name: 'missing', value: undefined, remove: true },
  { name: 'null', value: null, remove: false },
  { name: 'wrong-type', value: 'PATH', remove: false }
]) {
  test(`rejects a ${variant.name} environment allowlist before spawning`, async () => {
    const root = await project(`invalid-${variant.name}`);
    await setEnvironmentPolicy(root, variant.value, { remove: variant.remove });
    await addAndStart(root);

    await assert.rejects(
      () => runtime(root, { HARNESS_AMBIENT_CANARY: canary }, 'verify', 'feat-001'),
      /security\.environmentAllow must be an array/
    );
    assert.equal(await exists(path.join(root, 'spawned.json')), false);
    const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
    assert.equal(state.features[0].status, 'active');
    assert.equal(state.features[0].attempts, 0);
    assert.deepEqual(state.features[0].evidence, []);
  });
}

test('an explicit empty allowlist supplies no ambient variables and preserves internal Git probes', async () => {
  const root = await project('explicit-empty');
  await setEnvironmentPolicy(root, []);
  await addAndStart(root);

  assert.match((await runtime(root, { HARNESS_AMBIENT_CANARY: canary }, 'verify', 'feat-001')).stdout, /PASSING feat-001/);
  const result = JSON.parse(await readFile(path.join(root, 'spawned.json'), 'utf8'));
  assert.equal(result.ambient, null);
  assert.equal(result.providerPresent, false);
});

test('an explicitly requested provider credential is injected through an empty ambient allowlist', async () => {
  const root = await project('explicit-provider');
  await setEnvironmentPolicy(root, []);
  await addAndStart(root, { credential: true });

  assert.match((await runtime(root, { OPENAI_API_KEY: 'fixture-provider-value-1234' }, 'verify', 'feat-001')).stdout, /PASSING feat-001/);
  const result = JSON.parse(await readFile(path.join(root, 'spawned.json'), 'utf8'));
  assert.equal(result.ambient, null);
  assert.equal(result.providerPresent, true);
});
