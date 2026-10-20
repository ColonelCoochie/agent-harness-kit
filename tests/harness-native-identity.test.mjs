import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initHarness, planSync, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';
import { codexHookIdentity, CODEX_SESSION_HEADER_LIMIT } from '../skill/codex-harness/assets/native-hook-identity.mjs';
import { hookRepairCommand } from '../skill/codex-harness/assets/hook-recovery.mjs';

const execute = promisify(execFile), temporary = [];
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCli = path.join(sourceRoot, 'bin/agent-harness.mjs');
const homes = new Map();
const repairCommand = args => `node "${sourceCli}" repair ${args.join(' ')}`;
const fixtureEnv = root => ({ ...process.env, CODEX_HOME: homes.get(root) ?? process.env.CODEX_HOME });
const id = '01a141eb-827c-7ba2-975b-2f275469bc3f';
const other = '01a141eb-827c-7ba2-975b-2f275469bc30';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(name, initialized = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-native-' + name + '-')); temporary.push(root);
  await mkdir(path.join(root, '.harness'));
  if (initialized) {
    const home = path.join(root, 'test-home'); await mkdir(home); homes.set(root, home);
    await writeFile(path.join(root, 'README.md'), '# Native repair fixture\n');
    await initHarness(root, { name, purpose: 'Native identity and independent repair fixture', hookApproval: { home } });
    await writeFile(path.join(home, 'agent-harness-hook-policy.json'), JSON.stringify({ version: 1, enabled: true, authority: 'explicit-canonical-kit-location', sourceRoot, projects: [root] }));
  }
  return root;
}
function header(root, bytes, payload = {}) {
  const record = { type: 'session_meta', payload: { id, cwd: root, base_instructions: '', ...payload } };
  const extra = bytes - Buffer.byteLength(JSON.stringify(record));
  assert.ok(extra >= 0); record.payload.base_instructions = 'x'.repeat(extra);
  const value = JSON.stringify(record); assert.equal(Buffer.byteLength(value), bytes); return value;
}
async function transcript(root, text) {
  const file = path.join(root, 'rollout-2026-10-15T23-24-28-' + id + '.jsonl'); await writeFile(file, text); return file;
}
function nativeHook(root, event, input = {}, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, '.harness/hooks/context-guard.mjs'), '--platform', 'codex'], { cwd: root, windowsHide: true, env: { ...fixtureEnv(root), CODEX_THREAD_ID: '', ...environment } });
    let output = '', error = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => error += data);
    child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0, error); resolve(JSON.parse(output)); } catch (failure) { reject(failure); } });
    child.stdin.end(JSON.stringify({ cwd: root, hook_event_name: event, ...input }));
  });
}
async function launcher(root, event, input = {}, platform = 'codex', timeout = 0, environment = {}) {
  const settings = JSON.parse(await readFile(path.join(root, platform === 'claude' ? '.claude/settings.json' : '.codex/hooks.json')));
  const command = settings.hooks[event][0].hooks[0].command;
  assert.ok(command.startsWith('node -e "') && command.endsWith('"'));
  const script = command.slice('node -e "'.length, -1);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { cwd: root, windowsHide: true, env: { ...fixtureEnv(root), CODEX_THREAD_ID: '', ...environment } });
    const timer = timeout ? setTimeout(() => { child.kill(); reject(new Error('Native launcher timed out')); }, timeout) : null;
    let output = '', error = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => error += data);
    child.on('error', failure => { clearTimeout(timer); reject(failure); }); child.on('close', code => { clearTimeout(timer); try { assert.equal(code, 0, error); resolve(JSON.parse(output)); } catch (failure) { reject(failure); } });
    child.stdin.end(JSON.stringify({ cwd: root, hook_event_name: event, ...input }));
  });
}
async function run(root, relative, args, actor = 'parent') {
  try { const result = await execute(process.execPath, [path.isAbsolute(relative) ? relative : path.join(root, relative), ...args], { cwd: root, windowsHide: true, env: { ...fixtureEnv(root), CODEX_THREAD_ID: actor } }); return { code: 0, ...result }; }
  catch (failure) { return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr }; }
}
async function repairThroughHooks(root, args) {
  // Recorded installed-host envelope: tool_name Bash + tool_input.command.
  const input = { tool_name: 'Bash', tool_input: { command: repairCommand(args) } };
  const before = await launcher(root, 'PreToolUse', input);
  assert.notEqual(before.hookSpecificOutput?.permissionDecision, 'deny');
  assert.notEqual(before.continue, false);
  const result = await run(root, sourceCli, ['repair', ...args], 'worker');
  const after = await launcher(root, 'PostToolUse', { ...input, tool_response: result });
  assert.notEqual(after.continue, false, 'Repair results must reach the next autonomous step');
  assert.match(after.hookSpecificOutput.additionalContext, /already completed/);
  return result;
}
const tool = cmd => ({ tool_name: 'exec_command', tool_input: { cmd } });

