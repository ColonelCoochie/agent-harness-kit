import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';

const METHODS = new Set(['config/read', 'config/batchWrite', 'hooks/list']);

async function npmNativeExecutable(file, arch) {
  const script = /\.ps1$/i.test(file) ? path.join(path.dirname(file), 'node_modules', '@openai', 'codex', 'bin', 'codex.js') : file;
  try {
    if (/\.ps1$/i.test(file) && !/node_modules[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js/.test(await readFile(file, 'utf8'))) return;
    const root = path.dirname(path.dirname(script));
    if (JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).name !== '@openai/codex') return;
    const target = { x64: 'x86_64', arm64: 'aarch64' }[arch];
    if (!target) return;
    const roots = [root];
    try { roots.unshift(path.dirname(createRequire(script).resolve(`@openai/codex-win32-${arch}/package.json`))); } catch {}
    for (const packageRoot of roots) {
      const native = path.join(packageRoot, 'vendor', `${target}-pc-windows-msvc`, 'bin', 'codex.exe');
      try { await access(native, constants.F_OK); return native; } catch {}
    }
  } catch {}
}

async function stopTree(child, env, timeoutMs) {
  if (!child.pid) return true;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); return true; } catch (error) { return error.code === 'ESRCH'; }
  }
  const command = env.SystemRoot ? path.join(env.SystemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';
  return new Promise(resolve => {
    const killer = spawn(command, ['/PID', String(child.pid), '/T', '/F'], { env, windowsHide: true, stdio: 'ignore' });
    let done = false;
    const finish = result => { if (done) return; done = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { killer.kill(); killer.unref(); finish(false); }, timeoutMs);
    killer.on('error', () => finish(false));
    killer.on('exit', code => finish(code === 0));
  });
}

// Prefer the desktop executable over an npm launcher on Windows. An explicit
// executable also permits portable installations without a globally installed CLI.
export async function resolveCodexExecutable({ executable, env = process.env, platform = process.platform, arch = process.arch } = {}) {
  const explicit = executable ?? env.CODEX_EXECUTABLE;
  const directories = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const candidates = explicit ? [explicit] : platform === 'win32'
    ? ['codex.exe', 'codex.ps1'].flatMap(name => directories.map(directory => path.join(directory, name)))
    : directories.map(directory => path.join(directory, 'codex'));
  for (const candidate of candidates) {
    const file = path.resolve(candidate);
    try { await access(file, platform === 'win32' || /\.[cm]?js$/i.test(file) ? constants.F_OK : constants.X_OK); } catch { continue; }
    if (platform === 'win32' && /(?:\.ps1|\.[cm]?js)$/i.test(file)) {
      const native = await npmNativeExecutable(file, arch);
      if (native) return { command: native, args: [] };
      // taskkill cannot recover an orphan once its launcher PID has exited.
      // Only the packaged npm wrapper has a known direct native replacement.
      const error = new Error('Custom Windows script launchers are unsupported; supply the Codex native executable.');
      error.code = 'NATIVE_UNSUPPORTED_LAUNCHER';
      throw error;
    }
    if (/\.ps1$/i.test(file)) {
      const powershell = env.SystemRoot ? path.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
      return { command: powershell, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', file] };
    }
    if (/\.[cm]?js$/i.test(file)) return { command: process.execPath, args: [file] };
    return { command: file, args: [] };
  }
  throw new Error('Codex native executable was not found; supply executable or CODEX_EXECUTABLE.');
}

export async function connectNativeHookClient(options = {}) {
  const launch = await resolveCodexExecutable({ executable: options.executable, env: options.env });
  return openNativeClient(launch, options);
}

// Internal transport seam for a known direct server process. Policy/CLI callers
// use connectNativeHookClient so script launcher discovery cannot bypass safety.
export async function openNativeClient(launch, { cwd = process.cwd(), home, env = process.env, timeoutMs = 30000, shutdownTimeoutMs = 3000 } = {}) {
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) throw new Error('A positive finite native shutdown deadline is required.');
  if (!launch || typeof launch.command !== 'string' || !Array.isArray(launch.args) || launch.args.some(arg => typeof arg !== 'string')) throw new Error('A direct native command and argument prefix are required.');
  // Config/discovery never requests provider credentials. Use a host environment
  // allowlist so configured credentials cannot leak into this subprocess.
  const hostKeys = new Set(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME']);
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => hostKeys.has(key)));
  if (home) childEnv.CODEX_HOME = path.resolve(home);
  delete childEnv.CODEX_THREAD_ID;
  delete childEnv.CODEX_SESSION_ID;
  const child = spawn(launch.command, [...launch.args, 'app-server', '--stdio', '-c', 'features.hooks=true'], {
    cwd, env: childEnv, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']
  });
  let nextId = 0, closed = false, terminated = false;
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout });
  // Drain stderr without retaining configuration, credentials, or protocol logs.
  child.stderr.resume();
  function fail(error) {
    if (closed) return;
    closed = true;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    lines.close();
  }
  let closing;
  const close = () => closing ??= (async () => {
    const deadline = Date.now() + shutdownTimeoutMs;
    fail(new Error('Native config transport closed.'));
    let stopped;
    try { stopped = terminated || await stopTree(child, childEnv, shutdownTimeoutMs); }
    finally {
      // Inherited pipes must never extend the shutdown deadline. A failed tree
      // cleanup is reported; stream disposal alone does not prove quiescence.
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
    }
    if (stopped && !terminated) stopped = await new Promise(resolve => {
      const onClose = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { child.removeListener('close', onClose); resolve(false); }, Math.max(1, deadline - Date.now()));
      child.once('close', onClose);
    });
    if (!stopped) {
      const error = new Error('Native process-tree shutdown could not be confirmed before its deadline.');
      error.code = 'NATIVE_SHUTDOWN_INDETERMINATE';
      throw error;
    }
  })();
  child.on('close', () => { terminated = true; });
  child.on('error', () => fail(new Error('Native config transport could not start.')));
  child.on('exit', code => fail(new Error(`Native config transport exited (${code}).`)));
  child.stdin.on('error', () => fail(new Error('Native config transport input failed.')));
  lines.on('line', line => {
    if (line.length > 4 * 1024 * 1024) { void close().catch(() => {}); return; }
    let message;
    try { message = JSON.parse(line); } catch { void close().catch(() => {}); return; }
    if (message.id === undefined) return;
    if (message.method) {
      child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'This client does not execute server requests.' } }) + '\n');
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message ?? 'Native config RPC failed.');
      error.code = message.error.code;
      error.configWriteErrorCode = message.error.data?.config_write_error_code;
      waiter.reject(error);
    } else waiter.resolve(message.result);
  });
  function request(method, params) {
    if (closed) return Promise.reject(new Error('Native config transport is closed.'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(`Native ${method} outcome is unknown after timeout.`);
        error.code = 'NATIVE_RPC_TIMEOUT';
        reject(error);
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  try {
    await request('initialize', { clientInfo: { name: 'agent_harness_hook_policy', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  } catch (error) { await close(); throw error; }
  return {
    close,
    rpc(method, params = {}) {
      if (!METHODS.has(method)) return Promise.reject(new Error('Native hook policy transport does not permit this method: ' + method));
      return request(method, params);
    }
  };
}
