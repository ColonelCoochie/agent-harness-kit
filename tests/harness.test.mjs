import './harness-continuity.test.mjs';
import './harness-hardening.test.mjs';
import './harness-capture-sync.test.mjs';
import './harness-hook-timeout.test.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { auditHarness, initHarness, normalizeCommandForPlatform, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const execFileAsync = promisify(execFile);
const temporary = [];
const fixtureWorkers = new Map();
function fixtureActor(root) { return fixtureWorkers.get(root) ?? "fixture-worker-a"; }
async function freshFixtureWorker(root) {
 const id = fixtureActor(root) + "-fresh"; fixtureWorkers.set(root, id);
 await runtime(root, "claim");
}
async function baselineRecord(root, feature) {
 return feature.scopeBaseline ?? JSON.parse(await readFile(path.join(root, feature.scopeBaselineRef.path), "utf8"));
}
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reusableBins = [
  path.join(repositoryRoot, 'bin', 'agent-harness.mjs'),
  path.join(repositoryRoot, 'bin', 'codex-harness.mjs')
];
const runtimeSource = path.join(repositoryRoot, 'skill', 'codex-harness', 'assets', 'project-runtime.mjs');
const runtimeCommandUsage = new Map([
  ['session', 'node .harness/run.mjs session [--json]'],
  ['resume', 'node .harness/run.mjs resume HANDOFF_ID [--accept-drift] [--json]'],
  ['doctor', 'node .harness/run.mjs doctor'],
  ['status', 'node .harness/run.mjs status'],
  ['next', 'node .harness/run.mjs next [--json]'],
  ['add', 'node .harness/run.mjs add ID --title TEXT --description TEXT --criterion TEXT --command CMD --allow GLOB [options]'],
  ['start', 'node .harness/run.mjs start ID'],
  ['block', 'node .harness/run.mjs block ID --reason TEXT'],
  ['unblock', 'node .harness/run.mjs unblock ID'],
  ['check', 'node .harness/run.mjs check [quick|full|e2e|architecture|clean]'],
  ['verify', 'node .harness/run.mjs verify [ID]'],
  ['credentials', 'node .harness/run.mjs credentials [--json]'],
  ['checkpoint', 'node .harness/run.mjs checkpoint --summary TEXT [--next TEXT] [--reason REASON] [--decision TEXT] [--blocker TEXT] [--evidence PATH] [--json]'],
  ['handoff', 'node .harness/run.mjs handoff --summary TEXT [--next TEXT] [--reason TEXT] [--agent NAME] [--decision TEXT] [--blocker TEXT] [--evidence PATH] [--json]'],
  ['trace', 'node .harness/run.mjs trace ID']
]);
const runtimeMutators = ['resume', 'add', 'start', 'block', 'unblock', 'check', 'verify', 'checkpoint', 'handoff'];
const reusableCommandUsage = new Map([
  ['init', 'agent-harness init [project]'],
  ['audit', 'agent-harness audit [project]'],
  ['sync', 'agent-harness sync [project]']
]);
const pass = 'node -e "process.exit(0)"';

const canonicalAssetMigrationFixtures = [
  {
    asset: 'docs-map.md.template',
    predecessor: 'docs-map.md.template',
    destination: 'docs-map.md',
    review: 'docs-map.v6.addition.md',
    projectName: true
  },
  { asset: 'goal.md', predecessor: 'goal.md', destination: 'loops/goal.md', review: 'loops/goal.v6.addition.md' },
  { asset: 'maker.md', predecessor: 'maker.md', destination: 'loops/maker.md', review: 'loops/maker.v6.addition.md' },
  { asset: 'checker.md', predecessor: 'checker.md', destination: 'loops/checker.md', review: 'loops/checker.v6.addition.md' }
];

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
  await runtime(root, "claim");
  return root;
}

async function runtime(root, ...args) {
  return runtimeWithEnvironment(root, {}, ...args);
}

async function runtimeWithEnvironment(root, overrides, ...args) {
  if (args[0] === "resume" && !Object.hasOwn(overrides, "CODEX_THREAD_ID")) {
    const c = JSON.parse(await readFile(path.join(root, ".harness/continuity.json"), "utf8"));
    if (c.phase === "awaiting_resume" && c.owner?.id === fixtureActor(root)) fixtureWorkers.set(root, fixtureActor(root) + "-fresh");
  }
  const env = { ...process.env, CODEX_THREAD_ID: fixtureActor(root), CODEX_SESSION_ID: "fixture-root" };
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

async function commandResult(executable, commandArgs, cwd) {
  try {
    const result = await execFileAsync(executable, commandArgs, { cwd, windowsHide: true });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: Number(error.code ?? 1), stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

async function reusableCli(bin, args, cwd = repositoryRoot) {
  return commandResult(process.execPath, [bin, ...args], cwd);
}

async function runHook(root, platform, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, '.harness', 'hooks', 'precompact-handoff.mjs'), '--platform', platform], {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, CODEX_THREAD_ID: fixtureActor(root), CODEX_SESSION_ID: 'fixture-root' }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || stdout || `hook exited ${code}`)));
    child.stdin.end(JSON.stringify(input));
  });
}

async function snapshotTree(root) {
  const snapshot = {};
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        snapshot[`${relative}/`] = 'directory';
        await visit(target, relative);
      } else {
        snapshot[relative] = (await readFile(target)).toString('base64');
      }
    }
  }
  try {
    await visit(root);
    return snapshot;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function canonicalAssetContents(root) {
  const config = JSON.parse(await readFile(path.join(root, '.harness', 'config.json'), 'utf8'));
  return Promise.all(canonicalAssetMigrationFixtures.map(async (fixture) => {
    const render = (content) => fixture.projectName
      ? content.replaceAll('{{PROJECT_NAME}}', config.project.name)
      : content;
    const assetRoot = path.join(repositoryRoot, 'skill', 'codex-harness', 'assets');
    return {
      ...fixture,
      targetPath: path.join(root, '.harness', ...fixture.destination.split('/')),
      reviewPath: path.join(root, '.harness', ...fixture.review.split('/')),
      v5: render(await readFile(path.join(assetRoot, 'migrations', 'runtime-v5', fixture.predecessor), 'utf8')),
      v6: render(await readFile(path.join(assetRoot, fixture.asset), 'utf8'))
    };
  }));
}

async function runtimeOnlyProject(name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `agent-harness-${name}-`));
  temporary.push(root);
  const harnessDir = path.join(root, '.harness');
  await mkdir(harnessDir, { recursive: true });
  await writeFile(path.join(harnessDir, 'run.mjs'), await readFile(runtimeSource));
  return root;
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

function evidencePlanHash(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

async function passingEvidenceFixture(name = 'evidence-plan') {
  const root = await project(name);
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await runtime(root, 'verify', 'feat-001');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidencePath = path.join(root, state.features[0].evidence[0]);
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  return { root, state, evidencePath, evidence };
}

async function assertEvidencePlanTamperRejected(fixture, mutate, pattern, { refreshHash = true } = {}) {
  const tampered = structuredClone(fixture.evidence);
  mutate(tampered);
  if (refreshHash && tampered.verificationPlan) {
    tampered.verificationHash = evidencePlanHash(tampered.verificationPlan);
  }
  await writeFile(fixture.evidencePath, `${JSON.stringify(tampered, null, 2)}\n`);
  try {
    await assert.rejects(
      () => runtime(fixture.root, 'doctor'),
      (error) => pattern.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)
    );
    const audit = await auditHarness(fixture.root);
    const integrityFailure = audit.subsystems.state.checks.find((item) =>
      item.pass === false
      && item.severity === 'error'
      && /evidence|verification[ -]plan/.test(item.message));
    assert.equal(integrityFailure?.pass, false);
    assert.ok(audit.criticalFailures > 0);
  } finally {
    await writeFile(fixture.evidencePath, `${JSON.stringify(fixture.evidence, null, 2)}\n`);
  }
}

async function waitForStateLockOwner(root, timeoutMs = 5000) {
  const lockDir = path.join(root, '.harness', 'state.lock');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = await readdir(lockDir).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const ownerName = entries.find((name) => name.startsWith('owner-') && name.endsWith('.json'));
    if (ownerName) {
      const ownerPath = path.join(lockDir, ownerName);
      const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
      return { lockDir, ownerName, ownerPath, owner };
    }
    await delay(10);
  }
  throw new Error(`Timed out waiting for state lock owner at ${lockDir}`);
}

test.after(async () => {
  for (const root of temporary) await rm(root, { recursive: true, force: true });
});

test('cli-help-option-validation: runtime help is command-specific and byte-stable without project state', async () => {
  const root = await runtimeOnlyProject('runtime-help');
  const runPath = path.join(root, '.harness', 'run.mjs');
  const before = await snapshotTree(root);
  const topLevel = await commandResult(process.execPath, [runPath, '--help'], root);
  assert.equal(topLevel.code, 0);
  assert.match(topLevel.stdout, /Project harness runtime/);
  assert.match(topLevel.stdout, /Orchestrated-Worker Protocol/);
  assert.deepEqual(await snapshotTree(root), before);

  for (const [command, usage] of runtimeCommandUsage) {
    const longHelp = await commandResult(process.execPath, [runPath, command, 'invalid positional value', '--help'], root);
    assert.equal(longHelp.code, 0, `${command} --help: ${longHelp.stderr}`);
    assert.ok(longHelp.stdout.includes(`Usage:\n  ${usage}`), `${command} --help lacked its usage`);
    assert.deepEqual(await snapshotTree(root), before, `${command} --help changed the fixture`);

    const shortHelp = await commandResult(process.execPath, [runPath, command, '-h', 'another invalid value'], root);
    assert.equal(shortHelp.code, 0, `${command} -h: ${shortHelp.stderr}`);
    assert.equal(shortHelp.stdout, longHelp.stdout, `${command} help spellings diverged`);
    assert.deepEqual(await snapshotTree(root), before, `${command} -h changed the fixture`);

    const routedHelp = await commandResult(process.execPath, [runPath, 'help', command], root);
    assert.equal(routedHelp.code, 0, `help ${command}: ${routedHelp.stderr}`);
    assert.equal(routedHelp.stdout, longHelp.stdout, `help ${command} diverged`);
  }
});

