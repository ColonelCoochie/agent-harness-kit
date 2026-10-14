import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import { initHarness, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';
const exec = promisify(execFile);
const roots = [];
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
async function fixture(name = 'hardening') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-' + name + '-')); roots.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name, scripts: { test: 'node --version' } }));
  await initHarness(root, { name, purpose: 'Audit fixture' });
  for (const args of [['init'], ['config', 'user.email', 'harness@example.test'], ['config', 'user.name', 'Harness Fixture'], ['add', '.'], ['commit', '-m', 'Fixture baseline']]) await exec('git', args, { cwd: root, windowsHide: true });
  await run(root, 'worker-a', 'claim');
  return root;
}
function env(actor, extra = {}) { const value = { ...process.env, ...extra }; if (actor) value.CODEX_THREAD_ID = actor; else delete value.CODEX_THREAD_ID; return value; }
async function run(root, actor, ...args) { return exec(process.execPath, [path.join(root, '.harness/run.mjs'), ...args], { cwd: root, env: env(actor), windowsHide: true, maxBuffer: 1024 * 1024 }); }
async function configure(root, command, timeout = 10000) {
  const file = path.join(root, '.harness/config.json'); const config = await json(file);
  config.verification = { quick: [], full: [command], architecture: [], e2e: [], clean: [] };
  config.policies.commandTimeoutMs = timeout;
  config.completion = { baseLayers: ['full'], alwaysRunWhenConfigured: [], requireAcceptanceCommands: true };
  await save(file, config);
}
async function add(root, command = 'node --version') {
  await run(root, 'worker-a', 'add', 'audit', '--title', 'Audit', '--description', 'Audit fixture', '--criterion', 'Pass', '--command', command, '--allow', '**/*');
  await run(root, 'worker-a', 'start', 'audit');
}
async function stateBytes(root) { return Promise.all(['features.json', 'continuity.json', 'events.jsonl', 'progress.md', 'handoff.md'].map(name => readFile(path.join(root, '.harness', name), 'utf8').catch(() => null))); }
async function hook(root, name, input, actor, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, '.harness/hooks', name), ...args], { cwd: root, env: env(actor), windowsHide: true }); let raw = '', stderr = '';
    child.stdout.on('data', chunk => raw += chunk); child.stderr.on('data', chunk => stderr += chunk); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(raw)) : reject(new Error(stderr))); child.stdin.end(JSON.stringify(input));
  });
}

test('hardening: structured check preserves credential selection and never retries', async () => {
  const root = await fixture(); await writeFile(path.join(root, 'credential.cjs'), "console.log(process.env.OPENAI_API_KEY ? 'PRESENT' : 'MISSING'); process.exit(process.env.OPENAI_API_KEY ? 0 : 2);");
  await configure(root, { command: 'node credential.cjs', credentials: ['openai'] });
  const result = await exec(process.execPath, [path.join(root, '.harness/run.mjs'), 'check', 'full'], { cwd: root, env: env('worker-a', { OPENAI_API_KEY: 'fake-audit-value-123456789' }), windowsHide: true });
  assert.match(result.stdout, /PRESENT/); assert.equal((await json(path.join(root, '.harness/credentials-state.json'))).cursors.openai, 1);
});

test('hardening: credentials redact before output truncation and across chunk and UTF-8 boundaries', async () => {
  const root = await fixture(); const fake = 'fake-credential-' + 'S'.repeat(49);
  await writeFile(path.join(root, 'output.cjs'), "const s=process.env.OPENAI_API_KEY; process.stdout.write(s); process.stdout.write('Z'.repeat(29990)); process.stderr.write('X'.repeat(40000)+'\\n'); setTimeout(()=>{process.stderr.write(s.slice(0,20));setTimeout(()=>{process.stderr.write(s.slice(20)+' é\\n');},20);},20);");
  await configure(root, { command: 'node output.cjs', credentials: ['openai'] }); await add(root);
  await exec(process.execPath, [path.join(root, '.harness/run.mjs'), 'verify', 'audit'], { cwd: root, env: env('worker-a', { OPENAI_API_KEY: fake }), windowsHide: true, maxBuffer: 1024 * 1024 });
  const feature = (await json(path.join(root, '.harness/features.json'))).features[0]; const record = await json(path.join(root, feature.evidence.at(-1)));
  const result = record.commands[0];
  for (const field of ['stdout', 'stderr', 'output']) { assert.ok(!result[field].includes(fake)); assert.ok(!result[field].includes('S'.repeat(10))); }
  assert.match(result.stderr, /REDACTED_ENV/); assert.match(result.stderr, /é/); assert.equal(result.truncated, true); assert.ok(result.originalBytes > 70000);
});

