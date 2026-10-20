import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { initHarness, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';
import { CONTEXT_DEFAULTS, contextObservation, contextPolicy, evaluateContext, transcriptMetadata } from '../skill/codex-harness/assets/context-budget.mjs';
import { assertClosure, assertNoNodeShadow, guardAuthorityRpc } from '../scripts/source-context-performance-authority.mjs';

test('SOURCE proof latches post-write authority failure while retaining transport recovery', async () => {
  let writes=0,checks=0;
  const failure=new Error('closure drift after commit');
  const guarded=guardAuthorityRpc(async()=>{writes++;return {committed:true};},async()=>{if(++checks===2) throw failure;});
  await assert.rejects(guarded.rpc('config/batchWrite',{}),error=>error===failure);
  await assert.rejects(guarded.rpc('config/read',{}),error=>error===failure);
  await assert.rejects(guarded.validate(),error=>error===failure);
  assert.equal(writes,1);
  const recovered=guardAuthorityRpc(async method=>{if(method==='config/batchWrite') throw new Error('transport outcome unknown');return {readback:true};},async()=>{});
  await assert.rejects(recovered.rpc('config/batchWrite',{}),/transport outcome unknown/);
  assert.deepEqual(await recovered.rpc('config/read',{}),{readback:true});
  let rejectedChecks=0;
  const rejectedWrite=guardAuthorityRpc(async()=>{throw new Error('transport outcome unknown');},async()=>{if(++rejectedChecks===2) throw failure;});
  await assert.rejects(rejectedWrite.rpc('config/batchWrite',{}),error=>error===failure);
  await assert.rejects(rejectedWrite.rpc('config/read',{}),error=>error===failure);
});

test('SOURCE proof binds optional absence and rejects case-insensitive cwd Node shadowing', () => {
  const absent={'.harness/optional.json':{path:'.harness/optional.json',absent:true}};
  assertClosure(absent,absent);
  assert.throws(()=>assertClosure({'.harness/optional.json':{path:'.harness/optional.json',bytes:0,sha256:'0'.repeat(64)}},absent),/Gate input changed/);
  assert.deepEqual(assertNoNodeShadow(['README.md'],['.COM','.EXE','.BAT','.CMD']),['node','node.bat','node.cmd','node.com','node.exe']);
  for(const name of ['NODE.EXE','node.cmd','Node','node.custom']) assert.throws(()=>assertNoNodeShadow([name],['.COM','.EXE','.BAT','.CMD','.CUSTOM']),/Cwd shadows gate Node/);
});

const execute = promisify(execFile);
const temporary = [];
const pass = 'node -e "process.exit(0)"';
async function fixture(name, configure = () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-context-' + name + '-'));
  temporary.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name, scripts: { test: pass } }));
  await writeFile(path.join(root, 'README.md'), '# Fixture\n');
  await initHarness(root, { name, purpose: 'Context accounting fixture' });
  const config = JSON.parse(await readFile(path.join(root, '.harness/config.json')));
  configure(config);
  await writeFile(path.join(root, '.harness/config.json'), JSON.stringify(config));
  for (const args of [['init'], ['config', 'user.email', 'fixture@example.test'], ['config', 'user.name', 'Fixture'], ['add', '.'], ['commit', '-m', 'initial']]) await execute('git', args, { cwd: root, windowsHide: true });
  return root;
}
async function runtime(root, actor, ...args) {
  try { return { code: 0, ...await execute(process.execPath, [path.join(root, '.harness/run.mjs'), ...args], { cwd: root, windowsHide: true, env: { ...process.env, CODEX_THREAD_ID: actor } }) }; }
  catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
}
async function hook(root, actor, input, platform = 'codex', environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, '.harness/hooks/context-guard.mjs'), '--platform', platform], { cwd: root, windowsHide: true, env: { ...process.env, CODEX_THREAD_ID: actor, ...environment } });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject); child.on('close', code => { if (code) reject(new Error(error)); else { try { resolve(JSON.parse(output)); } catch { reject(new Error(output + error)); } } });
    child.stdin.end(JSON.stringify({ cwd: root, ...input }));
  });
}
const usage = (tokens = 223457) => ({ timestamp: '2026-10-15T21:03:44Z', type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 475000, last_token_usage: { total_tokens: tokens } } } });
const goal = () => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'DO NOT PERSIST PRIVATE PROMPT ' + 'x'.repeat(6250) }], internal_chat_message_metadata_passthrough: { content_item_kinds: ['goal.internal_context'] } } });
const aborted = () => ({ type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'fixture' } });
const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';

