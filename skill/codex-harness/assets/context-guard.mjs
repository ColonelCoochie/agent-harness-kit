#!/usr/bin/env node
// Native hook boundary adapter. It never claims, recovers or resumes ownership.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookRepairCommand, hookFailure } from './hook-recovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const platform = process.argv[process.argv.indexOf('--platform') + 1] ?? 'codex';
let event = '';
let input;
let restoreConservativeCharge;
try {
  let inputText = '', inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += chunk.length;
    if (inputBytes > 4194304) throw new Error('Context hook input exceeds its 4 MiB bound; use bounded tool output.');
    inputText += chunk;
  }
  input = JSON.parse(inputText || '{}');
  event = input.hook_event_name ?? '';
  if (['PreToolUse', 'PostToolUse'].includes(event) && hookRepairCommand(input, root, path)) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: event === 'PostToolUse' ? 'The scoped repair tool already completed; use its result for the next step and do not replay its side effects.' : 'Explicit scoped harness repair remains available; runtime ownership checks still apply.' } }));
    process.exit(0);
  }
  const { contextObservation, contextPolicy } = await import('../context-budget.mjs');
  const { codexHookIdentity } = await import('./native-hook-identity.mjs');
  const config = JSON.parse(await readFile(path.join(root, '.harness/config.json'), 'utf8'));
  const continuity = JSON.parse(await readFile(path.join(root, '.harness/continuity.json'), 'utf8'));
  const nativeActor = platform === 'claude' ? (typeof input.agent_id === 'string' && /^[a-zA-Z0-9_./:-]{1,180}$/.test(input.agent_id) ? 'claude-agent:' + input.agent_id : null) : await codexHookIdentity(input, root);
  // An unidentified native parent gets telemetry partitioning only. session_id
  // never authorizes a worker mutation, handoff, recovery or resume.
  const observer = createHash('sha256').update(platform + ':' + String(input.session_id ?? '') + ':' + String(input.transcript_path ?? '')).digest('hex');
  const actor = nativeActor || 'routing-observer:' + observer;
  const role = nativeActor && continuity.owner?.id === nativeActor ? 'worker' : 'orchestrator';
  const output = event === 'PostToolUse' ? JSON.stringify(input.tool_response ?? input.tool_result ?? '') : '';
  // Persist the redacted result before allowing delivered-result accounting.
  // Hosts without an explicit suppression attestation retain the raw charge.
  const policy = contextPolicy(config);
  let replacement = null, persistenceError;
  if (event === 'PostToolUse' && output.length > policy.perResultChars) {
    try {
      const log = await persistToolLog(output, config);
      const notice = `The tool already completed; do not repeat its side effects. Its ${output.length}-character result exceeded the context display budget. Redacted result: ${log}. Read only the required lines or query a concise summary.`;
      replacement = platform === 'codex' ? { decision: 'block', reason: notice } : { hookSpecificOutput: { hookEventName: event, additionalContext: notice } };
    } catch (error) { persistenceError = error; }
  }
  const deliveredChars = replacement && platform === 'codex' && policy.codexCodeModeResultSuppressionConfirmed
    ? JSON.stringify(replacement).length : output.length;
  const budget = await contextObservation(root, { actor, role, config, event, transcriptPath: input.transcript_path, outputChars: deliveredChars,
    startedAt: role === 'worker' ? continuity.owner.claimedAt : undefined });
  if (deliveredChars < output.length) restoreConservativeCharge = () => contextObservation(root, {
    actor, role, config, event: 'delivery_failed', outputChars: output.length - deliveredChars,
    startedAt: role === 'worker' ? continuity.owner.claimedAt : undefined
  });
  if (persistenceError) throw persistenceError;
  const circuit = budget.reasons.includes('interrupted_goal_loop');
  let reason = `Context pressure (${budget.reasons.join(', ')}). `;
  let pending = continuity.phase === 'awaiting_resume' ? `node .harness/run.mjs resume ${continuity.handoff.id}` : null;
  if (role === 'worker' && budget.pressure === 'rotate' && !pending) {
    const args = [path.join(root, '.harness/run.mjs'), 'handoff', '--reason', 'context_pressure', '--automatic',
      '--summary', `Proactive context boundary: ${budget.reasons.join(' ')}. Reconstruct implementation from scoped repository state.`,
      '--next', 'Use bootstrap --validate --json and scoped sources in a fresh worker then continue the active feature.'];
    if (platform === 'claude') args.push('--worker-id', nativeActor);
    const environment = { ...process.env };
    if (platform === 'claude') delete environment.CODEX_THREAD_ID;
    else environment.CODEX_THREAD_ID = nativeActor;
    const result = spawnSync(process.execPath, args, { cwd: root, env: environment, encoding: 'utf8', windowsHide: true, timeout: 590000, maxBuffer: 32768 });
    if (result.error || result.status !== 0) throw new Error('Context handoff persistence failed; use the owned handoff command before further work.');
    const updated = JSON.parse(await readFile(path.join(root, '.harness/continuity.json'), 'utf8'));
    pending = `node .harness/run.mjs resume ${updated.handoff.id}`;
  }
  reason += role === 'worker' ? `Yield this worker. The orchestrator must delegate one fresh worker without inherited history to run exactly: ${pending}.` :
    'Keep routing concise. Project Codex auto-compaction defaults reserve headroom; use host compaction when available. Do not claim or transfer another worker.';
  if (circuit) reason += ' Repeated interrupted internal goal turns made no tool progress. Stop the current goal continuation; reconcile host goal state before another run.';
  let response = {};
  if (event === 'Stop' && (circuit || role === 'worker' && budget.pressure === 'rotate')) {
    // decision:block at Stop creates another continuation on Codex and Claude.
    // Never turn a pressure circuit breaker into a continuation loop.
    response = { continue: false, stopReason: reason };
  } else if (event === 'UserPromptSubmit' && circuit && (budget.newGoalRecord || input.content_item_kinds?.includes('goal.internal_context'))) response = { decision: 'block', reason };
  else if (event === 'PreToolUse' && role === 'worker' && pending && !managementTool(input)) {
    response = { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason } };
  } else if (replacement) response = replacement;
  else if (budget.notify && ['PreToolUse', 'PostToolUse'].includes(event)) response = { hookSpecificOutput: { hookEventName: event, additionalContext: reason } };
  console.log(JSON.stringify(response));
  restoreConservativeCharge = null;
} catch (error) {
  if (restoreConservativeCharge) {
    try { await restoreConservativeCharge(); }
    catch (accountingError) { error = new Error(error.message + '; conservative accounting restoration failed: ' + accountingError.message); }
  }
  const reason = 'Harness context guard failed: ' + error.message;
  if (event === 'PreToolUse' && input && managementTool(input)) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: reason + ' Explicit harness management remains available; runtime ownership checks still apply.' } }));
  else if (event === 'PreToolUse') console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason + ' Use a narrowly scoped harness management command to inspect continuity.' } }));
  else if (event === 'UserPromptSubmit') console.log(JSON.stringify(hookFailure(input, error.message)));
  else console.log(JSON.stringify({ continue: false, stopReason: reason }));
}

