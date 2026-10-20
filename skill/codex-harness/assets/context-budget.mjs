// Repository-development context accounting. No provider calls or prompt bodies
// are persisted. Transcript schemas are best-effort host telemetry, not authority.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CONTEXT_DEFAULTS = Object.freeze({
  version: 1,
  worker: { maxAgeMs: 1200000, maxMutations: 48, maxToolCalls: 80, maxOutputChars: 120000 },
  orchestrator: { maxAgeMs: 7200000, maxMutations: 48, maxToolCalls: 160, maxOutputChars: 160000 },
  pressureRatio: 0.65, reserveTokens: 24000, maxEstimatedTokens: 120000,
  maxUnmeasuredBytes: 240000, staleUsageMs: 300000, staleGrowthBytes: 48000,
  maxInterruptedGoals: 6, scanBytes: 1048576, maxLineBytes: 262144,
  perResultChars: 6000, perRunChars: 16000,
  codexCodeModeResultSuppressionConfirmed: false
});

export function contextPolicy(config = {}) {
  const input = config.context ?? {};
  const result = { ...CONTEXT_DEFAULTS, ...input,
    worker: { ...CONTEXT_DEFAULTS.worker, ...input.worker },
    orchestrator: { ...CONTEXT_DEFAULTS.orchestrator, ...input.orchestrator } };
  if (result.version !== 1) throw new Error('Unsupported context budget version.');
  for (const [key, value] of Object.entries(result)) {
    if (key === 'codexCodeModeResultSuppressionConfirmed') {
      if (typeof value !== 'boolean') throw new Error('codexCodeModeResultSuppressionConfirmed must be a boolean.');
    } else if (['worker', 'orchestrator'].includes(key)) {
      for (const number of Object.values(value)) if (!Number.isFinite(number) || number <= 0) throw new Error('Context budgets must be positive finite numbers.');
    } else if (!Number.isFinite(value) || value <= 0) throw new Error('Context budgets must be positive finite numbers.');
  }
  if (result.pressureRatio >= 1 || result.scanBytes > 8388608 || result.maxLineBytes > result.scanBytes) throw new Error('Invalid context pressure ratio or transcript scan bounds.');
  return result;
}

const digest = value => createHash('sha256').update(value).digest('hex');
const emptyTelemetry = () => ({ status: 'unavailable', bytesSinceUsage: 0, interruptedGoals: 0, goalPrompts: 0, interruptions: 0 });

// Only metadata fields are inspected. In particular, content[].text and tool
// arguments/results are never used for classification, hashes, logs or state.
export function transcriptRecord(record) {
  const payload = record?.payload ?? {};
  const kind = payload.type ?? record?.type;
  if (record?.type === 'compacted' || kind === 'context_compacted') return { compacted: true };
  if (kind === 'token_count') {
    const info = payload.info ?? record.info;
    const usage = info?.last_token_usage;
    const used = Number(usage?.total_tokens ?? (Number(usage?.input_tokens) + Number(usage?.output_tokens)));
    const limit = Number(info?.model_context_window);
    if (Number.isFinite(used) && used >= 0) return { usage: { tokens: used, limit: Number.isFinite(limit) && limit > 0 ? limit : null, at: record.timestamp ?? null } };
  }
  if (record?.type === 'response_item' && kind === 'message' && payload.role === 'user') {
    const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds;
    return { goal: Array.isArray(kinds) && kinds.includes('goal.internal_context'), user: true };
  }
  if (kind === 'turn_aborted') return { interrupted: true };
  if (['function_call', 'custom_tool_call', 'tool_use', 'task_complete'].includes(kind)) return { progress: true };
  return {};
}

