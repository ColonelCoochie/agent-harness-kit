#!/usr/bin/env node
// Independent of run.mjs, context telemetry and native hook identity. This only
// diagnoses installed bytes or invokes the install-recorded reusable sync CLI.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), operation = argv.shift();
try {
  if (operation === 'health' && (argv.length === 0 || argv.length === 1 && argv[0] === '--json')) {
    const inventory = JSON.parse(await readFile(path.join(root, '.harness/managed-files.json'), 'utf8'));
    if (inventory.version !== 1 || !inventory.files || typeof inventory.files !== 'object' || Array.isArray(inventory.files) || !['.harness/run.mjs', '.harness/context-budget.mjs', '.harness/windows-command.mjs', '.harness/windows-command-supervisor.ps1', '.harness/repair.mjs'].every(file => Object.hasOwn(inventory.files, file)) || !Object.values(inventory.files).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) throw new Error('Invalid or incomplete managed executable inventory; health is indeterminate');
    const files = [];
    for (const [relative, expected] of Object.entries(inventory.files ?? {})) {
      if (!/^\.harness\/(?:(?:run|context-budget|windows-command|repair|hooks\/[a-z-]+)\.mjs|windows-command-supervisor\.ps1|hooks\/native-hook-bootstrap-v[123]\.json)$/.test(relative)) throw new Error('Invalid managed executable path');
      let actual = null, error = null;
      try { const file = path.join(root, relative); const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('not a regular file'); actual = createHash('sha256').update(await readFile(file)).digest('hex'); }
      catch (failure) { error = failure.code ?? failure.message; }
      files.push({ path: relative, expected, actual, healthy: actual === expected, ...(error ? { error } : {}) });
    }
    const source = JSON.parse(await readFile(path.join(root, '.harness/repair-source.json'), 'utf8'));
    console.log(JSON.stringify({ healthy: files.every(file => file.healthy), files, source: source.entrypoint, next: 'node .harness/repair.mjs sync --preview --json' }, null, argv.includes('--json') ? 0 : 2));
  } else if (operation === 'sync') {
    let preview = false, plan = false; const seen = new Set();
    for (let i = 0; i < argv.length; i++) {
      const flag = argv[i];
      if (flag !== '--replace-reviewed' && seen.has(flag)) throw new Error('Duplicate repair option'); seen.add(flag);
      if (flag === '--preview') preview = true;
      else if (flag === '--json') continue;
      else if (flag === '--expect-plan') { if (!/^[a-f0-9]{64}$/.test(argv[++i] ?? '')) throw new Error('Repair needs a SHA256 plan'); plan = true; }
      else if (flag === '--replace-reviewed') { if (!/^\.harness\/(?:(?:run|context-budget|windows-command|repair|hooks\/[a-z-]+)\.mjs|windows-command-supervisor\.ps1|hooks\/native-hook-bootstrap-v[123]\.json)=[a-f0-9]{64}$/.test(argv[++i] ?? '')) throw new Error('Repair replacement must name one managed executable and its raw SHA256'); }
      else throw new Error('Unknown repair option: ' + flag);
    }
    if (!preview && !plan) throw new Error('Repair apply requires --expect-plan from the reviewed sync preview');
    const source = JSON.parse(await readFile(path.join(root, '.harness/repair-source.json'), 'utf8'));
    if (source.version !== 1 || typeof source.entrypoint !== 'string' || !path.isAbsolute(source.entrypoint) || path.basename(source.entrypoint) !== 'harness.mjs') throw new Error('Invalid install-recorded reusable sync entrypoint');
    const result = spawnSync(process.execPath, [source.entrypoint, 'sync', root, ...argv], { cwd: root, env: process.env, windowsHide: true, stdio: 'inherit' });
    if (result.error) throw result.error; process.exitCode = result.status ?? 1;
  } else throw new Error('Usage: node .harness/repair.mjs health [--json] | sync --preview [--json] | sync --expect-plan SHA256 [--replace-reviewed PATH=SHA256] [--json]');
} catch (error) { console.error('REPAIR: ' + error.message); process.exitCode = 1; }
