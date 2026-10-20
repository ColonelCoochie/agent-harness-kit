// Resolve only the invocation's own identity. Hook input is trusted host input;
// this validates local metadata, not an authentication boundary against a caller
// that can forge a hook payload or replace another same-project rollout.
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { nearestHarnessRoot } from './hook-recovery.mjs';

const identity = /^[a-zA-Z0-9_./:-]{1,200}$/;
const rollout = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.jsonl$/i;
// Bound identity parsing independently of transcript length. Read only the first
// complete JSONL record; host instructions routinely exceed one filesystem read.
export const CODEX_SESSION_HEADER_LIMIT = 1024 * 1024;
const headerChunkBytes = 16384;

export async function codexHookIdentity(input, root, environment = process.env) {
  const native = environment.CODEX_THREAD_ID?.trim();
  if (native && !identity.test(native)) throw new Error('invalid native Codex worker identity');
  const supplied = input.transcript_path;
  // Existing hosts with a native per-invocation ID may supply non-rollout
  // telemetry. It cannot override that ID and is never an identity fallback.
  if (native && (!supplied || !rollout.test(path.basename(String(supplied))))) return native;
  if (supplied === undefined || supplied === null || supplied === '') return native || null;
  if (typeof supplied !== 'string' || !path.isAbsolute(supplied) || /^(?:\\\\|\/\/)/.test(supplied)) throw new Error('Codex transcript identity requires an absolute local rollout path');
  const match = rollout.exec(path.basename(supplied));
  if (!match) throw new Error('Codex transcript filename is not a canonical rollout');
  const info = await lstat(supplied);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Codex transcript identity requires a regular local file');
  const file = await open(supplied, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let record;
  try {
    const current = await file.stat();
    if (!current.isFile() || current.dev !== info.dev || current.ino !== info.ino) throw new Error('Codex transcript changed while opening');
    const chunks = [];
    let offset = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(headerChunkBytes, CODEX_SESSION_HEADER_LIMIT + 1 - offset));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) throw new Error('Codex transcript session header is incomplete: no first-record newline before EOF');
      const data = buffer.subarray(0, bytesRead), end = data.indexOf(10);
      if (end >= 0) {
        if (offset + end > CODEX_SESSION_HEADER_LIMIT) throw new Error('Codex transcript session header exceeds the 1 MiB identity bound');
        chunks.push(data.subarray(0, end));
        record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        break;
      }
      offset += bytesRead;
      if (offset > CODEX_SESSION_HEADER_LIMIT) throw new Error('Codex transcript session header exceeds the 1 MiB identity bound');
      chunks.push(data);
    }
  } finally { await file.close(); }
  if (record?.type !== 'session_meta' || record.payload?.id?.toLowerCase() !== match[1].toLowerCase()) throw new Error('Codex transcript session metadata does not match its filename');
  try {
    // A session may start below the project root. Resolve its own nearest
    // canonical installation, rejecting symlinks and distinct nested harnesses.
    if (typeof record.payload.cwd !== 'string' || !path.isAbsolute(record.payload.cwd)
      || nearestHarnessRoot(record.payload.cwd, path) !== nearestHarnessRoot(root, path)) throw new Error('different nearest harness');
  } catch (error) { throw new Error('Codex transcript project does not match hook root: ' + error.message); }
  const actor = match[1].toLowerCase();
  if (native && native.toLowerCase() !== actor) throw new Error('native Codex identity conflicts with own transcript');
  return native || actor;
}
