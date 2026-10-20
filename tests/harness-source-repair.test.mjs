import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initHarness, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';
import { repairHarness } from '../skill/codex-harness/scripts/lib/source-repair.mjs';
import { buildNativeHookBootstrapV2, buildNativeHookBootstrapV3 } from '../skill/codex-harness/scripts/lib/hook-bootstrap.mjs';
import { hookRepairCommand, repairArguments, repairRealPath } from '../skill/codex-harness/assets/hook-recovery.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin/agent-harness.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, agents) {
  const base = await mkdtemp(path.join(repo, 'tests', '.source-repair-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'), home = path.join(base, 'home');
  await mkdir(root); await mkdir(home);
  await initHarness(root, { agents, hookApproval: { home } });
  const policyPath = path.join(home, 'agent-harness-hook-policy.json');
  const policy = { version: 1, enabled: true, authority: 'explicit-canonical-kit-location', sourceRoot: repo, projects: [root] };
  await writeFile(policyPath, JSON.stringify(policy));
  const environment = { ...process.env, CODEX_HOME: home, CODEX_THREAD_ID: 'source-repair-test' };
  const run = (words, extra = {}) => repairHarness(words, { cwd: root, environment, ...extra });
  return { base, root, home, policyPath, policy, environment, run };
}
async function mutateContinuity(f, edit) {
  const file = path.join(f.root, '.harness/continuity.json');
  const state = JSON.parse(await readFile(file)); edit(state); await writeFile(file, JSON.stringify(state));
}
function repairInput(f, command, cwd = f.root) { return { cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { cmd: command, workdir: cwd } }; }