test('context policy keeps conservative defaults and rejects invalid limits', () => {
  assert.equal(contextPolicy().reserveTokens, 24000);
  assert.equal(contextPolicy({ context: { worker: { maxToolCalls: 3 } } }).worker.maxAgeMs, 1200000);
  assert.throws(() => contextPolicy({ context: { pressureRatio: 1 } }));
  assert.equal(contextPolicy().codexCodeModeResultSuppressionConfirmed, false);
  for (const value of ['true', 1, null]) assert.throws(() => contextPolicy({ context: { codexCodeModeResultSuppressionConfirmed: value } }), /boolean/);
  const value = evaluateContext({ role: 'worker', startedAt: new Date(0).toISOString() }, contextPolicy(), 1200000);
  assert.deepEqual(value.reasons, ['actor_age']);
});

test('confirmed Codex suppression charges the exact emitted notice after successful redaction', async () => {
  const root = await fixture('confirmed-delivery', config => { config.context.codexCodeModeResultSuppressionConfirmed = true; });
  const secret = 'fixture-only-secret-quote"slash\\';
  const result = await hook(root, 'parent', { hook_event_name: 'PostToolUse', tool_response: { password: secret, value: 'x'.repeat(1048600) } }, 'codex', { OPENAI_API_KEY: secret });
  assert.equal(result.decision, 'block');
  const budget = await contextObservation(root, { actor: 'parent', role: 'orchestrator', persist: false });
  assert.equal(budget.outputChars, JSON.stringify(result).length);
  assert.equal(budget.pressure, 'ok');
  const files = await readdir(path.join(root, '.harness/logs'));
  assert.equal(files.length, 1);
  const log = await readFile(path.join(root, '.harness/logs', files[0]), 'utf8');
  assert.ok(log.length > 1048576);
  assert.doesNotMatch(log, /fixture-only-secret/);
});

test('unconfirmed Codex and Claude retain raw output pressure and failed persistence cannot reduce it', async () => {
  for (const [platform, confirmed, failLog] of [['codex', false, false], ['claude', true, false], ['codex', true, true]]) {
    const root = await fixture('conservative-' + platform + '-' + failLog, config => { config.context.codexCodeModeResultSuppressionConfirmed = confirmed; });
    if (failLog) await writeFile(path.join(root, '.harness/logs'), 'block directory creation');
    const tool_response = { value: 'x'.repeat(1048600) };
    const result = await hook(root, 'parent', { hook_event_name: 'PostToolUse', agent_id: 'parent', tool_response }, platform);
    const actor = platform === 'claude' ? 'claude-agent:parent' : 'parent';
    const budget = await contextObservation(root, { actor, role: 'orchestrator', persist: false });
    assert.equal(budget.outputChars, JSON.stringify(tool_response).length);
    assert.ok(budget.reasons.includes('outputChars'));
    if (failLog) assert.match(result.stopReason, /context guard failed/);
  }
});

