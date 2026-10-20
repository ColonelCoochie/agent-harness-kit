import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(KIT, 'bin', 'agent-harness.mjs');
const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['CODEX_THREAD_ID', 'HARNESS_WORKER_ID', 'CODEX_SESSION_ID'].includes(name)));
const temps = [];
test.after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function run(cwd, file, args, env = {}) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8', env: { ...BASE_ENV, ...env }, windowsHide: true });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}
const kit = (cwd, ...args) => run(cwd, CLI, args);
const h = (cwd, ...args) => run(cwd, path.join(cwd, '.harness', 'run.mjs'), args);
function ok(result) { assert.equal(result.code, 0, result.out); return result.out; }
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const put = (root, relative, content) => { mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); writeFileSync(path.join(root, relative), content); };

function repo(name) {
  const root = mkdtempSync(path.join(os.tmpdir(), `harness-${name}-`));
  temps.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'core.autocrlf', 'false');
  put(root, 'package.json', JSON.stringify({ name, scripts: { test: 'node --test' } }));
  put(root, 'src/add.mjs', 'export const add = (a, b) => a + b;\n');
  put(root, 'test/add.test.mjs', "import test from 'node:test'; import assert from 'node:assert'; import { add } from '../src/add.mjs'; test('add', () => assert.equal(add(1, 2), 3));\n");
  return root;
}

function initialized(name, agents = 'codex,claude') {
  const root = repo(name);
  ok(kit(root, 'init', '.', '--agents', agents, '--purpose', 'Demo math library'));
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return root;
}

const fileCheck = (file, expr) => `node -e "import('./${file}').then(m=>process.exit(${expr}?0:1))"`;

function addFeature(root, id, extra = []) {
  return h(root, 'add', id, '--title', `Feature ${id}`, '--description', 'Observable behavior', '--criterion', 'mul works',
    '--command', fileCheck('src/mul.mjs', 'm.mul(2,3)===6'), '--allow', 'src/**', ...extra);
}

test('init scaffolds a v7 harness with one fail-open PreCompact hook', () => {
  const root = initialized('init');
  for (const relative of ['.harness/run.mjs', '.harness/hooks/precompact.mjs', '.harness/config.json', '.harness/loops/maker.md', 'AGENTS.md', 'CLAUDE.md']) assert.ok(existsSync(path.join(root, relative)), relative);
  const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Demo math library/);
  assert.match(agents, /agent-harness-v7/);
  assert.ok(Buffer.byteLength(agents) < 6000);
  for (const file of ['.codex/hooks.json', '.claude/settings.json']) {
    const hooks = json(path.join(root, file)).hooks;
    assert.deepEqual(Object.keys(hooks), ['PreCompact'], file);
    assert.match(hooks.PreCompact[0].hooks[0].command, /AGENT_HARNESS_HOOK_V7/);
  }
  assert.deepEqual(json(path.join(root, '.harness/config.json')).verification.full, ['npm test']);
  ok(h(root, 'doctor'));
  const audit = kit(root, 'audit', '.', '--json');
  assert.equal(JSON.parse(audit.out).score, 100, audit.out);
});