function invokeBootstrap(f, bootstrap, platform, input) {
  const code = bootstrap.commands[platform + '/context-guard.mjs'].slice(9, -1);
  const result = spawnSync(process.execPath, ['-e', code], { cwd: f.root, input: JSON.stringify(input), encoding: 'utf8', env: f.environment, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}

const previouslyExcluded = ['.harness/windows-command.mjs', '.harness/windows-command-supervisor.ps1', ...[1, 2, 3].map(version => `.harness/hooks/native-hook-bootstrap-v${version}.json`)];

test('every managed repair path is accepted, corrupted omitted paths recover through full v3 launchers, and v2 retains its grammar', async t => {
  const f = await fixture(t), bootstrap = buildNativeHookBootstrapV3(), old = buildNativeHookBootstrapV2();
  const inventory = JSON.parse(await readFile(path.join(f.root, '.harness/managed-files.json')));
  for (const relative of Object.keys(inventory.files)) assert.doesNotThrow(() => repairArguments(['--preview', '--replace-reviewed', relative + '=' + 'a'.repeat(64)], f.root, path));
  const bytes = 'damaged reviewed bytes\n', reviewed = previouslyExcluded.flatMap(relative => ['--replace-reviewed', relative + '=' + hash(bytes)]);
  for (const relative of previouslyExcluded) await writeFile(path.join(f.root, relative), bytes);
  await rm(path.join(f.root, '.harness/hooks/native-hook-dispatch.mjs'));
  const blocked = (await f.run(['--preview'])).result;
  assert.deepEqual(blocked.blockers.map(item => item.path).sort(), [...previouslyExcluded].sort());
  const localPreview = spawnSync(process.execPath, [path.join(f.root, '.harness/repair.mjs'), 'sync', '--preview', '--json', ...reviewed], { cwd: f.root, encoding: 'utf8', env: f.environment, windowsHide: true });
  assert.equal(localPreview.status, 0, localPreview.stderr);
  const preview = (await f.run(['--preview', ...reviewed])).result;
  assert.equal(preview.blocked, false);
  for (const platform of ['codex', 'claude']) for (const operation of [['--preview'], ['--expect-plan', preview.planHash]]) {
    const command = `node "${cli}" repair ${[...operation, ...reviewed].join(' ')}`;
    const input = repairInput(f, command);
    assert.equal(invokeBootstrap(f, old, platform, input).hookSpecificOutput.permissionDecision, 'deny');
    for (const hook_event_name of ['PreToolUse', 'PostToolUse']) {
      const output = invokeBootstrap(f, bootstrap, platform, { ...input, hook_event_name });
      assert.notEqual(output.hookSpecificOutput?.permissionDecision, 'deny');
      assert.match(output.hookSpecificOutput.additionalContext, /Authenticated source/);
      if (hook_event_name === 'PostToolUse') assert.match(output.hookSpecificOutput.additionalContext, /already completed/);
    }
  }
  await f.run(['--expect-plan', preview.planHash, ...reviewed]);
  const health = spawnSync(process.execPath, [path.join(f.root, '.harness/repair.mjs'), 'health', '--json'], { cwd: f.root, encoding: 'utf8', env: f.environment, windowsHide: true });
  assert.equal(health.status, 0, health.stderr); assert.equal(JSON.parse(health.stdout).healthy, true);
  for (const relative of previouslyExcluded) assert.ok(JSON.parse(health.stdout).files.find(item => item.path === relative)?.healthy);
});

test('missing Windows helpers and all versioned bootstrap manifests recover without replacements', async t => {
  const f = await fixture(t);
  for (const relative of previouslyExcluded) await rm(path.join(f.root, relative));
  const health = spawnSync(process.execPath, [path.join(f.root, '.harness/repair.mjs'), 'health', '--json'], { cwd: f.root, encoding: 'utf8', env: f.environment, windowsHide: true });
  const report = JSON.parse(health.stdout); assert.equal(report.healthy, false);
  assert.deepEqual(report.files.filter(item => !item.healthy).map(item => item.path).sort(), [...previouslyExcluded].sort());
  const preview = (await f.run(['--preview'])).result;
  assert.equal(preview.blocked, false); await f.run(['--expect-plan', preview.planHash]);
  for (const relative of previouslyExcluded) assert.ok((await readFile(path.join(f.root, relative))).length);
});

test('authenticated v1 and v2 hook groups upgrade to v3 for both hosts without duplicating unrelated groups', async t => {
  for (const version of [1, 2]) {
    const f = await fixture(t), old = JSON.parse(await readFile(path.join(repo, `skill/codex-harness/assets/native-hook-bootstrap-v${version}.json`)));
    const current = buildNativeHookBootstrapV3();
    for (const platform of ['codex', 'claude']) {
      const destination = path.join(f.root, platform === 'codex' ? '.codex/hooks.json' : '.claude/settings.json');
      let text = await readFile(destination, 'utf8');
      for (const [key, command] of Object.entries(current.commands).filter(([key]) => key.startsWith(platform + '/'))) text = text.replaceAll(JSON.stringify(command), JSON.stringify(old.commands[key]));
      const settings = JSON.parse(text);
      settings.hooks.PreCompact.unshift({ matcher: 'manual', hooks: [{ type: 'command', command: 'echo unrelated' }] });
      await writeFile(destination, JSON.stringify(settings));
    }
    await syncHarness(f.root, { approveNativeHooks: false });
    for (const platform of ['codex', 'claude']) {
      const settings = JSON.parse(await readFile(path.join(f.root, platform === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')));
      assert.equal(settings.hooks.PreCompact[0].hooks[0].command, 'echo unrelated');
      assert.equal(settings.hooks.PreCompact.length, 2);
      for (const groups of Object.values(settings.hooks)) for (const group of groups) for (const hook of group.hooks) if (hook.command !== 'echo unrelated') assert.match(hook.command, /HARNESS_HOOK_LAUNCHER_V3/);
    }
  }
});

test('disabled hook adapters reject bootstrap replacement and remain absent across sync and source repair', async t => {
  const f = await fixture(t, ['github-copilot']);
  await assert.rejects(f.run(['--preview', '--replace-reviewed', '.harness/hooks/native-hook-bootstrap-v3.json=' + 'a'.repeat(64)]), /not an enabled runtime\/hook path/);
  const preview = (await f.run(['--preview'])).result; await f.run(['--expect-plan', preview.planHash]);
  await syncHarness(f.root, { approveNativeHooks: false });
  for (const relative of ['.harness/hooks/native-hook-bootstrap-v3.json', '.codex/hooks.json', '.claude/settings.json']) await assert.rejects(readFile(path.join(f.root, relative)), { code: 'ENOENT' });
  const health = spawnSync(process.execPath, [path.join(f.root, '.harness/repair.mjs'), 'health', '--json'], { cwd: f.root, encoding: 'utf8', env: f.environment, windowsHide: true });
  assert.equal(health.status, 0, health.stderr); assert.equal(JSON.parse(health.stdout).healthy, true);
  assert.equal(JSON.parse(health.stdout).files.length, 5);
});

test('v2 custom hook groups remain unchanged and duplicate canonical predecessors block v3 migration', async t => {
  for (const platform of ['codex', 'claude']) for (const mode of ['custom', 'duplicate']) {
    const f = await fixture(t), destination = path.join(f.root, platform === 'codex' ? '.codex/hooks.json' : '.claude/settings.json');
    const settings = JSON.parse(await readFile(destination));
    const hook = settings.hooks.PreToolUse[0].hooks[0];
    hook.command = buildNativeHookBootstrapV2().commands[platform + '/context-guard.mjs'];
    if (hook.commandWindows) hook.commandWindows = hook.command;
    if (mode === 'custom') hook.timeout = 123;
    else settings.hooks.PreToolUse.push(structuredClone(settings.hooks.PreToolUse[0]));
    const before = JSON.stringify(settings); await writeFile(destination, before);
    if (mode === 'duplicate') {
      await assert.rejects(syncHarness(f.root, { approveNativeHooks: false }), /Duplicated canonical hook predecessor/);
      assert.equal(await readFile(destination, 'utf8'), before);
    } else {
      await syncHarness(f.root, { approveNativeHooks: false });
      const after = JSON.parse(await readFile(destination));
      assert.deepEqual(after.hooks.PreToolUse, settings.hooks.PreToolUse);
    }
  }
});

test('v3 generation preserves byte-pinned v1 and v2 predecessors', async () => {
  const v1Bytes = await readFile(path.join(repo, 'skill/codex-harness/assets/native-hook-bootstrap-v1.json'));
  assert.equal(hash(v1Bytes), 'c814703c44c562c66d8d2a653a3be3e3b03b633e57db348988145b8b8455e4c9');
  const v1 = JSON.parse(v1Bytes);
  const v2Bytes = await readFile(path.join(repo, 'skill/codex-harness/assets/native-hook-bootstrap-v2.json'));
  assert.equal(hash(v2Bytes), 'c2f54c51d1c8a2cb8b3ff04a5b65b824ea2301849e02d702551dfdc80a77e6c9');
  const v2 = JSON.parse(v2Bytes);
  assert.equal(v1.version, 1); assert.deepEqual(v2, buildNativeHookBootstrapV2());
  assert.ok(Object.values(v1.commands).every(command => command.includes('HARNESS_HOOK_LAUNCHER_V1')));
  assert.ok(Object.values(v2.commands).every(command => command.includes('HARNESS_HOOK_LAUNCHER_V2')));
  const v3 = JSON.parse(await readFile(path.join(repo, 'skill/codex-harness/assets/native-hook-bootstrap-v3.json')));
  assert.deepEqual(v3, buildNativeHookBootstrapV3());
  assert.ok(Object.values(v3.commands).every(command => command.includes('HARNESS_HOOK_LAUNCHER_V3')));
});

test('source repair restores missing and damaged installed entrypoints with no native approval', async t => {
  const f = await fixture(t), damaged = '.harness/run.mjs', bytes = 'throw new Error("damaged runtime must never execute");\n';
  await writeFile(path.join(f.root, damaged), bytes);
  await rm(path.join(f.root, '.harness/repair.mjs'));
  await rm(path.join(f.root, '.harness/hooks/native-hook-dispatch.mjs'));
  const reviewed = ['--replace-reviewed', `${damaged}=${hash(bytes)}`];
  let nativeCalls = 0;
  const sync = (root, options) => {
    assert.equal(options.approveNativeHooks, false); assert.equal(options.enrollHooks, undefined);
    return syncHarness(root, { ...options, hookApproval: { home: f.home, rpc: () => { nativeCalls++; throw new Error('native approval forbidden'); } } });
  };
  const preview = (await f.run(['--preview', ...reviewed], { sync })).result;
  assert.equal(await readFile(path.join(f.root, damaged), 'utf8'), bytes);
  const repaired = (await f.run(['--expect-plan', preview.planHash, ...reviewed], { sync })).result;
  assert.equal(nativeCalls, 0); assert.equal(repaired.nativeHookApproval.status, 'skipped');
  for (const [installed, source] of [[damaged, 'project-runtime.mjs'], ['.harness/repair.mjs', 'repair.mjs'], ['.harness/hooks/native-hook-dispatch.mjs', 'native-hook-dispatch.mjs']]) {
    assert.deepEqual(await readFile(path.join(f.root, installed)), await readFile(path.join(repo, 'skill/codex-harness/assets', source)));
  }
});

test('source repair has strict source authority, nearest-root and command grammar', async t => {
  const f = await fixture(t), command = `node "${cli}" repair --preview`;
  assert.equal(hookRepairCommand(repairInput(f, command), f.root, path, undefined, f.environment), true);
  for (const suffix of [' --help', ' --json --json', ' --target anywhere', '; node evil.mjs', ' | more', ' && node evil.mjs', ' --expect-plan ' + 'a'.repeat(64)]) {
    assert.equal(hookRepairCommand(repairInput(f, command + suffix), f.root, path, undefined, f.environment), false, suffix);
  }
  for (const words of [['--preview', '--preview'], ['--expect-plan'], ['--json'], ['--preview', '--replace-reviewed', '.harness/config.json=' + 'a'.repeat(64)], ['--preview', '--help']]) assert.throws(() => repairArguments(words, f.root, path));
  await writeFile(f.policyPath, JSON.stringify({ ...f.policy, enabled: false })); await assert.rejects(f.run(['--preview']), /policy/i);
  await writeFile(f.policyPath, JSON.stringify({ ...f.policy, sourceRoot: f.base })); await assert.rejects(f.run(['--preview']), /authority/i);
  await writeFile(f.policyPath, JSON.stringify(f.policy));
  const nested = path.join(f.root, 'nested'); await mkdir(path.join(nested, '.harness'), { recursive: true });
  await assert.rejects(f.run([f.root, '--preview'], { cwd: nested }), /nearest/i);
  assert.equal(hookRepairCommand(repairInput(f, command, nested), nested, path, undefined, f.environment), false);
  const link = path.join(f.base, 'link');
  try {
    await symlink(f.root, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.run(['--preview'], { cwd: link }), /symbolic/i);
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    // Restricted Windows hosts may prohibit junction creation even in fixtures.
    assert.throws(() => repairRealPath(link, path, { lstatSync: () => ({ isSymbolicLink: () => true }) }), /symbolic/i);
  }
});

test('source repair rejects stale plans, read sets and changed lock authority', async t => {
  const f = await fixture(t), runtime = path.join(f.root, '.harness/run.mjs');
  await rm(runtime); const preview = (await f.run(['--preview'])).result;
  await writeFile(f.policyPath, JSON.stringify({ ...f.policy, reviewedAt: 'changed after preview' }));
  await assert.rejects(f.run(['--expect-plan', preview.planHash]), /Stale/i);
  const newer = (await f.run(['--preview'])).result;
  const sync = (root, options) => syncHarness(root, { ...options, validateRepairAuthority: async plan => {
    await mutateContinuity(f, state => { state.owner = { id: 'distinct-live-worker' }; });
    return options.validateRepairAuthority(plan);
  } });
  await assert.rejects(f.run(['--expect-plan', newer.planHash], { sync }), /distinct worker/);
  await assert.rejects(readFile(runtime), { code: 'ENOENT' });
});

test('source repair respects matching native owners and retired unowned workers', async t => {
  const f = await fixture(t);
  await mutateContinuity(f, state => { state.owner = { id: 'distinct-live-worker' }; });
  await assert.rejects(f.run(['--preview']), /distinct worker/);
  await mutateContinuity(f, state => { state.owner = { id: f.environment.CODEX_THREAD_ID }; });
  assert.ok((await f.run(['--preview'])).result.planHash);
  await mutateContinuity(f, state => { state.owner = null; state.retiredWorkerIds = [...(state.retiredWorkerIds ?? []), f.environment.CODEX_THREAD_ID]; });
  await assert.rejects(f.run(['--preview']), /Retired/);
});

test('pending transfer survives code restoration byte for byte and migration fails closed', async t => {
  const f = await fixture(t);
  await mutateContinuity(f, state => { state.phase = 'awaiting_resume'; state.owner = null; state.handoff = { id: 'pending-transfer-test', summary: 'private packet', next: 'resume only' }; });
  const protectedPaths = ['.harness/config.json', '.harness/features.json', '.harness/continuity.json'];
  const before = await Promise.all(protectedPaths.map(file => readFile(path.join(f.root, file))));
  await rm(path.join(f.root, '.harness/run.mjs'));
  const preview = (await f.run(['--preview'])).result;
  await f.run(['--expect-plan', preview.planHash]);
  assert.deepEqual(await Promise.all(protectedPaths.map(file => readFile(path.join(f.root, file)))), before);
  const configFile = path.join(f.root, '.harness/config.json'), config = JSON.parse(await readFile(configFile));
  delete config.context; await writeFile(configFile, JSON.stringify(config));
  await assert.rejects(f.run(['--preview']), /Pending handoff requires migration/);
});

test('non-Codex repair uses only the explicit matching owner and preserves a pending transfer', async t => {
  const f = await fixture(t), worker = 'claude-agent:source-repair-owner';
  const environment = { ...f.environment, CODEX_THREAD_ID: '', CODEX_SESSION_ID: worker };
  const run = words => f.run(words, { environment });
  await mutateContinuity(f, state => {
    state.owner = { id: worker };
    state.phase = 'awaiting_resume';
    state.handoff = { id: 'pending-manual-repair', summary: 'preserved packet', next: 'resume only' };
  });
  await assert.rejects(run(['--preview']), /distinct worker/);
  await assert.rejects(run(['--preview', '--worker-id', 'distinct-worker']), /distinct worker/);
  for (const flags of [['--worker-id', worker, '--worker-id', worker], ['--worker-id'], ['--worker-id', 'bad worker'], ['--worker-id', '--json']]) {
    await assert.rejects(run(['--preview', ...flags]), /Duplicate|valid worker/);
  }
  const command = `node "${cli}" repair --preview --worker-id ${worker}`;
  assert.equal(hookRepairCommand(repairInput(f, command), f.root, path, undefined, environment), true);
  assert.equal(hookRepairCommand(repairInput(f, command + ` --worker-id ${worker}`), f.root, path, undefined, environment), false);
  assert.equal(hookRepairCommand(repairInput(f, command), f.root, path, undefined, f.environment), false);
  await assert.rejects(f.run(['--preview', '--worker-id', worker]), /conflicts with native identity/);
  const files = ['.harness/config.json', '.harness/features.json', '.harness/continuity.json'];
  const before = await Promise.all(files.map(file => readFile(path.join(f.root, file))));
  await rm(path.join(f.root, '.harness/run.mjs'));
  const preview = (await run(['--preview', '--worker-id', worker])).result;
  await run(['--expect-plan', preview.planHash, '--worker-id', worker]);
  assert.deepEqual(await Promise.all(files.map(file => readFile(path.join(f.root, file)))), before);
  await mutateContinuity(f, state => { state.retiredWorkerIds = [...(state.retiredWorkerIds ?? []), worker]; });
  await assert.rejects(run(['--preview', '--worker-id', worker]), /Retired/);
});

test('v2 bootstrap authenticates repair without replay and leaves normal damaged dispatch fail closed', async t => {
  const f = await fixture(t), bootstrap = buildNativeHookBootstrapV2();
  await rm(path.join(f.root, '.harness/hooks/native-hook-dispatch.mjs'));
  const code = bootstrap.commands['codex/context-guard.mjs'].slice(9, -1);
  const invoke = input => {
    const result = spawnSync(process.execPath, ['-e', code], { cwd: f.root, input: JSON.stringify(input), encoding: 'utf8', env: f.environment });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const input = repairInput(f, `node "${cli}" repair --preview`);
  const pre = invoke(input); assert.equal(pre.hookSpecificOutput.permissionDecision, undefined);
  assert.match(pre.hookSpecificOutput.additionalContext, /Authenticated source/);
  const post = invoke({ ...input, hook_event_name: 'PostToolUse' });
  assert.match(post.hookSpecificOutput.additionalContext, /already completed.*do not replay/);
  const denied = invoke(repairInput(f, 'node ordinary.mjs')); assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
});
