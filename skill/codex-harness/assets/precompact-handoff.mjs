#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const platform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : 'codex';

try {
  const input = JSON.parse(await readStdin() || '{}');
  if (String(input.hook_event_name || '').toLowerCase() !== 'precompact' || input.trigger !== 'auto') {
    emitContinue();
  } else {
    const root = await findProjectRoot(input.cwd || process.cwd());
    const runtime = path.join(root, '.harness', 'run.mjs');
    const continuityPath = path.join(root, '.harness', 'continuity.json');
    const continuity = JSON.parse(await readFile(continuityPath, 'utf8'));
    let handoffId = continuity.handoff?.id ?? null;
    if (continuity.phase !== 'awaiting_resume') {
      const result = await run(process.execPath, [
        runtime,
        'handoff',
        '--summary',
        `Automatic ${platform} handoff created before context compaction. Resume from repository state, the active feature contract, and the event trace.`,
        '--reason',
        'context_limit',
        '--agent',
        platform,
        '--automatic',
        '--json'
      ], root);
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'automatic handoff failed');
      handoffId = JSON.parse(result.stdout).id;
    }
    const reason = `Automatic compaction was stopped after writing handoff ${handoffId}. End this conversation, start a fresh task in the same worktree, and run: node .harness/run.mjs resume ${handoffId}`;
    if (platform === 'claude') console.log(JSON.stringify({ decision: 'block', reason }));
    else console.log(JSON.stringify({ continue: false, stopReason: reason, systemMessage: reason }));
  }
} catch (error) {
  const reason = `Could not create the required pre-compaction handoff: ${error.message}. Stop and run node .harness/run.mjs handoff manually before continuing.`;
  if (platform === 'claude') console.log(JSON.stringify({ decision: 'block', reason }));
  else console.log(JSON.stringify({ continue: false, stopReason: reason, systemMessage: reason }));
}

async function readStdin() {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function findProjectRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (await exists(path.join(current, '.harness', 'run.mjs')) && await exists(path.join(current, '.harness', 'continuity.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`no harness root found from ${start}`);
    current = parent;
  }
}

function run(command, commandArgs, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

function emitContinue() {
  if (platform === 'claude') console.log('{}');
  else console.log(JSON.stringify({ continue: true }));
}