test('failed automatic handoff restores raw output accounting before the failure response', async () => {
  const root = await fixture('failed-delivery', config => {
    config.context.codexCodeModeResultSuppressionConfirmed = true;
    config.context.worker.maxToolCalls = 1;
  });
  assert.equal((await runtime(root, 'worker', 'claim')).code, 0);
  await contextObservation(root, { actor: 'worker', role: 'worker', event: 'PreToolUse' });
  await writeFile(path.join(root, '.harness/run.mjs'), 'process.exit(1);\n');
  const output = { value: 'x'.repeat(1048600) };
  const result = await hook(root, 'worker', { hook_event_name: 'PostToolUse', tool_response: output });
  assert.equal(result.continue, false);
  assert.match(result.stopReason, /handoff persistence failed/);
  const budget = await contextObservation(root, { actor: 'worker', role: 'worker', persist: false });
  assert.equal(budget.outputChars, JSON.stringify(output).length);
  assert.equal(budget.toolCalls, 1);
  assert.ok(budget.reasons.includes('outputChars'));
});

test('an explicitly extended age policy still rotates with unavailable telemetry', () => {
  const value = evaluateContext({ role: 'worker', startedAt: new Date(0).toISOString(), telemetry: { status: 'unavailable' } }, contextPolicy({ context: { worker: { maxAgeMs: 3600000 } } }), 3600001);
  assert.ok(value.reasons.includes('actor_age'));
});

test('validated bootstrap shares full doctor validation and bounded status routing', async () => {
  const root = await fixture('combined-startup');
  await runtime(root, 'worker', 'claim');
  const plain = JSON.parse((await runtime(root, 'worker', 'bootstrap', '--json')).stdout);
  assert.equal(plain.validation, undefined);
  const result = await runtime(root, 'worker', 'bootstrap', '--validate', '--json');
  assert.equal(result.code, 0, result.stderr);
  const combined = JSON.parse(result.stdout);
  assert.deepEqual(combined.counts, plain.counts);
  assert.equal(combined.validation.healthy, true);
  assert.equal(combined.next.action, 'none');
  assert.ok(Buffer.byteLength(result.stdout) <= 32768);
  const integrity = JSON.parse((await runtime(root, 'worker', 'bootstrap', '--validate', '--integrity', '--json')).stdout);
  assert.match(integrity.validation.integrity.hash, /^[a-f0-9]{64}$/);
  assert.ok(integrity.validation.integrity.contentBytes > 0);
  assert.equal((await runtime(root, 'worker', 'bootstrap', '--validate=false', '--json')).code, 1);
  assert.equal((await runtime(root, 'worker', 'bootstrap', '--integrity', '--json')).code, 1);
});

test('validated bootstrap authenticates every baseline and passing evidence with bounded diagnostics', async () => {
  const root = await fixture('combined-corruption');
  await runtime(root, 'worker', 'claim');
  await runtime(root, 'worker', 'add', 'one', '--title', 'One', '--description', 'One behavior', '--criterion', 'One works', '--command', pass, '--allow', '**');
  await runtime(root, 'worker', 'start', 'one');
  await runtime(root, 'worker', 'verify', 'one');
  const file = path.join(root, '.harness/features.json');
  const state = JSON.parse(await readFile(file));
  const original = structuredClone(state.features[0]);
  await writeFile(path.join(root, original.scopeBaselineRef.path), '{}');
  let result = await runtime(root, 'worker', 'bootstrap', '--validate', '--json');
  assert.equal(result.code, 1);
  assert.ok(JSON.parse(result.stdout).validation.errors.some(message => /baseline|digest|hash|blob/i.test(message)));
  state.features[0].evidence = [];
  for (let index = 0; index < 1200; index++) state.features.push({ ...structuredClone(original), id: 'broken-' + index, title: '', scopeBaselineRef: null, evidence: [] });
  await writeFile(file, JSON.stringify(state));
  result = await runtime(root, 'worker', 'bootstrap', '--validate', '--json');
  const combined = JSON.parse(result.stdout);
  assert.equal(result.code, 1);
  assert.equal(combined.validation.healthy, false);
  assert.ok(combined.validation.errors.some(message => /evidence|passing/i.test(message)));
  assert.ok(combined.validation.omitted.errors > 0);
  assert.ok(Buffer.byteLength(result.stdout) <= 32768);
  // Parked routing precedes state/config access and never exposes a packet.
  const continuityFile = path.join(root, '.harness/continuity.json');
  const continuity = JSON.parse(await readFile(continuityFile));
  continuity.phase = 'awaiting_resume'; continuity.handoff = { id: 'parked-test' };
  await writeFile(continuityFile, JSON.stringify(continuity));
  await writeFile(file, 'invalid JSON');
  const parked = JSON.parse((await runtime(root, 'worker', 'bootstrap', '--validate', '--json')).stdout);
  assert.deepEqual(Object.keys(parked), ['continuity']);
});

