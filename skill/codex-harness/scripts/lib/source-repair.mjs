import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nearestHarnessRoot, repairArguments, repairRealPath, sourceRepairAuthority } from '../../assets/hook-recovery.mjs';
import { syncHarness } from './core.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const cli = path.join(sourceRoot, 'bin', 'agent-harness.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = /^[a-zA-Z0-9_./:-]{1,200}$/;

function readAuthority(root, environment, workerId) {
  const authority = sourceRepairAuthority(root, cli, path, fs, environment);
  const continuityPath = path.join(root, '.harness', 'continuity.json');
  repairRealPath(continuityPath, path);
  const bytes = fs.readFileSync(continuityPath);
  const continuity = JSON.parse(bytes);
  const owner = continuity.owner ?? null, retired = continuity.retiredWorkerIds === undefined ? [] : continuity.retiredWorkerIds;
  if (!['working', 'awaiting_resume'].includes(continuity.phase)
    || !Array.isArray(retired) || !retired.every(id => typeof id === 'string')
    || !(owner === null || typeof owner?.id === 'string' && identity.test(owner.id))) throw new Error('Malformed repair ownership state');
  if (environment.CODEX_THREAD_ID && workerId && environment.CODEX_THREAD_ID !== workerId) throw new Error('Repair worker identity conflicts with native identity');
  const actor = environment.CODEX_THREAD_ID || workerId || null;
  if (actor !== null && !identity.test(actor)) throw new Error('Invalid native repair identity');
  if (actor && retired.includes(actor)) throw new Error('Retired worker cannot repair');
  if (owner && owner.id !== actor) throw new Error('Repair denied while a distinct worker owns the project');
  if (continuity.phase === 'awaiting_resume' && !continuity.handoff?.id) throw new Error('Malformed pending repair handoff');
  return { ...authority, policyHash: sha(fs.readFileSync(authority.policyPath)), continuityHash: sha(bytes), actor,
    pendingHandoff: continuity.phase === 'awaiting_resume' ? continuity.handoff.id : null };
}

// Authorization comes only from the enabled source policy, attested identity and
// stored ownership. No installed executable or native approval RPC is loaded.
export async function repairHarness(words, { cwd = process.cwd(), environment = process.env, sync = syncHarness } = {}) {
  const root = nearestHarnessRoot(cwd, path);
  const args = repairArguments(words, root, path);
  const authority = readAuthority(root, environment, args.workerId);
  const options = { preview: args.preview, expectedPlanHash: args.expectedPlanHash, replacements: args.replacements,
    repairAuthority: authority, sourceRepair: true, deferHostConfig: true, approveNativeHooks: false,
    validateRepairAuthority: plan => {
      const current = readAuthority(root, environment, args.workerId);
      if (JSON.stringify(current) !== JSON.stringify(authority)) throw new Error('Stale source repair authority; project left unchanged');
      if (current.pendingHandoff && plan.migrations.length) throw new Error('Pending handoff requires migration; repair left transfer unchanged');
    } };
  return { result: await sync(root, options), json: args.json };
}
