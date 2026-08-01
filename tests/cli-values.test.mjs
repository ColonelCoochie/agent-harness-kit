import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { initHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const execFileAsync = promisify(execFile);
const temporary = [];
const node = `"${process.execPath}"`;
const pass = `${node} -e "process.exit(0)"`;

async function project(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `agent-harness-cli-${name}-`));
  temporary.push(root);
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name,
    scripts: { test: pass }
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'README.md'), `# ${name}\n`);
  await initHarness(root, { name, purpose: `${name} exercises lossless CLI values.` });
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

async function state(root) {
  return JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
}

async function add(root, id, extra = []) {
  return runtime(root, 'add', id,
    '--title', `${id} values`,
    '--description', `${id} preserves opaque values.`,
    '--criterion', 'The no-op check passes.',
    '--command', pass,
    '--allow', 'src/**',
    ...extra);
}

test.after(async () => {
  for (const root of temporary) await rm(root, { recursive: true, force: true });
});

test('round-trips one comma-bearing criterion command allow and deny value', async () => {
  const root = await project('round-trip');
  const criterion = 'Reports alpha, beta exactly.';
  const command = `${node} -e "process.exit([1,2].length === 2 ? 0 : 1)"`;
  const allow = 'src/alpha,beta.mjs';
  const deny = 'src/no,entry.mjs';
  await runtime(root, 'add', 'feat-001',
    '--title', 'Comma safety',
    '--description', 'Opaque values remain one value.',
    '--criterion', criterion,
    '--command', command,
    '--allow', allow,
    '--deny', deny);

  const feature = (await state(root)).features[0];
  assert.equal(feature.acceptance.length, 1);
  assert.equal(feature.acceptance[0].description, criterion);
  assert.equal(feature.acceptance[0].command, command);
  assert.deepEqual(feature.scope.allow, [allow]);
  assert.deepEqual(feature.scope.deny, [deny]);
});

test('executes a comma-bearing script path as one acceptance command', async () => {
  const root = await project('execute-command');
  await writeFile(path.join(root, 'probe,comma.mjs'), `
import { writeFileSync } from 'node:fs';
writeFileSync('result,comma.txt', 'ok');
`);
  await runtime(root, 'add', 'feat-001',
    '--title', 'Comma command',
    '--description', 'A comma-bearing script path executes.',
    '--criterion', 'Creates result,comma output.',
    '--command', `${node} "probe,comma.mjs"`,
    '--allow', 'result,comma.txt');
  await runtime(root, 'start', 'feat-001');

  assert.match((await runtime(root, 'verify', 'feat-001')).stdout, /PASSING feat-001/);
  assert.equal(await readFile(path.join(root, 'result,comma.txt'), 'utf8'), 'ok');
});

test('preserves repeated criterion-command order and pairing', async () => {
  const root = await project('repeated-pairs');
  const criteria = ['First value, with comma.', 'Second value, with comma.'];
  const commands = ['first,command', 'second,command'];
  await runtime(root, 'add', 'feat-001',
    '--title', 'Repeated values',
    '--description', 'Repeated flags preserve pairing.',
    '--criterion', criteria[0],
    '--command', commands[0],
    '--criterion', criteria[1],
    '--command', commands[1],
    '--allow', 'src/**');

  const acceptance = (await state(root)).features[0].acceptance;
  assert.deepEqual(acceptance.map((item) => item.description), criteria);
  assert.deepEqual(acceptance.map((item) => item.command), commands);
});

test('preserves repeated comma-bearing allow patterns', async () => {
  const root = await project('allow-patterns');
  const patterns = ['src/alpha,beta.mjs', 'docs/one,two.md'];
  await runtime(root, 'add', 'feat-001',
    '--title', 'Allow values',
    '--description', 'Allow patterns are opaque.',
    '--criterion', 'The no-op check passes.',
    '--command', pass,
    '--allow', patterns[0],
    '--allow', patterns[1]);

  assert.deepEqual((await state(root)).features[0].scope.allow, patterns);
});

test('enforces a comma-bearing deny pattern as one path', async () => {
  const root = await project('deny-pattern');
  await runtime(root, 'add', 'feat-001',
    '--title', 'Deny value',
    '--description', 'A deny path containing a comma remains exact.',
    '--criterion', 'The no-op check passes.',
    '--command', pass,
    '--allow', '**/*',
    '--deny', 'forbidden,report.txt');
  await runtime(root, 'start', 'feat-001');
  await writeFile(path.join(root, 'forbidden,report.txt'), 'forbidden\n');

  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));
  const current = await state(root);
  const evidence = JSON.parse(await readFile(path.join(root, current.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, ['forbidden,report.txt']);
});

test('retains documented CSV dependency identifiers', async () => {
  const root = await project('dependency-csv');
  await add(root, 'base-a');
  await add(root, 'base-b');
  await add(root, 'dependent', ['--depends', 'base-a,base-b']);

  const feature = (await state(root)).features.find((candidate) => candidate.id === 'dependent');
  assert.deepEqual(feature.dependencies, ['base-a', 'base-b']);
});

test('retains documented CSV verification-level identifiers', async () => {
  const root = await project('level-csv');
  await add(root, 'feat-001', ['--level', 'e2e,architecture']);

  assert.deepEqual((await state(root)).features[0].requiredLayers, ['full', 'e2e', 'architecture']);
});

test('retains documented CSV credential-provider identifiers', async () => {
  const root = await project('credential-csv');
  await add(root, 'feat-001', ['--credential', 'openai,anthropic']);

  assert.deepEqual((await state(root)).features[0].acceptance[0].credentials, ['openai', 'anthropic']);
});
