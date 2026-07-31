import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { auditHarness, initHarness, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const execFileAsync = promisify(execFile);
const temporary = [];
const pass = 'node -e "process.exit(0)"';

async function project(name, testScript = pass, { git = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), `codex-harness-${name}-`));
  temporary.push(root);
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name,
    scripts: { test: testScript, lint: pass }
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'README.md'), `# ${name}\n`);
  await initHarness(root, { name, purpose: `${name} provides a concrete test service.` });
  if (git) {
    await execFileAsync('git', ['init'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'harness@example.test'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['config', 'user.name', 'Harness Test'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['add', '.'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'harness checkpoint'], { cwd: root, windowsHide: true });
  }
  return root;
}

async function runtime(root, ...args) {
  return runtimeWithEnvironment(root, {}, ...args);
}

async function runtimeWithEnvironment(root, overrides, ...args) {
  const env = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete env[name];
    else env[name] = value;
  }
  return execFileAsync(process.execPath, [path.join(root, '.harness', 'run.mjs'), ...args], {
    cwd: root,
    windowsHide: true,
    env
  });
}

async function add(root, id, extra = []) {
  return runtime(root, 'add', id,
    '--title', `${id} behavior`,
    '--description', `${id} is observable.`,
    '--criterion', 'The behavior check passes.',
    '--command', pass,
    '--allow', 'src/**',
    ...extra);
}

test.after(async () => {
  for (const root of temporary) await rm(root, { recursive: true, force: true });
});

test('preserves existing guidance and fails until the harness route is merged', async () => {
  const root = await project('initialization');
  const original = '# User-owned instructions\n';
  await writeFile(path.join(root, 'AGENTS.md'), original);
  const second = await initHarness(root, { name: 'changed', purpose: 'Should not overwrite.' });

  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), original);
  assert.ok(second.results.some((item) => item.path.endsWith('AGENTS.addition.md')));
  await assert.rejects(
    () => runtime(root, 'doctor'),
    (error) => /AGENTS\.md does not route|addition is still unmerged/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)
  );

  await writeFile(path.join(root, 'AGENTS.md'), '# Project instructions\nRead `.harness/config.json` and `.harness/features.json`.\n');
  await rm(path.join(root, '.harness', 'AGENTS.addition.md'));
  assert.match((await runtime(root, 'doctor')).stdout, /Structural state is healthy/);
  const audit = await auditHarness(root);
  assert.equal(audit.criticalFailures, 0);
  assert.equal(audit.bottleneck, 'feedback');
});

test('scaffolds native instructions for Codex, Claude Code, and GitHub Copilot', async () => {
  const root = await project('agent-surfaces');
  const config = JSON.parse(await readFile(path.join(root, '.harness', 'config.json'), 'utf8'));
  assert.deepEqual(config.agents.enabled, ['codex', 'claude', 'github-copilot']);
  assert.match(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /\.harness\/features\.json/);
  assert.match(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md/m);
  assert.match(await readFile(path.join(root, '.github', 'copilot-instructions.md'), 'utf8'), /AGENTS\.md/);
  assert.match((await runtime(root, 'doctor')).stdout, /Structural state is healthy/);
});

test('preserves existing Claude and Copilot instructions and emits reviewable additions', async () => {
  const root = await project('instruction-preservation');
  const claude = '# Existing Claude rules\n';
  const copilot = '# Existing Copilot rules\n';
  await writeFile(path.join(root, 'CLAUDE.md'), claude);
  await writeFile(path.join(root, '.github', 'copilot-instructions.md'), copilot);
  await initHarness(root, { name: 'instruction-preservation', purpose: 'Preserves user-owned instructions.' });

  assert.equal(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), claude);
  assert.equal(await readFile(path.join(root, '.github', 'copilot-instructions.md'), 'utf8'), copilot);
  assert.match(await readFile(path.join(root, '.harness', 'CLAUDE.addition.md'), 'utf8'), /@AGENTS\.md/);
  assert.match(await readFile(path.join(root, '.harness', 'copilot-instructions.addition.md'), 'utf8'), /Project Harness/);
});

test('requires executable acceptance and bounded scope', async () => {
  const root = await project('contracts');
  await assert.rejects(
    () => runtime(root, 'add', 'no-command', '--title', 'No command', '--description', 'Invalid contract.', '--criterion', 'It works.', '--allow', 'src/**'),
    /matching --command/
  );
  await assert.rejects(
    () => runtime(root, 'add', 'no-scope', '--title', 'No scope', '--description', 'Invalid scope.', '--criterion', 'It works.', '--command', pass),
    /Declare bounded scope/
  );
});

test('enforces WIP and only cumulative verification can create passing state', async () => {
  const root = await project('state-machine');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await add(root, 'feat-002', ['--depends', 'feat-001']);
  await assert.rejects(() => runtime(root, 'start', 'feat-002'), /Dependencies are not passing|WIP limit/);
  const verified = await runtime(root, 'verify', 'feat-001');
  assert.match(verified.stdout, /PASSING feat-001/);

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const first = state.features.find((item) => item.id === 'feat-001');
  assert.equal(first.status, 'passing');
  const evidence = JSON.parse(await readFile(path.join(root, first.evidence[0]), 'utf8'));
  assert.equal(evidence.pass, true);
  assert.deepEqual(evidence.requiredLayers.sort(), ['full', 'quick']);
  assert.ok(evidence.commands.some((item) => item.layer === 'acceptance'));
  assert.ok(evidence.contractHash && evidence.configHash);
  assert.ok(evidence.verificationHash);
  assert.ok(evidence.changedFiles.every((item) => !item.startsWith('.harness/')));
  assert.match((await runtime(root, 'handoff', '--summary', 'The first behavior is verified.')).stdout, /Updated \.harness\/handoff\.md/);

  await runtime(root, 'start', 'feat-002');
  await runtime(root, 'block', 'feat-002', '--reason', 'Needs a product decision.');
  await runtime(root, 'unblock', 'feat-002');
  assert.match((await runtime(root, 'trace', 'feat-002')).stdout, /feature\.unblocked/);
});

test('runs configured layers cumulatively instead of selecting an easier tier', async () => {
  const root = await project('cumulative');
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.verification.quick = ['node -e "process.exit(9)"'];
  config.verification.full = [pass];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.equal(evidence.commands[0].layer, 'quick');
  assert.equal(evidence.commands[0].exitCode, 9);
  assert.equal(state.features[0].status, 'active');
});

test('freezes a feature contract when work starts', async () => {
  const root = await project('frozen-contract');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  const statePath = path.join(root, '.harness', 'features.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.features[0].scope.allow.push('README.md');
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'), /contract changed after start/);
});

test('expands untracked directories and enforces scope on their actual files', async () => {
  const root = await project('untracked-scope');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await mkdir(path.join(root, 'docs', 'nested'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'nested', 'forbidden file.md'), '# Out of scope\n');
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, ['docs/nested/forbidden file.md']);
});

test('does not exempt user-editable harness policy or runtime files from feature scope', async () => {
  const root = await project('harness-scope');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  const runtimePath = path.join(root, '.harness', 'run.mjs');
  await writeFile(runtimePath, `${await readFile(runtimePath, 'utf8')}\n// unauthorized runtime edit\n`);
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, ['.harness/run.mjs']);
});

test('enforces both sides of a staged rename across the scope boundary', async () => {
  const root = await project('rename-scope');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'original.mjs'), 'export const value = 1;\n');
  await execFileAsync('git', ['add', '.'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'tracked source'], { cwd: root, windowsHide: true });
  await runtime(root, 'add', 'feat-001', '--title', 'Rename scope', '--description', 'Only documentation may change.', '--criterion', 'Checks pass.', '--command', pass, '--allow', 'docs/**');
  await runtime(root, 'start', 'feat-001');
  await mkdir(path.join(root, 'docs'));
  await rename(path.join(root, 'src', 'original.mjs'), path.join(root, 'docs', 'moved file.mjs'));
  await execFileAsync('git', ['add', '-A'], { cwd: root, windowsHide: true });
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, ['src/original.mjs']);
  assert.ok(evidence.changedFiles.includes('docs/moved file.mjs'));
  assert.ok(evidence.changedFiles.includes('src/original.mjs'));
});

test('failed verification records evidence and bounded repeated failures block work', async () => {
  const root = await project('failed-verification', 'node -e "process.exit(7)"');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  assert.equal(state.features[0].status, 'blocked');
  assert.equal(state.features[0].evidence.length, 2);
  assert.match(state.features[0].blocker, /stop condition/);
});

test('detects tampered passing evidence', async () => {
  const root = await project('evidence-integrity');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await runtime(root, 'verify', 'feat-001');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidencePath = path.join(root, state.features[0].evidence[0]);
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  evidence.featureId = 'forged-feature';
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await assert.rejects(
    () => runtime(root, 'doctor'),
    (error) => /evidence belongs to forged-feature/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)
  );
});