test('full native launcher identifies root and descendant sessions with matching native and transcript identities', async () => {
  const root = await fixture('descendant-launcher', true);
  const nested = path.join(root, 'src', 'nested'); await mkdir(nested, { recursive: true });
  assert.equal((await run(root, '.harness/run.mjs', ['claim'], id)).code, 0);
  for (const cwd of [root, path.dirname(nested), nested]) {
    const transcript_path = await transcript(root, header(root, 2048, { cwd }) + '\n');
    for (const native of ['', id]) {
      const response = await launcher(root, 'PreToolUse', { cwd: nested, transcript_path, ...tool('node ordinary.mjs') }, 'codex', 0, { CODEX_THREAD_ID: native });
      assert.notEqual(response.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(response));
      assert.notEqual(response.continue, false);
      assert.equal(await codexHookIdentity({ transcript_path }, root, { CODEX_THREAD_ID: native }), id);
    }
  }
});

test('full native launcher rejects unrelated, distinct nested, relative and symlink session roots', async () => {
  const root = await fixture('rejected-roots', true), unrelated = await fixture('unrelated-root');
  const nested = path.join(root, 'nested'); await mkdir(path.join(nested, '.harness'), { recursive: true });
  const cases = [unrelated, nested, 'src'];
  const link = path.join(root, 'linked-project');
  try { await symlink(unrelated, link, process.platform === 'win32' ? 'junction' : 'dir'); cases.push(link); }
  catch (error) { if (error.code !== 'EPERM') throw error; }
  for (const cwd of cases) {
    const transcript_path = await transcript(root, header(root, 2048, { cwd }) + '\n');
    await assert.rejects(codexHookIdentity({ transcript_path }, root, {}), /project does not match/);
    const response = await launcher(root, 'PreToolUse', { transcript_path, ...tool('node ordinary.mjs') }, 'codex', 0, { CODEX_THREAD_ID: id });
    assert.equal(response.hookSpecificOutput?.permissionDecision, 'deny', cwd);
    assert.match(response.hookSpecificOutput.permissionDecisionReason, /project does not match/);
  }
  const transcript_path = await transcript(root, header(root, 2048) + '\n');
  assert.equal((await launcher(root, 'PreToolUse', { transcript_path, ...tool('node ordinary.mjs') }, 'codex', 0, { CODEX_THREAD_ID: other })).hookSpecificOutput.permissionDecision, 'deny');
});

test('native identity reads actual host-sized and much larger complete first records', async () => {
  const root = await fixture('headers');
  for (const bytes of [16383, 16384, 16385, 23385, 262144, CODEX_SESSION_HEADER_LIMIT]) {
    const file = await transcript(root, header(root, bytes) + '\n' + 'not identity metadata\n'.repeat(10000));
    assert.equal(await codexHookIdentity({ transcript_path: file }, root, {}), id, 'header bytes ' + bytes);
  }
  const unicode = JSON.stringify({ type: 'session_meta', payload: { id, cwd: root, base_instructions: '🧭'.repeat(20000) } });
  assert.equal(await codexHookIdentity({ transcript_path: await transcript(root, unicode + '\r\n') }, root, {}), id);
});

test('native identity distinguishes incomplete, oversized and malformed records', async () => {
  const root = await fixture('bounds');
  // Leave room for long workspace-local temporary paths in the short record.
  for (const bytes of [512, 23385, CODEX_SESSION_HEADER_LIMIT]) {
    const file = await transcript(root, header(root, bytes));
    await assert.rejects(codexHookIdentity({ transcript_path: file }, root, {}), /incomplete:.*EOF/);
  }
  for (const ending of ['', '\n']) {
    const file = await transcript(root, header(root, CODEX_SESSION_HEADER_LIMIT + 1) + ending);
    await assert.rejects(codexHookIdentity({ transcript_path: file }, root, {}), /exceeds the 1 MiB identity bound/);
  }
  await assert.rejects(codexHookIdentity({ transcript_path: await transcript(root, '{invalid\n') }, root, {}), SyntaxError);
});