test('stale usage and 1249 interrupted goals trip pressure without storing prompt bodies', async () => {
  const root = await fixture('stale');
  const transcript = path.join(root, 'transcript.jsonl');
  await writeFile(transcript, jsonl([usage()]));
  await contextObservation(root, { actor: 'parent', role: 'orchestrator', transcriptPath: transcript });
  await appendFile(transcript, jsonl(Array.from({ length: 1249 }, () => [goal(), aborted()]).flat()));
  const value = await contextObservation(root, { actor: 'parent', role: 'orchestrator', transcriptPath: transcript });
  assert.equal(value.pressure, 'rotate');
  assert.ok(value.reasons.includes('interrupted_goal_loop'));
  assert.ok(value.reasons.includes('unmeasured_growth'));
  assert.ok(value.estimatedTokens > 475000);
  for (const file of await readdir(path.join(root, '.harness/context'))) assert.doesNotMatch(await readFile(path.join(root, '.harness/context', file), 'utf8'), /PRIVATE PROMPT/);
});

test('partial and oversized transcript lines do not repeatedly count unchanged bytes', async () => {
  const root = await fixture('partial');
  const transcript = path.join(root, 'partial.jsonl');
  await writeFile(transcript, '{"unfinished":"' + 'x'.repeat(200));
  let state = await transcriptMetadata(transcript);
  for (let index = 0; index < 4; index++) state = await transcriptMetadata(transcript, state);
  assert.equal(state.bytesSinceUsage, (await readFile(transcript)).length);
  await writeFile(transcript, 'x'.repeat(CONTEXT_DEFAULTS.scanBytes + 100));
  state = await transcriptMetadata(transcript, state);
  const bytes = state.bytesSinceUsage;
  state = await transcriptMetadata(transcript, state);
  assert.equal(state.bytesSinceUsage, bytes);
  assert.ok(['uncertain', 'unrecognized'].includes(state.status));
});

test('real user metadata and compaction release goal pressure', async () => {
  const root = await fixture('compact');
  const transcript = path.join(root, 'transcript.jsonl');
  await writeFile(transcript, jsonl(Array.from({ length: 7 }, () => [goal(), aborted()]).flat()));
  let state = await transcriptMetadata(transcript);
  assert.equal(state.interruptedGoals, 7);
  await appendFile(transcript, jsonl([{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'A genuine user recovery prompt' }] } }]));
  state = await transcriptMetadata(transcript, state);
  assert.equal(state.interruptedGoals, 0);
  await appendFile(transcript, jsonl([{ type: 'compacted', payload: {} }]));
  state = await transcriptMetadata(transcript, state);
  assert.equal(state.bytesSinceUsage, 0);
});

test('per-actor accounting serializes parallel hooks and separates parent from worker', async () => {
  const root = await fixture('parallel');
  await Promise.all(Array.from({ length: 12 }, () => contextObservation(root, { actor: 'parent', role: 'orchestrator', event: 'PreToolUse' })));
  const parent = await contextObservation(root, { actor: 'parent', role: 'orchestrator', persist: false });
  const worker = await contextObservation(root, { actor: 'worker', role: 'worker', persist: false });
  assert.equal(parent.toolCalls, 12);
  assert.equal(worker.toolCalls, 0);
});