test('hardening: timed-out shell descendants stop before a delayed write', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'child.cjs'), "setTimeout(()=>require('node:fs').writeFileSync('escaped.txt','BAD'),650);");
  await writeFile(path.join(root, 'parent.cjs'), "require('node:child_process').spawn(process.execPath,['child.cjs'],{stdio:'inherit'});setTimeout(()=>{},5000);");
  await configure(root, 'node parent.cjs', 100);
  const began = Date.now(); await assert.rejects(run(root, 'worker-a', 'check', 'full'), error => /timeout/.test(error.stdout)); assert.ok(Date.now() - began < 2500);
  await delay(850); await assert.rejects(readFile(path.join(root, 'escaped.txt')), /ENOENT/);
});

test('hardening: generic secret labels retain pending lexical context across long whitespace', async () => {
  const root = await fixture(); await writeFile(path.join(root, 'generic.cjs'), "process.stdout.write('password= '+' '.repeat(12000)); setTimeout(()=>process.stdout.write('OPAQUE-FIXTURE-PASSWORD\\n'),30); process.stderr.write('authorization: bearer '+' '.repeat(12000));setTimeout(()=>process.stderr.write('OPAQUE-FIXTURE-BEARER\\n'),30);");
  await configure(root, 'node generic.cjs'); const result = await run(root, 'worker-a', 'check', 'full');
  assert.doesNotMatch(result.stdout, /OPAQUE-FIXTURE-PASSWORD|OPAQUE-FIXTURE-BEARER/); assert.match(result.stdout, /REDACTED/);
});

test('hardening: sync preserves customized canonical additions', async () => {
  const root = await fixture(); const target = path.join(root, '.harness/loops/goal.md'); const addition = path.join(root, '.harness/loops/goal.v6.addition.md');
  await writeFile(target, '# Local project goal\n'); await syncHarness(root); await writeFile(addition, (await readFile(addition, 'utf8')) + '\nUser review notes: keep these.\n');
  const before = await readFile(addition, 'utf8'); await syncHarness(root); assert.equal(await readFile(addition, 'utf8'), before);
});

test('hardening: sync rejects future config/features/continuity schemas before writes', async () => {
  for (const name of ['config', 'features', 'continuity']) {
    const root = await fixture('future-' + name); const file = path.join(root, '.harness/' + name + '.json'); const value = await json(file); value.version = 999; await save(file, value);
    const before = await stateBytes(root); const config = await readFile(path.join(root, '.harness/config.json'), 'utf8'); const runtime = await readFile(path.join(root, '.harness/run.mjs'), 'utf8');
    await assert.rejects(syncHarness(root), /Unsupported .* schema version: 999/); assert.deepEqual(await stateBytes(root), before); assert.equal(await readFile(path.join(root, '.harness/config.json'), 'utf8'), config); assert.equal(await readFile(path.join(root, '.harness/run.mjs'), 'utf8'), runtime);
  }
});

test('hardening: generated hooks address harness subdirectories and preserve user settings', async () => {
  const outer = await mkdtemp(path.join(os.tmpdir(), 'harness-monorepo-')); roots.push(outer); await exec('git', ['init'], { cwd: outer }); const root = path.join(outer, 'project space'); await mkdir(root);
  await initHarness(root, { name: 'nested', purpose: 'Nested fixture' }); const hooks = await json(path.join(root, '.codex/hooks.json'));
  for (const group of Object.values(hooks.hooks)) for (const entry of group) for (const item of entry.hooks) {
    assert.match(item.command, /HARNESS_HOOK_LAUNCHER_V1/); assert.ok(!item.command.includes(root.replaceAll('\\', '/'))); assert.doesNotMatch(item.commandWindows, /\$projectRoot|git rev-parse/);
  }
  await save(path.join(root, '.claude/settings.json'), { env: { LOCAL_NON_SECRET: 'preserve' }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo custom' }] }] } });
  const before = await readFile(path.join(root, '.claude/settings.json'), 'utf8'); await syncHarness(root); assert.equal(await readFile(path.join(root, '.claude/settings.json'), 'utf8'), before);
  const addition = await json(path.join(root, '.harness/claude-hooks.addition.json')); assert.ok(addition.hooks.SubagentStart); assert.ok(addition.hooks.PreCompact); assert.ok(addition.hooks.SessionStart);
});

test('hardening: portable hook launchers select the relocated nearest harness and upgrade old generated routes', async () => {
  const original = await fixture(); const outer = await mkdtemp(path.join(os.tmpdir(), 'harness-relocation-')); roots.push(outer); const copied = path.join(outer, 'nested project');
  await cp(original, copied, { recursive: true }); await save(path.join(copied, '.harness/continuity.json'), { version: 1, generation: 1, phase: 'working', owner: null, checkpoint: null, handoff: null });
  const file = path.join(copied, '.codex/hooks.json'); const settings = await json(file);
  for (const [event, name] of [['PreCompact', 'precompact-handoff.mjs'], ['SessionStart', 'sessionstart-routing.mjs']]) {
    const hook = settings.hooks[event][0].hooks[0]; hook.command = 'node "' + original.replaceAll('\\', '/') + '/.harness/hooks/' + name + '"' + (event === 'PreCompact' ? ' --platform codex' : ''); hook.commandWindows = hook.command;
  }
  settings.custom = 'preserved'; settings.hooks.SessionStart[0].hooks.push({ type: 'command', command: 'echo user-hook' }); await save(file, settings); await syncHarness(copied);
  const updated = await json(file); assert.equal(updated.custom, 'preserved'); assert.equal(updated.hooks.SessionStart[0].hooks[1].command, 'echo user-hook');
  const command = process.platform === 'win32' ? updated.hooks.SessionStart[0].hooks[0].commandWindows : updated.hooks.SessionStart[0].hooks[0].command;
  const route = await new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: outer, env: env(null), shell: true, windowsHide: true }); let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk); child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr))); child.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', cwd: copied }));
  });
  assert.match(route.hookSpecificOutput.additionalContext, /claim/); assert.doesNotMatch(route.hookSpecificOutput.additionalContext, /Existing worker worker-a/);
});