test('large-header handling preserves filename, project and native ownership identity checks', async () => {
  const root = await fixture('validation');
  for (const payload of [{ id: other }, { cwd: path.dirname(root) }]) {
    const file = await transcript(root, header(root, 23385, payload) + '\n');
    await assert.rejects(codexHookIdentity({ transcript_path: file }, root, {}), /does not match/);
  }
  const file = await transcript(root, header(root, 23385) + '\n');
  await assert.rejects(codexHookIdentity({ transcript_path: file }, root, { CODEX_THREAD_ID: other }), /conflicts/);
  await assert.rejects(codexHookIdentity({ transcript_path: 'relative.jsonl' }, root, {}), /absolute local/);
  assert.equal(await codexHookIdentity({}, root, { CODEX_THREAD_ID: id }), id);
});

test('repair command allowlist rejects installed executables, shell programs, extra flags and other projects', async () => {
  const root = await fixture('allowlist', true);
  const allowed = input => hookRepairCommand(input, root, path, undefined, { ...fixtureEnv(root), CODEX_THREAD_ID: '' });
  const valid = [repairCommand(['--preview']), repairCommand(['--preview', '--json']), repairCommand(['--expect-plan', 'a'.repeat(64)])];
  for (const command of valid) assert.equal(allowed({ cwd: root, ...tool(command) }), true);
  for (const command of [
    'node .harness/repair.mjs sync', 'node .harness/repair.mjs health --json --evil',
    'node .harness/repair.mjs health; whoami', 'node .harness/repair.mjs health && whoami',
    'node .harness/repair.mjs health $(whoami)', 'node .harness/repair.mjs health \u0060whoami\u0060',
    'node .harness/repair.mjs sync --expect-plan ' + 'a'.repeat(64) + ' --target other',
    'node ../other/.harness/repair.mjs health', 'node .harness/run.mjs recover',
    ...['health --json', 'sync --preview --json', 'sync --expect-plan ' + 'a'.repeat(64)].map(args => 'node .harness/repair.mjs ' + args),
    ...['; whoami', ' && whoami', ' --evil', ' --target other'].map(suffix => valid[0] + suffix)
  ]) assert.equal(allowed({ cwd: root, ...tool(command) }), false, command);
  for (const command of valid) assert.equal(allowed({ cwd: root, tool_name: 'Bash', tool_input: { command } }), true);
  for (const command of ['node .harness/repair.mjs health; whoami', valid[0] + ' --target other']) assert.equal(allowed({ cwd: root, tool_name: 'Bash', tool_input: { command } }), false);
  assert.equal(allowed({ cwd: root, tool_name: 'BASH', tool_input: { command: valid[0] } }), false);
  assert.equal(allowed({ cwd: root, tool_name: 'arbitrary_tool', tool_input: tool(valid[0]).tool_input }), false);
  assert.equal(allowed({ cwd: root, ...tool(valid[0]), tool_input: { cmd: valid[0], workdir: path.dirname(root) } }), false);
});