test('runtime mutation pressure parks one owned handoff and returns rotation exit 75', async () => {
  const root = await fixture('rotate', config => { config.context.worker.maxMutations = 1; });
  assert.equal((await runtime(root, 'old', 'claim')).code, 0);
  const result = await runtime(root, 'old', 'migrate');
  assert.equal(result.code, 75);
  const state = JSON.parse(await readFile(path.join(root, '.harness/continuity.json')));
  assert.equal(state.phase, 'awaiting_resume');
  assert.match(result.stdout, new RegExp('resume ' + state.handoff.id));
  assert.notEqual((await runtime(root, 'old', 'resume', state.handoff.id)).code, 0);
  assert.equal((await runtime(root, 'fresh', 'resume', state.handoff.id)).code, 0);
});

test('parent persistent CLI observations account pressure without changing child ownership', async () => {
  const root = await fixture('observe', config => { config.context.orchestrator.maxToolCalls = 2; });
  await runtime(root, 'worker', 'claim');
  const before = await readFile(path.join(root, '.harness/continuity.json'), 'utf8');
  await runtime(root, 'parent', 'context', '--observe', '--json');
  const result = await runtime(root, 'parent', 'context', '--observe', '--json');
  assert.equal(JSON.parse(result.stdout).pressure, 'rotate');
  assert.equal(await readFile(path.join(root, '.harness/continuity.json'), 'utf8'), before);
});

test('owner hooks hand off once and leave exact management paths available', async () => {
  const root = await fixture('hooks', config => { config.context.worker.maxToolCalls = 1; });
  await runtime(root, 'worker', 'claim');
  const blocked = await hook(root, 'worker', { hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'node -e "console.log(1)"' } });
  assert.equal(blocked.hookSpecificOutput.permissionDecision, 'deny');
  const parked = JSON.parse(await readFile(path.join(root, '.harness/continuity.json')));
  assert.equal(parked.phase, 'awaiting_resume');
  assert.deepEqual(await hook(root, 'worker', { hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'node .harness/run.mjs session --json' } }), {});
  const unrelated = await hook(root, 'worker', { hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'node "C:/other/.harness/run.mjs" handoff' } });
  assert.equal(unrelated.hookSpecificOutput.permissionDecision, 'deny');
  const wrongDirectory = await hook(root, 'worker', { hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'node .harness/run.mjs session', workdir: 'C:/other' } });
  assert.equal(wrongDirectory.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(JSON.parse(await readFile(path.join(root, '.harness/continuity.json'))).handoff.id, parked.handoff.id);
});

test('goal Stop circuit never requests continuation and real user prompt can recover', async () => {
  const root = await fixture('circuit');
  const transcript = path.join(root, 'transcript.jsonl');
  await writeFile(transcript, jsonl(Array.from({ length: 7 }, () => [goal(), aborted()]).flat()));
  const stopped = await hook(root, 'parent', { hook_event_name: 'Stop', transcript_path: transcript });
  assert.equal(stopped.continue, false);
  assert.notEqual(stopped.decision, 'block');
  assert.deepEqual(await hook(root, 'parent', { hook_event_name: 'UserPromptSubmit', transcript_path: transcript }), {});
  await appendFile(transcript, jsonl([usage()]));
  assert.deepEqual(await hook(root, 'parent', { hook_event_name: 'UserPromptSubmit', transcript_path: transcript }), {});
  await appendFile(transcript, jsonl([goal(), aborted()]));
  assert.equal((await hook(root, 'parent', { hook_event_name: 'UserPromptSubmit', transcript_path: transcript })).decision, 'block');
});