test('verify pass marks the feature passing, writes evidence and commits only scoped changes', () => {
  const root = initialized('pass');
  ok(h(root, 'claim', '--worker-id', 'w1'));
  ok(addFeature(root, 'feat-1', ['--worker-id', 'w1']));
  ok(h(root, 'start', 'feat-1', '--worker-id', 'w1'));
  put(root, 'src/mul.mjs', 'export const mul = (a, b) => a * b;\n');
  put(root, 'notes.txt', 'unrelated dirt created before verify\n');
  const out = h(root, 'verify', 'feat-1', '--worker-id', 'w1');
  assert.equal(out.code, 1, 'out-of-scope file must fail verification');
  assert.match(out.out, /SCOPE out of scope: notes\.txt/);
  rmSync(path.join(root, 'notes.txt'));
  const pass = ok(h(root, 'verify', 'feat-1', '--worker-id', 'w1'));
  assert.match(pass, /VERIFIED feat-1/);
  assert.match(pass, /COMMITTED [0-9a-f]+ feat-1/);
  const feature = json(path.join(root, '.harness/features.json')).features[0];
  assert.equal(feature.status, 'passing');
  assert.equal(feature.attempts, 2);
  const evidence = json(path.join(root, feature.evidence.at(-1)));
  assert.equal(evidence.pass, true);
  assert.ok(evidence.results.every(r => r.pass && r.log));
  const committed = git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.ok(committed.includes('src/mul.mjs'));
  assert.ok(committed.includes('.harness/features.json'));
  assert.equal(git(root, 'status', '--porcelain'), '');
  for (const evidencePath of feature.evidence) rmSync(path.join(root, evidencePath));
  const doctor = JSON.parse(h(root, 'doctor', '--json').out);
  assert.deepEqual(doctor.errors, []);
  assert.match(doctor.warnings.join('\n'), /1 passing feature\(s\) have no evidence file on disk.*feat-1/);
});

test('repeated identical failures block the feature', () => {
  const root = initialized('repeat');
  ok(addFeature(root, 'feat-1'));
  ok(h(root, 'start', 'feat-1'));
  put(root, 'src/mul.mjs', 'export const mul = (a, b) => a + b;\n');
  assert.equal(h(root, 'verify', 'feat-1').code, 1);
  const second = h(root, 'verify', 'feat-1');
  assert.equal(second.code, 1);
  assert.match(second.out, /Blocked: Same failure repeated 2 times/);
  assert.match(second.out, /acceptance\/ac-1/);
  const feature = json(path.join(root, '.harness/features.json')).features[0];
  assert.equal(feature.status, 'blocked');
  assert.match(h(root, 'verify', 'feat-1').out, /only active features/);
  ok(h(root, 'unblock', 'feat-1'));
  put(root, 'src/mul.mjs', 'export const mul = (a, b) => a * b;\n');
  ok(h(root, 'verify', 'feat-1'));
});

test('unchanged pre-existing dirt is not attributed; changed dirt is', () => {
  const root = initialized('dirt');
  put(root, 'scratch.txt', 'pre-existing\n');
  ok(addFeature(root, 'feat-1'));
  ok(h(root, 'start', 'feat-1'));
  put(root, 'src/mul.mjs', 'export const mul = (a, b) => a * b;\n');
  const pass = ok(h(root, 'verify', 'feat-1'));
  assert.doesNotMatch(pass, /scratch\.txt/);
  assert.ok(!git(root, 'show', '--name-only', '--format=', 'HEAD').includes('scratch.txt'));
  ok(h(root, 'add', 'feat-2', '--title', 'Two', '--description', 'd', '--criterion', 'c', '--command', 'node -e "0"', '--allow', 'src/**'));
  ok(h(root, 'start', 'feat-2'));
  put(root, 'scratch.txt', 'edited during feat-2\n');
  assert.match(h(root, 'verify', 'feat-2').out, /SCOPE out of scope: scratch\.txt/);
});

test('WIP limit, dependencies and frozen contracts are enforced', () => {
  const root = initialized('rules');
  ok(addFeature(root, 'a'));
  ok(h(root, 'add', 'b', '--title', 'B', '--description', 'd', '--criterion', 'c', '--command', 'node -e "0"', '--allow', 'src/**', '--depends', 'a'));
  assert.match(h(root, 'start', 'b').out, /Dependencies not passing: a/);
  ok(h(root, 'add', 'c', '--title', 'C', '--description', 'd', '--criterion', 'c', '--command', 'node -e "0"', '--allow', 'src/**'));
  ok(h(root, 'start', 'a'));
  assert.match(h(root, 'start', 'c').out, /WIP limit 1 reached/);
  assert.match(h(root, 'add', 'd', '--title', 'D', '--description', 'd', '--criterion', 'c1', '--criterion', 'c2', '--command', 'x', '--allow', 'src/**').out, /Pair every --criterion/);
  const file = path.join(root, '.harness/features.json');
  const state = json(file);
  state.features[0].acceptance[0].command = 'node -e "0"';
  writeFileSync(file, JSON.stringify(state));
  assert.match(h(root, 'verify', 'a').out, /frozen contract differs/);
});

