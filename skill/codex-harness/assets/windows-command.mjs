import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The controller owns a non-inherited job handle outside the command's job.
// A private pipe carries only in-memory requests and completion acknowledgments.
export function windowsCommand(command, cwd, environment, timeoutMs) {
  // Node and .NET must address the same local namespace in an AppContainer.
  // .NET adds the pipe path prefix itself, so retain LOCAL in the shared name.
  const pipeName = `LOCAL\\agent-harness-${process.pid}-${randomUUID()}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const deadline = Date.now() + timeoutMs;
  let connection, child, stopped = false, timedOut = false, final, settled = false, closed = false, pipeClosed = false;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const server = createServer(socket => {
    if (connection) { socket.destroy(); return; }
    connection = socket;
    let pending = '';
    socket.setEncoding('utf8');
    socket.on('data', data => {
      pending += data;
      if (pending.length > 8192) { socket.destroy(); return; }
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { socket.destroy(); return; }
        if (message.type === 'ready') {
          if (timedOut || stopped || Date.now() >= deadline) socket.end(JSON.stringify({ type: 'cancel' }) + '\n');
          else socket.write(JSON.stringify({ type: 'start', command, cwd, remainingMs: Math.max(0, deadline - Date.now()) }) + '\n');
        } else if (message.type === 'final' && Number.isInteger(message.exitCode) && typeof message.confirmed === 'boolean' && typeof message.timedOut === 'boolean') {
          final = message; timedOut ||= message.timedOut || Date.now() >= deadline;
          socket.end(); maybeFinish();
        }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { pipeClosed = true; maybeFinish(); });
  });
  const finish = result => {
    if (settled) return;
    settled = true; clearTimeout(timer); clearTimeout(watchdog);
    connection?.destroy(); server.close(); resolveDone(result);
  };
  const maybeFinish = () => {
    if (!closed || (!final && connection && !pipeClosed)) return;
    timedOut ||= Date.now() >= deadline;
    finish(final && final.confirmed ? { ...final, exitCode: timedOut ? 124 : final.exitCode, timedOut } : { exitCode: timedOut ? 124 : 1, timedOut, confirmed: false, error: final?.error || 'Windows command containment cleanup was not confirmed.' });
  };
  const cancel = () => {
    if (settled) return;
    timedOut = true; stopped = true;
    if (connection?.writable) connection.write(JSON.stringify({ type: 'cancel' }) + '\n');
  };
  const timer = setTimeout(cancel, timeoutMs);
  // This is a bounded failure path, never evidence of successful tree cleanup.
  const watchdog = setTimeout(() => {
    stopped = true; timedOut = true;
    try { child?.kill('SIGKILL'); } catch {}
    child?.stdout.destroy(); child?.stderr.destroy();
    finish({ exitCode: 124, timedOut: true, confirmed: false, error: 'Windows command containment cleanup was not confirmed before the controller watchdog.' });
  }, timeoutMs + 10000);
  server.on('error', error => {
    stopped = true;
    try { child?.kill('SIGKILL'); } catch {}
    finish({ exitCode: 1, timedOut, confirmed: false, error: `Windows command containment initialization failed: ${error.message}` });
  });
  server.listen(pipePath);
  const powershell = path.join(environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // This is the selected command's execution wrapper. Credentials stay solely
  // in its filtered environment; control messages never contain their values.
  child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./windows-command-supervisor.ps1', import.meta.url)), '-PipeName', pipeName], { cwd, env: environment, windowsHide: true });
  child.on('error', error => { closed = true; final = { exitCode: 1, confirmed: false, timedOut, error: error.message }; maybeFinish(); });
  child.on('close', () => { closed = true; maybeFinish(); });
  return { child, done, cancel };
}