export async function transcriptMetadata(transcriptPath, previous = emptyTelemetry(), policy = CONTEXT_DEFAULTS) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return { ...previous, status: 'unavailable' };
  let file;
  try {
    const info = await stat(transcriptPath);
    if (!info.isFile()) return { ...previous, status: 'unavailable' };
    const identity = digest(path.resolve(transcriptPath) + ':' + info.dev + ':' + info.ino);
    const same = previous.identity === identity && info.size >= Number(previous.offset ?? 0);
    let value = same ? { ...previous } : { ...emptyTelemetry(), identity, epoch: (previous.epoch ?? 0) + 1 };
    const oldOffset = same ? Number(previous.offset ?? 0) : 0;
    const start = Math.max(oldOffset, info.size - policy.scanBytes);
    const skipped = start > oldOffset;
    file = await open(transcriptPath, 'r');
    const bytes = Buffer.alloc(Math.min(policy.scanBytes, info.size - start));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, start);
    const chunk = bytes.subarray(0, bytesRead);
    // Skip an incomplete first line after a bounded catch-up. Do not retain any
    // partial prompt text across calls; reread an incomplete final line later.
    let cursor = start;
    let lineStart = 0;
    if (skipped) {
      const newline = chunk.indexOf(10);
      if (newline < 0) return { ...value, status: 'uncertain', offset: info.size, observedSize: info.size, bytesSinceUsage: (value.bytesSinceUsage ?? 0) + Math.max(0, info.size - Number(previous.observedSize ?? 0)) };
      lineStart = newline + 1; cursor += lineStart;
    }
    let recognized = 0, malformed = 0;
    for (let end = chunk.indexOf(10, lineStart); end >= 0; end = chunk.indexOf(10, lineStart)) {
      const length = end - lineStart;
      cursor = start + end + 1;
      if (length <= policy.maxLineBytes) {
        try {
          const item = transcriptRecord(JSON.parse(chunk.subarray(lineStart, end).toString('utf8')));
          if (Object.keys(item).length) recognized++;
          if (item.compacted) value = { ...emptyTelemetry(), identity, epoch: (value.epoch ?? 0) + 1, usageOffset: cursor, compacted: true };
          if (item.usage) {
            // A new physical usage event is a sample even when its numeric
            // value is unchanged. Never trust an older event from a tail scan.
            if (cursor > Number(value.usageOffset ?? 0)) value = { ...value, usage: item.usage, usageOffset: cursor, bytesSinceUsage: 0 };
          }
          if (item.progress) { value.goalPrompts = 0; value.interruptions = 0; }
          if (item.user && !item.goal) { value.goalPrompts = 0; value.interruptions = 0; }
          if (item.goal) value.goalPrompts = (value.goalPrompts ?? 0) + 1;
          if (item.user) value.lastUserGoal = item.goal;
          if (item.goal) value.lastGoalOffset = cursor;
          if (item.interrupted) value.interruptions = (value.interruptions ?? 0) + 1;
        } catch { malformed++; }
      } else malformed++;
      lineStart = end + 1;
    }
    const usageOffset = Number(value.usageOffset ?? 0);
    // File bytes conservatively include unrecognized records and oversized
    // lines. They cannot disappear just because token telemetry went stale.
    value.bytesSinceUsage = usageOffset ? Math.max(0, info.size - usageOffset) : (same ? Number(previous.bytesSinceUsage ?? 0) + Math.max(0, info.size - Number(previous.observedSize ?? oldOffset)) : info.size);
    value.interruptedGoals = Math.min(value.goalPrompts ?? 0, value.interruptions ?? 0);
    value.status = malformed || skipped ? 'uncertain' : recognized || value.usage ? 'estimated' : 'unrecognized';
    value.offset = cursor;
    value.observedSize = info.size;
    return value;
  } catch { return { ...previous, status: 'unavailable' }; }
  finally { await file?.close().catch(() => {}); }
}