test('redacts common secrets from durable command evidence', async () => {
  const root = await project('redaction');
  await runtime(root, 'add', 'feat-001', '--title', 'Redaction', '--description', 'Sensitive output is removed.', '--criterion', 'Command runs.', '--command', 'node -e "console.log(\'token=supersecretvalue123\')"', '--allow', 'src/**');
  await runtime(root, 'start', 'feat-001');
  await runtime(root, 'verify', 'feat-001');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const raw = await readFile(path.join(root, state.features[0].evidence[0]), 'utf8');
  assert.doesNotMatch(raw, /supersecretvalue123/);
  assert.match(raw, /REDACTED/);
});

test('redacts the values of allowlisted secret environment variables', async () => {
  const root = await project('environment-redaction');
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.security.environmentAllow.push('HARNESS_TEST_SECRET');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const previous = process.env.HARNESS_TEST_SECRET;
  process.env.HARNESS_TEST_SECRET = 'opaque-environment-value-984731';
  try {
    await runtime(root, 'add', 'feat-001', '--title', 'Environment redaction', '--description', 'Sensitive environment output is removed.', '--criterion', 'Command runs.', '--command', 'node -e "console.log(process.env.HARNESS_TEST_SECRET)"', '--allow', 'src/**');
    await runtime(root, 'start', 'feat-001');
    await runtime(root, 'verify', 'feat-001');
  } finally {
    if (previous === undefined) delete process.env.HARNESS_TEST_SECRET;
    else process.env.HARNESS_TEST_SECRET = previous;
  }
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const raw = await readFile(path.join(root, state.features[0].evidence[0]), 'utf8');
  assert.doesNotMatch(raw, /opaque-environment-value-984731/);
  assert.match(raw, /REDACTED_ENV/);
});

test('keeps provider keys out of commands that do not explicitly request them', async () => {
  const root = await project('credential-opt-in');
  const command = 'node -e "console.log(process.env.ANTHROPIC_API_KEY ?? \'absent\')"';
  await runtime(root, 'add', 'feat-001', '--title', 'No ambient key', '--description', 'Provider keys are opt in.', '--criterion', 'The command cannot see a provider key.', '--command', command, '--allow', 'src/**');
  await runtime(root, 'start', 'feat-001');
  await runtimeWithEnvironment(root, { ANTHROPIC_API_KEY: 'anthropic-secret-primary-111111' }, 'verify', 'feat-001');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  const acceptance = evidence.commands.find((item) => item.layer === 'acceptance');
  assert.match(acceptance.output, /absent/);
  assert.deepEqual(acceptance.credentials, []);
});

test('round-robins multiple Anthropic keys across runs and persists only slot metadata', async () => {
  const root = await project('credential-rotation');
  const command = 'node -e "console.log(process.env.ANTHROPIC_API_KEY)"';
  const credentialEnvironment = {
    ANTHROPIC_API_KEY: 'anthropic-secret-primary-222222',
    ANTHROPIC_API_KEY_2: 'anthropic-secret-secondary-333333',
    ANTHROPIC_API_KEY_3: null,
    ANTHROPIC_API_KEY_4: null
  };
  for (const id of ['feat-001', 'feat-002']) {
    await runtime(root, 'add', id, '--title', `${id} credential`, '--description', 'A provider command runs.', '--criterion', 'The provider key is available.', '--command', command, '--credential', 'anthropic', '--allow', 'src/**');
    await runtime(root, 'start', id);
    await runtimeWithEnvironment(root, credentialEnvironment, 'verify', id);
  }

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  for (const [index, feature] of state.features.entries()) {
    const raw = await readFile(path.join(root, feature.evidence[0]), 'utf8');
    assert.doesNotMatch(raw, /anthropic-secret-primary|anthropic-secret-secondary/);
    const evidence = JSON.parse(raw);
    const acceptance = evidence.commands.find((item) => item.layer === 'acceptance');
    assert.deepEqual(acceptance.credentials, [{ provider: 'anthropic', slot: index + 1, selection: 'round_robin' }]);
    assert.match(acceptance.output, /REDACTED_ENV/);
  }
  const rotation = JSON.parse(await readFile(path.join(root, '.harness', 'credentials-state.json'), 'utf8'));
  assert.equal(rotation.cursors.anthropic, 2);
  assert.doesNotMatch(JSON.stringify(rotation), /anthropic-secret/);
});