test('hardening: generated Windows hooks execute paths containing shell interpolation characters', { skip: process.platform !== 'win32' }, async () => {
  const outer = await mkdtemp(path.join(os.tmpdir(), 'harness-shell-path-')); roots.push(outer); const root = path.join(outer, "dollar $HOME tick ` apostrophe ' project"); await mkdir(root);
  await initHarness(root, { name: 'shell-path', purpose: 'Quoting fixture' });
  const settings = await json(path.join(root, '.codex/hooks.json'));
  for (const [name, input] of [['PreCompact', { hook_event_name: 'PreCompact', trigger: 'auto', cwd: root }], ['SessionStart', { hook_event_name: 'SessionStart', source: 'compact', cwd: root }]]) {
    const command = settings.hooks[name][0].hooks[0].commandWindows;
    const result = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: outer, windowsHide: true, env: env(null) }); let stdout = '', stderr = '';
      child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk); child.on('error', reject); child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr))); child.stdin.end(JSON.stringify(input));
    });
    assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).continue, true);
  }
});

test('hardening: Claude hooks isolate identified agents, block main without agent_id, and persist only the owner', async () => {
  const root = await fixture(); await run(root, 'worker-a', 'checkpoint', '--summary', 'Release', '--reason', 'worker_yield');
  const before = await stateBytes(root); const identity = await hook(root, 'claude-worker-identity.mjs', { hook_event_name: 'SubagentStart', agent_id: 'child-7', session_id: 'shared' }, null);
  assert.match(identity.hookSpecificOutput.additionalContext, /claude-agent:child-7/); assert.deepEqual(await stateBytes(root), before);
  await run(root, null, 'claim', '--worker-id', 'claude-agent:child-7'); const owned = await stateBytes(root);
  const payload = { hook_event_name: 'PreCompact', trigger: 'auto', cwd: root, session_id: 'shared' };
  // An identified other agent differs from Claude's actual main, which has no agent_id.
  assert.equal((await hook(root, 'precompact-handoff.mjs', { ...payload, agent_id: 'other-agent' }, 'foreign-codex', ['--platform', 'claude'])).decision, undefined); assert.deepEqual(await stateBytes(root), owned);
  // Main PreCompact is deliberately inhibited while a child owns work; a shared
  // session_id never proves that this event is the routing parent.
  assert.equal((await hook(root, 'precompact-handoff.mjs', payload, null, ['--platform', 'claude'])).decision, 'block'); assert.deepEqual(await stateBytes(root), owned);
  await mkdir(path.join(root, '.harness/state.lock')); await writeFile(path.join(root, '.harness/state.lock/owner-live.json'), JSON.stringify({ token: 'live', pid: process.pid, acquiredAt: new Date().toISOString() }));
  assert.equal((await hook(root, 'precompact-handoff.mjs', { ...payload, agent_id: 'child-7' }, null, ['--platform', 'claude'])).decision, 'block'); assert.deepEqual(await stateBytes(root), owned);
  await rm(path.join(root, '.harness/state.lock'), { recursive: true });
  assert.deepEqual(await hook(root, 'precompact-handoff.mjs', { ...payload, agent_id: 'child-7' }, 'foreign-codex', ['--platform', 'claude']), {});
  const continuity = await json(path.join(root, '.harness/continuity.json')); assert.equal(continuity.phase, 'awaiting_resume'); assert.equal(continuity.handoff.owner.id, 'claude-agent:child-7');
  assert.deepEqual(await hook(root, 'precompact-handoff.mjs', payload, null, ['--platform', 'claude']), {});
  const parked = await stateBytes(root); const route = await hook(root, 'sessionstart-routing.mjs', { hook_event_name: 'SessionStart', source: 'compact' }, null, ['--platform', 'claude']);
  assert.match(route.hookSpecificOutput.additionalContext, /fresh non-fork Claude Agent/); assert.match(route.hookSpecificOutput.additionalContext, /--worker-id/); assert.deepEqual(await stateBytes(root), parked);
});

