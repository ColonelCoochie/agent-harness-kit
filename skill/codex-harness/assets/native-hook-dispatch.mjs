// Mutable dispatch lives behind the deliberately frozen native bootstrap.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const allowed = new Set(['context-guard.mjs', 'precompact-handoff.mjs', 'sessionstart-routing.mjs', 'claude-worker-identity.mjs']);
if (args.length !== 4 || args[0] !== '--adapter' || !allowed.has(args[1]) || args[2] !== '--platform' || !['codex', 'claude'].includes(args[3])) throw new Error('Unsupported native adapter dispatch');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = spawnSync(process.execPath, [path.join(root, '.harness/hooks', args[1]), '--platform', args[3]], {
  cwd: root, input: readFileSync(0, 'utf8'), encoding: 'utf8', windowsHide: true
});
if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Hook adapter failed');
process.stdout.write(result.stdout || '{}');