test('cli-help-option-validation: every runtime mutator rejects unknown flags before locks or state reads', async () => {
  const root = await runtimeOnlyProject('runtime-options');
  const runPath = path.join(root, '.harness', 'run.mjs');
  const before = await snapshotTree(root);
  for (const command of runtimeMutators) {
    const result = await commandResult(process.execPath, [runPath, command, 'invalid positional value', '--definitely-unknown', 'ignored'], root);
    assert.notEqual(result.code, 0, `${command} unexpectedly accepted an unknown option`);
    assert.match(result.stderr, new RegExp(`Unknown options for ${command}: --definitely-unknown`));
    assert.match(result.stderr, new RegExp(`${command} --help`));
    assert.deepEqual(await snapshotTree(root), before, `${command} changed the fixture before rejecting an option`);
  }
});

test('cli-help-option-validation: reusable command help is non-mutating and both aliases are equivalent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-harness-reusable-help-'));
  temporary.push(root);
  const target = path.join(root, 'must-not-exist');
  const before = await snapshotTree(root);
  const outputs = new Map();

  for (const bin of reusableBins) {
    const globalHelp = await reusableCli(bin, ['--help'], root);
    assert.equal(globalHelp.code, 0);
    assert.match(globalHelp.stdout, /Agent Harness Kit/);
    outputs.set(`${path.basename(bin)}:global`, globalHelp.stdout);
    for (const [command, usagePrefix] of reusableCommandUsage) {
      const longHelp = await reusableCli(bin, [command, target, 'invalid positional value', '--help'], root);
      assert.equal(longHelp.code, 0, `${path.basename(bin)} ${command} --help: ${longHelp.stderr}`);
      assert.ok(longHelp.stdout.includes(`Usage:\n  ${usagePrefix}`));
      assert.deepEqual(await snapshotTree(root), before);

      const shortHelp = await reusableCli(bin, [command, target, '-h', 'another invalid value'], root);
      assert.equal(shortHelp.code, 0, `${path.basename(bin)} ${command} -h: ${shortHelp.stderr}`);
      assert.equal(shortHelp.stdout, longHelp.stdout);
      assert.deepEqual(await snapshotTree(root), before);

      const routedHelp = await reusableCli(bin, ['help', command], root);
      assert.equal(routedHelp.code, 0);
      assert.equal(routedHelp.stdout, longHelp.stdout);
      outputs.set(`${path.basename(bin)}:${command}`, longHelp.stdout);
    }
  }

  assert.equal(outputs.get('agent-harness.mjs:global'), outputs.get('codex-harness.mjs:global'));
  for (const command of reusableCommandUsage.keys()) {
    assert.equal(outputs.get(`agent-harness.mjs:${command}`), outputs.get(`codex-harness.mjs:${command}`));
  }
  assert.equal(await snapshotTree(target), null);
});

test('cli-help-option-validation: reusable mutators reject misspelled flags before scaffold or sync writes', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'agent-harness-reusable-options-'));
  temporary.push(parent);
  const absent = path.join(parent, 'absent-target');
  const syncRoot = await project('reusable-option-sync');
  const runtimePath = path.join(syncRoot, '.harness', 'run.mjs');
  await writeFile(runtimePath, '// deliberately stale runtime\n');
  const syncBefore = await snapshotTree(syncRoot);
  const errorOutputs = new Map();

  for (const bin of reusableBins) {
    const initResult = await reusableCli(bin, ['init', absent, '--purpsoe', 'typo'], parent);
    assert.notEqual(initResult.code, 0);
    assert.match(initResult.stderr, /Unknown options for init: --purpsoe/);
    assert.match(initResult.stderr, /agent-harness init --help/);
    assert.equal(await snapshotTree(absent), null);

    const syncResult = await reusableCli(bin, ['sync', syncRoot, '--froce'], parent);
    assert.notEqual(syncResult.code, 0);
    assert.match(syncResult.stderr, /Unknown options for sync: --froce/);
    assert.match(syncResult.stderr, /agent-harness sync --help/);
    assert.deepEqual(await snapshotTree(syncRoot), syncBefore);
    errorOutputs.set(path.basename(bin), `${initResult.stderr}\n${syncResult.stderr}`);
  }

  assert.equal(errorOutputs.get('agent-harness.mjs'), errorOutputs.get('codex-harness.mjs'));
});

test('normalizes relative executable paths for cmd without changing POSIX commands', () => {
  const command = '.venv/Scripts/python.exe -m pytest -q tests';
  assert.equal(normalizeCommandForPlatform(command, 'win32'), '.\\.venv\\Scripts\\python.exe -m pytest -q tests');
  assert.equal(normalizeCommandForPlatform('".venv/Scripts/python.exe" -m pytest', 'win32'), '".\\.venv\\Scripts\\python.exe" -m pytest');
  assert.equal(normalizeCommandForPlatform(command, 'linux'), command);
  assert.equal(normalizeCommandForPlatform(command, 'darwin'), command);
});

test('initialization and generated runtime execute a Windows relative-path command', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-harness-windows-command-'));
  temporary.push(root);
  await mkdir(path.join(root, '.venv', 'Scripts'), { recursive: true });
  await writeFile(path.join(root, '.venv', 'Scripts', 'python.cmd'), '@exit /b 0\r\n');
  await writeFile(path.join(root, 'requirements.txt'), 'pytest\n');
  await initHarness(root, {
    name: 'windows-command',
    purpose: 'Exercises Windows relative executable paths.',
    commands: '.venv/Scripts/python.cmd -m pytest'
  });
  const config = JSON.parse(await readFile(path.join(root, '.harness', 'config.json'), 'utf8'));
  assert.deepEqual(config.verification.full, ['.\\.venv\\Scripts\\python.cmd -m pytest']);
  await runtime(root, 'claim');
  const result = await runtime(root, 'check', 'full');
  assert.match(result.stdout, /\[exit=0 /);
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

  await writeFile(path.join(root, 'AGENTS.md'), '# Project instructions\n\n## Development-Harness Boundary\n\n`.harness/` is development-only.\n\n## Orchestrated-Worker Protocol\n\nORCHESTRATED_WORKER_CONTINUITY_V1\n\nRead `.harness/config.json`, `.harness/features.json`, and `.harness/continuity.json`. Keep the user-facing orchestrator persistent and delegate a fresh worker/subagent when `.harness/run.mjs session` requests it. The fresh worker runs the exact `.harness/run.mjs resume` command.\n');
  await rm(path.join(root, '.harness', 'AGENTS.addition.md'));
  assert.match((await runtime(root, 'doctor')).stdout, /Structural state is healthy/);
  const audit = await auditHarness(root);
  assert.equal(audit.criticalFailures, 0);
  assert.equal(audit.bottleneck, 'feedback');
});

test('scaffolds native instructions for Codex, Claude Code, and GitHub Copilot', async () => {
  const root = await project('agent-surfaces');
  const config = JSON.parse(await readFile(path.join(root, '.harness', 'config.json'), 'utf8'));
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  assert.deepEqual(config.agents.enabled, ['codex', 'claude', 'github-copilot']);
  assert.match(agents, /\.harness\/features\.json/);
  assert.match(agents, /\.harness\/continuity\.json/);
  assert.match(agents, /\.harness\/run\.mjs resume/);
  assert.match(agents, /^## Development-Harness Boundary$/m);
  assert.match(agents, /^## Orchestrated-Worker Protocol$/m);
  assert.match(agents, /ORCHESTRATED_WORKER_CONTINUITY_V1/);
  assert.match(agents, /persistent (?:development )?orchestrator/i);
  assert.match(agents, /fresh (?:bounded )?(?:worker|subagent)/i);
  assert.doesNotMatch(agents, /STOP_CURRENT_CHAT/);
  assert.equal(JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8')).phase, 'working');
  assert.match(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md/m);
  assert.match(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), /Development-Harness Boundary/);
  assert.match(await readFile(path.join(root, '.github', 'copilot-instructions.md'), 'utf8'), /AGENTS\.md/);
  assert.match(await readFile(path.join(root, '.github', 'copilot-instructions.md'), 'utf8'), /Development-Harness Boundary/);
  assert.match(await readFile(path.join(root, '.codex', 'hooks.json'), 'utf8'), /precompact-handoff\.mjs/);
  const help = (await runtime(root, 'help')).stdout;
  assert.match(help, /Orchestrated-Worker Protocol/);
  assert.match(help, /persistent (?:development )?orchestrator/i);
  assert.match(help, /fresh (?:bounded )?(?:worker|subagent)/i);
  assert.doesNotMatch(help, /STOP_CURRENT_CHAT/);
  assert.match((await runtime(root, 'doctor')).stdout, /Structural state is healthy/);
});

test('Codex automatic compaction parks a handoff and returns control to the persistent orchestrator', async () => {
  const root = await project('precompact-guard');
  const result = await runHook(root, 'codex', {
    hook_event_name: 'PreCompact',
    trigger: 'auto',
    cwd: root,
    session_id: 'test-session'
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, true);
  assert.equal(Object.hasOwn(output, 'stopReason'), false);
  assert.match(output.systemMessage, /orchestrator/i);
  assert.match(output.systemMessage, /delegate/i);
  assert.match(output.systemMessage, /fresh (?:worker|subagent)/i);
  assert.ok(output.systemMessage.length < 1000);
  assert.doesNotMatch(output.systemMessage, /STOP_CURRENT_CHAT|start a new (?:chat|conversation)/i);
  const continuity = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  assert.equal(continuity.phase, 'awaiting_resume');
  assert.equal(continuity.handoff.automatic, true);
  assert.equal(continuity.handoff.reason, 'context_limit');
  assert.match(output.systemMessage, new RegExp(continuity.handoff.id));
});

test('Codex compaction hook passes through non-automatic events without mutating continuity', async () => {
  const root = await project('precompact-passthrough');
  const before = await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8');
  const result = await runHook(root, 'codex', {
    hook_event_name: 'PreCompact',
    trigger: 'manual',
    cwd: root,
    session_id: 'test-session'
  });
  assert.deepEqual(JSON.parse(result.stdout), { continue: true });
  assert.equal(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'), before);
});

test('Codex compaction hook reuses an already-pending worker handoff idempotently', async () => {
  const root = await project('precompact-pending');
  await runtime(root, 'handoff', '--summary', 'A worker handoff is already pending.', '--reason', 'context_limit');
  const continuityPath = path.join(root, '.harness', 'continuity.json');
  const before = await readFile(continuityPath, 'utf8');
  const pending = JSON.parse(before);
  const result = await runHook(root, 'codex', {
    hook_event_name: 'PreCompact',
    trigger: 'auto',
    cwd: root,
    session_id: 'test-session'
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, true);
  assert.match(output.systemMessage, new RegExp(pending.handoff.id));
  assert.match(output.systemMessage, /delegate.*fresh (?:worker|subagent)/i);
  assert.equal(await readFile(continuityPath, 'utf8'), before);
});

test('preserves existing Claude and Copilot instructions and emits reviewable additions', async () => {
  const root = await project('instruction-preservation');
  const claude = '# Existing Claude rules\n';
  const copilot = '# Existing Copilot rules\n';
  const codexHooks = '{"description":"Existing Codex hooks","hooks":{}}\n';
  await writeFile(path.join(root, 'CLAUDE.md'), claude);
  await writeFile(path.join(root, '.github', 'copilot-instructions.md'), copilot);
  await writeFile(path.join(root, '.codex', 'hooks.json'), codexHooks);
  await initHarness(root, { name: 'instruction-preservation', purpose: 'Preserves user-owned instructions.' });

  assert.equal(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), claude);
  assert.equal(await readFile(path.join(root, '.github', 'copilot-instructions.md'), 'utf8'), copilot);
  assert.equal(await readFile(path.join(root, '.codex', 'hooks.json'), 'utf8'), codexHooks);
  assert.match(await readFile(path.join(root, '.harness', 'CLAUDE.addition.md'), 'utf8'), /@AGENTS\.md/);
  assert.match(await readFile(path.join(root, '.harness', 'CLAUDE.addition.md'), 'utf8'), /Development-Harness Boundary/);
  assert.match(await readFile(path.join(root, '.harness', 'copilot-instructions.addition.md'), 'utf8'), /Project Harness/);
  assert.match(await readFile(path.join(root, '.harness', 'copilot-instructions.addition.md'), 'utf8'), /Development-Harness Boundary/);
  assert.match(await readFile(path.join(root, '.harness', 'codex-hooks.addition.json'), 'utf8'), /precompact-handoff\.mjs/);
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
  const handoffResult = await runtime(root, 'handoff', '--summary', 'The first behavior is verified.');
  assert.match(handoffResult.stdout, /HANDOFF_READY/);
  assert.match(handoffResult.stdout, /FRESH_WORKER_REQUIRED/);
  assert.match(handoffResult.stdout, /YIELD_CURRENT_WORKER/);
  assert.match(handoffResult.stdout, /Persistent development orchestrator: stay in the current user chat\./);
  assert.match(handoffResult.stdout, /Fallback only when worker delegation is unavailable/);
  assert.doesNotMatch(handoffResult.stdout, /STOP_CURRENT_CHAT|start a new (?:chat|conversation)|end this (?:chat|conversation)/i);
  const parked = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  assert.equal(parked.phase, 'awaiting_resume');
  assert.equal(parked.handoff.featureRevision, state.revision);
  const parkedGeneration = parked.generation;
  const parkedMutations = [
    ['add', 'feat-003', '--title', 'Parked', '--description', 'Must not be added.', '--criterion', 'Never runs.', '--command', pass, '--allow', 'src/**'],
    ['start', 'feat-002'],
    ['block', 'feat-001', '--reason', 'Must not mutate.'],
    ['unblock', 'feat-001'],
    ['check', 'quick'],
    ['verify', 'feat-001'],
    ['checkpoint', '--summary', 'Must not overwrite the terminal handoff.']
  ];
  for (const parkedMutation of parkedMutations) {
    await assert.rejects(() => runtime(root, ...parkedMutation), /Repository is parked/);
  }
  assert.match((await runtime(root, 'status')).stdout, new RegExp(parked.handoff.id));
  await assert.rejects(() => runtime(root, 'resume', 'wrong-handoff'), /Handoff ID mismatch/);
  assert.match((await runtime(root, 'resume', parked.handoff.id)).stdout, /WORKER_RESUMED/);
  const resumed = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  assert.equal(resumed.phase, 'working');
  assert.equal(resumed.generation, parkedGeneration + 1);
  assert.equal(resumed.lastHandoff.id, parked.handoff.id);
  const resumedHandoff = await readFile(path.join(root, '.harness', 'handoff.md'), 'utf8');
  assert.match(resumedHandoff, /- Status: \*\*CONSUMED_HANDOFF\*\*/);
  assert.match(resumedHandoff, /No worker handoff is pending\. The persistent development orchestrator may continue in the current user chat\./);
  await runtime(root, 'start', 'feat-002');
  await runtime(root, 'block', 'feat-002', '--reason', 'Needs a product decision.');
  await runtime(root, 'unblock', 'feat-002');
  assert.match((await runtime(root, 'trace', 'feat-002')).stdout, /feature\.unblocked/);
});

test('writes a bounded checkpoint without ending the working session', async () => {
  const root = await project('checkpoint');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await writeFile(path.join(root, '.harness', 'handoff.md'), '# Stale pending handoff\n');
  const result = await runtime(root, 'checkpoint', '--summary', 'Implementation is partially complete.', '--next', 'Finish the focused unit test.', '--decision', 'Keep the public API stable.', '--blocker', 'Waiting on a fixture.', '--evidence', 'notes/manual-check.txt');
  assert.match(result.stdout, /CHECKPOINT_WRITTEN/);
  const continuity = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  assert.equal(continuity.phase, 'working');
  assert.equal(continuity.checkpoint.featureRevision, state.revision);
  assert.deepEqual(continuity.checkpoint.decisions, ['Keep the public API stable.']);
  const progress = await readFile(path.join(root, '.harness', 'progress.md'), 'utf8');
  assert.match(progress, /bounded current-state snapshot/);
  assert.match(progress, /Finish the focused unit test/);
  assert.doesNotMatch(progress, /Harness scaffold created/);
  const handoff = await readFile(path.join(root, '.harness', 'handoff.md'), 'utf8');
  assert.match(handoff, /- Status: \*\*NO_PENDING_HANDOFF\*\*/);
  assert.match(handoff, /No worker handoff is pending\. The persistent development orchestrator may continue in the current user chat\./);
  assert.doesNotMatch(handoff, /Stale pending handoff/);
  assert.match((await runtime(root, 'doctor')).stdout, /Structural state is healthy/);
});

test('session --json exposes only the compact delegated-worker routing packet', async () => {
  const root = await project('compact-session');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await writeFile(path.join(root, 'README.md'), '# Rich dirty handoff\n');
  await runtime(root, 'handoff',
    '--summary', 'Implementation details that stay in repository state.',
    '--next', 'Continue the active feature.',
    '--reason', 'context_limit',
    '--decision', 'Preserve the public API.',
    '--blocker', 'Review the edge case.',
    '--evidence', 'notes/manual-check.txt');

  const continuityPath = path.join(root, '.harness', 'continuity.json');
  const before = await readFile(continuityPath, 'utf8');
  const pending = JSON.parse(before);
  assert.ok(pending.handoff.repository.changedFiles.length > 0);
  assert.deepEqual(pending.handoff.decisions, ['Preserve the public API.']);
  assert.ok(pending.handoff.evidence.includes('notes/manual-check.txt'));

  const sessionResult = await runtime(root, 'session', '--json');
  const session = JSON.parse(sessionResult.stdout);
  const expectedResume = `node .harness/run.mjs resume ${pending.handoff.id}`;
  assert.deepEqual(Object.keys(session).sort(), ['action', 'generation', 'handoffId', 'owner', 'packet', 'phase', 'resumeCommand', 'workerPrompt']);
  assert.equal(session.phase, 'awaiting_resume');
  assert.equal(session.generation, pending.generation);
  assert.equal(session.action, 'delegate_worker');
  assert.equal(session.handoffId, pending.handoff.id);
  assert.equal(session.resumeCommand, expectedResume);
  assert.match(session.workerPrompt, /fork_turns="none"/);
  assert.ok(session.workerPrompt.includes(expectedResume));
  assert.match(session.workerPrompt, /bootstrap --json/);
  assert.deepEqual(session.packet, {
    id: pending.handoff.id,
    kind: pending.handoff.kind,
    createdAt: pending.handoff.createdAt,
    reason: pending.handoff.reason,
    featureRevision: pending.handoff.featureRevision,
    automatic: pending.handoff.automatic
  });
  assert.doesNotMatch(sessionResult.stdout, /"(?:summary|next|repository|changedFiles|evidence|decisions|lastHandoff)"/);
  assert.doesNotMatch(sessionResult.stdout, /STOP_CURRENT_CHAT|start a new (?:chat|conversation)|end this (?:chat|conversation)/i);
  assert.equal(await readFile(continuityPath, 'utf8'), before);
});

test('needs-input and worker-yield checkpoints keep the orchestrator session working without resume', async () => {
  const root = await project('worker-checkpoint-routing');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await runtime(root, 'block', 'feat-001', '--reason', 'A product decision needs user input.');
  await runtime(root, 'checkpoint',
    '--summary', 'The worker is waiting for the product decision.',
    '--next', 'Ask the user to choose the behavior.',
    '--reason', 'needs_input');

  const continuityPath = path.join(root, '.harness', 'continuity.json');
  const waitingRaw = await readFile(continuityPath, 'utf8');
  const waiting = JSON.parse(waitingRaw);
  assert.equal(waiting.phase, 'working');
  assert.equal(waiting.checkpoint.reason, 'needs_input');
  const generation = waiting.generation;
  const waitingSession = JSON.parse((await runtime(root, 'session', '--json')).stdout);
  assert.equal(waitingSession.action, 'await_user');
  assert.equal(waitingSession.phase, 'working');
  assert.equal(waitingSession.handoffId, null);
  assert.equal(waitingSession.resumeCommand, null);
  assert.equal(waitingSession.workerPrompt, null);
  assert.equal(waitingSession.packet.reason, 'needs_input');
  assert.equal(await readFile(continuityPath, 'utf8'), waitingRaw);

  await freshFixtureWorker(root);
  await runtime(root, 'unblock', 'feat-001');
  const unblocked = JSON.parse(await readFile(continuityPath, 'utf8'));
  assert.equal(unblocked.phase, 'working');
  assert.equal(unblocked.generation, generation);
  await runtime(root, 'verify', 'feat-001');
  await runtime(root, 'checkpoint',
    '--summary', 'The feature is verified and this worker is complete.',
    '--next', 'Choose the next bounded feature.',
    '--reason', 'worker_yield');
  const yielded = JSON.parse(await readFile(continuityPath, 'utf8'));
  assert.equal(yielded.phase, 'working');
  assert.equal(yielded.generation, generation);
  assert.equal(yielded.checkpoint.reason, 'worker_yield');
  const yieldedSession = JSON.parse((await runtime(root, 'session', '--json')).stdout);
  assert.equal(yieldedSession.action, 'delegate_worker');
  assert.equal(yieldedSession.handoffId, null);
  assert.equal(yieldedSession.resumeCommand, null);
});

test('makes handoff and resume idempotent when command output is lost', async () => {
  const root = await project('continuity-idempotence');
  const first = await runtime(root, 'handoff', '--summary', 'Ready to continue in a fresh task.');
  const continuity = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  const id = continuity.handoff.id;
  assert.match(first.stdout, new RegExp(id));
  await rm(path.join(root, '.harness', 'progress.md'));
  await rm(path.join(root, '.harness', 'handoff.md'));
  assert.match((await runtime(root, 'handoff', '--summary', 'This retry must not replace the capsule.')).stdout, new RegExp(id));
  assert.match(await readFile(path.join(root, '.harness', 'progress.md'), 'utf8'), new RegExp(id));
  assert.match(await readFile(path.join(root, '.harness', 'handoff.md'), 'utf8'), new RegExp(id));
  assert.equal(JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8')).handoff.summary, 'Ready to continue in a fresh task.');
  await runtime(root, 'resume', id);
  assert.match((await runtime(root, 'resume', id)).stdout, /ALREADY_RESUMED/);
  const resumed = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  assert.equal(resumed.phase, 'working');
  assert.equal(resumed.generation, 2);
  assert.equal(resumed.lastHandoff.id, id);
});

test('repository-snapshot detects user-editable harness drift before consuming a handoff capsule', async () => {
  const root = await project('continuity-drift');
  await writeFile(path.join(root, 'README.md'), '# Dirty at handoff\n');
  await runtime(root, 'handoff', '--summary', 'Preserve the dirty worktree.');
  const continuity = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  const runtimePath = path.join(root, '.harness', 'run.mjs');
  await writeFile(runtimePath, `${await readFile(runtimePath, 'utf8')}\n// user-editable drift after handoff\n`);
  await assert.rejects(() => runtime(root, 'resume', continuity.handoff.id), /Repository drifted after handoff/);
  const accepted = await runtime(root, 'resume', continuity.handoff.id, '--accept-drift');
  assert.match(accepted.stdout, /Accepted drift/);
  assert.equal(JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8')).lastHandoff.driftAccepted, true);
});

test('repository-snapshot keeps durable harness state inside continuity drift hashes', async () => {
  const root = await project('continuity-state-drift');
  await runtime(root, 'handoff', '--summary', 'Durable harness state must remain authenticated.');
  const continuity = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  const statePath = path.join(root, '.harness', 'features.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.unreviewedMutation = true;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(() => runtime(root, 'resume', continuity.handoff.id), /Repository drifted after handoff/);
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

test('repository-snapshot captures status beyond 30 KB and preserves NUL-safe unusual paths', async () => {
  const root = await project('large-repository-snapshot');
  const seedDirectory = path.join(root, 'preexisting');
  await mkdir(seedDirectory);
  const seedFiles = Array.from({ length: 520 }, (_, index) =>
    `preexisting-${String(index).padStart(4, '0')}-${'x'.repeat(44)}.txt`);
  await Promise.all(seedFiles.map((file) => writeFile(path.join(seedDirectory, file), 'unchanged before feature start\n')));

  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  let state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const baseline = await baselineRecord(root, state.features[0]);
  assert.equal(baseline.version, 2);
  assert.equal(baseline.available, true);
  assert.match(baseline.head, /^[0-9a-f]{40,64}$/);
  assert.match(baseline.tree, /^[0-9a-f]{40,64}$/);
  assert.equal(typeof baseline.branch, 'string');
  assert.match(baseline.worktreeHash, /^[0-9a-f]{64}$/);
  assert.match(baseline.baselineHash, /^[0-9a-f]{64}$/);
  assert.equal(state.features[0].contract.version, 2);
  assert.equal(state.features[0].contract.scopeBaselineHash, baseline.baselineHash);
  assert.equal(baseline.files.filter((item) => item.path.startsWith('preexisting/')).length, seedFiles.length);
  assert.ok(Buffer.byteLength(baseline.output) > 30000);

  await mkdir(path.join(root, 'src'));
  const unusualPaths = [process.platform === 'win32'
    ? 'src/unicode-ü space.mjs'
    : 'src/unicode-ü space\nline.mjs'];
  if (process.platform !== 'win32') unusualPaths.push('src/literal\\backslash.mjs');
  await Promise.all(unusualPaths.map((file) => writeFile(path.join(root, file), 'export const complete = true;\n')));
  await runtime(root, 'verify', 'feat-001');

  state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.equal(state.features[0].status, 'passing');
  assert.ok(unusualPaths.every((file) => evidence.changedFiles.includes(file)));
  assert.ok(evidence.changedFiles.every((file) => !file.startsWith('preexisting/')));
});

test('repository-snapshot fails closed when exact Git output exceeds its bound', async () => {
  const root = await project('bounded-repository-snapshot');
  await add(root, 'feat-001');
  await mkdir(path.join(root, 'src'));
  await Promise.all(Array.from({ length: 40 }, (_, index) =>
    writeFile(path.join(root, 'src', `overflow-${String(index).padStart(3, '0')}-${'y'.repeat(40)}.mjs`), 'export {};\n')));

  await assert.rejects(
    () => runtimeWithEnvironment(root, { AGENT_HARNESS_GIT_CAPTURE_MAX_BYTES: '1024' }, 'start', 'feat-001'),
    (error) => /exceeded the bounded 1024-byte capture limit/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)
  );
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  assert.equal(state.features[0].status, 'not_started');
});

test('repository-snapshot preserves literal POSIX backslashes during scope matching', { skip: process.platform === 'win32' }, async () => {
  const root = await project('literal-backslash-scope');
  await runtime(root, 'add', 'feat-001', '--title', 'Literal path scope', '--description', 'Only the docs directory may change.', '--criterion', 'Checks pass.', '--command', pass, '--allow', 'docs/**');
  await runtime(root, 'start', 'feat-001');
  const literalBackslash = 'docs\\escape.md';
  await writeFile(path.join(root, literalBackslash), '# This is a root filename, not a docs child\n');
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, [literalBackslash]);
});

test('repository-snapshot expands untracked directories and enforces scope on their actual files', async () => {
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

test('repository-snapshot unions committed paths without blaming unchanged baseline dirt', async () => {
  const root = await project('committed-scope');
  await mkdir(path.join(root, 'preexisting'));
  const preexistingPath = path.join(root, 'preexisting', 'user note.md');
  await writeFile(preexistingPath, '# User work from before feature start\n');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');

  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'allowed.mjs'), 'export const allowed = true;\n');
  await writeFile(path.join(root, 'README.md'), '# Forbidden committed change\n');
  await execFileAsync('git', ['add', '-A'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'post-start changes'], { cwd: root, windowsHide: true });
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, ['README.md']);
  assert.ok(evidence.changedFiles.includes('README.md'));
  assert.ok(evidence.changedFiles.includes('src/allowed.mjs'));
  assert.ok(!evidence.changedFiles.includes('preexisting/user note.md'));
});

test('repository-snapshot does not exempt user-editable harness policy or runtime files from feature scope', async () => {
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

test('repository-snapshot enforces both sides of a staged rename across the scope boundary', async () => {
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

test('repository-snapshot enforces a staged deletion across the scope boundary', async () => {
  const root = await project('deletion-scope');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'removed.mjs'), 'export const removed = true;\n');
  await execFileAsync('git', ['add', '.'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'tracked deletion source'], { cwd: root, windowsHide: true });
  await runtime(root, 'add', 'feat-001', '--title', 'Deletion scope', '--description', 'Only documentation may change.', '--criterion', 'Checks pass.', '--command', pass, '--allow', 'docs/**');
  await runtime(root, 'start', 'feat-001');
  await rm(path.join(root, 'src', 'removed.mjs'));
  await execFileAsync('git', ['add', '-A'], { cwd: root, windowsHide: true });
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, ['src/removed.mjs']);
  assert.ok(evidence.changedFiles.includes('src/removed.mjs'));
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

test('evidence-plan writes a canonical historical manifest with exact ordered result coverage', async () => {
  const fixture = await passingEvidenceFixture('evidence-plan-manifest');
  const { evidence } = fixture;
  const plan = evidence.verificationPlan;
  assert.equal(evidence.schemaVersion, 4);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.evidenceSchemaVersion, evidence.schemaVersion);
  assert.equal(plan.harnessVersion, evidence.harnessVersion);
  assert.equal(plan.feature.id, evidence.featureId);
  assert.equal(plan.feature.contractHash, evidence.contractHash);
  assert.equal(plan.config.hash, evidence.configHash);
  assert.equal(evidence.verificationHash, evidencePlanHash(plan));
  assert.deepEqual(plan.requiredLayers.map((layer) => layer.order), plan.requiredLayers.map((_, order) => order));
  assert.deepEqual(plan.requiredLayers.map((layer) => layer.id), evidence.requiredLayers);
  assert.deepEqual(plan.executions.map((execution) => execution.order), plan.executions.map((_, order) => order));
  assert.equal(new Set(plan.executions.map((execution) => execution.id)).size, plan.executions.length);
  assert.deepEqual(evidence.commands.map((result) => result.executionId), plan.executions.map((execution) => execution.id));
  assert.deepEqual(evidence.commands.map((result) => result.executionOrder), plan.executions.map((_, order) => order));
  assert.ok(evidence.commands.every((result) => result.pass === true && result.exitCode === 0 && result.timedOut === false));
  assert.deepEqual(evidence.executedLayers, [...new Set(plan.executions.map((execution) => execution.layer))]);
  assert.deepEqual(plan.scope.expectedViolations, []);
  assert.deepEqual(evidence.scopeViolations, []);
  assert.equal(plan.acceptanceCriteria.length, 1);
  assert.equal(plan.acceptanceCriteria[0].executionId, plan.executions.find((execution) => execution.kind === 'acceptance').id);
  assert.match((await runtime(fixture.root, 'doctor')).stdout, /Structural state is healthy/);
  const audit = await auditHarness(fixture.root);
  assert.equal(audit.criticalFailures, 0);
  assert.equal(audit.subsystems.state.checks.find((item) => item.message === 'Passing evidence chains are valid').pass, true);
});

test('evidence-plan rejects removed extra duplicate or unsuccessful planned command results', async (t) => {
  const fixture = await passingEvidenceFixture('evidence-plan-results');
  const cases = [
    {
      name: 'removed command result',
      mutate: (record) => { record.commands.shift(); },
      pattern: /command results do not exactly cover verification plan/
    },
    {
      name: 'extra command result',
      mutate: (record) => {
        record.commands.push({
          ...record.commands.at(-1),
          executionId: 'extra:execution:1',
          executionOrder: record.commands.length
        });
      },
      pattern: /command results do not exactly cover verification plan/
    },
    {
      name: 'duplicate command result',
      mutate: (record) => { record.commands[1].executionId = record.commands[0].executionId; },
      pattern: /command results do not exactly cover verification plan/
    },
    {
      name: 'removed acceptance result',
      mutate: (record) => {
        const index = record.commands.findIndex((result) => result.layer === 'acceptance');
        record.commands.splice(index, 1);
      },
      pattern: /command results do not exactly cover verification plan/
    },
    {
      name: 'changed exit code',
      mutate: (record) => { record.commands[0].exitCode = 9; },
      pattern: /evidence lacks successful commands|planned pass flags/
    },
    {
      name: 'changed result pass flag',
      mutate: (record) => { record.commands[0].pass = false; },
      pattern: /planned pass flags/
    }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      await assertEvidencePlanTamperRejected(fixture, item.mutate, item.pattern);
    });
  }
});

test('evidence-plan rejects altered layers criteria hashes scope and relationship fields', async (t) => {
  const fixture = await passingEvidenceFixture('evidence-plan-structure');
  const cases = [
    {
      name: 'removed required layer',
      mutate: (record) => {
        record.verificationPlan.requiredLayers.shift();
        record.verificationPlan.requiredLayers.forEach((layer, order) => { layer.order = order; });
      },
      pattern: /required layers do not match|layer coverage is incomplete/
    },
    {
      name: 'altered required layer',
      mutate: (record) => { record.verificationPlan.requiredLayers[0].id = 'altered-layer'; },
      pattern: /required layers do not match|layer coverage is incomplete/
    },
    {
      name: 'altered planned command',
      mutate: (record) => { record.verificationPlan.executions[0].command = 'node altered-command.mjs'; },
      pattern: /command hashes do not match exact commands|does not match its planned command/
    },
    {
      name: 'removed acceptance criterion',
      mutate: (record) => { record.verificationPlan.acceptanceCriteria.pop(); },
      pattern: /acceptance coverage does not match|acceptance criteria do not match/
    },
    {
      name: 'changed snapshot with stale hash',
      mutate: (record) => { record.verificationPlan.executionPolicy.commandTimeoutMs += 1; },
      pattern: /verification plan hash does not match verificationHash/,
      refreshHash: false
    },
    {
      name: 'changed verification hash',
      mutate: (record) => { record.verificationHash = '0'.repeat(64); },
      pattern: /verification plan hash does not match verificationHash/,
      refreshHash: false
    },
    {
      name: 'nonempty scope violations',
      mutate: (record) => { record.scopeViolations = ['src/out-of-scope.mjs']; },
      pattern: /passing evidence has nonempty or invalid scope violations/
    },
    {
      name: 'unknown future evidence schema',
      mutate: (record) => { record.schemaVersion = 5; },
      pattern: /unsupported evidence schema version 5/
    },
    {
      name: 'unknown future verification-plan schema',
      mutate: (record) => { record.verificationPlan.schemaVersion = 2; },
      pattern: /unsupported verification-plan schema version 2/
    },
    {
      name: 'mismatched feature field',
      mutate: (record) => { record.verificationPlan.feature.id = 'other-feature'; },
      pattern: /verification-plan feature does not match evidence/
    },
    {
      name: 'mismatched contract field',
      mutate: (record) => { record.verificationPlan.feature.contractHash = '0'.repeat(64); },
      pattern: /verification-plan contract does not match evidence/
    },
    {
      name: 'mismatched config field',
      mutate: (record) => { record.verificationPlan.config.hash = '0'.repeat(64); },
      pattern: /verification-plan config hash does not match evidence/
    }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      await assertEvidencePlanTamperRejected(fixture, item.mutate, item.pattern, { refreshHash: item.refreshHash ?? true });
    });
  }
});

test('evidence-plan keeps legacy evidence usable with an explicit non-plan-verified warning', async () => {
  const fixture = await passingEvidenceFixture('evidence-plan-legacy');
  const legacy = structuredClone(fixture.evidence);
  legacy.schemaVersion = 3;
  delete legacy.verificationPlan;
  await writeFile(fixture.evidencePath, `${JSON.stringify(legacy, null, 2)}\n`);

  const doctor = await runtime(fixture.root, 'doctor');
  assert.match(doctor.stdout, /legacy evidence schema v3 predates embedded verification-plan manifests/);
  assert.match(doctor.stdout, /historical pass remains usable but is not independently plan-verified/);
  assert.match(doctor.stdout, /Structural state is healthy/);
  const audit = await auditHarness(fixture.root);
  assert.equal(audit.criticalFailures, 0);
  const provenance = audit.subsystems.state.checks.find((item) => item.severity === 'warning' && /legacy evidence schema v3/.test(item.message));
  assert.equal(provenance.pass, false);
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

test('redacts configured provider values from continuity capsules and projections', async () => {
  const root = await project('continuity-redaction');
  const secret = 'sk-continuity-secret-value-1234567890';
  const result = await runtimeWithEnvironment(root, { OPENAI_API_KEY: secret }, 'handoff', '--summary', `Investigated token=${secret}`, '--next', `Continue without ${secret}`);
  assert.doesNotMatch(result.stdout, new RegExp(secret));
  const continuityPath = path.join(root, '.harness', 'continuity.json');
  const continuityRaw = await readFile(continuityPath, 'utf8');
  const progressRaw = await readFile(path.join(root, '.harness', 'progress.md'), 'utf8');
  const handoffRaw = await readFile(path.join(root, '.harness', 'handoff.md'), 'utf8');
  assert.doesNotMatch(`${continuityRaw}\n${progressRaw}\n${handoffRaw}`, new RegExp(secret));
  assert.match(continuityRaw, /REDACTED/);
  const continuity = JSON.parse(continuityRaw);
  await runtimeWithEnvironment(root, { OPENAI_API_KEY: secret }, 'resume', continuity.handoff.id);
});

test('rejects built-in and custom provider environments in the ordinary allowlist without exposing values', async () => {
  const root = await project('credential-allowlist-validation');
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.security.credentials.providers.internal = {
    targetEnvironment: 'SERVICE_VALUE',
    sources: ['PRIMARY_SLOT', 'SECONDARY_SLOT'],
    selection: 'first_available'
  };
  const overlaps = ['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'SERVICE_VALUE', 'PRIMARY_SLOT', 'SECONDARY_SLOT'];
  config.security.environmentAllow.push(...overlaps);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const values = {
    OPENAI_API_KEY: 'doctor-openai-value-810001',
    OPENAI_API_KEY_2: 'doctor-openai-value-810002',
    SERVICE_VALUE: 'doctor-service-value-810003',
    PRIMARY_SLOT: 'doctor-primary-value-810004',
    SECONDARY_SLOT: 'doctor-secondary-value-810005'
  };
  let doctorDiagnostic = '';
  await assert.rejects(
    () => runtimeWithEnvironment(root, values, 'doctor'),
    (error) => {
      doctorDiagnostic = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
      return /Remove credential provider source and target environment names from security\.environmentAllow/.test(doctorDiagnostic);
    }
  );
  for (const name of overlaps) assert.match(doctorDiagnostic, new RegExp(name));
  for (const value of Object.values(values)) assert.doesNotMatch(doctorDiagnostic, new RegExp(value));

  const audit = await auditHarness(root);
  const overlapCheck = audit.subsystems.tools.checks.find((item) => item.message.startsWith('Remove credential provider source and target environment names'));
  assert.ok(overlapCheck);
  assert.equal(overlapCheck.pass, false);
  assert.ok(audit.criticalFailures >= 1);
  for (const name of overlaps) assert.match(overlapCheck.message, new RegExp(name));
  for (const value of Object.values(values)) assert.doesNotMatch(JSON.stringify(audit), new RegExp(value));
});

test('defensively strips every provider source and target from uncredentialed commands', async () => {
  const root = await project('credential-overlap-defense');
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.security.credentials.providers.internal = {
    targetEnvironment: 'SERVICE_VALUE',
    sources: ['PRIMARY_SLOT', 'SECONDARY_SLOT'],
    selection: 'first_available'
  };
  const names = ['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'SERVICE_VALUE', 'PRIMARY_SLOT', 'SECONDARY_SLOT'];
  config.security.environmentAllow.push(...names);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const expression = names.map((name) => `(process.env.${name} ?? 'absent')`).join(` + ':' + `);
  const quote = String.fromCharCode(34);
  const command = 'node -e ' + quote + 'console.log(' + expression + ')' + quote;
  await runtime(root, 'add', 'feat-001', '--title', 'Defensive isolation', '--description', 'Invalid overlap cannot bypass credential opt in.', '--criterion', 'No provider environment is inherited.', '--command', command, '--allow', 'src/**');
  await runtime(root, 'start', 'feat-001');
  const values = Object.fromEntries(names.map((name, index) => [name, `ambient-provider-value-${index}-82000`]));
  await runtimeWithEnvironment(root, values, 'verify', 'feat-001');

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  const acceptance = evidence.commands.find((item) => item.layer === 'acceptance');
  assert.match(acceptance.output, /absent:absent:absent:absent:absent/);
  assert.deepEqual(acceptance.credentials, []);
});

test('injects only the explicitly requested custom provider target without cross-provider leakage', async () => {
  const root = await project('credential-exact-provider');
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.security.credentials.providers.internal = {
    targetEnvironment: 'SERVICE_VALUE',
    sources: ['PRIMARY_SLOT', 'SECONDARY_SLOT'],
    selection: 'round_robin'
  };
  config.security.environmentAllow.push('OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'ANTHROPIC_API_KEY', 'SERVICE_VALUE', 'PRIMARY_SLOT', 'SECONDARY_SLOT');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const checks = [
    `typeof process.env.SERVICE_VALUE === 'string'`,
    `process.env.SERVICE_VALUE.startsWith('selected-')`,
    'process.env.PRIMARY_SLOT === undefined',
    'process.env.SECONDARY_SLOT === undefined',
    'process.env.OPENAI_API_KEY === undefined',
    'process.env.OPENAI_API_KEY_2 === undefined',
    'process.env.ANTHROPIC_API_KEY === undefined'
  ].join(' && ');
  const quote = String.fromCharCode(34);
  const command = 'node -e ' + quote + 'const isolated = ' + checks + `; console.log(isolated ? 'isolated' : 'leaked'); process.exit(isolated ? 0 : 9)` + quote;
  await runtime(root, 'add', 'feat-001', '--title', 'Exact provider', '--description', 'Only the requested provider target is injected.', '--criterion', 'Other providers and all source variables stay absent.', '--command', command, '--credential', 'internal', '--allow', 'src/**');
  await runtime(root, 'start', 'feat-001');
  const values = {
    OPENAI_API_KEY: 'unrequested-openai-value-830001',
    OPENAI_API_KEY_2: 'unrequested-openai-value-830002',
    ANTHROPIC_API_KEY: 'unrequested-anthropic-value-830003',
    SERVICE_VALUE: 'ambient-service-value-830004',
    PRIMARY_SLOT: 'selected-internal-value-830005',
    SECONDARY_SLOT: 'unselected-internal-value-830006'
  };
  await runtimeWithEnvironment(root, values, 'verify', 'feat-001');

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidencePath = path.join(root, state.features[0].evidence[0]);
  const raw = await readFile(evidencePath, 'utf8');
  const evidence = JSON.parse(raw);
  const acceptance = evidence.commands.find((item) => item.layer === 'acceptance');
  assert.match(acceptance.output, /isolated/);
  assert.deepEqual(acceptance.credentials, [{ provider: 'internal', slot: 1, selection: 'round_robin' }]);
  for (const value of Object.values(values)) assert.doesNotMatch(raw, new RegExp(value));
  const rotation = JSON.parse(await readFile(path.join(root, '.harness', 'credentials-state.json'), 'utf8'));
  assert.deepEqual(rotation.cursors, { internal: 1 });
});

test('does not retry a failed credentialed command with another available slot', async () => {
  const root = await project('credential-no-retry');
  const quote = String.fromCharCode(34);
  const command = 'node -e ' + quote + 'console.log(process.env.ANTHROPIC_API_KEY); process.exit(7)' + quote;
  await runtime(root, 'add', 'feat-001', '--title', 'No credential retry', '--description', 'A failed command executes once.', '--criterion', 'Failure does not rotate and rerun.', '--command', command, '--credential', 'anthropic', '--allow', 'src/**');
  await runtime(root, 'start', 'feat-001');
  await assert.rejects(() => runtimeWithEnvironment(root, {
    ANTHROPIC_API_KEY: 'no-retry-primary-value-840001',
    ANTHROPIC_API_KEY_2: 'no-retry-secondary-value-840002',
    ANTHROPIC_API_KEY_3: null,
    ANTHROPIC_API_KEY_4: null
  }, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  const acceptance = evidence.commands.filter((item) => item.layer === 'acceptance');
  assert.equal(acceptance.length, 1);
  assert.deepEqual(acceptance[0].credentials, [{ provider: 'anthropic', slot: 1, selection: 'round_robin' }]);
  const rotation = JSON.parse(await readFile(path.join(root, '.harness', 'credentials-state.json'), 'utf8'));
  assert.equal(rotation.cursors.anthropic, 1);
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

test('repository-snapshot fails closed when Git-backed scope state is unavailable', async () => {
  const root = await project('no-git', pass, { git: false });
  assert.match((await runtime(root, 'handoff', '--summary', 'Git is unavailable, but continuity must persist.')).stdout, /HANDOFF_READY/);
  const continuity = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  assert.equal(continuity.handoff.repository.available, false);
  await runtime(root, 'resume', continuity.handoff.id);
  await assert.rejects(
    () => runtime(root, 'doctor'),
    (error) => /scope enforcement is required/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)
  );
  await add(root, 'feat-001');
  await assert.rejects(() => runtime(root, 'start', 'feat-001'), /repository state is unavailable/);
});

test('repository-snapshot rejects a legacy feature baseline instead of waiving history', async () => {
  const root = await project('legacy-scope-baseline');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  const statePath = path.join(root, '.harness', 'features.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const oldBaseline = await baselineRecord(root, state.features[0]);
  delete state.features[0].scopeBaselineRef;
  state.features[0].scopeBaseline = {
    available: true,
    files: oldBaseline.files
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));
  const updated = JSON.parse(await readFile(statePath, 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, updated.features[0].evidence[0]), 'utf8'));
  assert.equal(updated.features[0].status, 'active');
  assert.match(evidence.scopeViolations[0], /^\[scope-baseline-unavailable\].*predates repository snapshot v2/);
});

test('repository-snapshot binds the starting HEAD and tree into the frozen contract', async () => {
  const root = await project('tampered-scope-identity');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'committed.mjs'), 'export const committed = true;\n');
  await execFileAsync('git', ['add', 'src/committed.mjs'], { cwd: root, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'post-start commit'], { cwd: root, windowsHide: true });

  const statePath = path.join(root, '.harness', 'features.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.features[0].scopeBaseline = await baselineRecord(root, state.features[0]);
  delete state.features[0].scopeBaselineRef;
  state.features[0].scopeBaseline.head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim();
  state.features[0].scopeBaseline.tree = (await execFileAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, windowsHide: true })).stdout.trim();
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const updated = JSON.parse(await readFile(statePath, 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, updated.features[0].evidence[0]), 'utf8'));
  assert.match(evidence.scopeViolations[0], /^\[scope-baseline-unavailable\].*does not match the frozen feature contract/);
});

test('repository-snapshot fails closed when Git disappears after feature start', async () => {
  const root = await project('git-disappears');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  const gitDirectory = path.join(root, '.git');
  const hiddenGitDirectory = path.join(root, '.git-unavailable');
  await rename(gitDirectory, hiddenGitDirectory);
  try {
    await assert.rejects(() => runtime(root, 'verify', 'feat-001'));
  } finally {
    await rename(hiddenGitDirectory, gitDirectory);
  }

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.equal(state.features[0].status, 'active');
  assert.match(evidence.scopeViolations[0], /^\[scope-unavailable\].*git status failed/);
});

test('repository-snapshot fails closed for unrelated or rewritten history', async () => {
  const root = await project('rewritten-history');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  const tree = (await execFileAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, windowsHide: true })).stdout.trim();
  const unrelated = (await execFileAsync('git', ['commit-tree', tree, '-m', 'unrelated root'], { cwd: root, windowsHide: true })).stdout.trim();
  await execFileAsync('git', ['reset', '--soft', unrelated], { cwd: root, windowsHide: true });
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.equal(state.features[0].status, 'active');
  assert.match(evidence.scopeViolations[0], /^\[scope-history-unavailable\].*not an ancestor/);
});

test('repository-snapshot rejects newly changed files outside feature scope', async () => {
  const root = await project('scope');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  await writeFile(path.join(root, 'README.md'), '# Changed outside scope\n');
  const handoff = await runtime(root, 'handoff', '--summary', 'Dirty work is safely checkpointed.');
  assert.match(handoff.stdout, /worktree is not clean/);
  const continuity = JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8'));
  assert.equal(continuity.phase, 'awaiting_resume');
  assert.equal(continuity.handoff.repository.clean, false);
  assert.ok(continuity.handoff.repository.changedFiles.some((item) => item.path === 'README.md'));
  await runtime(root, 'resume', continuity.handoff.id);
  await assert.rejects(() => runtime(root, 'verify', 'feat-001'));

  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const evidence = JSON.parse(await readFile(path.join(root, state.features[0].evidence[0]), 'utf8'));
  assert.deepEqual(evidence.scopeViolations, ['README.md']);
  assert.equal(state.features[0].status, 'active');
});

test('repository-snapshot keeps transient locks and Git diagnostics out of scope baselines', async () => {
  const root = await project('clean-baseline');
  await add(root, 'feat-001');
  await runtime(root, 'start', 'feat-001');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  const paths = (await baselineRecord(root, state.features[0])).files.map((item) => item.path);
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

test('evidence-plan accepts normal post-pass config evolution without consulting mutable config', async () => {
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
  const audit = await auditHarness(root);
  assert.equal(audit.criticalFailures, 0);
  assert.equal(audit.subsystems.state.checks.find((item) => item.message === 'Passing evidence chains are valid').pass, true);
});

test('serializes mutating operations with a recoverable state lock', async () => {
  const root = await project('locking');
  await mkdir(path.join(root, '.harness', 'state.lock'));
  await assert.rejects(() => add(root, 'feat-001'), /state is locked/);
});

test('never age-steals a backdated lock whose owner PID is alive', async () => {
  const root = await project('live-old-lock');
  const lockDir = path.join(root, '.harness', 'state.lock');
  const token = '11111111-1111-4111-8111-111111111111';
  const ownerPath = path.join(lockDir, `owner-${token}.json`);
  const owner = {
    version: 1,
    pid: process.pid,
    token,
    command: 'long-running-verification',
    acquiredAt: new Date(Date.now() - 600000).toISOString()
  };
  await mkdir(lockDir);
  await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`);
  const old = new Date(Date.now() - 600000);
  await utimes(ownerPath, old, old);
  await utimes(lockDir, old, old);

  await assert.rejects(() => add(root, 'feat-001'), /state is locked/);
  await assert.rejects(() => syncHarness(root), /state is locked/);
  assert.deepEqual(JSON.parse(await readFile(ownerPath, 'utf8')), owner);
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

test('sync recovers a tokenized lock owned by a process that no longer exists', async () => {
  const root = await project('stale-sync-lock');
  const lockDir = path.join(root, '.harness', 'state.lock');
  const token = '22222222-2222-4222-8222-222222222222';
  await mkdir(lockDir);
  await writeFile(path.join(lockDir, `owner-${token}.json`), `${JSON.stringify({
    version: 1,
    pid: 2147483647,
    token,
    command: 'interrupted-sync',
    acquiredAt: new Date().toISOString()
  })}\n`);

  await syncHarness(root);
  await assert.rejects(() => readdir(lockDir), /ENOENT/);
  JSON.parse(await readFile(path.join(root, '.harness', 'config.json'), 'utf8'));
  JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
});

test('recovers an old ownerless lock but preserves a young one', async () => {
  const root = await project('orphan-lock');
  const lockDir = path.join(root, '.harness', 'state.lock');
  await mkdir(lockDir);
  await assert.rejects(() => add(root, 'feat-young'), /state is locked/);
  const old = new Date(Date.now() - 600000);
  await utimes(lockDir, old, old);

  await add(root, 'feat-recovered');
  const state = JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  assert.deepEqual(state.features.map((feature) => feature.id), ['feat-recovered']);
  await assert.rejects(() => readdir(lockDir), /ENOENT/);
});

test('an old owner cannot delete a replacement owner lock', async () => {
  const root = await project('replacement-lock');
  const configPath = path.join(root, '.harness', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(path.join(root, 'hold-lock.mjs'), 'await new Promise((resolve) => setTimeout(resolve, 800));\n');
  config.verification.full = ['node hold-lock.mjs'];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const running = runtime(root, 'check', 'full');
  const original = await waitForStateLockOwner(root);
  await rm(original.lockDir, { recursive: true, force: true });

  const replacementToken = '33333333-3333-4333-8333-333333333333';
  const replacementPath = path.join(original.lockDir, `owner-${replacementToken}.json`);
  const replacement = {
    version: 1,
    pid: process.pid,
    token: replacementToken,
    command: 'replacement-owner',
    acquiredAt: new Date().toISOString()
  };
  await mkdir(original.lockDir);
  await writeFile(replacementPath, `${JSON.stringify(replacement, null, 2)}\n`);

  await running;
  assert.deepEqual(JSON.parse(await readFile(replacementPath, 'utf8')), replacement);
  await rm(original.lockDir, { recursive: true, force: true });
});

test('sync upgrades every exact canonical runtime-v5 worker and docs asset to runtime v6', async () => {
  const root = await project('canonical-v5-assets');
  const fixtures = await canonicalAssetContents(root);
  for (const fixture of fixtures) await writeFile(fixture.targetPath, fixture.v5);

  const first = await syncHarness(root);
  assert.deepEqual(first.canonicalAssetResults.map(({ path: assetPath, status }) => [assetPath, status]), [
    ['.harness/docs-map.md', 'migrated'],
    ['.harness/loops/goal.md', 'migrated'],
    ['.harness/loops/maker.md', 'migrated'],
    ['.harness/loops/checker.md', 'migrated']
  ]);
  for (const fixture of fixtures) {
    assert.equal(await readFile(fixture.targetPath, 'utf8'), fixture.v6);
    await assert.rejects(() => readFile(fixture.reviewPath), /ENOENT/);
    assert.ok(first.repairs.includes(`.harness/${fixture.destination}`));
  }

  const afterFirst = await snapshotTree(root);
  const second = await syncHarness(root);
  assert.deepEqual(second.canonicalAssetResults.map(({ status }) => status), fixtures.map(() => 'unchanged'));
  assert.deepEqual(second.repairs, []);
  assert.deepEqual(await snapshotTree(root), afterFirst);
});

test('sync accepts only CRLF-to-LF normalization for known runtime-v5 asset identities', async () => {
  const root = await project('canonical-v5-crlf-assets');
  const fixtures = await canonicalAssetContents(root);
  for (const fixture of fixtures) await writeFile(fixture.targetPath, fixture.v5.replaceAll('\n', '\r\n'));

  const result = await syncHarness(root);
  assert.deepEqual(result.canonicalAssetResults.map(({ status }) => status), fixtures.map(() => 'migrated'));
  for (const fixture of fixtures) assert.equal(await readFile(fixture.targetPath, 'utf8'), fixture.v6);
});

test('sync preserves customized and unknown assets with actionable v6 additions and a resolved lifecycle', async () => {
  const root = await project('custom-v5-assets');
  const fixtures = await canonicalAssetContents(root);
  const customContents = fixtures.map((fixture, index) => index < 2
    ? `${fixture.v5}<!-- project customization ${index} -->\n`
    : `# Unknown project-owned ${path.basename(fixture.destination)}\n`);
  for (const [index, fixture] of fixtures.entries()) await writeFile(fixture.targetPath, customContents[index]);
  const agentsPath = path.join(root, 'AGENTS.md');
  const userAgents = '# User-owned agent instructions\n';
  await writeFile(agentsPath, userAgents);

  const first = await syncHarness(root);
  assert.deepEqual(first.canonicalAssetResults.map(({ status, reviewStatus }) => [status, reviewStatus]), fixtures.map(() => ['preserved', 'written']));
  assert.equal(await readFile(agentsPath, 'utf8'), userAgents);
  assert.match(await readFile(path.join(root, '.harness', 'AGENTS.addition.md'), 'utf8'), /ORCHESTRATED_WORKER_CONTINUITY_V1/);
  for (const [index, fixture] of fixtures.entries()) {
    assert.equal(await readFile(fixture.targetPath, 'utf8'), customContents[index]);
    const review = await readFile(fixture.reviewPath, 'utf8');
    assert.match(review, /agent-harness-managed: canonical-runtime-v6-asset-review/);
    assert.match(review, /preserved/);
    assert.match(review, /Review and merge/);
    assert.ok(review.includes(fixture.v6));
    assert.ok(first.repairs.includes(`.harness/${fixture.review}`));
  }
  const audit = await auditHarness(root);
  assert.match(JSON.stringify(audit), /Review and merge canonical runtime-v6 asset additions/);

  const pendingSnapshot = await snapshotTree(root);
  const repeated = await syncHarness(root);
  assert.deepEqual(repeated.canonicalAssetResults.map(({ status, reviewStatus }) => [status, reviewStatus]), fixtures.map(() => ['preserved', 'unchanged']));
  assert.deepEqual(repeated.repairs, []);
  assert.deepEqual(await snapshotTree(root), pendingSnapshot);

  const modifiedReview = `${await readFile(fixtures[0].reviewPath, 'utf8')}\nProject review note.\n`;
  await writeFile(fixtures[0].reviewPath, modifiedReview);
  for (const fixture of fixtures) await writeFile(fixture.targetPath, fixture.v6);
  const resolved = await syncHarness(root);
  assert.deepEqual(resolved.canonicalAssetResults.map(({ status, reviewStatus }) => [status, reviewStatus]), fixtures.map((_, index) => ['unchanged', index === 0 ? 'preserved_modified' : 'removed']));
  assert.equal(await readFile(fixtures[0].reviewPath, 'utf8'), modifiedReview);
  for (const fixture of fixtures.slice(1)) await assert.rejects(() => readFile(fixture.reviewPath), /ENOENT/);
  await rm(fixtures[0].reviewPath);
  const resolvedSnapshot = await snapshotTree(root);
  const final = await syncHarness(root);
  assert.deepEqual(final.canonicalAssetResults.map(({ status, reviewStatus }) => [status, reviewStatus]), fixtures.map(() => ['unchanged', 'absent']));
  assert.deepEqual(final.repairs, []);
  assert.deepEqual(await snapshotTree(root), resolvedSnapshot);
});

test('sync leaves current canonical runtime-v6 worker and docs assets byte-for-byte unchanged', async () => {
  const root = await project('canonical-v6-assets');
  const before = await snapshotTree(root);
  const result = await syncHarness(root);
  assert.deepEqual(result.canonicalAssetResults.map(({ status, reviewStatus }) => [status, reviewStatus]), canonicalAssetMigrationFixtures.map(() => ['unchanged', 'absent']));
  assert.deepEqual(result.repairs, []);
  assert.deepEqual(await snapshotTree(root), before);
});

test('sync respects the runtime state lock and leaves project state untouched on contention', async () => {
  const root = await project('sync-runtime-lock');
  const configPath = path.join(root, '.harness', 'config.json');
  const featuresPath = path.join(root, '.harness', 'features.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(path.join(root, 'hold-sync-lock.mjs'), 'await new Promise((resolve) => setTimeout(resolve, 800));\n');
  config.verification.full = ['node hold-sync-lock.mjs'];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const beforeConfig = await readFile(configPath, 'utf8');
  const beforeFeatures = await readFile(featuresPath, 'utf8');

  const running = runtime(root, 'check', 'full');
  await waitForStateLockOwner(root);
  await assert.rejects(() => syncHarness(root), /state is locked/);
  assert.equal(await readFile(configPath, 'utf8'), beforeConfig);
  assert.equal(await readFile(featuresPath, 'utf8'), beforeFeatures);
  await running;

  const synced = await syncHarness(root);
  assert.equal(synced.result.status, 'unchanged');
});

test('concurrent syncs have a single atomic state lock owner and preserve valid state', async () => {
  const root = await project('concurrent-sync');
  const contenders = await Promise.allSettled(Array.from({ length: 8 }, () => syncHarness(root)));
  const completed = contenders.filter((result) => result.status === 'fulfilled');
  const blocked = contenders.filter((result) => result.status === 'rejected');
  assert.ok(completed.length >= 1);
  assert.ok(blocked.length >= 1);
  for (const result of blocked) assert.match(result.reason.message, /state is locked/);

  JSON.parse(await readFile(path.join(root, '.harness', 'config.json'), 'utf8'));
  JSON.parse(await readFile(path.join(root, '.harness', 'features.json'), 'utf8'));
  await assert.rejects(() => readdir(path.join(root, '.harness', 'state.lock')), /ENOENT/);
  const final = await syncHarness(root);
  assert.equal(final.result.status, 'unchanged');
});

test('sync flags routed canonical instructions that lack the development boundary', async () => {
  const root = await project('instruction-continuity-sync');
  await writeFile(path.join(root, 'AGENTS.md'), '# Legacy instructions\nRead `.harness/config.json`, `.harness/features.json`, and `.harness/continuity.json`. A fresh task runs `.harness/run.mjs resume`.\n');
  await assert.rejects(
    () => runtime(root, 'doctor'),
    (error) => /missing the canonical Development-Harness Boundary|does not route/.test(`${error.stdout ?? ''}\n${error.stderr ?? ''}`)
  );
  const result = await syncHarness(root);
  assert.ok(result.repairs.includes('.harness/AGENTS.addition.md'));
  const addition = await readFile(path.join(root, '.harness', 'AGENTS.addition.md'), 'utf8');
  assert.match(addition, /^## Development-Harness Boundary$/m);
  assert.match(addition, /^## Orchestrated-Worker Protocol$/m);
  assert.match(addition, /ORCHESTRATED_WORKER_CONTINUITY_V1/);
  assert.match(addition, /\.harness\/continuity\.json/);
  assert.match(addition, /\.harness\/run\.mjs resume/);
  const audit = await auditHarness(root);
  assert.ok(audit.criticalFailures > 0);
  assert.match(JSON.stringify(audit), /Unresolved instruction additions/);
});

test('sync flags otherwise-routed v5 instructions that impose a restrictive global chat boundary', async () => {
  const root = await project('stale-v5-instructions');
  const stale = `# Legacy v5 project instructions

## Development-Harness Boundary

Read \`.harness/config.json\`, \`.harness/features.json\`, and \`.harness/continuity.json\` before work. If continuity is awaiting resume, start a genuinely new chat and run \`.harness/run.mjs resume\`. After STOP_CURRENT_CHAT, end the conversation.
`;
  await writeFile(path.join(root, 'AGENTS.md'), stale);
  const result = await syncHarness(root);
  assert.ok(result.repairs.includes('.harness/AGENTS.addition.md'));
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), stale);
  const addition = await readFile(path.join(root, '.harness', 'AGENTS.addition.md'), 'utf8');
  assert.match(addition, /ORCHESTRATED_WORKER_CONTINUITY_V1/);
  assert.match(addition, /^## Orchestrated-Worker Protocol$/m);
  assert.match(addition, /persistent (?:development )?orchestrator/i);
  assert.match(addition, /fresh (?:bounded )?(?:worker|subagent)/i);
  assert.doesNotMatch(addition, /STOP_CURRENT_CHAT/);
});

test('sync requires a reviewed raw hash to refresh an unknown precompact hook', async () => {
  const root = await project('stale-precompact-hook');
  const hookPath = path.join(root, '.harness', 'hooks', 'precompact-handoff.mjs');
  await writeFile(hookPath, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ continue: false, stopReason: "STOP_CURRENT_CHAT" }));\n');
  await assert.rejects(syncHarness(root), /Sync blocked/);
  const expected = createHash('sha256').update(await readFile(hookPath)).digest('hex');
  const result = await syncHarness(root, { replacements: { '.harness/hooks/precompact-handoff.mjs': expected } });
  assert.ok(result.repairs.includes('.harness/hooks/precompact-handoff.mjs'));
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'codex-harness');
  const canonical = await readFile(path.join(skillRoot, 'assets', 'precompact-handoff.mjs'), 'utf8');
  const refreshed = await readFile(hookPath, 'utf8');
  assert.equal(refreshed, canonical);
  assert.doesNotMatch(refreshed, /STOP_CURRENT_CHAT/);
});

test('selective agent initialization and sync never recreate a disabled Claude adapter', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-harness-selective-agents-'));
  temporary.push(root);
  await writeFile(path.join(root, 'package.json'), '{"name":"selective-agents","scripts":{"test":"node -e \\\"process.exit(0)\\\""}}\n');
  await writeFile(path.join(root, 'README.md'), '# selective agents\n');
  await initHarness(root, {
    name: 'selective-agents',
    purpose: 'Exercises selective coding-agent surfaces.',
    agents: 'codex,github-copilot'
  });
  const config = JSON.parse(await readFile(path.join(root, '.harness', 'config.json'), 'utf8'));
  assert.deepEqual(config.agents.enabled, ['codex', 'github-copilot']);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8').then(() => true), true);
  assert.equal(await readFile(path.join(root, '.github', 'copilot-instructions.md'), 'utf8').then(() => true), true);
  await assert.rejects(() => readFile(path.join(root, 'CLAUDE.md'), 'utf8'), /ENOENT/);
  await syncHarness(root);
  await assert.rejects(() => readFile(path.join(root, 'CLAUDE.md'), 'utf8'), /ENOENT/);
  await assert.rejects(
    () => initHarness(path.join(root, 'invalid'), { purpose: 'Invalid surface selection.', agents: 'codex,product-agent' }),
    /Unknown coding-agent surface/
  );
});

test('init and sync preserve a seeded product-agent runtime byte-for-byte', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-harness-product-agent-boundary-'));
  temporary.push(root);
  const runtimeDir = path.join(root, 'src', 'product-agent');
  const runtimePath = path.join(runtimeDir, 'orchestrator.mjs');
  const runtimeBytes = Buffer.from('export const runtime = { state: "product-owned", telemetry: [] };\n', 'utf8');
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(runtimePath, runtimeBytes);
  await writeFile(path.join(root, 'package.json'), '{"name":"product-agent-boundary","scripts":{"test":"node -e \\\"process.exit(0)\\\""}}\n');
  await writeFile(path.join(root, 'README.md'), '# product agent boundary\n');
  await initHarness(root, { name: 'product-agent-boundary', purpose: 'Keeps product runtime separate.' });
  assert.deepEqual(await readFile(runtimePath), runtimeBytes);
  assert.doesNotMatch((await readFile(runtimePath, 'utf8')), /\.harness/);
  await syncHarness(root);
  assert.deepEqual(await readFile(runtimePath), runtimeBytes);
  assert.doesNotMatch((await readFile(runtimePath, 'utf8')), /\.harness/);
});

test('sync preserves a pending handoff barrier and refuses to erase a corrupt one', async () => {
  const root = await project('pending-continuity-sync');
  await runtime(root, 'handoff', '--summary', 'This pending handoff must survive sync.');
  const continuityPath = path.join(root, '.harness', 'continuity.json');
  const pending = JSON.parse(await readFile(continuityPath, 'utf8'));
  await syncHarness(root);
  const preserved = JSON.parse(await readFile(continuityPath, 'utf8'));
  assert.equal(preserved.phase, 'awaiting_resume');
  assert.equal(preserved.handoff.id, pending.handoff.id);
  preserved.handoff = null;
  await writeFile(continuityPath, `${JSON.stringify(preserved, null, 2)}\n`);
  await assert.rejects(() => syncHarness(root), /Refusing to clear an awaiting-resume barrier/);
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
  delete config.continuity;
  config.policies.requireCleanHandoff = true;
  delete config.scope.enforcement;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  delete state.revision;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(runtimePath, '#!/usr/bin/env node\n// legacy runtime\n');
  await rm(path.join(root, '.harness', 'events.jsonl'));
  await rm(path.join(root, '.harness', 'credentials-state.json'));
  await rm(path.join(root, '.harness', 'continuity.json'));
  await rm(path.join(root, 'CLAUDE.md'));
  await rm(path.join(root, '.github', 'copilot-instructions.md'));

  const syncLock = path.join(root, '.harness', 'state.lock');
  const replacements = { '.harness/run.mjs': createHash('sha256').update(await readFile(runtimePath)).digest('hex') };
  await mkdir(syncLock);
  await assert.rejects(() => syncHarness(root, { replacements }), /state is locked/);
  await rm(syncLock, { recursive: true });

  const first = await syncHarness(root, { replacements });
  assert.equal(first.result.status, 'written');
  assert.deepEqual(first.migrations.sort(), ['.harness/config.json', '.harness/continuity.json', '.harness/features.json']);
  assert.deepEqual(first.repairs, [
    '.harness/events.jsonl',
    '.harness/credentials-state.json',
    'CLAUDE.md',
    '.github/copilot-instructions.md'
  ]);
  const migratedConfig = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(migratedConfig.project.name, 'sync');
  assert.equal(migratedConfig.scope.enforcement, 'required');
  assert.equal(migratedConfig.continuity.mode, 'orchestrated_worker');
  assert.equal(migratedConfig.continuity.dirtyWorktree, 'record');
  assert.equal(Object.hasOwn(migratedConfig.policies, 'requireCleanHandoff'), false);
  assert.deepEqual(migratedConfig.completion.baseLayers, ['full']);
  assert.deepEqual(migratedConfig.agents.enabled, ['codex', 'claude', 'github-copilot']);
  assert.equal(migratedConfig.security.credentials.providers.anthropic.targetEnvironment, 'ANTHROPIC_API_KEY');
  const migratedState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(migratedState.revision, 0);
  assert.equal(JSON.parse(await readFile(path.join(root, '.harness', 'continuity.json'), 'utf8')).phase, 'working');
  assert.match(await readFile(runtimePath, 'utf8'), /HARNESS_RUNTIME_VERSION = 6/);

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
  assert.match(metadata, /display_name: "Development Harness"/);
  assert.match(metadata, /default_prompt: "Use \$codex-harness/);
  assert.match(metadata, /product-runtime agents independent/);
});