test('guard accounting failure permits only canonical management and routing tools', async () => {
  const root = await fixture('guard-recovery');
  await writeFile(path.join(root, '.harness/config.json'), '{invalid');
  const event = { hook_event_name: 'PreToolUse', tool_name: 'exec_command' };
  const allowed = await hook(root, 'worker', { ...event, tool_input: { cmd: 'node .harness/run.mjs session --json' } });
  assert.equal(allowed.hookSpecificOutput.permissionDecision, undefined);
  assert.match(allowed.hookSpecificOutput.additionalContext, /runtime ownership checks/);
  for (const tool_input of [
    { cmd: 'node -e "console.log(1)"' },
    { cmd: 'node .harness/run.mjs session; node -e "console.log(1)"' },
    { cmd: 'node .harness/run.mjs session', workdir: 'C:/other' },
    { cmd: 'node "C:/other/.harness/run.mjs" handoff' }
  ]) assert.equal((await hook(root, 'worker', { ...event, tool_input })).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal((await hook(root, 'worker', { ...event, tool_name: 'collaboration.spawn_agent' })).hookSpecificOutput.permissionDecision, undefined);
});

test('large native tool output is redacted on disk and replaced with bounded feedback', async () => {
  const root = await fixture('tool-output', config => { config.context.perResultChars = 80; });
  const secret = 'fixture-quote"backslash\\newline\nsecret';
  const result = await hook(root, 'parent', { hook_event_name: 'PostToolUse', tool_response: { password: secret, value: 'x'.repeat(500) } }, 'codex', { OPENAI_API_KEY: secret });
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /already completed/);
  const files = await readdir(path.join(root, '.harness/logs'));
  const log = await readFile(path.join(root, '.harness/logs', files[0]), 'utf8');
  assert.doesNotMatch(log, /fixture-quote|backslash/);
});

test('command run output has one aggregate cap while redacted stream logs retain full output', async () => {
  const root = await fixture('run-output', config => {
    config.context.perResultChars = 80; config.context.perRunChars = 100;
    config.verification.full = ['A', 'B', 'C'].map(letter => `node -e "console.log('${letter}'.repeat(250))"`);
  });
  await runtime(root, 'worker', 'claim');
  const result = await runtime(root, 'worker', 'check', 'full');
  assert.equal(result.code, 0, result.stderr);
  assert.ok((result.stdout.match(/A/g)?.length ?? 0) < 100);
  assert.ok((result.stdout.match(/B/g)?.length ?? 0) < 40);
  assert.ok((result.stdout.match(/C/g)?.length ?? 0) < 20);
  const logs = await readdir(path.join(root, '.harness/logs'));
  assert.equal(logs.length, 6);
  assert.ok((await Promise.all(logs.map(file => readFile(path.join(root, '.harness/logs', file), 'utf8')))).some(value => value.includes('C'.repeat(250))));
});

