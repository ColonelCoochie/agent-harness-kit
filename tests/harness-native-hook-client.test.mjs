import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { connectNativeHookClient, openNativeClient, resolveCodexExecutable } from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';

function connectTestServer({ executable, ...options }) {
  return openNativeClient({ command: process.execPath, args: [executable] }, options);
}

test('native discovery prefers Windows exe and rejects unsupported script launchers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-executable-'));
  try {
    const npm = path.join(root, 'npm'), desktop = path.join(root, 'desktop');
    await mkdir(npm); await mkdir(desktop);
    await writeFile(path.join(npm, 'codex.ps1'), ''); await writeFile(path.join(desktop, 'codex.exe'), '');
    const env = { PATH: [npm, desktop].join(';'), SystemRoot: 'C:\\Windows' };
    assert.equal((await resolveCodexExecutable({ env, platform: 'win32' })).command, path.join(desktop, 'codex.exe'));
    await assert.rejects(resolveCodexExecutable({ executable: path.join(npm, 'codex.ps1'), env, platform: 'win32' }), { code: 'NATIVE_UNSUPPORTED_LAUNCHER' });
    await assert.rejects(resolveCodexExecutable({ executable: path.join(root, 'missing'), env }), /not found/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows npm launchers resolve their packaged native executable instead of a descendant chain', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-npm-executable-'));
  try {
    const core = path.join(root, 'node_modules', '@openai', 'codex');
    const optional = path.join(root, 'node_modules', '@openai', 'codex-win32-x64');
    const native = path.join(optional, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    const script = path.join(core, 'bin', 'codex.js'), launcher = path.join(root, 'codex.ps1');
    await mkdir(path.dirname(script), { recursive: true }); await mkdir(path.dirname(native), { recursive: true });
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ name: '@openai/codex' }));
    await writeFile(path.join(optional, 'package.json'), JSON.stringify({ name: '@openai/codex-win32-x64' }));
    await writeFile(script, ''); await writeFile(native, '');
    await writeFile(launcher, '& node "$basedir/node_modules/@openai/codex/bin/codex.js"');
    for (const executable of [launcher, script]) {
      assert.deepEqual(await resolveCodexExecutable({ executable, platform: 'win32', arch: 'x64' }), { command: native, args: [] });
    }
    await rm(optional, { recursive: true, force: true });
    const fallback = path.join(core, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    await mkdir(path.dirname(fallback), { recursive: true }); await writeFile(fallback, '');
    assert.equal((await resolveCodexExecutable({ executable: launcher, platform: 'win32', arch: 'x64' })).command, fallback);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('closing a direct server process kills inherited-stdio descendants within a bounded deadline', { timeout: 12000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-launcher-lifecycle-'));
  let client;
  const pids = [];
  try {
    const server = path.join(root, 'server.mjs'), launcher = path.join(root, 'launcher.mjs');
    await writeFile(server, `import readline from 'node:readline';
      setInterval(()=>{},1000);
      readline.createInterface({input:process.stdin}).on('line',line=>{
        const q=JSON.parse(line);if(q.method==='initialized')return;
        process.stdout.write(JSON.stringify({id:q.id,result:{pid:process.pid}})+'\\n');
      });`);
    await writeFile(launcher, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
      writeFileSync('launcher.pid',String(process.pid));
      spawn(process.execPath,[${JSON.stringify(server)}],{stdio:'inherit'});
      process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
    client = await connectTestServer({ executable: launcher, cwd: root, home: root, timeoutMs: 4000, shutdownTimeoutMs: 3000 });
    pids.push(Number(await readFile(path.join(root, 'launcher.pid'), 'utf8')), (await client.rpc('config/read')).pid);
    const started = Date.now();
    await Promise.all([client.close(), client.close()]);
    assert.ok(Date.now() - started < 3500, 'shutdown exceeded its deadline');
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await assert.rejects(client.rpc('config/read'), /closed/);
  } finally {
    await client?.close();
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows rejects a launcher that would exit and orphan its server before it runs', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-orphan-rejection-'));
  const marker = path.join(root, 'orphan.pid');
  try {
    const launcher = path.join(root, 'exiting.mjs');
    await writeFile(launcher, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      writeFileSync(${JSON.stringify(marker)},String(child.pid));child.unref();process.exit(0);`);
    const powershell = path.join(root, 'exiting.ps1');
    await writeFile(powershell, `& '${process.execPath.replaceAll("'", "''")}' '${launcher.replaceAll("'", "''")}' @args`);
    for (const executable of [launcher, powershell]) {
      await assert.rejects(connectNativeHookClient({ executable, cwd: root, home: root, timeoutMs: 1000 }), { code: 'NATIVE_UNSUPPORTED_LAUNCHER' });
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
    }
  } finally {
    try { process.kill(Number(await readFile(marker, 'utf8')), 'SIGKILL'); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});

test('a timed-out write remains live and can commit after an unchanged readback without replay', { timeout: 12000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-client-timeout-'));
  let client;
  try {
    const executable = path.join(root, 'late-write.mjs');
    await writeFile(executable, `import readline from 'node:readline';let writes=0,attempts=0,pendingWrite;
      const reply=(q,result)=>process.stdout.write(JSON.stringify({id:q.id,result})+'\\n');
      readline.createInterface({input:process.stdin}).on('line',line=>{
        const q=JSON.parse(line);if(q.method==='initialized')return;
        if(q.method==='config/batchWrite'){attempts++;pendingWrite=q;}
        else if(q.method==='config/read'&&pendingWrite){
          const savedWrite=pendingWrite;pendingWrite=null;
          reply(q,{writes,attempts});
          process.nextTick(()=>{writes++;reply(savedWrite,{writes});});
        }else reply(q,{writes,attempts});
      });`);
    client = await connectTestServer({ executable, cwd: root, home: root, timeoutMs: 4000 });
    await assert.rejects(client.rpc('config/batchWrite'), {
      code: 'NATIVE_RPC_TIMEOUT', message: /config\/batchWrite outcome is unknown after timeout/
    });
    assert.deepEqual(await client.rpc('config/read'), { writes: 0, attempts: 1 });
    assert.deepEqual(await client.rpc('config/read'), { writes: 1, attempts: 1 });
  } finally { await client?.close(); await rm(root, { recursive: true, force: true }); }
});

test('native config transport initializes once, scopes home and exposes version conflicts without replay', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-client-'));
  let client;
  try {
    const executable = path.join(root, 'fake.mjs');
    await writeFile(executable, `import readline from 'node:readline';
      let initialized=0, writes=0;
      readline.createInterface({input:process.stdin}).on('line',line=>{
        const q=JSON.parse(line); if(q.method==='initialized')return;
        let reply;
        if(q.method==='initialize'){initialized++;reply={result:{}};}
        else if(q.method==='config/batchWrite'){writes++;reply={error:{code:-32600,message:'version conflict',data:{config_write_error_code:'configVersionConflict'}}};}
        else reply={result:{initialized,writes,home:process.env.CODEX_HOME,thread:process.env.CODEX_THREAD_ID??null,session:process.env.CODEX_SESSION_ID??null,credential:process.env.TEST_PROVIDER_CREDENTIAL??null,params:q.params}};
        process.stdout.write(JSON.stringify({id:q.id,...reply})+'\\n');
      });`);
    client = await connectTestServer({ executable, cwd: root, home: root, env: { ...process.env, CODEX_THREAD_ID: 'unrelated-worker', CODEX_SESSION_ID: 'shared-session', TEST_PROVIDER_CREDENTIAL: 'fixture-only' } });
    const config = await client.rpc('config/read', { includeLayers: true });
    assert.deepEqual(config, { initialized: 1, writes: 0, home: root, thread: null, session: null, credential: null, params: { includeLayers: true } });
    await assert.rejects(client.rpc('config/batchWrite', {}), { code: -32600, configWriteErrorCode: 'configVersionConflict' });
    assert.equal((await client.rpc('hooks/list')).writes, 1);
    await assert.rejects(client.rpc('hooks/trust', {}), /does not permit/);
    assert.equal((await client.rpc('config/read')).writes, 1);
  } finally { await client?.close(); await rm(root, { recursive: true, force: true }); }
});
