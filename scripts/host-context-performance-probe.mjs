import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextObservation } from '../.harness/context-budget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const beforePath = '.harness/context-performance-001/host-probe-before.json';
const marker = 'AHK_PATCHED_HOST_PROBE_20261016_';
const sha = value => createHash('sha256').update(value).digest('hex');
if (process.argv[2] === '--emit') {
  const config = JSON.parse(await readFile(path.join(root, '.harness/config.json')));
  assert.equal(config.context.codexCodeModeResultSuppressionConfirmed, true);
  const actor = process.env.CODEX_THREAD_ID;
  assert(actor);
  const observation = await contextObservation(root, { actor, role: 'orchestrator', persist: false });
  await writeFile(path.join(root, beforePath), JSON.stringify({ version: 1, actor, marker, observation, createdAt: new Date().toISOString() }) + '\n', { flag: 'wx' });
  console.log(marker + 'Q'.repeat(6500));
} else if (process.argv[2] === '--observe') {
  const before = JSON.parse(await readFile(path.join(root, beforePath)));
  assert.equal(before.actor, process.env.CODEX_THREAD_ID);
  const after = await contextObservation(root, { actor: before.actor, role: 'orchestrator', persist: false });
  const matches = [];
  for (const name of await readdir(path.join(root, '.harness/logs'))) {
    if (!/^tool-.*\.log$/.test(name)) continue;
    const relative = '.harness/logs/' + name;
    const bytes = await readFile(path.join(root, relative));
    const text = bytes.toString('utf8');
    if (text.includes(marker) && text.includes('Q'.repeat(6500))) matches.push({ relative, bytes, text });
  }
  assert.equal(matches.length, 1, 'The actual native hook must persist exactly one matching result.');
  const log = matches[0], rawChars = log.text.length - 1;
  const reason = `The tool already completed; do not repeat its side effects. Its ${rawChars}-character result exceeded the context display budget. Redacted result: ${log.relative}. Read only the required lines or query a concise summary.`;
  const expected = JSON.stringify({ decision: 'block', reason }).length;
  const delta = after.outputChars - before.observation.outputChars;
  assert.equal(delta, expected, 'Actual native delivered-output charge must equal the emitted replacement.');
  console.log(JSON.stringify({ version: 1, kind: 'actual-native-codex-delivered-result-probe', pass: true, actor: before.actor, rawChars, expected, delta,
    toolCallsDelta: after.toolCalls - before.observation.toolCalls, before: beforePath, log: { path: log.relative, bytes: log.bytes.length, sha256: sha(log.bytes) } }));
} else throw new Error('Use --emit once, then --observe after the native PostToolUse result.');