test('fails before a credentialed command when no provider key is available', async () => {
  const root = await project('credential-missing');
  await runtime(root, 'add', 'feat-001', '--title', 'Missing key', '--description', 'Missing keys fail closed.', '--criterion', 'A provider key exists.', '--command', 'node -e "process.exit(0)"', '--credential', 'anthropic', '--allow', 'src/**');
  await runtime(root, 'start', 'feat-001');
  const emptyAnthropic = {
    ANTHROPIC_API_KEY: null,
    ANTHROPIC_API_KEY_2: null,
    ANTHROPIC_API_KEY_3: null,
    ANTHROPIC_API_KEY_4: null
  };
  await assert.rejects(() => runtimeWithEnvironment(root, emptyAnthropic, 'verify', 'feat-001'));
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  const failure = evidence.commands.find((item) => item.exitCode === 78);
  assert.match(failure.output, /No environment-backed keys are available/);
  assert.deepEqual(failure.credentials, [{ provider: 'anthropic', slot: null }]);
});

test('reports provider slot availability without printing key values', async () => {
  const root = await project('credential-status');
  const result = await runtimeWithEnvironment(root, {
    OPENAI_API_KEY: 'openai-secret-444444444444',
    OPENAI_API_KEY_2: null,
    OPENAI_API_KEY_3: null,
    OPENAI_API_KEY_4: null,
    ANTHROPIC_API_KEY: 'anthropic-secret-555555555555',
    ANTHROPIC_API_KEY_2: null,
    ANTHROPIC_API_KEY_3: null,
    ANTHROPIC_API_KEY_4: null
  }, 'credentials', '--json');
  const status = JSON.parse(result.stdout);
  assert.equal(status.find((item) => item.provider === 'openai').availableSlots, 1);
  assert.equal(status.find((item) => item.provider === 'anthropic').availableSlots, 1);
  assert.doesNotMatch(result.stdout, /openai-secret|anthropic-secret/);
});