function managementTool(input) {
  const name = String(input.tool_name ?? '');
  if (/(?:^|__|\.)(?:spawn_agent|send_message|followup_task|wait_agent|interrupt_agent|list_agents|wait_threads|get_handoff_status|curr_time)$/.test(name)) return true;
  const value = input.tool_input;
  const command = typeof value === 'string' ? value : value?.cmd ?? value?.command;
  if (typeof command !== 'string' || /[;&|`$\r\n<>]/.test(command)) return false;
  const match = /^\s*node(?:\.exe)?\s+(?:["']([^"']+)["']|(\S+))\s+(?:session|context|bootstrap|claim|resume|doctor|status|next|checkpoint|handoff|verify|block)(?:\s+[^;&|`$\r\n<>]*)?\s*$/.exec(command);
  return Boolean(match && path.resolve(value?.workdir ?? value?.cwd ?? input.cwd ?? root, match[1] ?? match[2]) === path.join(root, '.harness/run.mjs'));
}

async function persistToolLog(output, config) {
  const names = Object.values(config.security?.credentials?.providers ?? {}).flatMap(provider => [...(provider.sources ?? []), provider.targetEnvironment]);
  const secrets = [...new Set([...names, ...Object.keys(process.env).filter(name => /key|secret|token|password|credential/i.test(name))].map(name => process.env[name]).filter(value => typeof value === 'string' && value.length > 0))].sort((a, b) => b.length - a.length);
  let sanitized = output;
  for (const secret of secrets) for (const form of [secret, JSON.stringify(secret).slice(1, -1)]) sanitized = sanitized.split(form).join('[REDACTED]');
  sanitized = sanitized.replace(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_\-]{16,}\b/g, '[REDACTED]')
    .replace(/(?:api[_-]?key|credential|password|private[_-]?key|secret|token)(?:\s*[=:]\s*|\s+)[^\s,;]+/gi, '[REDACTED]')
    .replace(/authorization:\s*(?:bearer|basic)\s+[^\s]+/gi, '[REDACTED]')
    .replace(/("(?:api[_-]?key|credential|password|private[_-]?key|secret|token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"');
  const relative = '.harness/logs/tool-' + randomUUID() + '.log';
  await mkdir(path.join(root, '.harness/logs'), { recursive: true });
  await writeFile(path.join(root, relative), sanitized + '\n', { mode: 0o600 });
  return relative;
}