test('identity/config/import faults leave genuine prompts and independent repair available', async () => {
  const root = await fixture('faults', true), identity = path.join(root, '.harness/hooks/native-hook-identity.mjs');
  const originalIdentity = await readFile(identity), config = path.join(root, '.harness/config.json'), originalConfig = await readFile(config);
  const file = await transcript(root, header(root, 23385, { cwd: path.dirname(root) }) + '\n');
  for (const fault of ['identity', 'syntax', 'missing', 'config', 'accounting-import']) {
    if (fault === 'syntax') await writeFile(identity, 'export const = syntax failure;');
    if (fault === 'missing') await rm(identity);
    if (fault === 'config') await writeFile(config, '{invalid');
    const accounting = path.join(root, '.harness/context-budget.mjs'), originalAccounting = await readFile(accounting);
    if (fault === 'accounting-import') await writeFile(accounting, 'export const = syntax failure;');
    const input = fault === 'identity' ? { transcript_path: file } : {};
    const prompt = await nativeHook(root, 'UserPromptSubmit', input);
    assert.notEqual(prompt.decision, 'block', fault); assert.match(prompt.hookSpecificOutput.additionalContext, /guard failed/);
    assert.equal((await nativeHook(root, 'UserPromptSubmit', { ...input, content_item_kinds: ['goal.internal_context'] })).decision, 'block');
    assert.equal((await nativeHook(root, 'PreToolUse', { ...input, ...tool('node -e 1') })).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal((await nativeHook(root, 'PreToolUse', { ...input, ...tool('node .harness/repair.mjs health --json') })).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal((await nativeHook(root, 'PreToolUse', { ...input, ...tool(repairCommand(['--preview', '--json'])) })).hookSpecificOutput.permissionDecision, undefined);
    await writeFile(identity, originalIdentity); await writeFile(config, originalConfig); await writeFile(accounting, originalAccounting);
  }
});

test('launcher recovers from broken adapter syntax, scoped sync repairs bytes and keeps owner state', async () => {
  const root = await fixture('repair-e2e', true);
  assert.equal((await run(root, '.harness/run.mjs', ['claim'], 'worker')).code, 0);
  const preserved = ['.harness/continuity.json', '.harness/features.json', '.harness/handoff.md'];
  await writeFile(path.join(root, '.harness/evidence/operator-sentinel.json'), '{"preserve":true}\n'); preserved.push('.harness/evidence/operator-sentinel.json');
  const before = new Map(await Promise.all(preserved.map(async file => [file, hash(await readFile(path.join(root, file)))])));
  const settings = JSON.parse(await readFile(path.join(root, '.codex/hooks.json')));
  settings.hooks.PreToolUse.push({ hooks: [{ type: 'command', command: 'echo unrelated-user-hook' }] });
  await writeFile(path.join(root, '.codex/hooks.json'), JSON.stringify(settings));
  const broken = '.harness/hooks/context-guard.mjs'; await writeFile(path.join(root, broken), 'export const = broken native adapter;');
  const brokenHash = hash(await readFile(path.join(root, broken)));
  const prompt = await launcher(root, 'UserPromptSubmit'); assert.notEqual(prompt.decision, 'block'); assert.match(prompt.hookSpecificOutput.additionalContext, /guard failed/);
  assert.equal((await launcher(root, 'UserPromptSubmit', { content_item_kinds: ['goal.internal_context'] })).decision, 'block');
  assert.equal((await launcher(root, 'PreToolUse', tool('node -e 1'))).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal((await launcher(root, 'PreToolUse', tool('node .harness/repair.mjs health --json'))).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal((await launcher(root, 'PreToolUse', tool(repairCommand(['--preview', '--json'])))).hookSpecificOutput.permissionDecision, undefined);
  assert.equal((await launcher(root, 'PreCompact', { trigger: 'auto' })).continue, false);
  const health = await run(root, '.harness/repair.mjs', ['health', '--json']); assert.equal(health.code, 0); assert.equal(JSON.parse(health.stdout).files.find(file => file.path === broken).healthy, false);
  const initial = JSON.parse((await repairThroughHooks(root, ['--preview', '--json'])).stdout); assert.equal(initial.blocked, true);
  const replacement = broken + '=' + brokenHash;
  const reviewed = JSON.parse((await repairThroughHooks(root, ['--preview', '--json', '--replace-reviewed', replacement])).stdout); assert.equal(reviewed.blocked, false);
  const stale = await run(root, sourceCli, ['repair', '--json', '--replace-reviewed', replacement, '--expect-plan', 'a'.repeat(64)], 'worker'); assert.notEqual(stale.code, 0); assert.equal(hash(await readFile(path.join(root, broken))), brokenHash);
  const repaired = await repairThroughHooks(root, ['--json', '--replace-reviewed', replacement, '--expect-plan', reviewed.planHash]); assert.equal(repaired.code, 0, repaired.stderr);
  assert.deepEqual(await readFile(path.join(root, broken)), await readFile(new URL('../skill/codex-harness/assets/context-guard.mjs', import.meta.url)));
  for (const [file, expected] of before) assert.equal(hash(await readFile(path.join(root, file))), expected, file);
  assert.ok(JSON.parse(await readFile(path.join(root, '.codex/hooks.json'))).hooks.PreToolUse.some(group => group.hooks?.some(hook => hook.command === 'echo unrelated-user-hook')));
  assert.notEqual((await run(root, '.harness/run.mjs', ['checkpoint', '--summary', 'Intruder', '--next', 'No'], 'parent')).code, 0);
  assert.equal(JSON.parse(await readFile(path.join(root, '.harness/continuity.json'))).owner.id, 'worker');
  assert.equal((await run(root, '.harness/repair.mjs', ['health', '--evil'])).code, 1);
  assert.equal((await run(root, '.harness/repair.mjs', ['sync'])).code, 1);
});

test('sync upgrades the exact predecessor launcher and preserves unrelated wrappers', async () => {
  const root = await fixture('launcher-migration', true);
  const settingsPath = path.join(root, '.codex/hooks.json'), settings = JSON.parse(await readFile(settingsPath));
  const hook = settings.hooks.PreToolUse[0].hooks[0];
  const current = hook.command;
  const legacyScript = "const marker='HARNESS_HOOK_LAUNCHER_V1';const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process');try{const raw=fs.readFileSync(0,'utf8'),input=JSON.parse(raw||'{}');let root=p.resolve(input.cwd||process.cwd());while(!fs.existsSync(p.join(root,'.harness/run.mjs'))){const parent=p.dirname(root);if(parent===root)throw new Error('No nearest harness installation');root=parent;}const result=cp.spawnSync(process.execPath,[p.join(root,'.harness/hooks/context-guard.mjs'),'--platform','codex'],{cwd:root,input:raw,encoding:'utf8',windowsHide:true});if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr||'Hook adapter failed');process.stdout.write(result.stdout||'{}');}catch(e){process.stdout.write(JSON.stringify({continue:false,stopReason:e.message}));}";
  const old = 'node -e ' + String.fromCharCode(34) + legacyScript + String.fromCharCode(34);
  assert.notEqual(old, current);
  hook.command = old; hook.commandWindows = old;
  // A changed command wrapper is deliberately outside the exact migration set.
  settings.hooks.PreToolUse.push({ hooks: [{ type: 'command', command: 'custom-wrapper ' + current }] });
  await writeFile(settingsPath, JSON.stringify(settings));
  await syncHarness(root);
  const upgraded = JSON.parse(await readFile(settingsPath));
  assert.equal(upgraded.hooks.PreToolUse[0].hooks[0].command, current);
  assert.equal(upgraded.hooks.PreToolUse[0].hooks[0].commandWindows, current);
  assert.equal(upgraded.hooks.PreToolUse[1].hooks[0].command, 'custom-wrapper ' + current);
  assert.equal((await planSync(root)).blocked, false);
});

test('sync preserves current user-formatted hook configuration byte for byte', async () => {
  const root = await fixture('current-host-config', true);
  for (const relative of ['.codex/hooks.json', '.claude/settings.json']) {
    const file = path.join(root, relative), value = JSON.parse(await readFile(file));
    await writeFile(file, JSON.stringify(value));
  }
  const before = new Map(await Promise.all(['.codex/hooks.json', '.claude/settings.json'].map(async relative => [relative, await readFile(path.join(root, relative))])));
  for (let i = 0; i < 2; i++) {
    await syncHarness(root);
    for (const [relative, bytes] of before) assert.deepEqual(await readFile(path.join(root, relative)), bytes);
  }
});

test('independent health never declares damaged inventory healthy', async () => {
  const root = await fixture('health-metadata', true);
  const valid = JSON.parse(await readFile(path.join(root, '.harness/managed-files.json'), 'utf8'));
  const healthy = await run(root, '.harness/repair.mjs', ['health', '--json']);
  assert.equal(healthy.code, 0, healthy.stderr);
  for (const version of [1, 2, 3]) assert.equal(JSON.parse(healthy.stdout).files.find(file => file.path === '.harness/hooks/native-hook-bootstrap-v' + version + '.json').healthy, true);
  for (const value of [{}, { version: 1, files: {} }, { version: 2, files: {} }, { version: 1, files: { '.harness/run.mjs': 'malformed' } }]) {
    await writeFile(path.join(root, '.harness/managed-files.json'), JSON.stringify(value));
    const result = await run(root, '.harness/repair.mjs', ['health', '--json']);
    assert.equal(result.code, 1); assert.match(result.stderr, /health is indeterminate/);
  }
  valid.files['.harness/hooks/untrusted.json'] = 'a'.repeat(64);
  await writeFile(path.join(root, '.harness/managed-files.json'), JSON.stringify(valid));
  const result = await run(root, '.harness/repair.mjs', ['health', '--json']);
  assert.equal(result.code, 1); assert.match(result.stderr, /Invalid managed executable path/);
});

test('independent repair survives a missing runtime entrypoint and hook adapter', async () => {
  const root = await fixture('missing-entrypoint', true);
  assert.equal((await run(root, '.harness/run.mjs', ['claim'], 'worker')).code, 0);
  const preserved = ['.harness/continuity.json', '.harness/features.json', '.harness/handoff.md'];
  const before = new Map(await Promise.all(preserved.map(async file => [file, hash(await readFile(path.join(root, file)))])));
  await rm(path.join(root, '.harness/run.mjs'));
  await rm(path.join(root, '.harness/hooks/context-guard.mjs'));
  for (const platform of ['codex', 'claude']) {
    assert.notEqual((await launcher(root, 'PreToolUse', tool(repairCommand(['--preview', '--json'])), platform)).hookSpecificOutput.permissionDecision, 'deny');
    assert.match((await launcher(root, 'PostToolUse', tool(repairCommand(['--preview', '--json'])), platform)).hookSpecificOutput.additionalContext, /already completed/);
    assert.equal((await launcher(root, 'PreToolUse', tool('node .harness/repair.mjs health --json'), platform)).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal((await launcher(root, 'PreToolUse', tool(repairCommand(['--preview', '--json']) + '; node -e 1'), platform)).hookSpecificOutput.permissionDecision, 'deny');
  }
  const health = await run(root, '.harness/repair.mjs', ['health', '--json']);
  assert.equal(health.code, 0, health.stderr);
  assert.equal(JSON.parse(health.stdout).files.find(file => file.path === '.harness/run.mjs').healthy, false);
  const preview = await repairThroughHooks(root, ['--preview', '--json']);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout); assert.equal(plan.blocked, false);
  const repaired = await repairThroughHooks(root, ['--json', '--expect-plan', plan.planHash]);
  assert.equal(repaired.code, 0, repaired.stderr);
  assert.deepEqual(await readFile(path.join(root, '.harness/run.mjs')), await readFile(new URL('../skill/codex-harness/assets/project-runtime.mjs', import.meta.url)));
  for (const [file, expected] of before) assert.equal(hash(await readFile(path.join(root, file))), expected, file);
});

test('exact repair commands bypass malformed and stalled adapters on both hosts', async () => {
  const root = await fixture('independent-adapter', true);
  const marker = path.join(root, '.harness/adapter-invoked');
  for (const payload of ["process.stdout.write('invalid hook JSON');", 'setTimeout(() => {}, 1000);']) {
    await writeFile(path.join(root, '.harness/hooks/context-guard.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'invoked'); ${payload}`);
    for (const platform of ['codex', 'claude']) {
      for (const event of ['PreToolUse', 'PostToolUse']) {
        const result = await launcher(root, event, tool(repairCommand(['--preview', '--json'])), platform, 3000);
        assert.notEqual(result.hookSpecificOutput.permissionDecision, 'deny');
        assert.match(result.hookSpecificOutput.additionalContext, /Authenticated source harness repair command routed without installed code/);
      }
    }
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  }
});

test('sync upgrades exact earlier recovery launchers while preserving custom hooks', async () => {
  const root = await fixture('launcher-upgrade', true);
  const predecessor = JSON.parse(await readFile(path.join(sourceRoot, 'skill/codex-harness/assets/native-hook-bootstrap-v1.json'), 'utf8'));
  for (const file of ['.codex/hooks.json', '.claude/settings.json']) {
    const settings = JSON.parse(await readFile(path.join(root, file)));
    const hook = settings.hooks.PreToolUse[0].hooks[0], current = hook.command;
    const platform = file.startsWith('.codex') ? 'codex' : 'claude';
    hook.command = predecessor.legacy[platform + '/context-guard.mjs'][0];
    assert.notEqual(hook.command, current);
    settings.hooks.PreToolUse.push({ hooks: [{ type: 'command', command: 'echo custom hook' }] });
    await writeFile(path.join(root, file), JSON.stringify(settings));
    await syncHarness(root, {});
    const updated = JSON.parse(await readFile(path.join(root, file)));
    assert.equal(updated.hooks.PreToolUse[0].hooks[0].command, current);
    assert.equal(updated.hooks.PreToolUse.at(-1).hooks[0].command, 'echo custom hook');
  }
});

test.after(async () => { for (const root of temporary) await rm(root, { recursive: true, force: true }); });