test('hardening: checkpoint validates UTF-8 entries and aggregate budgets before state writes', async () => {
  const root = await fixture(); const before = await stateBytes(root);
  for (const args of [['--decision', 'x'.repeat(29000)], ['--decision', 'é'.repeat(513)], ['--next', 'é'.repeat(1001)], ['--summary', 'é'.repeat(2001)], Array.from({ length: 20 }, () => ['--decision', 'x'.repeat(1000)]).flat()]) {
    await assert.rejects(run(root, 'worker-a', 'checkpoint', '--summary', 'Checkpoint', ...args), /bytes|budget/); assert.deepEqual(await stateBytes(root), before);
  }
  await run(root, 'worker-a', 'checkpoint', '--summary', 'é'.repeat(2000), '--next', 'Proceed', '--decision', 'é'.repeat(512)); const projection = JSON.parse((await run(root, 'worker-a', 'bootstrap', '--json')).stdout); assert.ok(Buffer.byteLength(JSON.stringify(projection)) < 32768);
});

test('hardening: abandoned owner recovery is expected-owner audited, explicit and preserves packet', async () => {
  const root = await fixture(); await run(root, 'worker-a', 'checkpoint', '--summary', 'Saved before worker disappeared', '--next', 'Continue'); const before = await stateBytes(root);
  for (const args of [['--expected-owner', 'worker-a', '--reason', 'Stopped'], ['--expected-owner', 'worker-other', '--reason', 'Stopped', '--confirmed-terminated']]) { await assert.rejects(run(root, 'recovery-actor', 'recover', ...args), /confirmed-terminated|expected owner mismatch/); assert.deepEqual(await stateBytes(root), before); }
  const packet = (await json(path.join(root, '.harness/continuity.json'))).checkpoint;
  await run(root, 'recovery-actor', 'recover', '--expected-owner', 'worker-a', '--reason', 'Host confirms worker terminated', '--confirmed-terminated');
  const recovered = await json(path.join(root, '.harness/continuity.json')); assert.equal(recovered.owner, null); assert.deepEqual(recovered.checkpoint, packet); assert.ok(recovered.retiredWorkerIds.includes('worker-a')); assert.equal(recovered.lastRecovery.formerOwner.id, 'worker-a');
  await assert.rejects(run(root, 'worker-a', 'claim'), /Retired/); await run(root, 'worker-b', 'claim'); assert.equal((await json(path.join(root, '.harness/continuity.json'))).owner.id, 'worker-b');
});

test('hardening: checkpoint preflights both selected and default WIP bootstrap before writes', async () => {
  const root = await fixture(); const configPath = path.join(root, '.harness/config.json'); const config = await json(configPath); config.policies.wipLimit = 2; await save(configPath, config);
  await run(root, 'worker-a', 'add', 'large', '--title', 'Large', '--description', 'Large contract', '--criterion', 'Pass', '--command', 'node --version ' + 'A'.repeat(28500), '--allow', '**/*'); await run(root, 'worker-a', 'start', 'large');
  await add(root); const before = await stateBytes(root);
  await assert.rejects(run(root, 'worker-a', 'checkpoint', '--summary', 'S'.repeat(4000), '--next', 'Continue'), /bootstrap exceeds 32 KiB/); assert.deepEqual(await stateBytes(root), before);
});

test('hardening: long frozen feature text yields and transfers with bounded UTF-8 display projections', async () => {
  for (const boundary of ['checkpoint', 'handoff']) {
    const root = await fixture(); await run(root, 'worker-a', 'add', 'long', '--title', 'é'.repeat(200), '--description', 'é'.repeat(5000), '--criterion', 'Pass', '--command', 'node --version', '--allow', '**/*'); await run(root, 'worker-a', 'start', 'long');
    const feature = (await json(path.join(root, '.harness/features.json'))).features[0];
    await run(root, 'worker-a', boundary, '--summary', 'Boundary', ...(boundary === 'checkpoint' ? ['--reason', 'worker_yield'] : []));
    const continuity = await json(path.join(root, '.harness/continuity.json')); const packet = continuity.checkpoint;
    assert.ok(Buffer.byteLength(packet.activeFeatures[0].title) <= 200); assert.ok(Buffer.byteLength(packet.activeFeatures[0].description) <= 2000); assert.ok(Buffer.byteLength(packet.next) <= 2000); assert.deepEqual((await json(path.join(root, '.harness/features.json'))).features[0], feature);
  }
});

test.after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });
