import './harness-runtime-redaction.test.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';
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

for (const stdio of ['inherit', 'ignore']) test(`hardening: ready shell descendants (${stdio}) are dead before timeout rejection`, async t => {
  const root = await fixture('containment');
  await writeFile(path.join(root, 'tree.cjs'), `
const fs=require('node:fs'),cp=require('node:child_process');
const role=process.argv[2],stdio=process.argv[3];
fs.writeFileSync(role+'.pid',String(process.pid));
if(role==='parent')cp.spawn(process.execPath,['tree.cjs','child',stdio],{stdio});
if(role==='child')cp.spawn(process.execPath,['tree.cjs','grandchild',stdio],{stdio});
setInterval(()=>{fs.appendFileSync(role+'.heartbeat','x');if(fs.existsSync('after-return.gate'))fs.writeFileSync(role+'.escaped','BAD');},25);
`);
  await configure(root, `node tree.cjs parent ${stdio}`, 3500);
  const began = Date.now(); let returned = false;
  const checked = run(root, 'worker-a', 'check', 'full').then(() => { returned = true; throw new Error('Unexpected command success'); }, error => { returned = true; return error; });
  const roles = ['parent', 'child', 'grandchild']; const pids = [];
  while (!returned && Date.now() - began < 3000) {
    const ready = await Promise.all(roles.map(role => readFile(path.join(root, role + '.pid'), 'utf8').catch(() => null)));
    if (ready.every(Boolean)) { pids.push(...ready.map(Number)); break; }
    await delay(20);
  }
  const error = await checked;
  assert.equal(pids.length, 3, 'parent, child, and grandchild must actually start before timeout');
  assert.match(error.stdout, /timeout/); assert.ok(Date.now() - began < 9000, 'cleanup must be bounded');
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), /ESRCH/, `PID ${pid} remains alive at rejection`);
  const heartbeats = await Promise.all(roles.map(role => readFile(path.join(root, role + '.heartbeat'), 'utf8')));
  assert.ok(heartbeats.every(value => value.length > 0), 'every process must heartbeat');
  await writeFile(path.join(root, 'after-return.gate'), 'GO'); await delay(300);
  assert.deepEqual(await Promise.all(roles.map(role => readFile(path.join(root, role + '.heartbeat'), 'utf8'))), heartbeats);
  for (const role of roles) await assert.rejects(readFile(path.join(root, role + '.escaped')), /ENOENT/);
  t.diagnostic(JSON.stringify({ stdio, pids, deadAtRejection: true, heartbeatLengths: heartbeats.map(value => value.length), heartbeatsStopped: true, postReturnWrites: false }));
});

test('hardening: Windows startup timeout never launches a command', { skip: process.platform !== 'win32' }, async () => {
  const root = await fixture('startup-timeout'); await configure(root, 'node -e "require(\'node:fs\').writeFileSync(\'started\',\'BAD\')"', 100);
  const began = Date.now(); await assert.rejects(run(root, 'worker-a', 'check', 'full'), error => /timeout/.test(error.stdout));
  assert.ok(Date.now() - began < 6000); await assert.rejects(readFile(path.join(root, 'started')), /ENOENT/);
});

test('hardening: genuine command exit 124 is distinct from a timeout and stdio stays raw', { skip: process.platform !== 'win32' }, async () => {
  const root = await fixture('raw-stdio'); await writeFile(path.join(root, 'raw.cjs'), "process.stdout.write(Buffer.from([0,255,65]));process.stderr.write(Buffer.from([0,254,66]));process.exit(Number(process.argv[2]));");
  const { windowsCommand } = await import('../skill/codex-harness/assets/windows-command.mjs');
  const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  for (const exitCode of [0, 7, 124, 0, 124]) {
    const controller = windowsCommand(`node raw.cjs ${exitCode}`, root, environment, 10000); const stdout = [], stderr = [];
    controller.child.stdout.on('data', value => stdout.push(value)); controller.child.stderr.on('data', value => stderr.push(value));
    const result = await controller.done;
    assert.equal(result.exitCode, exitCode); assert.equal(result.timedOut, false); assert.equal(result.confirmed, true);
    assert.deepEqual(Buffer.concat(stdout), Buffer.from([0,255,65])); assert.deepEqual(Buffer.concat(stderr), Buffer.from([0,254,66]));
  }
});

test('hardening: Windows broken execution adapter fails closed while help remains usable', { skip: process.platform !== 'win32' }, async () => {
  for (const broken of ['missing', 'syntax']) {
    const root = await fixture('broken-adapter');
    await configure(root, 'node -e "require(\'node:fs\').writeFileSync(\'started\',\'BAD\')"');
    const adapter = path.join(root, '.harness/windows-command.mjs');
    if (broken === 'missing') await rm(adapter); else await writeFile(adapter, 'export function broken( {');
    assert.match((await run(root, 'worker-a', '--help')).stdout, /Project harness runtime/);
    await assert.rejects(run(root, 'worker-a', 'check', 'full'), error => /containment adapter initialization failed/.test(error.stderr));
    await assert.rejects(readFile(path.join(root, 'started')), /ENOENT/);
  }
});

test('hardening: Windows controller initialization failure never confirms cleanup or starts target', { skip: process.platform !== 'win32' }, async () => {
  const root = await fixture('broken-supervisor');
  await writeFile(path.join(root, '.harness/windows-command-supervisor.ps1'), "param([string]$PipeName)\nthrow 'fixture initialization failure'\n");
  const { windowsCommand } = await import(pathToFileURL(path.join(root, '.harness/windows-command.mjs')).href);
  const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const controller = windowsCommand('node -e "require(\'node:fs\').writeFileSync(\'started\',\'BAD\')"', root, environment, 10000);
  controller.child.stdout.resume(); controller.child.stderr.resume();
  const result = await controller.done;
  assert.equal(result.confirmed, false); assert.equal(result.timedOut, false); assert.notEqual(result.exitCode, 0);
  await assert.rejects(readFile(path.join(root, 'started')), /ENOENT/);
});

test('hardening: Windows settlement checks the deadline before an overdue timer dispatches', async t => {
  const require = createRequire(import.meta.url);
  const childProcess = require('node:child_process'), net = require('node:net');
  const child = new EventEmitter(), server = new EventEmitter(), socket = new EventEmitter();
  child.stdout = { destroy() {} }; child.stderr = { destroy() {} };
  let pipePath, pipeName;
  server.listen = value => { pipePath = value; return server; }; server.close = () => server;
  socket.setEncoding = () => socket; socket.end = () => socket; socket.destroy = () => socket;
  let connect, now = 1000;
  t.mock.method(childProcess, 'spawn', (_executable, args) => { pipeName = args[args.indexOf('-PipeName') + 1]; return child; });
  t.mock.method(net, 'createServer', callback => { connect = callback; return server; });
  t.mock.method(Date, 'now', () => now);
  syncBuiltinESMExports();
  try {
    const { windowsCommand } = await import('../skill/codex-harness/assets/windows-command.mjs');
    const controller = windowsCommand('unused fixture command', os.tmpdir(), {}, 10000);
    assert.match(pipeName, /^LOCAL\\agent-harness-\d+-[a-f0-9-]+$/);
    assert.equal(pipePath, `\\\\.\\pipe\\${pipeName}`, 'Node and .NET must use the same AppContainer-compatible name');
    connect(socket);
    // Final acknowledgement arrives before the deadline. The controller closes
    // after a blocked event loop has crossed it, before its timer can dispatch.
    socket.emit('data', '{"type":"final","exitCode":0,"confirmed":true,"timedOut":false}\n');
    now = 11001;
    child.emit('close', 0);
    const result = await controller.done;
    assert.equal(result.confirmed, true);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 124);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test('hardening: Windows completion acknowledgement cannot turn an expired deadline into exit zero', { skip: process.platform !== 'win32' }, async () => {
  const root = await fixture('late-controller');
  await writeFile(path.join(root, '.harness/windows-command-supervisor.ps1'), `
param([string]$PipeName)
$pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$PipeName,[IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(10000)
$reader=[IO.StreamReader]::new($pipe)
$writer=[IO.StreamWriter]::new($pipe);$writer.AutoFlush=$true
$writer.WriteLine('{"type":"ready"}')
$null=$reader.ReadLine()
$writer.WriteLine('{"type":"final","exitCode":0,"confirmed":true,"timedOut":false}')
Write-Output 'ACKNOWLEDGED'
Start-Sleep -Milliseconds 2000
$writer.Dispose();$reader.Dispose();$pipe.Dispose()
`);
  const { windowsCommand } = await import(pathToFileURL(path.join(root, '.harness/windows-command.mjs')).href);
  const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const controller = windowsCommand('unused fixture command', root, environment, 1500); let acknowledged = '';
  controller.child.stdout.on('data', value => { acknowledged += value; }); controller.child.stderr.resume();
  const result = await controller.done;
  assert.match(acknowledged, /ACKNOWLEDGED/); assert.equal(result.exitCode, 124); assert.equal(result.timedOut, true);
});

test('hardening: independent health requires and authenticates the Windows executable closure', async () => {
  const root = await fixture('windows-inventory');
  const inventoryFile = path.join(root, '.harness/managed-files.json'), inventory = await json(inventoryFile);
  for (const relative of ['.harness/windows-command.mjs', '.harness/windows-command-supervisor.ps1']) {
    const incomplete = structuredClone(inventory); delete incomplete.files[relative]; await save(inventoryFile, incomplete);
    await assert.rejects(exec(process.execPath, [path.join(root, '.harness/repair.mjs'), 'health', '--json'], { cwd: root, windowsHide: true }), error => /incomplete managed executable inventory/.test(error.stderr));
    await save(inventoryFile, inventory);
    const original = await readFile(path.join(root, relative)); await writeFile(path.join(root, relative), 'damaged fixture');
    const result = JSON.parse((await exec(process.execPath, [path.join(root, '.harness/repair.mjs'), 'health', '--json'], { cwd: root, windowsHide: true })).stdout);
    assert.equal(result.healthy, false); assert.equal(result.files.find(file => file.path === relative).healthy, false);
    const digest = createHash('sha256').update('damaged fixture').digest('hex');
    const preview = JSON.parse((await exec(process.execPath, [path.join(root, '.harness/repair.mjs'), 'sync', '--preview', '--json', '--replace-reviewed', relative + '=' + digest], { cwd: root, windowsHide: true })).stdout);
    assert.equal(preview.blocked, false); assert.ok(preview.operations.some(item => item.path === relative && item.action === 'write'));
    await writeFile(path.join(root, relative), original);
  }
});

test('hardening: generic secret labels retain pending lexical context across long whitespace', async () => {
  const root = await fixture(); await writeFile(path.join(root, 'generic.cjs'), "process.stdout.write('password= '+' '.repeat(12000)); setTimeout(()=>process.stdout.write('OPAQUE-FIXTURE-PASSWORD\\n'),30); process.stderr.write('authorization: bearer '+' '.repeat(12000));setTimeout(()=>process.stderr.write('OPAQUE-FIXTURE-BEARER\\n'),30);");
  await configure(root, 'node generic.cjs'); const result = await run(root, 'worker-a', 'check', 'full');
  assert.doesNotMatch(result.stdout, /OPAQUE-FIXTURE-PASSWORD|OPAQUE-FIXTURE-BEARER/); assert.match(result.stdout, /REDACTED/);
});

test('hardening: quoted secrets never reach command display, stream logs, or evidence', async () => {
  const root = await fixture('quoted-secrets');
  await writeFile(path.join(root, 'quoted.mjs'), `
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
for (const [stream, key, value] of [[process.stdout, 'password', 'RUNTIME_ALPHA RUNTIME_BRAVO'], [process.stderr, 'token', 'RUNTIME_CHARLIE "RUNTIME_DELTA" \\\\ 雪🔒']]) {
  const json = JSON.stringify({ [key]: value });
  const cut = json.indexOf(' ') + 1;
  const payload = json + 'x'.repeat(4096 + cut - json.length);
  stream.write(payload.slice(0, cut)); await pause();
  stream.write(payload.slice(cut)); await pause();
  stream.write('\\nPUBLIC é雪🔒\\n');
}
`);
  await configure(root, 'node quoted.mjs'); await add(root, 'node quoted.mjs');
  const displayed = await run(root, 'worker-a', 'verify', 'audit');
  const feature = (await json(path.join(root, '.harness/features.json'))).features[0];
  const record = await json(path.join(root, feature.evidence.at(-1)));
  const leak = /RUNTIME_ALPHA|RUNTIME_BRAVO|RUNTIME_CHARLIE|RUNTIME_DELTA/;
  assert.doesNotMatch(displayed.stdout + displayed.stderr, leak);
  assert.match(displayed.stdout, /REDACTED/);
  for (const command of record.commands) {
    assert.doesNotMatch(JSON.stringify(command), leak);
    for (const stream of ['stdout', 'stderr']) {
      const saved = await readFile(path.join(root, command.logs[stream]), 'utf8');
      assert.doesNotMatch(saved, leak);
      assert.match(saved, /REDACTED/);
      assert.match(saved, /PUBLIC é雪🔒/);
    }
  }
});

test('hardening: overlapping secrets stay redacted in console, both stream logs, and evidence', async () => {
  const root = await fixture('overlapping-secrets');
  await writeFile(path.join(root, 'overlap.mjs'), `
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
for (const [stream, value] of [[process.stdout, JSON.stringify({password: 'RUNTIME_FIRST KNOWN" RUNTIME_LEAKTAIL'})], [process.stderr, '{"password":"RUNTIME_ALPHA RUNTIME_BRAVO"}']]) {
  const cut = value.indexOf(' ') + 1;
  const payload = value + 'x'.repeat(4096 + cut - value.length);
  stream.write(payload.slice(0, cut)); await pause();
  stream.write(payload.slice(cut)); await pause();
  stream.write('\\nPUBLIC é雪🔒\\n');
}
`);
  await configure(root, 'node overlap.mjs'); await add(root, 'node overlap.mjs');
  const displayed = await exec(process.execPath, [path.join(root, '.harness/run.mjs'), 'verify', 'audit'], {
    cwd: root, env: env('worker-a', { OPENAI_API_KEY: 'KNOWN\\', OPENAI_API_KEY_2: 'password' }), windowsHide: true, maxBuffer: 1024 * 1024
  });
  const feature = (await json(path.join(root, '.harness/features.json'))).features[0];
  const record = await json(path.join(root, feature.evidence.at(-1)));
  const leak = /RUNTIME_FIRST|RUNTIME_LEAKTAIL|RUNTIME_ALPHA|RUNTIME_BRAVO|KNOWN/;
  assert.doesNotMatch(displayed.stdout + displayed.stderr, leak);
  assert.match(displayed.stdout, /REDACTED_ENV/);
  assert.doesNotMatch(JSON.stringify(record), leak);
  for (const command of record.commands) for (const stream of ['stdout', 'stderr']) {
    const saved = await readFile(path.join(root, command.logs[stream]), 'utf8');
    assert.doesNotMatch(saved, leak);
    assert.match(saved, /REDACTED_ENV/);
    assert.match(saved, /PUBLIC é雪🔒/);
  }
});

test('hardening: oversized output suppresses only its stream before console, logs, and evidence', async () => {
  const root = await fixture('oversized-secrets');
  await writeFile(path.join(root, 'overflow.mjs'), `
const [mode, name] = process.argv.slice(2);
const affected = process[name], independent = name === 'stdout' ? process.stderr : process.stdout;
affected.write((mode === 'closed' ? '{"password":"' : '') + 'x'.repeat(100000));
await new Promise(resolve => setTimeout(resolve, 30));
if (mode === 'known') affected.write(' RUNTIME_ALPHA\\n');
else affected.write((mode === 'closed' ? '"}\\n' : ' ') + '{"password":"RUNTIME_ALPHA\\n');
await new Promise(resolve => setTimeout(resolve, 30));
affected.write('RUNTIME_BRAVO"}\\nUNSAFE_LATER_OUTPUT\\n');
independent.write('SAFE_OTHER_STREAM é雪🔒\\n');
`);
  const commands = ['node overflow.mjs quoted stdout', 'node overflow.mjs known stderr', 'node overflow.mjs closed stdout'];
  await configure(root, commands[0]);
  const configFile = path.join(root, '.harness/config.json'), config = await json(configFile);
  config.verification.full = commands; await save(configFile, config); await add(root, commands[0]);
  const displayed = await exec(process.execPath, [path.join(root, '.harness/run.mjs'), 'verify', 'audit'], {
    cwd: root, env: env('worker-a', { OPENAI_API_KEY: 'RUNTIME_ALPHA\nRUNTIME_BRAVO' }), windowsHide: true, maxBuffer: 1024 * 1024
  });
  const feature = (await json(path.join(root, '.harness/features.json'))).features[0];
  const record = await json(path.join(root, feature.evidence.at(-1)));
  const leak = /RUNTIME_ALPHA|RUNTIME_BRAVO|UNSAFE_LATER_OUTPUT/;
  assert.doesNotMatch(displayed.stdout + displayed.stderr, leak);
  assert.match(displayed.stdout, /remainder of stream suppressed/);
  assert.match(displayed.stdout, /SAFE_OTHER_STREAM é雪🔒/);
  assert.doesNotMatch(JSON.stringify(record), leak);
  for (const command of record.commands) {
    const affected = command.command.endsWith('stdout') ? 'stdout' : 'stderr';
    const independent = affected === 'stdout' ? 'stderr' : 'stdout';
    const omitted = await readFile(path.join(root, command.logs[affected]), 'utf8');
    const retained = await readFile(path.join(root, command.logs[independent]), 'utf8');
    assert.doesNotMatch(omitted + retained, leak);
    assert.match(omitted, /remainder of stream suppressed/);
    assert.ok(omitted.length < 200);
    assert.equal(retained, 'SAFE_OTHER_STREAM é雪🔒\n');
    assert.equal(command.truncated, true);
  }
});

test('hardening: a timed out zero exit cannot pass verification or continue a command layer', { skip: process.platform !== 'win32' }, async () => {
  const root = await fixture('timeout-aggregate');
  await writeFile(path.join(root, '.harness/windows-command.mjs'), `
import { spawn } from 'node:child_process';
export function windowsCommand(command, cwd, env) {
  const child = spawn(process.execPath, ['-e', ''], { cwd, env, windowsHide: true });
  const done = new Promise(resolve => child.on('close', () => resolve({ exitCode: 0, timedOut: true, confirmed: true })));
  return { child, done };
}
`);
  await configure(root, 'node --version');
  const file = path.join(root, '.harness/config.json'); const config = await json(file);
  config.verification.full.push('node --version'); await save(file, config); await add(root);
  await assert.rejects(run(root, 'worker-a', 'verify', 'audit'));
  const feature = (await json(path.join(root, '.harness/features.json'))).features[0];
  assert.notEqual(feature.status, 'passing');
  const record = await json(path.join(root, feature.evidence.at(-1)));
  const commands = record.commands.filter(item => item.layer === 'full');
  assert.equal(commands.length, 1); assert.equal(commands[0].timedOut, true); assert.equal(commands[0].pass, false);
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
    assert.match(item.command, /HARNESS_HOOK_LAUNCHER_V3/); assert.ok(!item.command.includes(root.replaceAll('\\', '/'))); assert.doesNotMatch(item.commandWindows, /\$projectRoot|git rev-parse/);
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
