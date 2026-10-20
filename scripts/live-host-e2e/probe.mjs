import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve('scratch/live-host-e2e');
await mkdir(root, { recursive: true });
const binary = 'C:/Users/Jason/AppData/Local/OpenAI/Codex/bin/9614f1d9b40d9c4f/codex.exe';
const child = spawn(binary, ['app-server', '--stdio', '-c', 'features.hooks=true', '-c', 'model_auto_compact_token_limit=40000', '-c', 'model_auto_compact_token_limit_scope="body_after_prefix"'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let id = 0;
const pending = new Map();
const stderr = [];
child.stderr.on('data', b => stderr.push(String(b)));
const input = readline.createInterface({ input: child.stdout });
input.on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  const callback = pending.get(message.id);
  if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result); }
});
function rpc(method, params) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(method + ' timed out')); }, 45000);
    pending.set(requestId, { resolve: v => { clearTimeout(timeout); resolve(v); }, reject: e => { clearTimeout(timeout); reject(e); } });
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
  });
}
try {
  const initialized = await rpc('initialize', { clientInfo: { name: 'harness_live_e2e', title: 'Harness live E2E', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const hooks = await rpc('hooks/list', { cwds: [root] });
  const config = await rpc('config/read', { cwd: root, includeLayers: true });
  const summary = { initialized, hooks, config: { model: config.config?.model, autoCompact: config.config?.model_auto_compact_token_limit, scope: config.config?.model_auto_compact_token_limit_scope, features: config.config?.features, layers: config.layers?.map(l => ({name:l.name,source:l.name?.type})) }, stderr: stderr.join('').slice(-3000) };
  await writeFile(path.join(root, 'probe.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ hookGroups: hooks.data?.map(g => ({ cwd: g.cwd, hooks: g.hooks?.map(h => ({ event: h.eventName, trust: h.trustStatus, path: h.sourcePath })), errors: g.errors, warnings: g.warnings })), config: summary.config, version: initialized.userAgent }));
} catch (error) { await writeFile(path.join(root, 'probe-error.json'), JSON.stringify({error:error.message,stderr:stderr.join('').slice(-3000)})); console.error(error.message); process.exitCode = 1; }
finally { child.kill(); input.close(); }
