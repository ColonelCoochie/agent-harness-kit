#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexHookIdentity } from './native-hook-identity.mjs';

const platform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : 'codex';

try {
  const input = JSON.parse(await readStdin() || '{}');
  if (String(input.hook_event_name || '').toLowerCase() !== 'precompact' || input.trigger !== 'auto') {
    emitContinue();
  } else {
    const root = await findProjectRoot(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
    const runtime = path.join(root, '.harness', 'run.mjs');
    const continuityPath = path.join(root, '.harness', 'continuity.json');
    const continuity = JSON.parse(await readFile(continuityPath, 'utf8'));
    // session_id is shared by parent and subagents. Only a per-invocation
    // worker identity can decide whether this is the owner or routing parent.
    const manualIndex = process.argv.indexOf('--worker-id');
    const explicit = manualIndex >= 0 ? process.argv[manualIndex + 1] : null;
    const nativeClaude = typeof input.agent_id === 'string' && /^[a-zA-Z0-9_./:-]{1,180}$/.test(input.agent_id) ? 'claude-agent:' + input.agent_id : null;
    const actor = platform === 'claude' ? nativeClaude || explicit : await codexHookIdentity(input, root);
    if (platform === 'claude' && nativeClaude && explicit && nativeClaude !== explicit) throw new Error('explicit worker identity conflicts with Claude agent_id');
    if (continuity.phase !== 'awaiting_resume') {
      if (!continuity.owner) { emitContinue(); process.exit(0); }
      if (!actor) throw new Error('hook has no per-worker identity (CODEX_THREAD_ID or Claude agent_id); owner left unchanged');
      if (actor !== continuity.owner.id) { emitContinue(); process.exit(0); }
    }
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
        '--json',
        ...(platform === 'claude' ? ['--worker-id', actor] : [])
      ], root, platform, actor);
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'automatic handoff failed');
      handoffId = JSON.parse(result.stdout).id;
    }
    if (!handoffId) throw new Error('awaiting-resume continuity is missing its handoff ID');
    const message = `Worker handoff ${handoffId} is safely parked. Keep this development orchestrator chat active and delegate one fresh worker without inherited implementation history (Codex fork_turns="none"; Claude fresh non-fork Agent) to run exactly \`node .harness/run.mjs resume ${handoffId}\` before edits; non-Codex workers append their own unique --worker-id to every mutation. The handing-off worker must yield.`;
    if (platform === 'claude') emitContinue();
    else console.log(JSON.stringify({ continue: true, systemMessage: message }));
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

function run(command, commandArgs, cwd, host, actor) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (host === 'claude') delete env.CODEX_THREAD_ID;
    else env.CODEX_THREAD_ID = actor;
    const child = spawn(command, commandArgs, { cwd, windowsHide: true, env });
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