test('checkpoint releases ownership; handoff parks work until a matching resume', () => {
  const root = initialized('continuity');
  ok(h(root, 'claim', '--worker-id', 'w1'));
  assert.match(h(root, 'claim', '--worker-id', 'w2').out, /Already owned by w1/);
  assert.match(addFeature(root, 'x', ['--worker-id', 'w2']).out, /owned by w1/);
  ok(addFeature(root, 'x', ['--worker-id', 'w1']));
  ok(h(root, 'checkpoint', '--reason', 'worker_yield', '--summary', 'added x', '--next', 'start x', '--worker-id', 'w1'));
  assert.equal(json(path.join(root, '.harness/continuity.json')).owner, null);
  assert.match(readFileSync(path.join(root, '.harness/progress.md'), 'utf8'), /added x/);
  ok(h(root, 'claim', '--worker-id', 'w2'));
  const parked = ok(h(root, 'handoff', '--summary', 'mid-way', '--next', 'continue', '--worker-id', 'w2'));
  const id = /resume (handoff-\S+)/.exec(parked)[1];
  assert.match(h(root, 'start', 'x', '--worker-id', 'w3').out, /handoff is pending/);
  assert.match(h(root, 'claim', '--worker-id', 'w3').out, /resume handoff-/);
  assert.match(h(root, 'resume', 'handoff-wrong', '--worker-id', 'w3').out, /Pending handoff is/);
  assert.match(readFileSync(path.join(root, '.harness/handoff.md'), 'utf8'), new RegExp(id));
  put(root, 'README.md', 'drift\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'drift');
  assert.match(h(root, 'resume', id, '--worker-id', 'w3').out, /drifted/);
  const resumed = ok(h(root, 'resume', id, '--worker-id', 'w3', '--accept-drift'));
  assert.match(resumed, /Summary: mid-way/);
  const continuity = json(path.join(root, '.harness/continuity.json'));
  assert.equal(continuity.phase, 'working');
  assert.equal(continuity.owner.id, 'w3');
  ok(h(root, 'claim', '--worker-id', 'w4', '--force'));
  const session = JSON.parse(ok(h(root, 'session', '--json')));
  assert.equal(session.owner.id, 'w4');
});

test('credentials reach only commands that request them and are redacted from logs', () => {
  const root = initialized('creds');
  const configPath = path.join(root, '.harness/config.json');
  const config = json(configPath);
  config.verification.quick = ['node -e "process.exit(process.env.OPENAI_API_KEY ? 1 : 0)"', { command: 'node -e "console.log(\'key=\' + process.env.OPENAI_API_KEY)"', credentials: ['openai'] }];
  writeFileSync(configPath, JSON.stringify(config));
  const secret = 'sk-test-abcdefghijklmnopqrstuvwxyz123456';
  const result = run(root, path.join(root, '.harness/run.mjs'), ['check', 'quick'], { OPENAI_API_KEY: secret, OPENAI_API_KEY_2: '' });
  assert.equal(result.code, 0, result.out);
  const logs = readdirSync(path.join(root, '.harness/logs')).map(name => readFileSync(path.join(root, '.harness/logs', name), 'utf8')).join('\n');
  assert.match(logs, /key=\[REDACTED\]/);
  assert.ok(!logs.includes(secret));
  assert.match(run(root, path.join(root, '.harness/run.mjs'), ['check', 'quick'], { OPENAI_API_KEY: '' }).out, /No openai credential is set/);
});

test('command timeouts kill the process tree', () => {
  const root = initialized('timeout');
  const configPath = path.join(root, '.harness/config.json');
  const config = json(configPath);
  config.policies.commandTimeoutMs = 1500;
  config.verification.quick = ['node -e "setTimeout(()=>{},60000)"'];
  writeFileSync(configPath, JSON.stringify(config));
  const started = Date.now();
  const result = h(root, 'check', 'quick');
  assert.equal(result.code, 1);
  assert.match(result.out, /exit 124, timed out/);
  assert.ok(Date.now() - started < 20000);
});

test('PreCompact launcher is fail-open and records the compaction', () => {
  const root = initialized('precompact');
  const command = json(path.join(root, '.codex/hooks.json')).hooks.PreCompact[0].hooks[0].command;
  const launch = cwd => spawnSync(command, { cwd, shell: true, input: JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto' }), encoding: 'utf8', windowsHide: true });
  mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  const ran = launch(path.join(root, 'src', 'deep'));
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout.trim(), '{}');
  assert.equal(json(path.join(root, '.harness/continuity.json')).lastCompaction.trigger, 'auto');
  const outside = mkdtempSync(path.join(os.tmpdir(), 'harness-none-'));
  temps.push(outside);
  assert.equal(launch(outside).stdout.trim(), '{}');
  writeFileSync(path.join(root, '.harness/run.mjs'), 'throw new Error("broken runtime")');
  const broken = launch(root);
  assert.equal(broken.status, 0);
  assert.equal(broken.stdout.trim(), '{}');
});

function legacyProject() {
  const root = repo('legacy');
  put(root, 'AGENTS.md', `# AGENTS.md

Maintain the Legacy App.

## Orchestrated-Worker Protocol

Protocol marker: \`ORCHESTRATED_WORKER_CONTINUITY_V1\`.

Long v6 protocol text.

## Project conventions

Use tabs. Run the linter.

## Bounded worker startup and ownership

More v6 text.

<!-- agent-harness-context-v1 -->
## Proactive context management

Context budget text.
<!-- /agent-harness-context-v1 -->
`);
  put(root, '.codex/hooks.json', JSON.stringify({
    description: 'Agent Harness worker-transfer persistence for automatic context compaction.',
    hooks: {
      PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node -e "const marker=\'HARNESS_HOOK_LAUNCHER_V3\';eval(1)"', timeout: 600 }] }],
      PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node -e "HARNESS_HOOK_LAUNCHER_V3"', timeout: 600 }, { type: 'command', command: 'echo user-hook' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node .harness/hooks/context-guard.mjs' }] }]
    }
  }));
  put(root, '.codex/config.toml', '# Agent Harness proactive context defaults; custom values are preserved.\nmodel_auto_compact_token_limit = 80000\nmodel_auto_compact_token_limit_scope = "total"\nmodel = "gpt-5"\n\n[features]\nhooks = true\n');
  put(root, '.harness/config.json', JSON.stringify({
    version: 1, project: { name: 'legacy', purpose: 'Legacy app' }, policies: { wipLimit: 1, maxAttempts: 5, maxRepeatedFailures: 2, commandTimeoutMs: 600000, passingIsTerminal: true },
    verification: { quick: [], full: ['npm test'], e2e: [], architecture: [], clean: [] }, completion: { baseLayers: ['full'], alwaysRunWhenConfigured: ['quick', 'architecture'], requireAcceptanceCommands: true },
    scope: { enforcement: 'required', defaultAllow: ['**/*'], defaultDeny: ['.git/**'], capture: { version: 1 } }, continuity: { mode: 'orchestrated_worker', dirtyWorktree: 'record' },
    context: { version: 1, worker: { maxToolCalls: 80 } }, security: { environmentAllow: ['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP'] },
    agents: { enabled: ['codex'], instructions: { codex: 'AGENTS.md' } }
  }));
  put(root, '.harness/continuity.json', JSON.stringify({ version: 1, phase: 'working', generation: 40, owner: null, checkpoint: null, handoff: null, retiredWorkerIds: ['a', 'b'] }));
  put(root, '.harness/events.jsonl', '');
  put(root, '.harness/run.mjs', '// v6 runtime\n');
  for (const legacy of ['context-budget.mjs', 'windows-command.mjs', 'repair.mjs', 'hooks/context-guard.mjs', 'hooks/native-hook-bootstrap-v3.json', 'context/abc.json', 'logs/tool-1.log']) put(root, `.harness/${legacy}`, '{}');
  put(root, '.harness/native-hook-v2-rollout-004-helper-freeze-v9.json', '{}');
  return root;
}

