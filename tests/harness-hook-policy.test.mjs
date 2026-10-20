import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initHarness, syncHarness, updateNativeHookTrust } from '../skill/codex-harness/scripts/lib/core.mjs';
import { approveCanonicalHooks, canonicalCodexHooks, enableHookPolicy, disableHookPolicy, readHookPolicy, reviewNativeDefinitions } from '../skill/codex-harness/scripts/lib/hook-policy.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const events = { PreCompact: 'pre_compact', SessionStart: 'session_start', PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', UserPromptSubmit: 'user_prompt_submit', Stop: 'stop' };

test('init and sync require policy opt-in and explicit enrollment; preview remains read-only', async () => fixture(async f => {
  const hookApproval = { home: f.home, runningSource: f.source, rpc: f.rpc, verifySource: async () => {} };
  assert.equal((await updateNativeHookTrust(f.root, { hookApproval, enrollHooks: true })).status, 'disabled');
  await enableHookPolicy({ sourceRoot: f.source, home: f.home, runningSource: f.source });
  assert.equal((await updateNativeHookTrust(f.root, { hookApproval })).status, 'not-enrolled');
  await syncHarness(f.root, { preview: true, enrollHooks: true, hookApproval });
  assert.deepEqual((await readHookPolicy({ home: f.home })).projects, []);
  assert.equal(f.writes, 0);
  const initialized = await initHarness(f.root, { enrollHooks: true, hookApproval });
  assert.equal(initialized.nativeHookApproval.status, 'trusted');
  assert.equal(initialized.nativeHookApproval.approved, 6);
  assert.ok((await readHookPolicy({ home: f.home })).projects.includes(f.root));
  const synced = await syncHarness(f.root, { hookApproval });
  assert.equal(synced.nativeHookApproval.status, 'trusted');
  assert.equal(f.writes, 1);
}));