export function evaluateContext(state, policy, now = Date.now()) {
  const limits = policy[state.role === 'worker' ? 'worker' : 'orchestrator'];
  const reasons = [];
  const ageMs = Math.max(0, now - Date.parse(state.startedAt));
  if (ageMs >= limits.maxAgeMs) reasons.push('actor_age');
  for (const [field, limit] of [['mutations', 'maxMutations'], ['toolCalls', 'maxToolCalls'], ['outputChars', 'maxOutputChars']]) if (Number(state[field] ?? 0) >= limits[limit]) reasons.push(field);
  const telemetry = state.telemetry ?? emptyTelemetry();
  const growth = Number(telemetry.bytesSinceUsage ?? 0);
  const estimate = Number(telemetry.usage?.tokens ?? 0) + Math.ceil(growth / 3);
  const window = telemetry.usage?.limit;
  const tokenLimit = window ? Math.min(window * policy.pressureRatio, window - policy.reserveTokens) : policy.maxEstimatedTokens;
  if (estimate >= tokenLimit) reasons.push('estimated_context');
  if (growth >= policy.maxUnmeasuredBytes) reasons.push('unmeasured_growth');
  const sampleAt = Date.parse(telemetry.usage?.at);
  if (growth >= policy.staleGrowthBytes && Number.isFinite(sampleAt) && now - sampleAt >= policy.staleUsageMs) reasons.push('stale_usage');
  if (Number(telemetry.interruptedGoals ?? 0) >= policy.maxInterruptedGoals) reasons.push('interrupted_goal_loop');
  return { pressure: reasons.length ? 'rotate' : 'ok', role: state.role, reasons, ageMs, mutations: state.mutations ?? 0, toolCalls: state.toolCalls ?? 0, outputChars: state.outputChars ?? 0,
    estimatedTokens: estimate, tokenLimit: Math.max(0, Math.floor(tokenLimit)), telemetry: telemetry.status, interruptedGoals: telemetry.interruptedGoals ?? 0 };
}

export async function contextObservation(root, options = {}) {
  if (options.persist === false) return updateContext(root, options);
  if (typeof options.actor !== 'string' || !options.actor.trim()) throw new Error('Context accounting requires the actual actor identity.');
  const directory = path.join(root, '.harness', 'context');
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, digest(options.actor) + '.lock');
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await mkdir(lock); acquired = true; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  if (!acquired) throw new Error('Context actor accounting is busy. Retry the boundary after the current hook finishes; inspect abandoned locks only after host termination.');
  try { return await updateContext(root, options); } finally { await rmdir(lock); }
}

async function updateContext(root, { actor, role, config = {}, event = 'inspect', transcriptPath, outputChars = 0, toolCalls = 0, startedAt, persist = true } = {}) {
  if (typeof actor !== 'string' || !actor.trim()) throw new Error('Context accounting requires the actual actor identity; shared session_id is not an identity.');
  const policy = contextPolicy(config);
  const directory = path.join(root, '.harness', 'context');
  const target = path.join(directory, digest(actor) + '.json');
  let state;
  try { state = JSON.parse(await readFile(target, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Context accounting state is unreadable; inspect it before continuing.'); }
  state = state ?? { version: 1, actorHash: digest(actor), role, startedAt: startedAt ?? new Date().toISOString(), mutations: 0, toolCalls: 0, outputChars: 0, telemetry: emptyTelemetry() };
  if (state.version !== 1 || state.actorHash !== digest(actor)) throw new Error('Context accounting state identity is invalid.');
  state.role = role;
  const oldGoalOffset = state.telemetry.lastGoalOffset ?? 0;
  state.telemetry = await transcriptMetadata(transcriptPath, state.telemetry, policy);
  if (state.telemetry.compacted) {
    // Compaction releases the orchestrator's context pressure. Worker identity
    // still ends only through the owned checkpoint/handoff protocol.
    if (role === 'orchestrator') { state.startedAt = new Date().toISOString(); state.toolCalls = 0; state.outputChars = 0; }
    delete state.telemetry.compacted;
  }
  if (event === 'mutation') state.mutations++;
  if (event === 'PreToolUse') state.toolCalls++;
  state.toolCalls += Math.max(0, Number(toolCalls) || 0);
  state.outputChars += Math.max(0, Number(outputChars) || 0);
  state.updatedAt = new Date().toISOString();
  const evaluation = evaluateContext(state, policy);
  const signature = evaluation.reasons.join(',');
  const notify = evaluation.pressure !== 'ok' && state.lastNotice !== signature;
  state.lastNotice = evaluation.pressure === 'ok' ? null : signature;
  if (persist) {
    await mkdir(directory, { recursive: true });
    const temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(state) + '\n', { mode: 0o600 });
    await rename(temporary, target);
  }
  return { ...evaluation, notify, newGoalRecord: state.telemetry.lastUserGoal === true && Number(state.telemetry.lastGoalOffset ?? 0) > oldGoalOffset, policy };
}