test('init and sync propagate context policy without replacing custom host values or instructions', async () => {
  const root = await fixture('sync');
  const file = path.join(root, '.codex/config.toml');
  await writeFile(file, 'model_auto_compact_token_limit = 60000\n[features]\nhooks = false\ncustom = true\n');
  await appendFile(path.join(root, 'AGENTS.md'), '\nCustom project prose.\n');
  const config = JSON.parse(await readFile(path.join(root, '.harness/config.json')));
  config.context = { worker: { maxToolCalls: 9 } };
  await writeFile(path.join(root, '.harness/config.json'), JSON.stringify(config));
  await syncHarness(root);
  const updated = JSON.parse(await readFile(path.join(root, '.harness/config.json')));
  assert.equal(updated.context.worker.maxToolCalls, 9);
  assert.equal(updated.context.worker.maxAgeMs, 1200000);
  assert.match(await readFile(file, 'utf8'), /hooks = false/);
  assert.match(await readFile(file, 'utf8'), /limit = 60000/);
  assert.match(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /Custom project prose/);
  for (const surface of ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md']) assert.match(await readFile(path.join(root, surface), 'utf8'), /agent-harness-context-v1/);
  const hooks = JSON.parse(await readFile(path.join(root, '.codex/hooks.json'))).hooks;
  const canonical = JSON.parse(await readFile(new URL('../skill/codex-harness/assets/native-hook-bootstrap-v3.json', import.meta.url), 'utf8'));
  for (const event of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']) assert.equal(hooks[event][0].hooks[0].command, canonical.commands['codex/context-guard.mjs']);
  await writeFile(file, 'features = { hooks = false }\n');
  await syncHarness(root);
  assert.equal(await readFile(file, 'utf8'), 'features = { hooks = false }\n');
  assert.match(await readFile(path.join(root, '.harness/codex-context-config.addition.toml'), 'utf8'), /model_auto_compact/);
  for (const [quoted, key, value] of [['"', 'model_auto_compact_token_limit', '50000'], ["'", 'model_auto_compact_token_limit_scope', '"total"']]) {
    const custom = `${quoted}${key}${quoted} = ${value}\n[features]\nhooks = false\n`;
    await writeFile(file, custom);
    await syncHarness(root);
    assert.equal(await readFile(file, 'utf8'), custom);
  }
  for (const custom of ['features."hooks" = false\n', '"features".hooks = false\n', '[features]\n"hooks" = false\n']) {
    await writeFile(file, custom);
    await syncHarness(root);
    assert.equal(await readFile(file, 'utf8'), custom);
  }
  for (const custom of ['[ features ]\nhooks = false\n', 'features . hooks = false\n']) {
    await writeFile(file, custom);
    await syncHarness(root);
    const updated = await readFile(file, 'utf8');
    assert.match(updated, /hooks\s*= false/);
    assert.doesNotMatch(updated, /hooks = true/);
  }
});

test('legacy helper stages its exact dependency and preserves unborn feature state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-context-legacy-helper-'));
  temporary.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'legacy-helper', scripts: { test: pass } }));
  await writeFile(path.join(root, 'README.md'), '# Legacy fixture\n');
  await initHarness(root, { name: 'legacy-helper', purpose: 'Unborn repository maintenance fixture' });
  await execute('git', ['init'], { cwd: root, windowsHide: true });
  await rm(path.join(root, '.harness/run.mjs'));
  await rm(path.join(root, '.harness/context-budget.mjs'));
  const before = await readFile(path.join(root, '.harness/features.json'), 'utf8');
  const source = path.resolve('skill/codex-harness/assets');
  await copyFile(path.join(source, 'context-budget.mjs'), path.join(root, '.harness/context-budget.mjs'));
  await copyFile(path.join(source, 'project-runtime.mjs'), path.join(root, '.harness/upgrade-bootstrap.mjs'));
  const runHelper = (...args) => execute(process.execPath, [path.join(root, '.harness/upgrade-bootstrap.mjs'), ...args], { cwd: root, windowsHide: true, env: { ...process.env, CODEX_THREAD_ID: 'legacy-owner' } });
  await runHelper('claim');
  assert.equal(JSON.parse((await runHelper('bootstrap', '--json')).stdout).counts.active, 0);
  await runHelper('migrate');
  await syncHarness(root);
  await rm(path.join(root, '.harness/upgrade-bootstrap.mjs'));
  assert.equal((await runtime(root, 'legacy-owner', 'doctor')).code, 0);
  assert.equal(await readFile(path.join(root, '.harness/features.json'), 'utf8'), before);
  assert.deepEqual(await readFile(path.join(root, '.harness/run.mjs')), await readFile(path.join(source, 'project-runtime.mjs')));
  assert.deepEqual(await readFile(path.join(root, '.harness/context-budget.mjs')), await readFile(path.join(source, 'context-budget.mjs')));
  assert.equal((await runtime(root, 'legacy-owner', 'checkpoint', '--reason', 'worker_yield', '--summary', 'Source and installed maintenance checks passed without creating a feature pass.')).code, 0);
  await assert.rejects(execute('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, windowsHide: true }));
});

test.after(async () => { for (const root of temporary) await rm(root, { recursive: true, force: true }); });