test('CLI policy commands persist only an explicit canonical source and selected project', async () => fixture(async f => {
  const invoke = (...args) => {
    const result = spawnSync(process.execPath, [path.join(repo, 'bin/agent-harness.mjs'), 'hook-policy', ...args, '--json'], {
      encoding: 'utf8', env: { ...process.env, CODEX_HOME: f.home }
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(invoke('status').enabled, false);
  const policy = invoke('enable', repo, '--project', f.root);
  assert.equal(policy.sourceRoot, repo);
  assert.deepEqual(policy.projects, [f.root]);
  assert.equal(invoke('status').enabled, true);
  assert.equal(invoke('disable').enabled, false);
  assert.equal(invoke('status').enabled, false);
}));
function discovery(root, canonical, state = {}) {
  const sourcePath = path.join(root, '.codex/hooks.json');
  const hooks = Object.entries(canonical.hooks).flatMap(([event, groups]) => groups.flatMap((group, index) => group.hooks.map((hook, hookIndex) => {
    const key = `${sourcePath}:${events[event]}:${index}:${hookIndex}`;
    const currentHash = 'sha256:' + createHash('sha256').update(JSON.stringify({ group, hookIndex })).digest('hex');
    return { key, eventName: event[0].toLowerCase() + event.slice(1), handlerType: hook.type, command: process.platform === 'win32' ? hook.commandWindows ?? hook.command : hook.command, matcher: group.matcher ?? null, timeoutSec: hook.timeout ?? 600, async: hook.async ?? false, statusMessage: hook.statusMessage ?? null, additionalContextLimit: hook.additionalContextLimit ?? null, sourcePath, source: 'project', pluginId: null, enabled: true, isManaged: false, currentHash, trustStatus: state[key]?.trusted_hash === currentHash ? 'trusted' : 'untrusted' };
  })));
  return { data: [{ cwd: root, errors: [], hooks: hooks.map((hook, displayOrder) => ({ ...hook, displayOrder })) }] };
}
async function fixture(callback) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'harness-hook-policy-'));
  const root = path.join(temporary, 'project'), source = path.join(temporary, 'kit'), home = path.join(temporary, 'codex');
  await mkdir(root); await mkdir(source); await mkdir(home);
  await cp(path.join(repo, 'skill'), path.join(source, 'skill'), { recursive: true });
  await mkdir(path.join(source, 'bin')); await mkdir(path.join(source, 'tests'));
  await writeFile(path.join(source, 'package.json'), '{}');
  await initHarness(root);
  const canonical = await canonicalCodexHooks(source);
  let state = { unrelated: { trusted_hash: 'sha256:' + 'e'.repeat(64), customOption: true } }, version = 'v1', writes = 0;
  const calls = [];
  const rpc = async (method, input) => {
    calls.push(method);
    if (method === 'hooks/list') return discovery(root, canonical, state);
    if (method === 'config/read') return { layers: [{ name: { type: 'user', file: path.join(home, 'config.toml') }, version, config: { hooks: { state }, projects: { unchanged: { trust_level: 'untrusted' } } } }] };
    assert.equal(method, 'config/batchWrite'); assert.equal(input.expectedVersion, version);
    assert.equal(input.edits.length, 1); assert.equal(input.edits[0].keyPath, 'hooks.state'); assert.equal(input.edits[0].mergeStrategy, 'replace');
    state = structuredClone(input.edits[0].value); version = 'v2'; writes++;
    return { status: 'ok', version };
  };
  try { await callback({ root, source, home, canonical, rpc, calls, get state() { return state; }, get writes() { return writes; } }); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}

async function evolvedCanonicalSource(f) {
  const templatePath = path.join(f.source, 'skill/codex-harness/assets/codex-hooks.json.template');
  const template = await readFile(templatePath, 'utf8');
  const status = /("statusMessage"\s*:\s*")[^"]*"/;
  const previous = template.replace(status, '$1Persisting an orchestrated-worker packet before compaction"');
  await writeFile(templatePath, previous);
  Object.assign(f.canonical, await canonicalCodexHooks(f.source));
  await writeFile(path.join(f.root, '.codex/hooks.json'), JSON.stringify(f.canonical));
  await enableHookPolicy({ sourceRoot: f.source, home: f.home, runningSource: f.source });
  const hookApproval = { home: f.home, runningSource: f.source, rpc: f.rpc, verifySource: async () => {} };
  await approveCanonicalHooks(f.root, { ...hookApproval, enroll: true });
  await writeFile(templatePath, previous.replace(status, '$1Updated verified canonical packet status"'));
  Object.assign(f.canonical, await canonicalCodexHooks(f.source));
  const core = await import(pathToFileURL(path.join(f.source, 'skill/codex-harness/scripts/lib/core.mjs')).href);
  return { core, hookApproval };
}

test('v2 complete groups migrate to v3 and refresh only exact fixture native trust', async () => fixture(async f => {
  const old = JSON.parse(await readFile(path.join(repo, 'skill/codex-harness/assets/native-hook-bootstrap-v2.json')));
  const current = JSON.parse(await readFile(path.join(repo, 'skill/codex-harness/assets/native-hook-bootstrap-v3.json')));
  let text = JSON.stringify(f.canonical);
  for (const [key, command] of Object.entries(current.commands)) text = text.replaceAll(JSON.stringify(command), JSON.stringify(old.commands[key]));
  const predecessor = JSON.parse(text), hookPath = path.join(f.root, '.codex/hooks.json');
  await writeFile(hookPath, text);
  for (const hook of discovery(f.root, predecessor).data[0].hooks) f.state[hook.key] = { trusted_hash: hook.currentHash };
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  const rpc = async (method, input) => method === 'hooks/list' ? discovery(f.root, JSON.parse(await readFile(hookPath)), f.state) : f.rpc(method, input);
  const core = await import(pathToFileURL(path.join(f.source, 'skill/codex-harness/scripts/lib/core.mjs')).href);
  const result = await core.syncHarness(f.root, { hookApproval: { home: f.home, runningSource: f.source, rpc, verifySource: async () => {} } });
  assert.equal(result.nativeHookApproval.status, 'trusted'); assert.equal(f.writes, 1);
  assert.deepEqual(JSON.parse(await readFile(hookPath)), f.canonical);
  assert.ok(discovery(f.root, f.canonical, f.state).data[0].hooks.every(hook => hook.trustStatus === 'trusted'));
  assert.deepEqual(f.state.unrelated, { trusted_hash: 'sha256:' + 'e'.repeat(64), customOption: true });
}));

test('source-pinned complete predecessor upgrades ordinary sync and refreshes exact native trust', async () => fixture(async f => {
  const { core, hookApproval } = await evolvedCanonicalSource(f);
  const hookPath = path.join(f.root, '.codex/hooks.json');
  const installed = JSON.parse(await readFile(hookPath, 'utf8'));
  installed.operatorSetting = { preserve: true };
  const unrelated = { matcher: '^manual$', hooks: [{ type: 'command', command: 'echo user-hook', timeout: 17 }] };
  installed.hooks.PreCompact.unshift(unrelated);
  await writeFile(hookPath, JSON.stringify(installed));
  const rpc = async (method, input) => method === 'hooks/list'
    ? discovery(f.root, JSON.parse(await readFile(hookPath, 'utf8')), f.state)
    : f.rpc(method, input);
  const preview = await core.syncHarness(f.root, { preview: true, hookApproval: { ...hookApproval, rpc } });
  assert.ok(preview.sourceSet.some(item => item.path === 'migrations/native-hooks-v3/group-identities.json'));
  const result = await core.syncHarness(f.root, { hookApproval: { ...hookApproval, rpc } });
  assert.equal(result.nativeHookApproval.status, 'trusted');
  assert.equal(f.writes, 2);
  const after = JSON.parse(await readFile(hookPath, 'utf8'));
  assert.deepEqual(after.hooks.PreCompact[0], unrelated);
  assert.deepEqual(after.hooks.PreCompact[1], f.canonical.hooks.PreCompact[0]);
  assert.deepEqual(after.operatorSetting, installed.operatorSetting);
  assert.deepEqual(f.state.unrelated, { trusted_hash: 'sha256:' + 'e'.repeat(64), customOption: true });
  assert.equal(f.state[path.join(f.root, '.codex/hooks.json') + ':pre_compact:0:0']?.trusted_hash,
    discovery(f.root, installed).data[0].hooks.find(item => item.key.endsWith(':pre_compact:1:0'))?.currentHash);
}));

test('custom predecessor fields and project inventory cannot authorize canonical transitions', async () => {
  for (const customize of [group => { group.hooks[0].statusMessage = 'operator customized'; }, group => { group.extraOption = true; }, group => { group.hooks[0].timeout = 123; }]) {
    await fixture(async f => {
      const { core, hookApproval } = await evolvedCanonicalSource(f);
      const hookPath = path.join(f.root, '.codex/hooks.json'), installed = JSON.parse(await readFile(hookPath, 'utf8'));
      customize(installed.hooks.PreCompact[0]);
      await writeFile(hookPath, JSON.stringify(installed));
      const inventoryPath = path.join(f.root, '.harness/managed-files.json'), inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
      inventory.canonicalHookPredecessors = installed.hooks;
      await writeFile(inventoryPath, JSON.stringify(inventory));
      await assert.rejects(core.syncHarness(f.root, { hookApproval }), /Customized or duplicated canonical hook requires review/);
      assert.deepEqual(JSON.parse(await readFile(hookPath, 'utf8')), installed);
      assert.equal(f.writes, 1);
    });
  }
});

test('duplicate old groups and old plus new canonical groups require review before sync writes', async () => {
  for (const includeNew of [false, true]) await fixture(async f => {
    const { core, hookApproval } = await evolvedCanonicalSource(f);
    const hookPath = path.join(f.root, '.codex/hooks.json'), installed = JSON.parse(await readFile(hookPath, 'utf8'));
    installed.hooks.PreCompact.push(structuredClone(includeNew ? f.canonical.hooks.PreCompact[0] : installed.hooks.PreCompact[0]));
    const bytes = JSON.stringify(installed);
    await writeFile(hookPath, bytes);
    await assert.rejects(core.syncHarness(f.root, { hookApproval }), /Duplicated canonical hook predecessor requires review/);
    assert.equal(await readFile(hookPath, 'utf8'), bytes);
    assert.equal(f.writes, 1);
  });
});

test('tampered source predecessor manifest cannot authorize installed hooks', async () => fixture(async f => {
  const { core, hookApproval } = await evolvedCanonicalSource(f);
  const hookPath = path.join(f.root, '.codex/hooks.json'), before = await readFile(hookPath, 'utf8');
  await writeFile(path.join(f.source, 'skill/codex-harness/assets/migrations/native-hooks-v3/group-identities.json'), '{"version":1,"groups":[]}');
  await assert.rejects(core.syncHarness(f.root, { hookApproval }), /Canonical hook predecessor identity mismatch/);
  assert.equal(await readFile(hookPath, 'utf8'), before);
  assert.equal(f.writes, 1);
}));

test('hook policy needs explicit source authority and enrollment; disabling is persistent', async () => fixture(async f => {
  await assert.rejects(enableHookPolicy({ sourceRoot: f.source, home: f.home }), /running this command/);
  await enableHookPolicy({ sourceRoot: f.source, home: f.home, runningSource: f.source });
  const options = { home: f.home, runningSource: f.source, rpc: f.rpc, verifySource: async () => {} };
  await assert.rejects(approveCanonicalHooks(f.root, options), /not been explicitly enrolled/);
  assert.equal(f.writes, 0);
  const result = await approveCanonicalHooks(f.root, { ...options, enroll: true });
  assert.equal(result.approved, 6); assert.equal(result.status, 'trusted');
  assert.deepEqual(f.state.unrelated, { trusted_hash: 'sha256:' + 'e'.repeat(64), customOption: true });
  assert.ok((await readHookPolicy({ home: f.home })).projects.includes(f.root));
  await disableHookPolicy({ home: f.home }); assert.equal(await readHookPolicy({ home: f.home }), null);
}));

test('failed verification, source drift, customized install and native option drift leave trust untouched', async () => fixture(async f => {
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  const options = { home: f.home, runningSource: f.source, rpc: f.rpc, verifySource: async () => {} };
  await assert.rejects(approveCanonicalHooks(f.root, { ...options, verifySource: async () => { throw new Error('verification failed'); } }), /verification failed/);
  await assert.rejects(approveCanonicalHooks(f.root, { ...options, verifySource: async () => writeFile(path.join(f.source, 'tests', 'drift.mjs'), '// drift') }), /changed during verification/);
  const hooksPath = path.join(f.root, '.codex/hooks.json'), installed = JSON.parse(await readFile(hooksPath, 'utf8'));
  installed.hooks.Stop[0].hooks[0].timeout = 1;
  await writeFile(hooksPath, JSON.stringify(installed));
  await assert.rejects(approveCanonicalHooks(f.root, options), /Customized/);
  const native = discovery(f.root, f.canonical);
  for (const field of ['key', 'command', 'matcher', 'handlerType', 'eventName', 'timeoutSec', 'async', 'statusMessage', 'additionalContextLimit', 'sourcePath', 'source', 'pluginId', 'enabled', 'isManaged']) {
    const altered = structuredClone(native); altered.data[0].hooks[0][field] = 'changed';
    assert.throws(() => reviewNativeDefinitions(altered, f.root, f.canonical, f.canonical), /Native/);
  }
  assert.equal(f.writes, 0);
}));

test('a successful config response is insufficient; unknown outcomes reread and never replay', async () => fixture(async f => {
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  const options = { home: f.home, runningSource: f.source, verifySource: async () => {} };
  let attempts = 0;
  const ignoredWrite = async (method, input) => method === 'config/batchWrite' ? (++attempts, { status: 'ok' }) : f.rpc(method, input);
  await assert.rejects(approveCanonicalHooks(f.root, { ...options, rpc: ignoredWrite }), /trust confirmation failed/);
  assert.equal(attempts, 1);
  const lostResponse = async (method, input) => {
    const result = await f.rpc(method, input);
    if (method === 'config/batchWrite') throw new Error('transport disconnected');
    return result;
  };
  const recovered = await approveCanonicalHooks(f.root, { ...options, rpc: lostResponse });
  assert.equal(recovered.status, 'trusted'); assert.equal(recovered.recoveredWrite, true);
  assert.equal(f.writes, 1); assert.deepEqual(f.calls.slice(-2), ['config/read', 'hooks/list']);
  await assert.rejects(approveCanonicalHooks(f.root, { ...options, rpc: f.rpc, nativeHookInvocation: true }), /cannot approve themselves/);
}));

test('an authoritative version rejection is classified from unchanged readback without replay', async () => fixture(async f => {
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  let attempts = 0;
  const rpc = async (method, input) => {
    if (method === 'config/batchWrite') { attempts++; throw Object.assign(new Error('version conflict'), { configWriteErrorCode: 'configVersionConflict' }); }
    return f.rpc(method, input);
  };
  await assert.rejects(approveCanonicalHooks(f.root, { home: f.home, runningSource: f.source, verifySource: async () => {}, rpc }), { code: 'HOOK_APPROVAL_NOT_COMMITTED' });
  assert.equal(attempts, 1); assert.equal(f.writes, 0);
  assert.deepEqual(f.calls.slice(-2), ['config/read', 'hooks/list']);
}));

test('timeout and disconnect with unchanged readback remain indeterminate without replay', async () => fixture(async f => {
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  let attempts = 0;
  for (const code of ['NATIVE_RPC_TIMEOUT', 'ECONNRESET']) {
    const rpc = async (method, input) => {
      if (method === 'config/batchWrite') { attempts++; throw Object.assign(new Error('unknown write outcome'), { code }); }
      return f.rpc(method, input);
    };
    await assert.rejects(approveCanonicalHooks(f.root, { home: f.home, runningSource: f.source, verifySource: async () => {}, rpc }), { code: 'HOOK_APPROVAL_INDETERMINATE' });
  }
  assert.equal(attempts, 2); assert.equal(f.writes, 0);
}));

test('a timed-out request can commit after unchanged readback and is never declared uncommitted', async () => fixture(async f => {
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  let attempts = 0, lateWrite, releaseLateWrite;
  const rpc = async (method, input) => {
    if (method === 'config/batchWrite') {
      attempts++;
      lateWrite = new Promise((resolve, reject) => { releaseLateWrite = () => f.rpc(method, input).then(resolve, reject); });
      throw Object.assign(new Error('write request timed out'), { code: 'NATIVE_RPC_TIMEOUT' });
    }
    return f.rpc(method, input);
  };
  await assert.rejects(approveCanonicalHooks(f.root, { home: f.home, runningSource: f.source, verifySource: async () => {}, rpc }), { code: 'HOOK_APPROVAL_INDETERMINATE' });
  assert.equal(f.writes, 0);
  releaseLateWrite();
  await lateWrite;
  assert.equal(f.writes, 1); assert.equal(attempts, 1);
}));

test('committed trust with unrelated config drift remains indeterminate and never replays', async () => fixture(async f => {
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  let attempted = false;
  const rpc = async (method, input) => {
    const result = await f.rpc(method, input);
    if (method === 'config/batchWrite') { attempted = true; throw new Error('lost response'); }
    if (method === 'config/read' && attempted) result.layers[0].config.model = 'concurrently-selected';
    return result;
  };
  await assert.rejects(approveCanonicalHooks(f.root, { home: f.home, runningSource: f.source, verifySource: async () => {}, rpc }), { code: 'HOOK_APPROVAL_INDETERMINATE' });
  assert.equal(f.writes, 1);
}));

test('policy revocation after a committed write prevents recovered approval', async () => fixture(async f => {
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  const rpc = async (method, input) => {
    const result = await f.rpc(method, input);
    if (method === 'config/batchWrite') { await disableHookPolicy({ home: f.home }); throw new Error('lost response'); }
    return result;
  };
  await assert.rejects(approveCanonicalHooks(f.root, { home: f.home, runningSource: f.source, verifySource: async () => {}, rpc }), { code: 'HOOK_APPROVAL_INDETERMINATE' });
  assert.equal(f.writes, 1);
}));

test('changed native discovery order and untrusted project enablement need review', async () => fixture(async f => {
  await enableHookPolicy({ sourceRoot: f.source, projects: [f.root], home: f.home, runningSource: f.source });
  const options = { home: f.home, runningSource: f.source, verifySource: async () => {} };
  const disabled = async (method, input) => {
    const result = await f.rpc(method, input);
    if (method === 'hooks/list') result.data[0].hooks[0].enabled = false;
    return result;
  };
  await assert.rejects(approveCanonicalHooks(f.root, { ...options, rpc: disabled }), /independent user review/);
  assert.equal(f.writes, 0);
  const reordered = async (method, input) => {
    const result = await f.rpc(method, input);
    if (method === 'hooks/list' && f.writes) for (const hook of result.data[0].hooks) hook.displayOrder += 10;
    return result;
  };
  await assert.rejects(approveCanonicalHooks(f.root, { ...options, rpc: reordered }), { code: 'HOOK_APPROVAL_INDETERMINATE' });
  assert.equal(f.writes, 1);
}));
