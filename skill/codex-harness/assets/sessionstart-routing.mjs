#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let raw = '';
const platformIndex = process.argv.indexOf('--platform');
const platform = platformIndex >= 0 ? process.argv[platformIndex + 1] : 'codex';
const fresh = platform === 'claude' ? 'a fresh non-fork Claude Agent with no inherited implementation transcript' : 'a fresh worker using fork_turns="none"';
for await (const chunk of process.stdin) raw += chunk;
try {
  const input = JSON.parse(raw || '{}');
  if (input.hook_event_name !== 'SessionStart' || input.source !== 'compact') {
    console.log(JSON.stringify({ continue: true }));
  } else {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, '.harness/run.mjs'), 'session', '--json'], { cwd: root, windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
    });
    const route = result.action === 'await_user'
      ? 'Keep the orchestrator in this chat and obtain the recorded user decision before delegating the pending work. Do not resume until that input arrives.'
      : result.phase === 'awaiting_resume'
      ? 'Delegate ' + fresh + ', without loading its packet. Exact resume command: ' + result.resumeCommand + (platform === 'claude' ? ' --worker-id <identity delivered by SubagentStart to the new child>' : '')
      : result.owner
        ? 'Existing worker ' + result.owner.id + ' owns repository mutations. Keep the orchestrator routing only; inspect or await that worker. Do not claim, resume or replace its ownership.'
        : result.action === 'await_user'
          ? 'Keep the orchestrator in this chat and obtain the recorded user decision before delegating work.'
          : 'Delegate ' + fresh + '. It runs node .harness/run.mjs claim' + (platform === 'claude' ? ' --worker-id <identity delivered by SubagentStart to the new child>; append that identity on every mutation' : '') + ', then bootstrap --validate --json before edits.';
    console.log(JSON.stringify({ continue: true, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Repository development continuity after compaction. ' + route + ' Never resume work in the compacted implementation context. Keep product runtime independent of .harness/.' } }));
  }
} catch (error) {
  console.log(JSON.stringify({ continue: false, stopReason: 'Unable to restore bounded worker routing: ' + error.message }));
}