test('redacts custom provider sources even when their environment names do not look secret', async () => {
  const root = await project('custom-provider-redaction');
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.security.credentials.providers.internal = {
    targetEnvironment: 'SERVICE_VALUE',
    sources: ['PRIMARY_SLOT', 'SECONDARY_SLOT'],
    selection: 'first_available'
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runtime(root, 'add', 'feat-001', '--title', 'Custom provider', '--description', 'Custom source names remain secret.', '--criterion', 'The custom provider is available.', '--command', 'node -e "console.log(process.env.SERVICE_VALUE)"', '--credential', 'internal', '--allow', 'src/**');
  await runtime(root, 'start', 'feat-001');
  await runtimeWithEnvironment(root, { PRIMARY_SLOT: 'custom-provider-value-666666', SECONDARY_SLOT: 'unused-provider-value-777777' }, 'verify', 'feat-001');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const raw = await readFile(path.join(root, state.features[0].evidence[0]), 'utf8');
  assert.doesNotMatch(raw, /custom-provider-value|unused-provider-value/);
  assert.match(raw, /REDACTED_ENV/);
});

test('rejects dependency cycles during doctor checks', async () => {
  const root = await project('cycles');
  const statePath = path.join(root, '.harness', 'features.json');
  const state = {
    version: 1,
    revision: 0,
    features: [
      { id: 'a', title: 'A', description: 'A', status: 'not_started', dependencies: ['b'], acceptance: [{ id: 'ac-1', description: 'A', command: pass }], evidence: [] },
      { id: 'b', title: 'B', description: 'B', status: 'not_started', dependencies: ['a'], acceptance: [{ id: 'ac-1', description: 'B', command: pass }], evidence: [] }
    ]
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(() => runtime(root, 'doctor'), (error) => /Dependency cycle/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`));
});

test('fails closed when Git-backed scope state is unavailable', async () => {
  const root = await project('no-git', pass, { git: false });
  await assert.rejects(
    () => runtime(root, 'doctor'),
    (error) => /scope enforcement is required/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)
  );
  await add(root, 'feat-001');
  await assert.rejects(() => runtime(root, 'start', 'feat-001'), /repository state is unavailable/);
});

test('rejects newly changed files outside feature scope', async () => {
  const root = await project('scope');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await writeFile(path.join(root, 'README.md'), '# Changed outside scope\n');
  await assert.rejects(() => runtime(root, 'handoff', '--summary', 'Unsafe dirty handoff.'), /Clean handoff is required/);
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, ['README.md']);
  assert.equal(state.features[0].status, 'active');
});

test('keeps transient locks and Git diagnostics out of scope baselines', async () => {
  const root = await project('clean-baseline');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const paths = state.features[0].scopeBaseline.files.map((item) => item.path);
  assert.ok(paths.every((item) => !item.startsWith('.harness/state.lock')));
  assert.ok(paths.every((item) => !item.toLowerCase().startsWith('ning:')));
});

test('suggests the next dependency-ready feature deterministically', async () => {
  const root = await project('next-feature');
  await add(root, 'feat-001');
  await add(root, 'feat-002', ['--depends', 'feat-001']);
  assert.match((await runtime(root, 'next')).stdout, /Start with: node \.harness\/run\.mjs start feat-001/);
  await runtime(root, 'start', 'feat-001');
  assert.match((await runtime(root, 'next')).stdout, /Continue active feature: feat-001/);
  await runtime(root, 'verify', 'feat-001');
  assert.match((await runtime(root, 'next')).stdout, /Start with: node \.harness\/run\.mjs start feat-002/);
});

test('does not treat normal post-pass config evolution as evidence corruption', async () => {
  const root = await project('config-evolution');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await runtime(root, 'verify', 'feat-001');
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.execution.start = ['node server.mjs'];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const result = await runtime(root, 'doctor');
  assert.doesNotMatch(result.stdout, /verification config changed after passing evidence/);
  assert.match(result.stdout, /Structural state is healthy/);
});

test('serializes mutating operations with a recoverable state lock', async () => {
  const root = await project('locking');
  await mkdir(path.join(root, '.harness', 'state.lock'));
  await assert.rejects(() => add(root, 'feat-001'), /state is locked/);
});

test('recovers a lock owned by a process that no longer exists', async () => {
  const root = await project('stale-lock');
  const lock = path.join(root, '.harness', 'state.lock');
  await mkdir(lock);
  await writeFile(path.join(lock, 'owner.json'), `${JSON.stringify({ pid: 2147483647, acquiredAt: new Date().toISOString() })}\n`);
  await add(root, 'feat-001');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  assert.equal(state.features[0].id, 'feat-001');
});

test('sync is idempotent and migrates legacy state without discarding project facts', async () => {
  const root = await project('sync');
  const configPath = path.join(root, '.harness', 'config.json');
  const statePath = path.join(root, '.harness', 'features.json');
  const runtimePath = path.join(root, '.harness', 'run.mjs');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  delete config.completion;
  delete config.execution;
  delete config.security;
  delete config.scope.enforcement;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  delete state.revision;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(runtimePath, '#!/usr/bin/env node\n// legacy runtime\n');
  await rm(path.join(root, '.harness', 'events.jsonl'));
  await rm(path.join(root, '.harness', 'credentials-state.json'));
  await rm(path.join(root, 'CLAUDE.md'));
  await rm(path.join(root, '.github', 'copilot-instructions.md'));

  const syncLock = path.join(root, '.harness', 'state.lock');
  await mkdir(syncLock);
  await assert.rejects(() => syncHarness(root), /state is locked/);
  await rm(syncLock, { recursive: true });

  const first = await syncHarness(root);
  assert.equal(first.result.status, 'written');
  assert.deepEqual(first.migrations.sort(), ['.harness/config.json', '.harness/features.json']);
  assert.deepEqual(first.repairs, [
    '.harness/events.jsonl',
    '.harness/credentials-state.json',
    'CLAUDE.md',
    '.github/copilot-instructions.md'
  ]);
  const migratedConfig = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(migratedConfig.project.name, 'sync');
  assert.equal(migratedConfig.scope.enforcement, 'required');
  assert.deepEqual(migratedConfig.completion.baseLayers, ['full']);
  assert.deepEqual(migratedConfig.agents.enabled, ['codex', 'claude', 'github-copilot']);
  assert.equal(migratedConfig.security.credentials.providers.anthropic.targetEnvironment, 'ANTHROPIC_API_KEY');
  const migratedState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(migratedState.revision, 0);
  assert.match(await readFile(runtimePath, 'utf8'), /HARNESS_RUNTIME_VERSION = 3/);

  const second = await syncHarness(root);
  assert.equal(second.result.status, 'unchanged');
  assert.deepEqual(second.migrations, []);
  assert.deepEqual(second.repairs, []);
});

test('skill metadata satisfies the dependency-free package contract', async () => {
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'codex-harness');
  const skill = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, 'SKILL.md needs YAML frontmatter');
  const fields = Object.fromEntries(frontmatter[1].split(/\r?\n/).map((line) => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
  assert.deepEqual(Object.keys(fields).sort(), ['description', 'name']);
  assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(fields.name.length <= 64);
  assert.ok(fields.description.length > 0 && fields.description.length <= 1024);
  assert.doesNotMatch(fields.description, /[<>]/);
  const metadata = await readFile(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
  assert.match(metadata, /display_name: "Agent Harness"/);
  assert.match(metadata, /default_prompt: "Use \$codex-harness/);
});