test('sync migrates a v6 project: removes per-tool hooks and leftovers, keeps project facts', () => {
  const root = legacyProject();
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'legacy');
  const baseline = { available: true, files: [], head: git(root, 'rev-parse', 'HEAD') };
  put(root, '.harness/baselines/abc.json', JSON.stringify(baseline));
  put(root, '.harness/baselines/stale.json', '{}');
  put(root, '.harness/features.json', JSON.stringify({ version: 1, revision: 9, features: [{
    id: 'legacy-active', title: 'Legacy', description: 'd', dependencies: [], status: 'active', requiredLayers: [], scope: { allow: ['src/**'], deny: [] },
    acceptance: [{ id: 'ac-1', description: 'c', command: 'node -e "0"' }], evidence: [], attempts: 0, scopeBaselineRef: { path: '.harness/baselines/abc.json' },
    contract: { hash: 'old', snapshot: { id: 'legacy-active', title: 'Legacy', description: 'd', dependencies: [], scope: { allow: ['src/**'], deny: [] }, acceptance: [{ id: 'ac-1', description: 'c', command: 'node -e "0"' }], requiredLayers: [] } }
  }] }));
  const out = ok(kit(root, 'sync', '.', '--prune'));
  assert.match(out, /removed 3 legacy hook commands/);
  const hooks = json(path.join(root, '.codex/hooks.json')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'PreCompact']);
  assert.equal(hooks.PostToolUse[0].hooks[0].command, 'echo user-hook');
  const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Maintain the Legacy App/);
  assert.match(agents, /## Project conventions\n\nUse tabs/);
  assert.match(agents, /agent-harness-v7/);
  assert.doesNotMatch(agents, /ORCHESTRATED_WORKER_CONTINUITY_V1|Bounded worker startup|Context budget text/);
  const toml = readFileSync(path.join(root, '.codex/config.toml'), 'utf8');
  assert.doesNotMatch(toml, /80000|Agent Harness proactive/);
  assert.match(toml, /model = "gpt-5"/);
  const config = json(path.join(root, '.harness/config.json'));
  assert.equal(config.context, undefined);
  assert.equal(config.harnessVersion, 7);
  assert.equal(config.completion.commitOnPass, true);
  assert.equal(json(path.join(root, '.harness/continuity.json')).retiredWorkerIds, undefined);
  for (const gone of ['context-budget.mjs', 'repair.mjs', 'hooks/context-guard.mjs', 'context', 'logs/tool-1.log', 'native-hook-v2-rollout-004-helper-freeze-v9.json', 'baselines/stale.json']) {
    assert.ok(!existsSync(path.join(root, '.harness', gone)), gone);
  }
  assert.ok(existsSync(path.join(root, '.harness/baselines/abc.json')), 'baseline of an active feature is kept');
  assert.equal(readFileSync(path.join(root, '.harness/run.mjs'), 'utf8'), readFileSync(path.join(KIT, 'skill/codex-harness/assets/project-runtime.mjs'), 'utf8'));
  const again = ok(kit(root, 'sync', '.'));
  assert.match(again, /Already current/);
  put(root, 'src/mul.mjs', 'export const mul = (a, b) => a * b;\n');
  const verified = ok(h(root, 'verify', 'legacy-active'));
  assert.match(verified, /VERIFIED legacy-active/);
  const committed = git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.ok(committed.includes('src/mul.mjs'));
  assert.ok(committed.includes('.harness/run.mjs'),'sync-rewritten runtime is committed with the feature');
  assert.ok(committed.includes('AGENTS.md'));
});

test('repository passes its own harness doctor and the suite stays fast', () => {
  const started = Date.now();
  const result = run(KIT, path.join(KIT, '.harness', 'run.mjs'), ['doctor', '--json']);
  const report = JSON.parse(result.out);
  assert.deepEqual(report.errors, []);
  assert.ok(Date.now() - started < 5000);
});
