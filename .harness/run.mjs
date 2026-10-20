#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, appendFile, lstat, mkdir, open, opendir, readFile, readdir, readlink, realpath, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { appendFileSync, closeSync, openSync } from 'node:fs';
import { contextObservation, contextPolicy } from './context-budget.mjs';

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HARNESS_DIR, '..');
const CONFIG_PATH = path.join(HARNESS_DIR, 'config.json');
const FEATURES_PATH = path.join(HARNESS_DIR, 'features.json');
const CONTINUITY_PATH = path.join(HARNESS_DIR, 'continuity.json');
const PROGRESS_PATH = path.join(HARNESS_DIR, 'progress.md');
const HANDOFF_PATH = path.join(HARNESS_DIR, 'handoff.md');
const CONTINUITY_HISTORY_DIR = path.join(HARNESS_DIR, 'history', 'progress');
const EVIDENCE_DIR = path.join(HARNESS_DIR, 'evidence');
const CREDENTIAL_STATE_PATH = path.join(HARNESS_DIR, 'credentials-state.json');
const HARNESS_RUNTIME_VERSION = 6;
const EVIDENCE_SCHEMA_VERSION = 5;
const VERIFICATION_PLAN_SCHEMA_VERSION = 2;
const STATE_SCHEMA_VERSION = 1;
const CONTINUITY_SCHEMA_VERSION = 1;
const STATE_LOCK_OWNER_PREFIX = 'owner-';
const STATE_LOCK_OWNER_SUFFIX = '.json';
const LEGACY_STATE_LOCK_OWNER = 'owner.json';
const STATE_LOCK_ORPHAN_AGE_MS = 300000;
const STATE_LOCK_MAX_ACQUIRE_ATTEMPTS = 8;
const DEFAULT_GIT_CAPTURE_MAX_BYTES = 8 * 1024 * 1024;
const REPOSITORY_CAPTURE_LIMITS = Object.freeze({ entries: 32768, manifestBytes: 16 * 1024 * 1024, depth: 64, elapsedMs: 300000, fileBytes: 16 * 1024 * 1024 * 1024 });
// Only deliberately selected generated output types may use metadata fingerprints.
// Code, configuration, contracts and JSON manifests always retain byte capture.
const ARTIFACT_METADATA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.zip', '.gz', '.fbx', '.rbxl', '.rbxlx', '.rbxm', '.rbxmx', '.log']);
const GIT_CAPTURE_MAX_BYTES = configuredGitCaptureLimit();
const STATES = new Set(['not_started', 'active', 'blocked', 'passing']);
const CONTINUITY_PHASES = new Set(['working', 'awaiting_resume']);
const RUNTIME_OWNED_PATHS = [
  '.harness/features.json',
  '.harness/baselines/**',
  '.harness/events.jsonl',
  '.harness/evidence/**',
  '.harness/credentials-state.json',
  '.harness/continuity.json',
  '.harness/progress.md',
  '.harness/handoff.md',
  '.harness/history/progress/**',
  '.harness/state.lock/**'
  ,'.harness/context/**', '.harness/logs/**'
];
const CONTINUITY_OWNED_PATHS = [
  '.harness/events.jsonl',
  '.harness/continuity.json',
  '.harness/progress.md',
  '.harness/handoff.md',
  '.harness/history/progress/**',
  '.harness/state.lock/**'
  ,'.harness/context/**', '.harness/logs/**'
];
const rawArgv = process.argv.slice(2);
const args = parseArgs(rawArgv);
const command = args._[0] ?? (args.help ? 'help' : null);
const AGENT_INSTRUCTIONS = {
  codex: 'AGENTS.md',
  claude: 'CLAUDE.md',
  'github-copilot': '.github/copilot-instructions.md'
};
const DEVELOPMENT_HARNESS_BOUNDARY = '## Development-Harness Boundary';
const ORCHESTRATED_WORKER_PROTOCOL = 'ORCHESTRATED_WORKER_CONTINUITY_V1';
const COMMAND_OPTIONS = Object.freeze({
  session: new Set(['json']),
  context: new Set(['json', 'observe', 'toolCalls', 'outputChars', 'transcript']),
  bootstrap: new Set(['id', 'json', 'validate', 'integrity']),
  claim: new Set(['json']),
  recover: new Set(['expectedOwner', 'reason', 'confirmedTerminated', 'json']),
  migrate: new Set(['json']),
  resume: new Set(['id', 'acceptDrift', 'json']),
  doctor: new Set(['integrity']),
  status: new Set(),
  next: new Set(['json']),
  add: new Set(['id', 'title', 'description', 'criterion', 'acceptCommand', 'command', 'depends', 'level', 'require', 'allow', 'allowAll', 'deny', 'credential', 'credentials']),
  start: new Set(['id']),
  block: new Set(['id', 'reason']),
  unblock: new Set(['id']),
  check: new Set(['level']),
  verify: new Set(['id']),
  credentials: new Set(['json']),
  checkpoint: new Set(['summary', 'next', 'reason', 'decision', 'blocker', 'evidence', 'agent', 'automatic', 'json']),
  handoff: new Set(['summary', 'next', 'reason', 'decision', 'blocker', 'evidence', 'agent', 'automatic', 'json']),
  trace: new Set(['id'])
});
const COMMAND_USAGE = Object.freeze({
  session: 'node .harness/run.mjs session [--json]',
  context: 'node .harness/run.mjs context [--observe] [--tool-calls N] [--output-chars N] [--transcript PATH] [--json]',
  bootstrap: 'node .harness/run.mjs bootstrap [ID] [--validate] [--integrity] [--json]',
  claim: 'node .harness/run.mjs claim [--json]',
  recover: 'node .harness/run.mjs recover --expected-owner ID --reason TEXT --confirmed-terminated [--json]',
  migrate: 'node .harness/run.mjs migrate [--json]',
  resume: 'node .harness/run.mjs resume HANDOFF_ID [--accept-drift] [--json]',
  doctor: 'node .harness/run.mjs doctor [--integrity]',
  status: 'node .harness/run.mjs status',
  next: 'node .harness/run.mjs next [--json]',
  add: 'node .harness/run.mjs add ID --title TEXT --description TEXT --criterion TEXT --command CMD --allow GLOB [options]',
  start: 'node .harness/run.mjs start ID',
  block: 'node .harness/run.mjs block ID --reason TEXT',
  unblock: 'node .harness/run.mjs unblock ID',
  check: 'node .harness/run.mjs check [quick|full|e2e|architecture|clean]',
  verify: 'node .harness/run.mjs verify [ID]',
  credentials: 'node .harness/run.mjs credentials [--json]',
  checkpoint: 'node .harness/run.mjs checkpoint --summary TEXT [--next TEXT] [--reason REASON] [--decision TEXT] [--blocker TEXT] [--evidence PATH] [--json]',
  handoff: 'node .harness/run.mjs handoff --summary TEXT [--next TEXT] [--reason TEXT] [--agent NAME] [--decision TEXT] [--blocker TEXT] [--evidence PATH] [--json]',
  trace: 'node .harness/run.mjs trace ID'
});

try {
  if (helpRequested(rawArgv) || !command || command === 'help') {
    printHelp(command === 'help' ? args._[1] : command);
  } else {
    validateCommandOptions(command, args, rawArgv);
    if (command === 'session') await continuityStatus();
    else if (command === 'context') await contextStatus();
    else if (command === 'bootstrap') await workerBootstrap();
    else if (command === 'claim') await withStateLock(claimWorker);
    else if (command === 'recover') await withStateLock(recoverWorker);
    else if (command === 'migrate') await withStateLock(() => whileWorking(migrateBaselines));
    else if (command === 'resume') await withStateLock(resumeHandoff);
    else if (command === 'doctor') await doctor();
    else if (command === 'status') await status();
    else if (command === 'next') await nextFeature();
    else if (command === 'add') await withStateLock(() => whileWorking(addFeature));
    else if (command === 'start') await withStateLock(() => whileWorking(startFeature));
    else if (command === 'block') await withStateLock(() => whileWorking(blockFeature));
    else if (command === 'unblock') await withStateLock(() => whileWorking(unblockFeature));
    else if (command === 'check') await withStateLock(() => whileWorking(checkLevel));
    else if (command === 'verify') await withStateLock(() => whileWorking(verifyFeature));
    else if (command === 'credentials') await credentialsStatus();
    else if (command === 'checkpoint') await withStateLock(() => whileWorking(writeCheckpoint));
    else if (command === 'handoff') await withStateLock(writeHandoff);
    else if (command === 'trace') await traceFeature();
    else throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}

function helpRequested(argv) {
  return argv.some((token) => token === '-h' || token === '--help' || token.startsWith('--help='));
}

function validateCommandOptions(name, parsed, argv) {
  const allowed = COMMAND_OPTIONS[name];
  if (!allowed) throw new Error(`Unknown command: ${name}`);
  const unknown = Object.keys(parsed)
    .filter((key) => key !== '_' && !allowed.has(key) && key !== 'workerId')
    .map(optionName);
  unknown.push(...shortOptions(argv));
  const unique = [...new Set(unknown)];
  if (unique.length) throw new Error(`Unknown options for ${name}: ${unique.join(', ')}. Run node .harness/run.mjs ${name} --help for usage.`);
}

function shortOptions(argv) {
  const found = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      if (!token.includes('=') && argv[index + 1] && !argv[index + 1].startsWith('--')) index += 1;
      continue;
    }
    if (token !== '-' && token !== '-h' && token.startsWith('-')) found.push(token);
  }
  return found;
}

function optionName(key) {
  if (!key) return '--';
  return `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = inline ?? (argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true);
    if (Object.hasOwn(result, key)) {
      result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
    } else result[key] = value;
  }
  return result;
}

function configuredGitCaptureLimit() {
  const configured = Number(process.env.AGENT_HARNESS_GIT_CAPTURE_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured >= 1024
    ? configured
    : DEFAULT_GIT_CAPTURE_MAX_BYTES;
}

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function readJson(target) {
  return JSON.parse(await readFile(target, 'utf8'));
}

async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
}

async function writeJson(target, value) {
  await atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function exclusiveJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function withStateLock(operation) {
  const lockDir = path.join(HARNESS_DIR, 'state.lock');
  const lock = await acquireStateLock(lockDir, command);
  try {
    return await operation();
  } finally {
    await releaseStateLock(lock);
  }
}

async function acquireStateLock(lockDir, lockCommand) {
  for (let attempt = 0; attempt < STATE_LOCK_MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockDir);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const observation = await inspectStateLock(lockDir);
      if (await recoverStateLock(lockDir, observation)) continue;
      throw stateLockError(observation);
    }

    const token = randomUUID();
    const ownerPath = path.join(lockDir, stateLockOwnerName(token));
    const owner = {
      version: 1,
      pid: process.pid,
      token,
      command: String(lockCommand || 'runtime'),
      acquiredAt: new Date().toISOString()
    };
    try {
      await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      return { lockDir, ownerPath, token };
    } catch (error) {
      await unlink(ownerPath).catch(() => {});
      await removeEmptyLockDirectory(lockDir);
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  throw new Error('Harness state lock changed repeatedly during acquisition; retry the operation.');
}

async function releaseStateLock(lock) {
  const snapshot = await readLockFile(lock.ownerPath);
  if (snapshot.missing || snapshot.value?.token !== lock.token) return;
  try {
    await unlink(lock.ownerPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await removeEmptyLockDirectory(lock.lockDir);
}

async function inspectStateLock(lockDir) {
  let directory;
  let entries;
  try {
    [directory, entries] = await Promise.all([stat(lockDir), readdir(lockDir)]);
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing', ageMs: 0 };
    throw error;
  }

  const ownerFiles = entries.filter((name) => name === LEGACY_STATE_LOCK_OWNER || stateLockTokenFromName(name));
  const unknownFiles = entries.filter((name) => !ownerFiles.includes(name));
  const validOwners = [];
  const invalidOwners = [];
  for (const name of ownerFiles) {
    const ownerPath = path.join(lockDir, name);
    const snapshot = await readLockFile(ownerPath);
    if (snapshot.missing) return { kind: 'retry', ageMs: 0 };
    const expectedToken = name === LEGACY_STATE_LOCK_OWNER ? null : stateLockTokenFromName(name);
    if (isValidLockOwner(snapshot.value, expectedToken)) {
      validOwners.push({ ...snapshot, name, path: ownerPath, expectedToken });
    } else invalidOwners.push({ ...snapshot, name, path: ownerPath });
  }

  const common = {
    ageMs: Math.max(0, Date.now() - directory.mtimeMs),
    identity: stateLockIdentity(directory),
    invalidOwners,
    unknownFiles
  };
  if (validOwners.length === 1) return { kind: 'owned', owner: validOwners[0], ...common };
  if (validOwners.length > 1) return { kind: 'ambiguous', owners: validOwners, ...common };
  return { kind: 'orphan', ...common };
}

async function recoverStateLock(lockDir, observation) {
  if (observation.kind === 'missing' || observation.kind === 'retry') return true;
  if (observation.kind === 'ambiguous') return false;

  if (observation.kind === 'owned') {
    if (processLiveness(observation.owner.value.pid) !== 'dead') return false;
    if (!await stateLockIdentityMatches(lockDir, observation.identity)) return true;
    const current = await readLockFile(observation.owner.path);
    if (current.missing) return true;
    if (current.raw !== observation.owner.raw || !isValidLockOwner(current.value, observation.owner.expectedToken)) return false;
    if (processLiveness(current.value.pid) !== 'dead') return false;
    try {
      await unlink(observation.owner.path);
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
    return removeEmptyLockDirectory(lockDir);
  }

  if (observation.ageMs <= STATE_LOCK_ORPHAN_AGE_MS || observation.unknownFiles.length > 0) return false;
  if (!await stateLockIdentityMatches(lockDir, observation.identity)) return true;
  for (const owner of observation.invalidOwners) {
    const current = await readLockFile(owner.path);
    if (current.missing) return true;
    if (current.raw !== owner.raw) return false;
  }
  for (const owner of observation.invalidOwners) {
    try {
      await unlink(owner.path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return removeEmptyLockDirectory(lockDir);
}

function stateLockError(observation) {
  const age = Math.round((observation.ageMs ?? 0) / 1000);
  const owner = observation.kind === 'owned' ? observation.owner.value : null;
  const ownerText = Number.isInteger(owner?.pid) ? ` pid=${owner.pid}` : '';
  const detail = observation.kind === 'ambiguous'
    ? ' ambiguous ownership'
    : observation.kind === 'orphan' ? ' owner metadata unavailable' : '';
  return new Error(`Harness state is locked by another operation (${age}s old${ownerText}${detail}).`);
}

function stateLockOwnerName(token) {
  return `${STATE_LOCK_OWNER_PREFIX}${token}${STATE_LOCK_OWNER_SUFFIX}`;
}

function stateLockTokenFromName(name) {
  if (!name.startsWith(STATE_LOCK_OWNER_PREFIX) || !name.endsWith(STATE_LOCK_OWNER_SUFFIX)) return null;
  const token = name.slice(STATE_LOCK_OWNER_PREFIX.length, -STATE_LOCK_OWNER_SUFFIX.length);
  return token || null;
}

function isValidLockOwner(owner, expectedToken) {
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return false;
  return expectedToken === null || owner.token === expectedToken;
}

async function readLockFile(target) {
  try {
    const raw = await readFile(target, 'utf8');
    try {
      return { raw, value: JSON.parse(raw), missing: false };
    } catch {
      return { raw, value: null, missing: false };
    }
  } catch (error) {
    if (error.code === 'ENOENT') return { raw: null, value: null, missing: true };
    throw error;
  }
}

function stateLockIdentity(info) {
  return `${info.dev}:${info.ino}:${info.birthtimeMs}`;
}

async function stateLockIdentityMatches(lockDir, expected) {
  try {
    return stateLockIdentity(await stat(lockDir)) === expected;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function removeEmptyLockDirectory(lockDir) {
  try {
    await rmdir(lockDir);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST' || error.code === 'EPERM') return false;
    throw error;
  }
}

function processLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown';
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error.code === 'EPERM') return 'alive';
    if (error.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

async function appendEvent(type, data = {}) {
  const event = {
    version: 1,
    id: `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 10)}`,
    type,
    at: new Date().toISOString(),
    ...data
  };
  await appendFile(path.join(HARNESS_DIR, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

function stableHash(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

async function load() {
  if (!await exists(CONFIG_PATH) || !await exists(FEATURES_PATH)) {
    throw new Error('Harness state is missing. Re-run the reusable initializer.');
  }
  const config = await readJson(CONFIG_PATH);
  const state = await readJson(FEATURES_PATH);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('config.json must contain an object.');
  if (!state || typeof state !== 'object' || !Array.isArray(state.features)) throw new Error('features.json must contain a features array.');
  return { config, state };
}

// Baselines are immutable content-addressed records. Keep the entire legacy object,
// including diagnostic output, so representation migration does not rewrite history.
async function storeBaseline(baseline) {
  const content = JSON.stringify(baseline);
  const sha256 = createHash('sha256').update(content).digest('hex');
  const relative = '.harness/baselines/' + sha256 + '.json';
  const target = path.join(ROOT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  if (await exists(target)) {
    if (await readFile(target, 'utf8') !== content) throw new Error('Immutable baseline collision: ' + relative);
  } else {
    const temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, target);
  }
  return { version: 1, path: relative, sha256, bytes: Buffer.byteLength(content), baselineHash: baseline.baselineHash ?? null };
}

async function resolveBaseline(feature) {
  if (!feature.scopeBaselineRef) return feature.scopeBaseline;
  if (feature.scopeBaseline) throw new Error('Ambiguous inline and referenced baseline for ' + feature.id);
  const ref = feature.scopeBaselineRef;
  if (ref.version !== 1 || !/^[a-f0-9]{64}$/.test(ref.sha256) || ref.path !== '.harness/baselines/' + ref.sha256 + '.json') throw new Error('Invalid baseline reference for ' + feature.id);
  const info = await lstat(path.join(ROOT, ref.path));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Baseline must be a regular immutable file');
  const content = await readFile(path.join(ROOT, ref.path));
  if (content.length !== ref.bytes || createHash('sha256').update(content).digest('hex') !== ref.sha256) throw new Error('Baseline integrity mismatch for ' + feature.id);
  const baseline = JSON.parse(content);
  if ((baseline.baselineHash ?? null) !== ref.baselineHash) throw new Error('Baseline reference identity mismatch');
  return baseline;
}

async function migrateBaselines() {
  const { state } = await load();
  let migrated = 0;
  for (const feature of state.features) {
    if (feature.scopeBaseline && feature.scopeBaselineRef) throw new Error('Ambiguous baseline for ' + feature.id);
    if (!feature.scopeBaseline) continue;
    feature.scopeBaselineRef = await storeBaseline(feature.scopeBaseline);
    delete feature.scopeBaseline;
    migrated++;
  }
  // No feature revision, contracts, status, timestamps, or evidence changes.
  if (migrated) await writeJson(FEATURES_PATH, state);
  console.log(JSON.stringify({ migrated, features: state.features.length }));
}

function workerIdentity() {
  const host = process.env.CODEX_THREAD_ID?.trim();
  const explicit = typeof args.workerId === 'string' ? args.workerId.trim() : null;
  if (host && explicit && host !== explicit) throw new Error('--worker-id conflicts with host CODEX_THREAD_ID');
  const id = host || explicit;
  if (!id || !/^[a-zA-Z0-9_./:-]{1,200}$/.test(id)) throw new Error('Worker identity required: CODEX_THREAD_ID or explicit --worker-id for hosts without per-worker identity. Never use shared CODEX_SESSION_ID.');
  return { id, source: host ? 'CODEX_THREAD_ID' : 'explicit-attestation', parentSessionId: process.env.CODEX_SESSION_ID || null };
}

function assertOwner(continuity) {
  const actor = workerIdentity();
  if (!continuity.owner) throw new Error('No worker owns this repository. A fresh delegated worker must run node .harness/run.mjs claim.');
  if (continuity.owner.id !== actor.id) throw new Error('Worker ownership mismatch: active owner is ' + continuity.owner.id);
  return actor;
}

function retired(continuity, id) {
  return (continuity.retiredWorkerIds ?? []).includes(id);
}

async function claimWorker() {
  const continuity = await readContinuity();
  const actor = workerIdentity();
  if (continuity.phase !== 'working') throw new Error('Pending handoff must be resumed by a fresh worker: ' + resumeCommand(continuity));
  if (continuity.owner) {
    assertOwner(continuity);
    console.log('WORKER_ALREADY_CLAIMED ' + actor.id);
    return;
  }
  if (retired(continuity, actor.id)) throw new Error('Retired worker cannot claim again; delegate without implementation history (Codex fork_turns="none"; Claude fresh non-fork Agent).');
  const { state } = await load();
  const owner = { ...actor, generation: continuity.generation, claimedAt: new Date().toISOString(), featureId: activeFeatures(state)[0]?.id ?? continuity.checkpoint?.selectedFeatureId ?? null };
  await writeJson(CONTINUITY_PATH, { ...continuity, owner });
  await appendEvent('worker.claimed', { workerId: actor.id, source: actor.source, generation: continuity.generation });
  console.log('WORKER_CLAIMED ' + actor.id);
}

async function recoverWorker() {
  const continuity = await readContinuity();
  const actor = workerIdentity();
  const expected = boundedText('expected-owner', args.expectedOwner, 200);
  const reason = boundedText('reason', args.reason, 1024);
  if (args.confirmedTerminated !== true) throw new Error('Recovery requires --confirmed-terminated after the host or operator confirms the former worker has stopped. Never recover a live worker.');
  if (continuity.phase !== 'working') throw new Error('Pending handoff is preserved; delegate its exact resume command instead of recovery.');
  if (!continuity.owner || continuity.owner.id !== expected) throw new Error('Recovery expected owner mismatch; inspect session --json again.');
  if (actor.id === expected || retired(continuity, actor.id)) throw new Error('Recovery must be performed by a distinct non-retired actor.');
  const { config } = await load();
  const record = { formerOwner: continuity.owner, actor, reason: redact(reason, secretEnvironmentValues(config.security)), recoveredAt: new Date().toISOString(), generation: continuity.generation };
  await writeJson(CONTINUITY_PATH, { ...continuity, owner: null, retiredWorkerIds: unique([...(continuity.retiredWorkerIds ?? []), expected]), lastRecovery: record });
  await appendEvent('worker.recovered', record);
  console.log(args.json ? JSON.stringify(record) : 'WORKER_RECOVERED ' + expected + '; delegate a fresh worker to claim.');
}

function compactFeature(feature) {
  return { id: feature.id, title: utf8Projection(feature.title, 200), status: feature.status };
}

async function workerBootstrap() {
  const validate = booleanRequest('validate');
  const integrityRequested = booleanRequest('integrity');
  if (integrityRequested && !validate) throw new Error('bootstrap --integrity requires --validate.');
  const continuity = await readContinuity();
  // Parked callers receive only routing; do not disclose the implementation packet.
  if (continuity.phase !== 'working') { console.log(JSON.stringify({ continuity: continuityView(continuity) })); return; }
  const { config, state } = await load();
  const selectedId = args._[1] || args.id;
  const projection = bootstrapProjection(config, state, continuity, selectedId);
  if (!validate) { console.log(serializeBootstrapProjection(projection)); return; }
  const validation = await collectDoctor(config, state, continuity, { integrityRequested });
  projection.status = { counts: projection.counts, activeIds: projection.active.map(feature => feature.id) };
  projection.next = { action: projection.active.length ? 'continue' : projection.candidates.length ? 'start' : 'none', candidateIds: projection.candidates.map(feature => feature.id) };
  projection.validation = { healthy: validation.errors.length === 0, errorCount: validation.errors.length, warningCount: validation.warnings.length,
    integrity: validation.integrity, errors: [], warnings: [], omitted: { errors: validation.errors.length, warnings: validation.warnings.length } };
  // Keep the contract projection intact and bound diagnostics by actual UTF-8 bytes.
  serializeBootstrapProjection(projection, 32767);
  for (const kind of ['errors', 'warnings']) {
    for (const message of validation[kind]) {
      projection.validation[kind].push(utf8Projection(message, 2000));
      projection.validation.omitted[kind]--;
      if (Buffer.byteLength(JSON.stringify(projection)) > 32767) {
        projection.validation[kind].pop(); projection.validation.omitted[kind]++; break;
      }
    }
  }
  console.log(serializeBootstrapProjection(projection, 32767));
  if (validation.errors.length) process.exitCode = 1;
}

function booleanRequest(name) {
  if (args[name] !== undefined && args[name] !== true && args[name] !== 'true') throw new Error(`--${name} accepts a flag or the value true; a requested validation cannot fall back to a structural check.`);
  return args[name] === true || args[name] === 'true';
}

function bootstrapProjection(config, state, continuity, selectedId) {
  const active = activeFeatures(state);
  const selected = selectedId ? byId(state, selectedId) : active[0];
  const detail = selected ? {
    ...compactFeature(selected), description: utf8Projection(selected.description, 2000),
    scope: selected.scope, acceptance: selected.acceptance, requiredLayers: selected.requiredLayers,
    dependencies: selected.dependencies, contractHash: selected.contract?.hash ?? null,
    scopeBaselineRef: selected.scopeBaselineRef ?? null, evidence: (selected.evidence ?? []).slice(-3),
    blocker: selected.blocker ? String(selected.blocker).slice(0, 2000) : null
  } : null;
  return {
    continuity: continuityView(continuity), revision: state.revision,
    counts: Object.fromEntries([...STATES].map(status => [status, state.features.filter(f => f.status === status).length])),
    active: active.slice(0, 10).map(compactFeature),
    candidates: nextCandidates(state, config).slice(0, 10).map(compactFeature), selected: detail,
    checkpoint: continuity.checkpoint ? { summary: String(continuity.checkpoint.summary).slice(0, 4000), next: String(continuity.checkpoint.next).slice(0, 2000), decisions: (continuity.checkpoint.decisions ?? []).slice(0, 20), blockers: (continuity.checkpoint.blockers ?? []).slice(0, 20), evidence: (continuity.checkpoint.evidence ?? []).slice(-10), historicalBlockedCount: continuity.checkpoint.historicalBlockedCount ?? null } : null,
    routes: { config: '.harness/config.json', docs: '.harness/docs-map.md', progress: '.harness/progress.md' }
  };
}

function serializeBootstrap(config, state, continuity, selectedId) {
  return serializeBootstrapProjection(bootstrapProjection(config, state, continuity, selectedId));
}

function serializeBootstrapProjection(result, limit = 32768) {
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized) > limit) throw new Error('Selected feature bootstrap exceeds 32 KiB; narrow the feature contract before dispatch.');
  return serialized;
}

async function readContinuity() {
  if (!await exists(CONTINUITY_PATH)) {
    throw new Error('Continuity state is missing. Run the reusable sync command before continuing.');
  }
  const continuity = await readJson(CONTINUITY_PATH);
  if (!continuity || typeof continuity !== 'object' || Array.isArray(continuity)) {
    throw new Error('continuity.json must contain an object.');
  }
  if (continuity.version !== CONTINUITY_SCHEMA_VERSION || !CONTINUITY_PHASES.has(continuity.phase)) {
    throw new Error('continuity.json has an unsupported version or phase. Run the reusable sync command.');
  }
  if (!Number.isInteger(continuity.generation) || continuity.generation < 1) {
    throw new Error('continuity.json generation must be a positive integer.');
  }
  if (continuity.phase === 'awaiting_resume' && !continuity.handoff?.id) {
    throw new Error('continuity.json is awaiting resume without a handoff capsule.');
  }
  return continuity;
}

function resumeCommand(continuity) {
  return continuity.handoff?.id
    ? `node .harness/run.mjs resume ${continuity.handoff.id}`
    : null;
}

function currentContinuityPacket(continuity) {
  return continuity.phase === 'awaiting_resume' ? continuity.handoff : continuity.checkpoint;
}

function continuityAction(continuity) {
  if ((continuity.phase === 'awaiting_resume' || !continuity.owner) && currentContinuityPacket(continuity)?.reason === 'needs_input') return 'await_user';
  if (continuity.phase === 'awaiting_resume') return 'delegate_worker';
  return continuity.owner ? 'continue_worker' : 'delegate_worker';
}

function packetMetadata(packet) {
  if (!packet) return null;
  return {
    id: packet.id,
    kind: packet.kind,
    createdAt: packet.createdAt,
    reason: packet.reason,
    featureRevision: packet.featureRevision,
    automatic: packet.automatic === true
  };
}

function continuityView(continuity) {
  const pending = continuity.phase === 'awaiting_resume';
  return {
    phase: continuity.phase,
    generation: continuity.generation,
    action: continuityAction(continuity),
    handoffId: pending ? continuity.handoff.id : null,
    resumeCommand: pending ? resumeCommand(continuity) : null,
    workerPrompt: pending ? freshWorkerPrompt(continuity.handoff) : null,
    owner: continuity.owner ? { id: continuity.owner.id, source: continuity.owner.source } : null,
    packet: packetMetadata(currentContinuityPacket(continuity))
  };
}

function printAwaitingResume(continuity) {
  console.log(`FRESH_WORKER_REQUIRED ${continuity.handoff.id}`);
  console.log('Persistent development orchestrator: stay in the current user chat.');
  if (continuityAction(continuity) === 'await_user') {
    console.log('Wait for the required user input in this chat, then delegate one fresh worker/subagent for the parked transfer.');
  } else {
    console.log('Delegate one fresh worker/subagent for the parked transfer.');
  }
  console.log(`The fresh worker must run this exact command before edits: ${resumeCommand(continuity)}`);
  console.log('The handing-off worker must yield and must not consume its own handoff.');
  console.log('Fallback only when worker delegation is unavailable: open a fresh chat/task in this same worktree and run the exact command there.');
}

function printAwaitUser(continuity) {
  console.log(`AWAIT_USER ${continuity.checkpoint?.id ?? '(no-checkpoint)'}`);
  console.log('Keep the development orchestrator in this user chat and wait for the requested input recorded in .harness/progress.md.');
}

async function continuityStatus() {
  const continuity = await readContinuity();
  if (args.json) {
    console.log(JSON.stringify(continuityView(continuity)));
    return;
  }
  console.log(`Continuity: ${continuity.phase}; generation ${continuity.generation}`);
  if (continuity.phase === 'awaiting_resume') printAwaitingResume(continuity);
  else if (continuityAction(continuity) === 'await_user') printAwaitUser(continuity);
  else if (continuity.checkpoint) console.log(`Latest checkpoint: ${continuity.checkpoint.id} (${continuity.checkpoint.createdAt})`);
  else console.log('No runtime checkpoint has been written yet.');
}

async function whileWorking(operation) {
  const continuity = await readContinuity();
  if (continuity.phase !== 'working') {
    throw new Error(`Repository is parked at handoff ${continuity.handoff.id}. Keep the orchestrator chat active and delegate one fresh worker to run: ${resumeCommand(continuity)}`);
  }
  assertOwner(continuity);
  if (!['checkpoint', 'handoff', 'block'].includes(command)) {
    const { config } = await load();
    const budget = await contextObservation(ROOT, { actor: continuity.owner.id, role: 'worker', config, event: 'mutation', startedAt: continuity.owner.claimedAt });
    if (budget.pressure === 'rotate') {
      await pressureHandoff(budget);
      process.exitCode = 75;
      return;
    }
  }
  return operation();
}

async function contextStatus() {
  const { config } = await load();
  const continuity = await readContinuity();
  const actor = workerIdentity();
  const role = continuity.owner?.id === actor.id ? 'worker' : 'orchestrator';
  if (!args.observe && (args.toolCalls || args.outputChars || args.transcript)) throw new Error('Context accounting options require --observe.');
  for (const value of [args.toolCalls, args.outputChars].filter(value => value !== undefined)) if (!/^\d+$/.test(String(value))) throw new Error('Context accounting counts must be nonnegative integers.');
  const budget = await contextObservation(ROOT, { actor: actor.id, role, config, startedAt: role === 'worker' ? continuity.owner.claimedAt : undefined, persist: Boolean(args.observe), event: args.observe ? 'PreToolUse' : 'inspect', toolCalls: Number(args.toolCalls ?? 0), outputChars: Number(args.outputChars ?? 0), transcriptPath: args.transcript });
  const { policy: _policy, ...view } = budget;
  console.log(args.json ? JSON.stringify(view) : `Context ${view.pressure}; role=${role}; reasons=${view.reasons.join(',') || 'none'}; telemetry=${view.telemetry}`);
}

async function pressureHandoff(budget) {
  args.summary = `Proactive worker rotation: ${budget.reasons.join(', ')}. Persisted feature state and Git changes are the implementation authority; reconstruct through bootstrap and scoped sources.`;
  args.next = 'Continue the active feature in one fresh worker without inherited implementation history. Run the exact resume command then bootstrap --validate --json and inspect scoped changes before further implementation or verification.';
  args.reason = 'context_pressure';
  args.automatic = true;
  args.json = false;
  await writeHandoff();
}

function list(value) {
  if (value === undefined || value === true) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function commandText(entry) {
  return typeof entry === 'string' ? entry : entry?.command;
}

function commandCredentials(entry) {
  if (!entry || typeof entry === 'string' || entry.credentials === undefined) return [];
  return Array.isArray(entry.credentials) ? entry.credentials : [entry.credentials];
}

function credentialProviders(config) {
  return config.security?.credentials?.providers ?? {};
}

function validCredentialProvider(provider) {
  return provider
    && typeof provider.targetEnvironment === 'string'
    && provider.targetEnvironment.trim().length > 0
    && Array.isArray(provider.sources)
    && provider.sources.length > 0
    && provider.sources.every((source) => typeof source === 'string' && source.trim().length > 0)
    && ['first_available', 'round_robin'].includes(provider.selection);
}

function environmentNameKey(value) {
  const name = String(value);
  return process.platform === 'win32' ? name.toUpperCase() : name;
}

function credentialEnvironmentNames(security = {}) {
  const providers = security?.credentials?.providers;
  if (!providers || typeof providers !== 'object') return [];
  return unique(Object.values(providers).flatMap((provider) => {
    if (!provider || typeof provider !== 'object') return [];
    const sources = Array.isArray(provider.sources) ? provider.sources : [];
    return [provider.targetEnvironment, ...sources]
      .filter((name) => typeof name === 'string' && name.length > 0);
  }));
}

function credentialEnvironmentAllowOverlaps(security = {}) {
  const credentialNames = new Set(credentialEnvironmentNames(security).map(environmentNameKey));
  if (!Array.isArray(security?.environmentAllow) || credentialNames.size === 0) return [];
  return unique(security.environmentAllow.filter((name) =>
    typeof name === 'string' && credentialNames.has(environmentNameKey(name))));
}

function validCommandEntry(entry) {
  return typeof commandText(entry) === 'string'
    && commandText(entry).trim().length > 0
    && (typeof entry === 'string' || entry.credentials === undefined || Array.isArray(entry.credentials))
    && commandCredentials(entry).every((provider) => typeof provider === 'string' && provider.trim().length > 0);
}

function instructionRoutes(agent, content) {
  if (!content.includes(DEVELOPMENT_HARNESS_BOUNDARY) || !content.includes(ORCHESTRATED_WORKER_PROTOCOL)) return false;
  if (agent === 'codex') {
    return content.includes('.harness/config.json')
      && content.includes('.harness/features.json')
      && content.includes('.harness/continuity.json')
      && content.includes('.harness/run.mjs resume');
  }
  if (agent === 'claude') return content.includes('@AGENTS.md') || (content.includes('.harness/config.json') && content.includes('.harness/features.json'));
  if (agent === 'github-copilot') return content.includes('AGENTS.md') || (content.includes('.harness/config.json') && content.includes('.harness/features.json'));
  return false;
}

function requireText(name, value) {
  if (!value || value === true || !String(value).trim()) throw new Error(`--${name} is required.`);
  return String(value).trim();
}

function byId(state, id) {
  const feature = state.features.find((item) => item.id === id);
  if (!feature) throw new Error(`Unknown feature: ${id}`);
  return feature;
}

function activeFeatures(state) {
  return state.features.filter((item) => item.status === 'active');
}

function dependencyFailures(state, feature) {
  return feature.dependencies.filter((id) => state.features.find((candidate) => candidate.id === id)?.status !== 'passing');
}

function contractShape(feature) {
  return {
    id: feature.id,
    title: feature.title,
    description: feature.description,
    dependencies: feature.dependencies,
    scope: feature.scope,
    acceptance: feature.acceptance,
    requiredLayers: feature.requiredLayers ?? ['full'],
    ...(Object.hasOwn(feature, 'verificationBudget') ? { verificationBudget: feature.verificationBudget } : {})
  };
}

function scopeBaselineShape(baseline) {
  return {
    version: baseline?.version,
    head: baseline?.head,
    tree: baseline?.tree,
    branch: baseline?.branch,
    files: baseline?.files,
    worktreeHash: baseline?.worktreeHash,
    ...(baseline?.capturePolicy ? { capturePolicy: baseline.capturePolicy } : {})
  };
}

function scopeBaselineHash(baseline) {
  return stableHash(scopeBaselineShape(baseline));
}

function featureContractHash(feature) {
  if (feature.contract?.version === 2) {
    return stableHash({
      contract: contractShape(feature),
      scopeBaselineHash: feature.contract.scopeBaselineHash
    });
  }
  return stableHash(contractShape(feature));
}

function sameOrderedValues(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function sameStructuredValue(actual, expected) {
  return actual !== undefined && stableHash(actual) === stableHash(expected);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value) && sameOrderedValues(Object.keys(value).sort(), [...keys].sort());
}

function validVerificationBudget(value) {
  return exactKeys(value, ['maxAttempts']) && Number.isSafeInteger(value.maxAttempts) && value.maxAttempts > 0;
}

function attemptBudget(config, feature) {
  const globalMaxAttempts = config.policies?.maxAttempts ?? 5;
  if (!Number.isSafeInteger(globalMaxAttempts) || globalMaxAttempts < 1) throw new Error('Global verification budget must be a positive safe integer.');
  if (Object.hasOwn(feature, 'verificationBudget') && !validVerificationBudget(feature.verificationBudget)) throw new Error(`${feature.id}: invalid verificationBudget`);
  const featureMaxAttempts = Object.hasOwn(feature, 'verificationBudget') ? feature.verificationBudget.maxAttempts : null;
  const attemptsBefore = feature.attempts ?? 0;
  if (!Number.isSafeInteger(attemptsBefore) || attemptsBefore < 0) throw new Error(`${feature.id}: invalid cumulative attempt count`);
  return { version: 1, globalMaxAttempts, featureMaxAttempts, effectiveMaxAttempts: Math.min(globalMaxAttempts, featureMaxAttempts ?? globalMaxAttempts), attemptsBefore };
}

function verificationCredentialPlan(config, entry) {
  const providers = credentialProviders(config);
  return unique(commandCredentials(entry)).map((provider) => ({
    provider,
    selection: providers[provider]?.selection ?? null
  }));
}

function verificationPlanSnapshot(config, feature, layers, entries, contractHash, configHash) {
  const secrets = secretEnvironmentValues(config.security);
  const counts = new Map();
  const executions = entries.map((entry, order) => {
    const kind = entry.layer === 'acceptance' ? 'acceptance' : 'layer';
    const group = kind === 'acceptance'
      ? `acceptance:${String(entry.criterionId)}`
      : `layer:${String(entry.layer)}`;
    const occurrence = Number(counts.get(group) ?? 0) + 1;
    counts.set(group, occurrence);
    const rawCommand = String(commandText(entry) ?? '');
    const persistedCommand = config.security?.redactOutput ? redact(rawCommand, secrets) : rawCommand;
    return {
      id: `${kind}:${encodeURIComponent(kind === 'acceptance' ? String(entry.criterionId) : String(entry.layer))}:${occurrence}`,
      order,
      kind,
      layer: String(entry.layer),
      criterionId: kind === 'acceptance' ? String(entry.criterionId) : null,
      command: persistedCommand,
      commandHash: stableHash(rawCommand),
      commandRedacted: persistedCommand !== rawCommand,
      credentials: verificationCredentialPlan(config, entry),
      expected: { pass: true, exitCode: 0, timedOut: false }
    };
  });
  const acceptanceExecutions = executions.filter((execution) => execution.kind === 'acceptance');
  return {
    schemaVersion: VERIFICATION_PLAN_SCHEMA_VERSION,
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    harnessVersion: HARNESS_RUNTIME_VERSION,
    feature: {
      id: feature.id,
      contractHash,
      ...(Object.hasOwn(feature, 'verificationBudget') ? { verificationBudget: feature.verificationBudget } : {})
    },
    config: {
      hash: configHash
    },
    requiredLayers: layers.map((id, order) => ({ id, order })),
    executions,
    acceptanceCriteria: feature.acceptance.map((criterion, order) => ({
      id: criterion.id,
      order,
      description: criterion.description,
      executionId: acceptanceExecutions[order]?.id ?? null,
      command: acceptanceExecutions[order]?.command ?? '',
      commandHash: acceptanceExecutions[order]?.commandHash ?? stableHash(String(commandText(criterion) ?? '')),
      commandRedacted: acceptanceExecutions[order]?.commandRedacted ?? false,
      credentials: acceptanceExecutions[order]?.credentials ?? verificationCredentialPlan(config, criterion)
    })),
    scope: {
      enforcement: config.scope?.enforcement ?? null,
      allow: feature.scope?.allow ?? [],
      deny: feature.scope?.deny ?? [],
      baselineHash: feature.contract?.scopeBaselineHash ?? null,
      expectedViolations: []
    },
    executionPolicy: {
      commandTimeoutMs: Number(config.policies?.commandTimeoutMs ?? 0),
      attemptBudget: attemptBudget(config, feature)
    },
    evidencePolicy: {
      redactOutput: Boolean(config.security?.redactOutput),
      environmentAllow: config.security?.environmentAllow ?? []
    }
  };
}

function validateEvidenceRecord(feature, record, { planOnly = false } = {}) {
  const errors = [];
  const warnings = [];
  const evidenceSchema = Number(record?.schemaVersion ?? 1);
  if (!Number.isInteger(evidenceSchema) || evidenceSchema < 1 || evidenceSchema > EVIDENCE_SCHEMA_VERSION) {
    errors.push(`${feature.id}: unsupported evidence schema version ${String(record?.schemaVersion ?? 1)}`);
    return { errors, warnings };
  }
  if (record.featureId !== feature.id) errors.push(`${feature.id}: evidence belongs to ${record.featureId}`);
  if (!planOnly && record.pass !== true) errors.push(`${feature.id}: latest evidence did not pass`);
  if (!planOnly && (!Array.isArray(record.commands) || record.commands.length === 0 || record.commands.some((item) => item.exitCode !== 0))) {
    errors.push(`${feature.id}: evidence lacks successful commands`);
  }
  if (!planOnly && (!Array.isArray(record.scopeViolations) || record.scopeViolations.length !== 0)) {
    errors.push(`${feature.id}: passing evidence has nonempty or invalid scope violations`);
  }
  if (evidenceSchema >= 2) {
    if (!record.contractHash || record.contractHash !== featureContractHash(feature)) errors.push(`${feature.id}: contract and evidence do not match`);
    if (!record.configHash) errors.push(`${feature.id}: evidence lacks config provenance`);
    if (Number(record.harnessVersion ?? 1) >= 2 && !record.verificationHash) errors.push(`${feature.id}: evidence lacks verification-plan provenance`);
  }
  if (evidenceSchema < 4 && record.verificationPlan === undefined) {
    warnings.push(`${feature.id}: legacy evidence schema v${evidenceSchema} predates embedded verification-plan manifests; the historical pass remains usable but is not independently plan-verified`);
    return { errors, warnings };
  }

  const plan = record.verificationPlan;
  if (!isRecord(plan)) {
    errors.push(`${feature.id}: evidence lacks an embedded verification plan`);
    return { errors, warnings };
  }
  if (!((evidenceSchema === 4 && plan.schemaVersion === 1) || (evidenceSchema === 5 && plan.schemaVersion === 2))) {
    errors.push(`${feature.id}: unsupported verification-plan schema version ${String(plan.schemaVersion)}`);
  }
  if (plan.evidenceSchemaVersion !== evidenceSchema
    || !Number.isInteger(plan.harnessVersion)
    || plan.harnessVersion < 1
    || plan.harnessVersion !== Number(record.harnessVersion)) {
    errors.push(`${feature.id}: verification-plan schema metadata does not match evidence`);
  }
  if (stableHash(plan) !== record.verificationHash) {
    errors.push(`${feature.id}: verification plan hash does not match verificationHash`);
  }
  if (plan.feature?.id !== record.featureId) errors.push(`${feature.id}: verification-plan feature does not match evidence`);
  if (plan.feature?.contractHash !== record.contractHash) errors.push(`${feature.id}: verification-plan contract does not match evidence`);
  if (plan.config?.hash !== record.configHash) errors.push(`${feature.id}: verification-plan config hash does not match evidence`);
  const hasBudget = Object.hasOwn(feature, 'verificationBudget');
  if (hasBudget && !validVerificationBudget(feature.verificationBudget)) errors.push(`${feature.id}: invalid frozen verificationBudget`);
  if (!exactKeys(plan.feature, ['id', 'contractHash', ...(hasBudget ? ['verificationBudget'] : [])]) || Object.hasOwn(plan.feature, 'verificationBudget') !== hasBudget
    || (hasBudget && !sameStructuredValue(plan.feature.verificationBudget, feature.verificationBudget))) {
    errors.push(`${feature.id}: verification-plan budget does not match the frozen feature`);
  }
  if (evidenceSchema === 5) {
    const budget = plan.executionPolicy?.attemptBudget;
    const validBudget = exactKeys(budget, ['version', 'globalMaxAttempts', 'featureMaxAttempts', 'effectiveMaxAttempts', 'attemptsBefore'])
      && budget.version === 1
      && Number.isSafeInteger(budget.globalMaxAttempts) && budget.globalMaxAttempts > 0
      && (budget.featureMaxAttempts === null || (Number.isSafeInteger(budget.featureMaxAttempts) && budget.featureMaxAttempts > 0))
      && budget.featureMaxAttempts === (hasBudget ? feature.verificationBudget?.maxAttempts : null)
      && Number.isSafeInteger(budget.effectiveMaxAttempts) && budget.effectiveMaxAttempts > 0
      && budget.effectiveMaxAttempts === Math.min(budget.globalMaxAttempts, budget.featureMaxAttempts ?? budget.globalMaxAttempts)
      && Number.isSafeInteger(budget.attemptsBefore) && budget.attemptsBefore >= 0 && budget.attemptsBefore < budget.effectiveMaxAttempts;
    if (!validBudget || !Number.isSafeInteger(record.attempt) || record.attempt !== budget?.attemptsBefore + 1 || record.attempt > budget?.effectiveMaxAttempts) {
      errors.push(`${feature.id}: verification-plan attempt budget or actual attempt is invalid`);
    }
  } else if (Object.hasOwn(plan.executionPolicy ?? {}, 'attemptBudget')) {
    errors.push(`${feature.id}: legacy verification plan cannot contain an attempt budget`);
  }

  const plannedLayers = Array.isArray(plan.requiredLayers) ? plan.requiredLayers : [];
  const layerIds = plannedLayers.map((layer) => layer?.id);
  const validLayers = plannedLayers.length > 0
    && plannedLayers.every((layer, order) => isRecord(layer) && typeof layer.id === 'string' && layer.id.length > 0 && layer.order === order)
    && new Set(layerIds).size === layerIds.length;
  if (!validLayers) errors.push(`${feature.id}: verification-plan required layers are invalid`);
  if (!sameOrderedValues(record.requiredLayers, layerIds)) errors.push(`${feature.id}: evidence required layers do not match verification plan`);
  const frozenRequiredLayers = feature.requiredLayers ?? ['full'];
  if (frozenRequiredLayers.some((layer) => !layerIds.includes(layer))) {
    errors.push(`${feature.id}: verification plan omits frozen feature required layers`);
  }

  const executions = Array.isArray(plan.executions) ? plan.executions : [];
  const executionIds = executions.map((execution) => execution?.id);
  const validExecutions = executions.length > 0 && executions.every((execution, order) => {
    const credentialPlan = execution?.credentials;
    return isRecord(execution)
      && typeof execution.id === 'string'
      && execution.id.length > 0
      && execution.order === order
      && ['layer', 'acceptance'].includes(execution.kind)
      && typeof execution.layer === 'string'
      && (execution.kind === 'acceptance' ? typeof execution.criterionId === 'string' : execution.criterionId === null)
      && typeof execution.command === 'string'
      && /^[0-9a-f]{64}$/.test(execution.commandHash)
      && typeof execution.commandRedacted === 'boolean'
      && Array.isArray(credentialPlan)
      && credentialPlan.every((credential) => isRecord(credential)
        && typeof credential.provider === 'string'
        && credential.provider.length > 0
        && ['first_available', 'round_robin'].includes(credential.selection))
      && new Set(credentialPlan.map((credential) => credential.provider)).size === credentialPlan.length
      && sameStructuredValue(execution.expected, { pass: true, exitCode: 0, timedOut: false });
  });
  if (!validExecutions) errors.push(`${feature.id}: verification-plan executions are invalid`);
  if (new Set(executionIds).size !== executionIds.length) errors.push(`${feature.id}: verification plan has duplicate execution IDs`);
  if (executions.some((execution) => execution?.kind === 'layer' && !layerIds.includes(execution.layer))
    || executions.some((execution) => execution?.kind === 'acceptance' && execution.layer !== 'acceptance')
    || layerIds.some((layer) => !executions.some((execution) => execution?.kind === 'layer' && execution.layer === layer))) {
    errors.push(`${feature.id}: verification-plan layer coverage is incomplete or contains unknown layers`);
  }
  if (executions.some((execution) => execution && execution.commandRedacted === false && stableHash(execution.command) !== execution.commandHash)) {
    errors.push(`${feature.id}: verification-plan command hashes do not match exact commands`);
  }

  const criteria = Array.isArray(plan.acceptanceCriteria) ? plan.acceptanceCriteria : [];
  const criterionIds = criteria.map((criterion) => criterion?.id);
  const acceptanceExecutions = executions.filter((execution) => execution?.kind === 'acceptance');
  const validCriteria = criteria.length > 0
    && criteria.every((criterion, order) => isRecord(criterion)
      && typeof criterion.id === 'string'
      && criterion.id.length > 0
      && criterion.order === order
      && typeof criterion.description === 'string'
      && criterion.description.length > 0
      && typeof criterion.executionId === 'string'
      && typeof criterion.command === 'string'
      && /^[0-9a-f]{64}$/.test(criterion.commandHash)
      && typeof criterion.commandRedacted === 'boolean'
      && Array.isArray(criterion.credentials))
    && new Set(criterionIds).size === criterionIds.length;
  if (!validCriteria) errors.push(`${feature.id}: verification-plan acceptance criteria are invalid`);
  const acceptanceCoverageValid = acceptanceExecutions.length === criteria.length
    && criteria.every((criterion) => {
      const execution = executions.find((candidate) => candidate?.id === criterion.executionId);
      return execution?.kind === 'acceptance'
        && execution.criterionId === criterion.id
        && execution.command === criterion.command
        && execution.commandHash === criterion.commandHash
        && execution.commandRedacted === criterion.commandRedacted
        && sameStructuredValue(execution.credentials, criterion.credentials);
    });
  if (!acceptanceCoverageValid) errors.push(`${feature.id}: verification-plan acceptance coverage does not match its executions`);
  const frozenAcceptance = feature.acceptance ?? [];
  const acceptanceMatchesFeature = criteria.length === frozenAcceptance.length
    && criteria.every((criterion, order) => {
      const frozen = frozenAcceptance[order];
      return criterion.id === frozen?.id
        && criterion.description === frozen?.description
        && criterion.commandHash === stableHash(String(commandText(frozen) ?? ''))
        && sameOrderedValues(criterion.credentials?.map((credential) => credential.provider), unique(commandCredentials(frozen)));
    });
  if (!acceptanceMatchesFeature) errors.push(`${feature.id}: verification-plan acceptance criteria do not match the frozen feature`);

  const scope = plan.scope;
  if (!isRecord(scope)
    || !['required', 'disabled'].includes(scope.enforcement)
    || !sameOrderedValues(scope.allow, feature.scope?.allow ?? [])
    || !sameOrderedValues(scope.deny, feature.scope?.deny ?? [])
    || scope.baselineHash !== (feature.contract?.scopeBaselineHash ?? null)) {
    errors.push(`${feature.id}: verification-plan scope contract does not match the frozen feature`);
  }
  if (!Array.isArray(scope?.expectedViolations) || scope.expectedViolations.length !== 0) {
    errors.push(`${feature.id}: verification plan does not require empty scope violations`);
  }
  if (!Number.isFinite(plan.executionPolicy?.commandTimeoutMs) || plan.executionPolicy.commandTimeoutMs <= 0
    || typeof plan.evidencePolicy?.redactOutput !== 'boolean'
    || !Array.isArray(plan.evidencePolicy?.environmentAllow)
    || plan.evidencePolicy.environmentAllow.some((name) => typeof name !== 'string')) {
    errors.push(`${feature.id}: verification-plan execution or evidence policy is invalid`);
  }

  if (planOnly) return { errors, warnings };
  const expectedExecutedLayers = unique(executions.map((execution) => execution?.layer));
  if (!sameOrderedValues(record.executedLayers, expectedExecutedLayers)) {
    errors.push(`${feature.id}: evidence executed layers do not match verification plan`);
  }
  const results = Array.isArray(record.commands) ? record.commands : [];
  const resultIds = results.map((result) => result?.executionId);
  if (results.length !== executions.length
    || new Set(resultIds).size !== resultIds.length
    || results.some((result, order) => result?.executionId !== executions[order]?.id || result?.executionOrder !== order)) {
    errors.push(`${feature.id}: evidence command results do not exactly cover verification plan`);
  }
  for (const [order, execution] of executions.entries()) {
    const result = results[order];
    if (!result) continue;
    if (result.command !== execution.command || result.layer !== execution.layer || result.criterionId !== execution.criterionId) {
      errors.push(`${feature.id}: evidence result ${execution.id} does not match its planned command`);
    }
    const resultCredentials = Array.isArray(result.credentials) ? result.credentials : [];
    const credentialShape = resultCredentials.map((credential) => ({
      provider: credential?.provider,
      selection: credential?.selection
    }));
    if (!sameStructuredValue(credentialShape, execution.credentials)
      || resultCredentials.some((credential) => !Number.isInteger(credential?.slot) || credential.slot < 1)) {
      errors.push(`${feature.id}: evidence result ${execution.id} does not match planned credential use`);
    }
    if (result.pass !== true || result.exitCode !== execution.expected?.exitCode || result.timedOut !== execution.expected?.timedOut) {
      errors.push(`${feature.id}: evidence result ${execution.id} did not satisfy its planned pass flags`);
    }
  }
  return { errors, warnings };
}

async function validatePassingEvidence(feature) {
  const reference = feature.evidence?.at(-1);
  if (!reference) return { errors: [`${feature.id}: passing without evidence`], warnings: [] };
  const target = path.resolve(ROOT, reference);
  if (!isPathInside(EVIDENCE_DIR, target)) {
    return { errors: [`${feature.id}: evidence path escapes .harness/evidence`], warnings: [] };
  }
  const record = await readJson(target).catch(() => null);
  if (!record) return { errors: [`${feature.id}: evidence is missing or invalid`], warnings: [] };
  return validateEvidenceRecord(feature, record);
}

async function validateBudgetHistory(feature, features, root) {
  const errors = [];
  const fail = message => { throw new Error(`${feature.id}: ${message}`); };
  const digest = value => /^[a-f0-9]{64}$/.test(value);
  const contractValid = contract => exactKeys(contract, ['version', 'scopeBaselineHash', 'hash', 'snapshot', 'frozenAt'])
    && contract.version === 2 && digest(contract.scopeBaselineHash) && digest(contract.hash)
    && typeof contract.frozenAt === 'string' && Number.isFinite(Date.parse(contract.frozenAt))
    && isRecord(contract.snapshot) && contract.snapshot.id === feature.id
    && sameStructuredValue(contract.snapshot, contractShape(contract.snapshot))
    && (!Object.hasOwn(contract.snapshot, 'verificationBudget') || validVerificationBudget(contract.snapshot.verificationBudget))
    && stableHash({ contract: contract.snapshot, scopeBaselineHash: contract.scopeBaselineHash }) === contract.hash;
  const historicalOwner = actor => exactKeys(actor, ['id', 'source', 'parentSessionId', 'generation', 'claimedAt', 'featureId'])
    && typeof actor.id === 'string' && /^[a-zA-Z0-9_./:-]{1,200}$/.test(actor.id)
    && ['CODEX_THREAD_ID', 'explicit-attestation'].includes(actor.source)
    && (actor.parentSessionId === null || (typeof actor.parentSessionId === 'string' && actor.parentSessionId.trim().length > 0))
    && Number.isSafeInteger(actor.generation) && actor.generation >= 0
    && typeof actor.claimedAt === 'string' && Number.isFinite(Date.parse(actor.claimedAt))
    && (actor.featureId === null || (typeof actor.featureId === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(actor.featureId)));
  const readContained = async (reference, hash, directory) => {
    if (typeof reference !== 'string' || !reference.startsWith(`.harness/${directory}/`) || !reference.endsWith('.json')
      || reference.includes('\\') || reference.split('/').includes('..') || !digest(hash)) fail('invalid immutable history reference');
    const container = path.join(root, '.harness', directory);
    const target = path.resolve(root, reference);
    if (!isPathInside(container, target)) fail('history reference escapes its directory');
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || !isPathInside(await realpath(container), await realpath(target))) fail('history reference is not a contained regular file');
    return readFile(target);
  };
  const rawHash = bytes => createHash('sha256').update(bytes).digest('hex');
  const readAuthenticated = async (reference, hash, directory) => {
    const bytes = await readContained(reference, hash, directory);
    if (rawHash(bytes) !== hash) fail('history reference hash mismatch');
    return { bytes, record: JSON.parse(bytes) };
  };
  const readEvidence = async (ref, legacyActor) => {
    if (!exactKeys(ref, ['reference', 'hash'])) fail('invalid evidence receipt');
    const bytes = await readContained(ref.reference, ref.hash, 'evidence');
    const record = JSON.parse(bytes);
    // Archived v2 owner-object writers hashed regular-file mode + NUL + these exact bytes.
    // This discriminator never changes baseline hashes or current evidence authentication.
    const historical = legacyActor && record.schemaVersion === 4 && record.verificationPlan?.schemaVersion === 1;
    if (rawHash(bytes) !== ref.hash && !(historical && ['100644', '100755'].some(mode =>
      createHash('sha256').update(mode + '\0').update(bytes).digest('hex') === ref.hash))) fail('history reference hash mismatch');
    return record;
  };
  const evidenceFor = (record, frozenFeature) => {
    const validation = validateEvidenceRecord(frozenFeature, record, { planOnly: true });
    if (validation.errors.length) fail(validation.errors.join('; '));
  };
  try {
    if (Object.hasOwn(feature, 'verificationBudget') && !validVerificationBudget(feature.verificationBudget)) fail('invalid verificationBudget');
    const revisions = feature.budgetRevisions;
    if (revisions === undefined) {
      if (Object.hasOwn(feature, 'verificationBudget')) fail('verificationBudget lacks authenticated revision history');
      return errors;
    }
    if (!Array.isArray(revisions) || revisions.length === 0) fail('invalid budget revision history');
    if (!contractValid(feature.contract) || !sameStructuredValue(feature.contract.snapshot, contractShape(feature))) fail('current revised contract snapshot mismatch');
    let prior = null;
    const revisionHashes = new Set();
    for (const [index, revision] of revisions.entries()) {
      if (!exactKeys(revision, ['version', 'at', 'actor', 'reason', 'additionalAttempts', 'previousRevisionHash', 'previousContract', 'scopeBaselineRef', 'previousEvidence', 'maintenanceReceipts', 'attempts', 'repeatedFailures', 'addedAllow', 'nextContractHash', 'hash'])
        || revision.version !== 2 || typeof revision.at !== 'string' || !Number.isFinite(Date.parse(revision.at))
        || !((typeof revision.actor === 'string' && revision.actor.trim()) || historicalOwner(revision.actor)) || typeof revision.reason !== 'string' || !revision.reason.trim()
        || !Number.isSafeInteger(revision.additionalAttempts) || revision.additionalAttempts < 0
        || !Number.isSafeInteger(revision.attempts) || revision.attempts < 0
        || !Number.isSafeInteger(revision.repeatedFailures) || revision.repeatedFailures < 0
        || !digest(revision.nextContractHash) || !digest(revision.hash)) fail('malformed budget revision');
      const { hash, ...unsigned } = revision;
      if (stableHash(unsigned) !== hash || revisionHashes.has(hash) || revision.previousRevisionHash !== (prior?.hash ?? null)) fail('budget revision hash or chain mismatch');
      revisionHashes.add(hash);
      const legacyActor = historicalOwner(revision.actor);
      if (!contractValid(revision.previousContract) || (prior && revision.previousContract.hash !== prior.nextContractHash)) fail('previous contract hash or snapshot mismatch');
      const ref = revision.scopeBaselineRef;
      if (!exactKeys(ref, ['version', 'path', 'sha256', 'bytes', 'baselineHash']) || ref.version !== 1 || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1
        || ref.path !== `.harness/baselines/${ref.sha256}.json` || ref.baselineHash !== revision.previousContract.scopeBaselineHash) fail('invalid revision baseline reference');
      const baseline = await readAuthenticated(ref.path, ref.sha256, 'baselines');
      if (baseline.bytes.length !== ref.bytes || baseline.record.baselineHash !== ref.baselineHash || scopeBaselineHash(baseline.record) !== ref.baselineHash) fail('revision baseline identity mismatch');
      if (!sameStructuredValue(ref, feature.scopeBaselineRef) || feature.contract.scopeBaselineHash !== ref.baselineHash) fail('revision baseline differs from current contract');
      const historicalContracts = revisions.slice(0,index+1).map(item=>item.previousContract);
      if (!Array.isArray(revision.previousEvidence) || revision.previousEvidence.length !== revision.attempts
        || new Set(revision.previousEvidence.map(item=>item?.reference)).size !== revision.previousEvidence.length
        || !revision.previousEvidence.every((item, order) => item?.reference === feature.evidence?.[order])) fail('previous evidence does not preserve cumulative history');
      for (const evidence of revision.previousEvidence) {
        const record = await readEvidence(evidence, legacyActor);
        const frozen = historicalContracts.find(item=>item.hash===record.contractHash);
        if (!frozen) fail('historical evidence contract is unknown');
        evidenceFor(record,{...frozen.snapshot,contract:frozen});
      }
      const receipts = revision.maintenanceReceipts;
      if (!Array.isArray(receipts) || receipts.length === 0 || new Set(receipts.map(receipt => receipt?.featureId)).size !== receipts.length) fail('missing or duplicate maintenance receipts');
      for (const receipt of receipts) {
        if (!exactKeys(receipt, ['featureId', 'evidence']) || typeof receipt.featureId !== 'string' || receipt.featureId === feature.id
          || !Array.isArray(receipt.evidence) || receipt.evidence.length === 0 || new Set(receipt.evidence.map(item => item?.reference)).size !== receipt.evidence.length) fail('invalid maintenance receipt');
        const maintenance = features.find(item => item.id === receipt.featureId);
        if (!maintenance || maintenance.status !== 'passing') fail('maintenance receipt feature is missing or not passing');
        if (!receipt.evidence.every((item,order)=>item?.reference === maintenance.evidence?.[order])) fail('maintenance receipt history differs from feature evidence');
        for (const evidence of receipt.evidence) {
          if (!maintenance.evidence?.includes(evidence?.reference)) fail('maintenance evidence does not belong to receipt feature');
          const record = await readEvidence(evidence, legacyActor);
          const contracts = [maintenance.contract, ...(maintenance.budgetRevisions ?? []).map(item => item.previousContract)];
          const frozen = contracts.find(item => item?.hash === record.contractHash);
          if (!frozen) fail('maintenance evidence contract is unknown');
          if (evidence === receipt.evidence.at(-1)) {
            const latestValidation = validateEvidenceRecord({ ...frozen.snapshot, contract: frozen }, record);
            if (latestValidation.errors.length) fail(latestValidation.errors.join('; '));
          }
          evidenceFor(record, { ...frozen.snapshot, contract: frozen });
        }
      }
      if (!Array.isArray(revision.addedAllow) || revision.addedAllow.some(value => typeof value !== 'string' || !value)
        || new Set(revision.addedAllow).size !== revision.addedAllow.length
        || (revision.additionalAttempts === 0 && revision.addedAllow.every(value => revision.previousContract.snapshot.scope.allow.includes(value)))) fail('invalid revised scope additions');
      const nextContract = revisions[index + 1]?.previousContract ?? feature.contract;
      const expected = { ...revision.previousContract.snapshot, scope: { ...revision.previousContract.snapshot.scope, allow: unique([...revision.previousContract.snapshot.scope.allow, ...revision.addedAllow]) } };
      if (revision.additionalAttempts > 0) {
        const nextBudget = nextContract.snapshot?.verificationBudget;
        if (!validVerificationBudget(nextBudget) || (Object.hasOwn(expected, 'verificationBudget')
          ? nextBudget.maxAttempts !== expected.verificationBudget.maxAttempts + revision.additionalAttempts
          : nextBudget.maxAttempts <= revision.additionalAttempts)) fail('invalid historical budget increment');
        expected.verificationBudget = nextBudget;
      }
      if (nextContract.hash !== revision.nextContractHash || !sameStructuredValue(nextContract.snapshot, expected)) fail('revision next contract or snapshot mismatch');
      prior = revision;
    }
    if (prior.nextContractHash !== featureContractHash(feature)) fail('final revised contract hash mismatch');
  } catch (error) { errors.push(`${feature.id}: budget history integrity: ${error.message}`); }
  return errors;
}

async function nativeHooksRouted(content, platform) {
  let settings, canonical, previous, legacy;
  try {
    settings = JSON.parse(content);
    canonical = JSON.parse(await readFile(path.join(HARNESS_DIR, 'hooks', 'native-hook-bootstrap-v3.json'), 'utf8'));
    previous = JSON.parse(await readFile(path.join(HARNESS_DIR, 'hooks', 'native-hook-bootstrap-v2.json'), 'utf8'));
    legacy = JSON.parse(await readFile(path.join(HARNESS_DIR, 'hooks', 'native-hook-bootstrap-v1.json'), 'utf8'));
  } catch { return false; }
  const required = [['PreCompact', 'precompact-handoff.mjs'], ['SessionStart', 'sessionstart-routing.mjs']];
  if (platform === 'claude') required.push(['SubagentStart', 'claude-worker-identity.mjs']);
  return required.every(([event, name]) => Array.isArray(settings?.hooks?.[event]) && settings.hooks[event].some(group => lifecycleHookGroup(group, event) && group.hooks.some(hook => {
    if (!hook || hook.type !== 'command') return false;
    const command = process.platform === 'win32' ? hook.commandWindows ?? hook.command : hook.command;
    if (typeof command !== 'string') return false;
    const key = `${platform}/${name}`, escapedName = name.replaceAll('.', '\\.');
    const absolute = new RegExp(`^node (?:"[^"\\r\\n]+/\\.harness/hooks/${escapedName}"|'[^'\\r\\n]+/\\.harness/hooks/${escapedName}')(?: --platform ${platform})?$`).test(command);
    const git = command === `node "$(git rev-parse --show-toplevel)/.harness/hooks/${name}"${name === 'precompact-handoff.mjs' ? ' --platform ' + platform : ''}`;
    return command === canonical.commands?.[key] || command === previous.commands?.[key] || command === legacy.commands?.[key] || legacy.legacy?.[key]?.includes(command) || absolute || git;
  })));
}

function lifecycleHookGroup(group, event) {
  if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.hooks)
      || Object.keys(group).some(key => !['matcher', 'hooks'].includes(key))) return false;
  if (group.matcher === undefined) return true;
  if (typeof group.matcher !== 'string') return false;
  try { return new RegExp(group.matcher).test(event === 'PreCompact' ? 'auto' : event === 'SessionStart' ? 'compact' : ''); }
  catch { return false; }
}

async function doctor() {
  if (args.integrity !== undefined && args.integrity !== true && args.integrity !== 'true') throw new Error('--integrity accepts a flag or the value true; an integrity request cannot fall back to a structural check.');
  const integrityRequested = args.integrity === true || args.integrity === 'true';
  const { config, state } = await load();
  const continuity = await readContinuity();
  const { errors, warnings, integrity } = await collectDoctor(config, state, continuity, { integrityRequested });
  if (integrity) console.log(`INTEGRITY content-v1 ${integrity.hash} (${integrity.paths} paths; ${integrity.contentBytes} content bytes)`);
  console.log(`Harness doctor: ${ROOT} (runtime v${HARNESS_RUNTIME_VERSION}, schema v${STATE_SCHEMA_VERSION})`);
  console.log(`Features: ${state.features.length}; active: ${activeFeatures(state).length}; passing: ${state.features.filter((item) => item.status === 'passing').length}`);
  console.log(`Continuity: ${continuity.phase}; generation: ${continuity.generation}`);
  for (const warning of warnings) console.log(`WARN  ${warning}`);
  for (const error of errors) console.log(`FAIL  ${error}`);
  if (errors.length === 0) console.log('PASS  Structural state is healthy.');
  if (continuity.phase === 'awaiting_resume') printAwaitingResume(continuity);
  if (errors.length > 0) process.exitCode = 1;
}

async function collectDoctor(config, state, continuity, { integrityRequested = false } = {}) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const featureIds = new Set(state.features.map((item) => item.id));
  try { capturePolicy(config.scope?.capture); } catch (error) { errors.push(error.message); }
  try { contextPolicy(config); } catch (error) { errors.push(error.message); }

  if (config.version !== STATE_SCHEMA_VERSION || state.version !== STATE_SCHEMA_VERSION) errors.push('Unsupported or mismatched harness state schema version.');
  if (!config.project?.purpose || String(config.project.purpose).includes('Replace this sentence')) errors.push('Project purpose is still a placeholder.');
  if (!Number.isInteger(config.policies?.wipLimit) || config.policies.wipLimit < 1) errors.push('policies.wipLimit must be a positive integer.');
  if (!Number.isInteger(config.policies?.maxAttempts) || config.policies.maxAttempts < 1) errors.push('policies.maxAttempts must be a positive integer.');
  if (!Number.isInteger(config.policies?.maxRepeatedFailures) || config.policies.maxRepeatedFailures < 1) errors.push('policies.maxRepeatedFailures must be a positive integer.');
  if (!Number.isFinite(config.policies?.commandTimeoutMs) || config.policies.commandTimeoutMs <= 0) errors.push('policies.commandTimeoutMs must be positive.');
  if (!Array.isArray(config.verification?.full) || config.verification.full.length === 0) errors.push('verification.full needs at least one real command.');
  if (!Array.isArray(config.completion?.baseLayers) || !config.completion.baseLayers.includes('full')) errors.push('completion.baseLayers must include full.');
  if (!Array.isArray(config.completion?.alwaysRunWhenConfigured)) errors.push('completion.alwaysRunWhenConfigured must be an array.');
  if (!Array.isArray(config.scope?.defaultAllow) || !Array.isArray(config.scope?.defaultDeny)) errors.push('scope defaultAllow/defaultDeny must be arrays.');
  if (config.continuity?.mode !== 'orchestrated_worker') errors.push('continuity.mode must be orchestrated_worker.');
  if (config.continuity?.dirtyWorktree !== 'record') errors.push('continuity.dirtyWorktree must be record so unfinished work can always be handed off.');
  if (config.continuity?.blockMutationsAfterHandoff !== true) errors.push('continuity.blockMutationsAfterHandoff must be true.');
  if (!Array.isArray(config.security?.environmentAllow)) errors.push('security.environmentAllow must be an array.');
  const providers = credentialProviders(config);
  const credentialAllowlistOverlaps = credentialEnvironmentAllowOverlaps(config.security);
  if (credentialAllowlistOverlaps.length) {
    errors.push(`Remove credential provider source and target environment names from security.environmentAllow and request providers explicitly per command: ${credentialAllowlistOverlaps.join(', ')}.`);
  }
  if (!config.security?.credentials || config.security.credentials.stateFile !== '.harness/credentials-state.json') errors.push('security.credentials.stateFile must be .harness/credentials-state.json.');
  if (!await exists(CREDENTIAL_STATE_PATH)) errors.push('Credential rotation state is missing. Run the reusable sync command.');
  const invalidProviders = Object.entries(providers).filter(([, provider]) => !validCredentialProvider(provider)).map(([name]) => name);
  if (invalidProviders.length) errors.push(`Invalid credential providers: ${invalidProviders.join(', ')}.`);
  const duplicateTargets = Object.values(providers).map((provider) => provider?.targetEnvironment).filter(Boolean).filter((target, index, all) => all.indexOf(target) !== index);
  if (duplicateTargets.length) errors.push(`Credential providers must use unique target environments: ${unique(duplicateTargets).join(', ')}.`);
  for (const [level, entries] of Object.entries(config.verification ?? {})) {
    if (!Array.isArray(entries) || entries.some((entry) => !validCommandEntry(entry))) errors.push(`verification.${level} contains an invalid command entry.`);
    const unknownProviders = unique((Array.isArray(entries) ? entries : []).flatMap(commandCredentials)).filter((provider) => !Object.hasOwn(providers, provider));
    if (unknownProviders.length) errors.push(`verification.${level} requests unknown credential providers: ${unknownProviders.join(', ')}.`);
  }
  if (!Array.isArray(config.execution?.setup) || !Array.isArray(config.execution?.start) || !Array.isArray(config.execution?.health) || !Array.isArray(config.execution?.shutdown)) errors.push('execution setup/start/health/shutdown must be arrays.');
  if (!Number.isInteger(state.revision) || state.revision < 0) errors.push('features.json revision must be a non-negative integer.');
  if (Number(process.versions.node.split('.')[0]) < Number(config.execution?.harnessRuntime?.minimumMajorVersion ?? 20)) errors.push('Node.js does not meet the configured harness runtime minimum.');
  // Structural startup checks need a complete Git listing, not every dirty byte.
  const repository = await repositoryChanges({ listingOnly: !integrityRequested });
  if (config.scope?.enforcement === 'required' && !repository.available) errors.push(`Git-backed scope enforcement is required but repository state is unavailable: ${repository.reason}`);
  if (integrityRequested && !repository.available && config.scope?.enforcement !== 'required') errors.push(`Full repository integrity capture failed: ${repository.reason}`);
  const integrity = integrityRequested && repository.available ? { hash: stableHash(repository.files), paths: repository.files.length, contentBytes: repository.collector.metrics().fileBytes } : null;
  if (activeFeatures(state).length > Number(config.policies?.wipLimit ?? 1)) errors.push('Active features exceed the WIP limit.');
  if (continuity.phase === 'awaiting_resume' && continuity.handoff?.featureRevision !== state.revision) {
    errors.push(`Pending handoff ${continuity.handoff?.id ?? '(missing)'} captured feature revision ${continuity.handoff?.featureRevision ?? '(missing)'}, but current state is revision ${state.revision}.`);
  } else if (continuity.phase === 'working' && continuity.checkpoint && continuity.checkpoint.featureRevision !== state.revision) {
    warnings.push(`Progress checkpoint ${continuity.checkpoint.id} is older than feature revision ${state.revision}; write a checkpoint before ending the session.`);
  }
  if (!await exists(PROGRESS_PATH)) errors.push('Progress snapshot is missing.');
  if (!await exists(HANDOFF_PATH)) errors.push('Handoff projection is missing.');

  for (const feature of state.features) {
    errors.push(...await validateBudgetHistory(feature, state.features, ROOT));
    if (feature.scopeBaselineRef) {
      try { await resolveBaseline(feature); } catch (error) { errors.push(feature.id + ': ' + error.message); }
    }
    if (!feature.id || ids.has(feature.id)) errors.push(`Feature ID is missing or duplicated: ${feature.id || '(empty)'}`);
    ids.add(feature.id);
    if (!feature.title || !feature.description) errors.push(`${feature.id}: title and description are required.`);
    if (!STATES.has(feature.status)) errors.push(`${feature.id}: invalid status ${feature.status}.`);
    if (!Array.isArray(feature.dependencies)) errors.push(`${feature.id}: dependencies must be an array.`);
    if (!Array.isArray(feature.acceptance) || feature.acceptance.length === 0) errors.push(`${feature.id}: no acceptance criteria.`);
    else if (feature.acceptance.some((item) => !item.id || !item.description || !validCommandEntry(item))) errors.push(`${feature.id}: every acceptance criterion needs a valid executable command.`);
    const unknownAcceptanceProviders = unique((Array.isArray(feature.acceptance) ? feature.acceptance : []).flatMap(commandCredentials)).filter((provider) => !Object.hasOwn(providers, provider));
    if (unknownAcceptanceProviders.length) errors.push(`${feature.id}: acceptance requests unknown credential providers: ${unknownAcceptanceProviders.join(', ')}.`);
    if (!Array.isArray(feature.scope?.allow) || feature.scope.allow.length === 0 || !Array.isArray(feature.scope?.deny)) errors.push(`${feature.id}: scope allow/deny must be explicit arrays.`);
    if (feature.status === 'passing') {
      const integrity = await validatePassingEvidence(feature, config);
      errors.push(...integrity.errors);
      warnings.push(...integrity.warnings);
    }
    for (const dependency of feature.dependencies ?? []) {
      if (!featureIds.has(dependency)) errors.push(`${feature.id}: unknown dependency ${dependency}.`);
      if (dependency === feature.id) errors.push(`${feature.id}: cannot depend on itself.`);
    }
  }
  for (const cycle of findCycles(state.features)) errors.push(`Dependency cycle: ${cycle.join(' -> ')}`);

  for (const required of config.docs?.required ?? []) {
    if (!await exists(path.join(ROOT, required))) warnings.push(`Declared document is missing: ${required}`);
  }
  const enabledAgents = Array.isArray(config.agents?.enabled) ? config.agents.enabled : ['codex'];
  const canonicalInstructionsPath = path.join(ROOT, 'AGENTS.md');
  const canonicalInstructions = await exists(canonicalInstructionsPath) ? await readFile(canonicalInstructionsPath, 'utf8') : '';
  if (!canonicalInstructions.includes(DEVELOPMENT_HARNESS_BOUNDARY)) {
    errors.push('AGENTS.md is missing the canonical Development-Harness Boundary. Run sync and merge .harness/AGENTS.addition.md.');
  }
  for (const agent of enabledAgents) {
    const relative = config.agents?.instructions?.[agent] ?? AGENT_INSTRUCTIONS[agent];
    if (!relative || !Object.hasOwn(AGENT_INSTRUCTIONS, agent)) {
      errors.push(`Unknown agent instruction surface: ${agent}.`);
      continue;
    }
    const instructionPath = path.join(ROOT, relative);
    if (!await exists(instructionPath)) errors.push(`${agent} instruction file is missing: ${relative}.`);
    else if (!instructionRoutes(agent, await readFile(instructionPath, 'utf8'))) errors.push(`${relative} does not route to canonical harness guidance.`);
    const additionName = agent === 'codex' ? 'AGENTS.addition.md' : agent === 'claude' ? 'CLAUDE.addition.md' : 'copilot-instructions.addition.md';
    if (await exists(path.join(HARNESS_DIR, additionName))) errors.push(`${additionName} is still unmerged.`);
  }
  if (enabledAgents.includes('codex')) {
    const guardPath = path.join(HARNESS_DIR, 'hooks', 'precompact-handoff.mjs');
    const hooksPath = path.join(ROOT, '.codex', 'hooks.json');
    if (!await exists(guardPath)) errors.push('Codex pre-compaction handoff adapter is missing. Run the reusable sync command.');
    const hooksText = await exists(hooksPath) ? await readFile(hooksPath, 'utf8') : '';
    if (!await nativeHooksRouted(hooksText, 'codex')) {
      warnings.push('Codex automatic compaction guard is not merged; review .harness/codex-hooks.addition.json or rerun sync.');
    }
  }
  if (enabledAgents.includes('claude')) {
    const settingsPath = path.join(ROOT, '.claude', 'settings.json');
    const settingsText = await exists(settingsPath) ? await readFile(settingsPath, 'utf8') : '';
    const identityPath = path.join(HARNESS_DIR, 'hooks', 'claude-worker-identity.mjs');
    if (!await exists(identityPath) || !await nativeHooksRouted(settingsText, 'claude') || await exists(path.join(HARNESS_DIR, 'claude-hooks.addition.json'))) {
      warnings.push('Claude native identity/compaction hooks are absent or unmerged; review .claude/settings.json and .harness/claude-hooks.addition.json. Unique explicit --worker-id manual operation remains available; automatic hooks cannot infer it.');
    }
  }

  return { errors, warnings, integrity };
}

function findCycles(features) {
  const graph = new Map(features.map((feature) => [feature.id, feature.dependencies ?? []]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  function visit(id, trail) {
    if (visiting.has(id)) {
      cycles.push([...trail.slice(trail.indexOf(id)), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) if (graph.has(dependency)) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id, []);
  return cycles;
}

async function status() {
  const { config, state } = await load();
  const continuity = await readContinuity();
  console.log(`${config.project.name}: ${config.project.purpose}`);
  console.log(`Continuity ${continuity.phase}; generation ${continuity.generation}`);
  if (continuity.phase === 'awaiting_resume') printAwaitingResume(continuity);
  console.log(`WIP ${activeFeatures(state).length}/${config.policies.wipLimit}`);
  if (state.features.length === 0) {
    console.log('No features. Use add to define the first bounded behavior.');
    return;
  }
  const counts = Object.fromEntries([...STATES].map(status => [status, state.features.filter(f => f.status === status).length]));
  console.log('Counts: ' + JSON.stringify(counts) + '; showing active and next candidates only (bootstrap ID for details)');
  for (const feature of [...activeFeatures(state), ...nextCandidates(state, config)].slice(0, 10)) {
    const evidence = feature.evidence?.at(-1) ? ` evidence=${feature.evidence.at(-1)}` : '';
    console.log(`${feature.status.padEnd(11)} ${feature.id.padEnd(16)} ${feature.title}${evidence}`);
  }
  const candidates = nextCandidates(state, config);
  if (candidates.length) console.log(`Next: ${candidates.map((item) => item.id).join(', ')}`);
}

function nextCandidates(state, config) {
  const slots = Math.max(0, Number(config.policies?.wipLimit ?? 1) - activeFeatures(state).length);
  if (slots === 0) return [];
  return state.features
    .filter((feature) => feature.status === 'not_started' && dependencyFailures(state, feature).length === 0)
    .slice(0, slots);
}

async function nextFeature() {
  const { config, state } = await load();
  const continuity = await readContinuity();
  const active = activeFeatures(state);
  const candidates = nextCandidates(state, config);
  const result = {
    continuity: continuityView(continuity),
    active: active.map((item) => ({ id: item.id, title: item.title })),
    candidates: candidates.map((item) => ({ id: item.id, title: item.title }))
  };
  if (args.json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (continuity.phase === 'awaiting_resume') {
    printAwaitingResume(continuity);
    return;
  }
  if (continuityAction(continuity) === 'await_user') {
    printAwaitUser(continuity);
    return;
  }
  if (active.length) {
    console.log(`Continue active feature${active.length === 1 ? '' : 's'}: ${active.map((item) => item.id).join(', ')}`);
    return;
  }
  if (candidates.length) {
    for (const candidate of candidates) console.log(`${candidate.id}: ${candidate.title}`);
    console.log(`Start with: node .harness/run.mjs start ${candidates[0].id}`);
    return;
  }
  const blocked = state.features.filter((item) => item.status === 'blocked');
  if (blocked.length) console.log(`No startable feature; ${blocked.length} historical blocked features. Use bootstrap ID for a deliberately selected feature.`);
  else console.log('No startable feature. Add the next bounded behavior.');
}

async function addFeature() {
  const { config, state } = await load();
  const id = requireText('id', args._[1] || args.id);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error('Feature ID may contain letters, numbers, dots, underscores, and hyphens.');
  if (state.features.some((item) => item.id === id)) throw new Error(`Feature already exists: ${id}`);
  const title = requireText('title', args.title);
  const description = requireText('description', args.description);
  const criteria = list(args.criterion);
  const acceptanceCommands = list(args.acceptCommand || args.command);
  if (criteria.length === 0) throw new Error('--criterion is required. Repeat it for each observable behavior.');
  if (acceptanceCommands.length !== criteria.length) {
    throw new Error('Each --criterion needs one matching --command (or --accept-command).');
  }
  const dependencies = list(args.depends);
  const unknown = dependencies.filter((dependency) => !state.features.some((item) => item.id === dependency));
  if (unknown.length) throw new Error(`Unknown dependencies: ${unknown.join(', ')}`);
  const requiredLayers = unique(['full', ...list(args.level || args.require || 'full')]);
  for (const level of requiredLayers) {
    if (!Object.hasOwn(config.verification, level)) throw new Error(`Unknown verification layer: ${level}`);
  }
  const allowed = list(args.allow);
  if (allowed.length === 0 && args.allowAll !== true) {
    throw new Error('Declare bounded scope with --allow PATTERN (repeatable), or explicitly use --allow-all.');
  }
  const requestedCredentials = list(args.credential || args.credentials);
  const unknownCredentials = requestedCredentials.filter((provider) => !Object.hasOwn(credentialProviders(config), provider));
  if (unknownCredentials.length) throw new Error(`Unknown credential providers: ${unknownCredentials.join(', ')}`);
  const acceptance = criteria.map((description, index) => ({
    id: `ac-${index + 1}`,
    description,
    command: acceptanceCommands[index],
    ...(requestedCredentials.length ? { credentials: requestedCredentials } : {})
  }));
  state.features.push({
    id,
    title,
    description,
    dependencies,
    status: 'not_started',
    requiredLayers,
    scope: {
      allow: args.allowAll === true ? ['**/*'] : allowed,
      deny: list(args.deny).length ? list(args.deny) : config.scope.defaultDeny
    },
    acceptance,
    evidence: [],
    blocker: null,
    attempts: 0,
    repeatedFailures: 0,
    lastFailureFingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  state.revision = Number(state.revision ?? 0) + 1;
  await writeJson(FEATURES_PATH, state);
  await appendEvent('feature.added', { featureId: id, contractHash: stableHash(contractShape(state.features.at(-1))) });
  console.log(`Added ${id}. Start it with: node .harness/run.mjs start ${id}`);
}

async function startFeature() {
  const { config, state } = await load();
  const feature = byId(state, requireText('id', args._[1] || args.id));
  if (feature.status !== 'not_started') throw new Error(`${feature.id} is ${feature.status}; only not_started features can start.`);
  if (activeFeatures(state).length >= config.policies.wipLimit) throw new Error(`WIP limit ${config.policies.wipLimit} reached.`);
  const missing = dependencyFailures(state, feature);
  if (missing.length) throw new Error(`Dependencies are not passing: ${missing.join(', ')}`);
  feature.scopeBaseline = await repositoryBaseline(capturePolicy(config.scope?.capture));
  if (config.scope?.enforcement === 'required' && !feature.scopeBaseline.available) {
    const detail = feature.scopeBaseline.reason ? ` ${feature.scopeBaseline.reason}` : '';
    throw new Error(`Git-backed scope enforcement is required, but repository state is unavailable.${detail} Initialize Git and retry.`);
  }
  const contractSnapshot = contractShape(feature);
  feature.contract = {
    version: 2,
    scopeBaselineHash: feature.scopeBaseline.baselineHash,
    hash: stableHash({ contract: contractSnapshot, scopeBaselineHash: feature.scopeBaseline.baselineHash }),
    snapshot: contractSnapshot,
    frozenAt: new Date().toISOString()
  };
  feature.scopeBaselineRef = await storeBaseline(feature.scopeBaseline);
  delete feature.scopeBaseline;
  feature.status = 'active';
  feature.updatedAt = new Date().toISOString();
  state.revision = Number(state.revision ?? 0) + 1;
  await writeJson(FEATURES_PATH, state);
  await bindOwnedFeature(feature.id);
  await appendEvent('feature.started', { featureId: feature.id, contractHash: feature.contract.hash, revision: state.revision });
  console.log(`Started ${feature.id}: ${feature.title}`);
}

async function bindOwnedFeature(id) {
  const continuity = await readContinuity();
  assertOwner(continuity);
  await writeJson(CONTINUITY_PATH, { ...continuity, owner: { ...continuity.owner, featureId: id } });
}

async function blockFeature() {
  const { state } = await load();
  const feature = byId(state, requireText('id', args._[1] || args.id));
  if (feature.status !== 'active') throw new Error('Only active features can be blocked.');
  feature.status = 'blocked';
  feature.blocker = requireText('reason', args.reason);
  feature.updatedAt = new Date().toISOString();
  state.revision = Number(state.revision ?? 0) + 1;
  await writeJson(FEATURES_PATH, state);
  await bindOwnedFeature(feature.id);
  await appendEvent('feature.blocked', { featureId: feature.id, reason: feature.blocker, revision: state.revision });
  console.log(`Blocked ${feature.id}: ${feature.blocker}`);
}

async function unblockFeature() {
  const { config, state } = await load();
  const feature = byId(state, requireText('id', args._[1] || args.id));
  if (feature.status !== 'blocked') throw new Error('Only blocked features can be unblocked.');
  if (activeFeatures(state).length >= config.policies.wipLimit) throw new Error(`WIP limit ${config.policies.wipLimit} reached.`);
  const missing = dependencyFailures(state, feature);
  if (missing.length) throw new Error(`Dependencies are not passing: ${missing.join(', ')}`);
  feature.status = 'active';
  feature.blocker = null;
  feature.updatedAt = new Date().toISOString();
  state.revision = Number(state.revision ?? 0) + 1;
  await writeJson(FEATURES_PATH, state);
  await bindOwnedFeature(feature.id);
  await appendEvent('feature.unblocked', { featureId: feature.id, revision: state.revision });
  console.log(`Unblocked ${feature.id}.`);
}

async function checkLevel() {
  const { config } = await load();
  const level = String(args._[1] || args.level || 'quick');
  const commands = config.verification?.[level];
  if (!Array.isArray(commands) || commands.length === 0) throw new Error(`No commands configured for verification.${level}.`);
  const result = await runCommands(commands.map((entry) => typeof entry === 'string' ? { command: entry, layer: level } : { ...entry, layer: level }), config);
  printRun(result);
  if (!result.pass) process.exitCode = 1;
}

async function verifyFeature() {
  const { config, state } = await load();
  const requested = args._[1] || args.id;
  const feature = requested ? byId(state, requested) : activeFeatures(state)[0];
  if (!feature) throw new Error('No active feature. Provide a feature ID.');
  if (feature.status !== 'active') throw new Error(`${feature.id} is ${feature.status}; only active features can verify.`);
  const historyErrors = await validateBudgetHistory(feature, state.features, ROOT);
  if (historyErrors.length) throw new Error(historyErrors.join('; '));
  const budget = attemptBudget(config, feature);
  if (budget.attemptsBefore >= budget.effectiveMaxAttempts) {
    throw new Error(`${feature.id} exhausted its verification budget; block, inspect the trace, and revise the plan.`);
  }
  const currentContractHash = featureContractHash(feature);
  if (!feature.contract?.hash || feature.contract.hash !== currentContractHash) {
    throw new Error(`${feature.id} contract changed after start. Create a new feature or return it to not_started through an explicit review.`);
  }
  const layers = unique([
    ...(config.completion?.alwaysRunWhenConfigured ?? []).filter((layer) => (config.verification?.[layer]?.length ?? 0) > 0),
    ...(config.completion?.baseLayers ?? ['full']),
    ...(feature.requiredLayers ?? ['full'])
  ]);
  const missingLayers = layers.filter((layer) => !Array.isArray(config.verification?.[layer]) || config.verification[layer].length === 0);
  if (missingLayers.length) throw new Error(`Required verification layers have no commands: ${missingLayers.join(', ')}`);
  if (!feature.acceptance?.length || feature.acceptance.some((item) => !item.command)) {
    throw new Error(`${feature.id} needs executable behavior-specific acceptance criteria.`);
  }
  const entries = [];
  for (const layer of layers) {
    for (const specification of config.verification[layer]) {
      entries.push(typeof specification === 'string'
        ? { command: specification, layer }
        : { ...specification, layer });
    }
  }
  for (const criterion of feature.acceptance) entries.push({ ...criterion, layer: 'acceptance', criterionId: criterion.id });
  const configHash = stableHash(config);
  const verificationPlan = verificationPlanSnapshot(config, feature, layers, entries, currentContractHash, configHash);
  const plannedEntries = entries.map((entry, executionOrder) => ({
    ...entry,
    criterionId: entry.criterionId ?? null,
    executionId: verificationPlan.executions[executionOrder].id,
    executionOrder
  }));

  const startedAt = new Date().toISOString();
  const preScope = await evaluateScope(feature, config);
  const before = preScope.repository ?? null;
  if (before?.captureMode === 'artifact-metadata-v1') console.log('Scope capture: artifact-metadata-v1; selected generated outputs use metadata fingerprints. Use doctor --integrity for current content digests.');
  let run = preScope.violations.length
    ? {
        pass: false,
        results: [{
          command: '[scope] changed files must satisfy feature allow/deny rules',
          layer: 'scope',
          pass: false,
          exitCode: 1,
          timedOut: false,
          durationMs: 0,
          output: `Out-of-scope changes:\n${preScope.violations.map((item) => `- ${item}`).join('\n')}`
        }]
      }
    : await runCommands(plannedEntries, config);
  const postScope = await evaluateScope(feature, config);
  if (postScope.violations.length) {
    run = {
      pass: false,
      results: [...run.results, {
        command: '[scope] post-verification scope check',
        layer: 'scope',
        pass: false,
        exitCode: 1,
        timedOut: false,
        durationMs: 0,
        output: `Out-of-scope changes:\n${postScope.violations.map((item) => `- ${item}`).join('\n')}`
      }]
    };
  }
  const after = postScope.repository ?? null;
  const slug = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const relativeEvidence = `.harness/evidence/${slug}-${safeName(feature.id)}.json`;
  const evidence = {
    harnessVersion: HARNESS_RUNTIME_VERSION,
    featureId: feature.id,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    requiredLayers: layers,
    executedLayers: unique(run.results.map((item) => item.layer)),
    contractHash: currentContractHash,
    configHash,
    verificationHash: stableHash(verificationPlan),
    verificationPlan,
    attempt: budget.attemptsBefore + 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    pass: run.pass,
    commands: run.results,
    changedFiles: postScope.changed.map((item) => item.path),
    scopeViolations: postScope.violations,
    repository: { before, after },
    repositoryStatus: postScope.output.trim()
  };
  await exclusiveJson(path.join(ROOT, relativeEvidence), evidence);
  feature.evidence.push(relativeEvidence.replaceAll('\\', '/'));
  feature.lastVerification = { at: evidence.finishedAt, pass: evidence.pass };
  feature.attempts = Number(feature.attempts ?? 0) + 1;
  if (run.pass) {
    feature.status = 'passing';
    feature.repeatedFailures = 0;
    feature.lastFailureFingerprint = null;
  } else {
    const fingerprint = stableHash(run.results.filter((item) => item.exitCode !== 0).map((item) => ({ layer: item.layer, command: item.command, exitCode: item.exitCode, output: item.output.slice(-1000) })));
    feature.repeatedFailures = feature.lastFailureFingerprint === fingerprint ? Number(feature.repeatedFailures ?? 0) + 1 : 1;
    feature.lastFailureFingerprint = fingerprint;
    if (feature.attempts >= budget.effectiveMaxAttempts || feature.repeatedFailures >= Number(config.policies?.maxRepeatedFailures ?? 2)) {
      feature.status = 'blocked';
      feature.blocker = `Verification stop condition reached after ${feature.attempts} attempt(s). Inspect: node .harness/run.mjs trace ${feature.id}`;
    }
  }
  feature.updatedAt = evidence.finishedAt;
  state.revision = Number(state.revision ?? 0) + 1;
  await writeJson(FEATURES_PATH, state);
  await appendEvent('feature.verified', {
    featureId: feature.id,
    pass: run.pass,
    status: feature.status,
    attempts: feature.attempts,
    evidence: relativeEvidence.replaceAll('\\', '/'),
    failureFingerprint: feature.lastFailureFingerprint,
    revision: state.revision
  });
  printRun(run);
  console.log(`Evidence: ${relativeEvidence}`);
  console.log(run.pass ? `PASSING ${feature.id}` : `${feature.status.toUpperCase()} ${feature.id} (${feature.blocker ?? 'repair failures and verify again'})`);
  if (!run.pass) process.exitCode = 1;
}

async function evaluateScope(feature, config) {
  let baseline;
  try { baseline = await resolveBaseline(feature); } catch (error) { return scopeFailure(config, 'scope-baseline-unavailable', error.message); }
  const baselineProblem = validateScopeBaseline(baseline, feature.contract?.scopeBaselineHash);
  if (baselineProblem) {
    return scopeFailure(config, 'scope-baseline-unavailable', baselineProblem);
  }
  const policy = baseline.capturePolicy ?? capturePolicy();
  const current = await repositoryChanges({ policy, scopeOnly: true });
  if (!current.available) {
    return scopeFailure(config, 'scope-unavailable', current.reason || 'Git repository state could not be read', current.output);
  }
  const identity = await repositoryIdentity(current);
  if (!identity.available) {
    return scopeFailure(config, 'scope-unavailable', identity.reason || 'Git repository identity could not be read', identity.status);
  }
  const committed = await committedChangesSince(baseline, identity, current.collector);
  if (!committed.available) {
    return scopeFailure(config, 'scope-history-unavailable', committed.reason, committed.output);
  }
  let dirty;
  try {
    dirty = await dirtyChangesSince(baseline.files.filter((item) => !isScopeOwnedPath(item.path)), current.files, current.collector);
  } catch (error) {
    return scopeFailure(config, 'scope-unavailable', error.message, current.output);
  }
  const changedByPath = new Map(committed.files.map((item) => [item.path, item]));
  for (const item of dirty) changedByPath.set(item.path, item);
  const changed = [...changedByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  const scopedChanges = changed.filter((item) => !RUNTIME_OWNED_PATHS.some((pattern) => matchGlob(item.path, pattern)));
  const allow = feature.scope?.allow ?? ['**/*'];
  const deny = feature.scope?.deny ?? [];
  const violations = scopedChanges
    .map((item) => item.path)
    .filter((file) => deny.some((pattern) => matchGlob(file, pattern)) || !allow.some((pattern) => matchGlob(file, pattern)));
  return {
    changed: scopedChanges,
    violations,
    output: [current.output, committed.output].filter(Boolean).join('\n'),
    repository: identity,
    capturePolicy: policy
  };
}

function scopeFailure(config, code, reason, output = '') {
  const message = `[${code}] ${reason}`;
  const violations = config.scope?.enforcement === 'required' ? [message] : [];
  return { changed: [], violations, output: [output, message].filter(Boolean).join('\n') };
}

function validateScopeBaseline(baseline, expectedBaselineHash) {
  if (!baseline || baseline.version !== 2) {
    return 'Feature scope baseline predates repository snapshot v2; preserve it as history and start a successor feature.';
  }
  if (baseline.available !== true) return baseline.reason || 'Feature scope baseline was unavailable at start.';
  if (baseline.capturePolicy) {
    try { if (stableHash(capturePolicy(baseline.capturePolicy)) !== stableHash(baseline.capturePolicy)) return 'Feature scope baseline capture policy is not canonical.'; }
    catch (error) { return error.message; }
  }
  if (typeof baseline.head !== 'string' || !baseline.head || typeof baseline.tree !== 'string' || !baseline.tree) {
    return 'Feature scope baseline is missing its starting HEAD or tree identity.';
  }
  if (!(typeof baseline.branch === 'string' || baseline.branch === null) || !Array.isArray(baseline.files)) {
    return 'Feature scope baseline has an invalid branch or dirty-file record.';
  }
  if (baseline.files.some((item) => typeof item?.path !== 'string'
    || typeof item.status !== 'string'
    || typeof item.hash !== 'string')) {
    return 'Feature scope baseline contains an invalid dirty-file fingerprint.';
  }
  if (baseline.files.some((item) => item.fingerprint === 'metadata-v1'
    && (!metadataArtifact(item.path, baseline.capturePolicy) || !/^metadata-v1:[a-f0-9]{64}$/.test(item.hash) || !/^[a-f0-9]{64}$/.test(item.contentHash)))) {
    return 'Feature scope baseline metadata fingerprint lacks its original artifact content digest.';
  }
  if (baseline.worktreeHash !== stableHash(baseline.files)) {
    return 'Feature scope baseline dirty-file fingerprint does not match its recorded hash.';
  }
  const actualBaselineHash = scopeBaselineHash(baseline);
  if (baseline.baselineHash !== actualBaselineHash || expectedBaselineHash !== actualBaselineHash) {
    return 'Feature scope baseline identity does not match the frozen feature contract.';
  }
  return null;
}

async function dirtyChangesSince(baselineFiles, currentFiles, collector = repositoryCaptureCollector()) {
  const baseline = new Map(baselineFiles.map(item => [item.path,item]));
  const current = new Map(currentFiles.map(item => [item.path,item]));
  const changed = currentFiles.filter(item => !baseline.has(item.path) || baseline.get(item.path).hash !== item.hash);
  const missing = baselineFiles.filter(item => !current.has(item.path)).map(item => ({path:item.path,status:'B '}));
  for (const resolved of await collector.collect(missing)) if (baseline.get(resolved.path)?.hash !== resolved.hash) changed.push(resolved);
  return changed;
}

async function repositoryBaseline(policy = capturePolicy()) {
  // Metadata fingerprints are used for later scope comparison; start still seals
  // the original artifact bytes once, alongside those explicitly labelled rows.
  const changes = await repositoryChanges({ policy, scopeOnly: true, baselineIntegrity: true });
  const identity = await repositoryIdentity(changes);
  const available = changes.available && identity.available;
  const baseline = {
    version: 2,
    capturePolicy: policy,
    available,
    head: identity.head,
    tree: identity.tree,
    branch: identity.branch,
    files: changes.files,
    worktreeHash: changes.available ? stableHash(changes.files) : null,
    output: changes.output,
    diagnostics: [changes.diagnostics, identity.diagnostics].filter(Boolean).join('\n'),
    reason: available ? null : (changes.reason || identity.reason || 'Git repository baseline could not be captured.')
  };
  return { ...baseline, baselineHash: scopeBaselineHash(baseline) };
}

async function repositoryIdentity(status = null) {
  const worktree = status ?? await repositoryChanges();
  const [head, tree, branch] = await Promise.all([
    captureGit(['rev-parse', '--verify', 'HEAD']),
    captureGit(['rev-parse', '--verify', 'HEAD^{tree}']),
    captureGit(['branch', '--show-current'])
  ]);
  const failures = [];
  if (!worktree.available) failures.push(worktree.reason || 'Git status is unavailable.');
  if (head.exitCode !== 0 || head.overflow) failures.push(gitCaptureFailure('git rev-parse HEAD', head));
  if (tree.exitCode !== 0 || tree.overflow) failures.push(gitCaptureFailure('git rev-parse HEAD^{tree}', tree));
  if (branch.exitCode !== 0 || branch.overflow) failures.push(gitCaptureFailure('git branch --show-current', branch));
  return {
    available: failures.length === 0,
    head: head.exitCode === 0 && !head.overflow ? head.stdout.trim() : null,
    tree: tree.exitCode === 0 && !tree.overflow ? tree.stdout.trim() : null,
    branch: branch.exitCode === 0 && !branch.overflow ? branch.stdout.trim() : null,
    statusHash: stableHash(worktree.files ?? []),
    captureMode: worktree.captureMode ?? 'content-v1',
    ...(worktree.capturePolicy ? { capturePolicy: worktree.capturePolicy } : {}),
    ...(worktree.collector ? { captureMetrics: worktree.collector.metrics() } : {}),
    status: worktree.output.trim(),
    diagnostics: [worktree.diagnostics, head.stderr, tree.stderr, branch.stderr].filter(Boolean).join('\n').trim(),
    reason: failures.length ? unique(failures).join(' ') : null
  };
}

async function repositoryChanges(options = {}) {
  const result = await captureGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.exitCode !== 0 || result.overflow) {
    const reason = gitCaptureFailure('git status', result);
    return { available: false, files: [], output: reason, diagnostics: result.stderr.trim(), reason };
  }
  let records;
  try {
    records = parsePorcelainStatus(result.stdoutBuffer)
      .filter(record => !isTransientHarnessPath(record.path) || (record.fromPath && !isTransientHarnessPath(record.fromPath)));
  } catch (error) {
    const reason = `git status returned malformed NUL-delimited output: ${error.message}`;
    return { available: false, files: [], output: reason, diagnostics: result.stderr.trim(), reason };
  }
  const excluded = options.scopeOnly ? isScopeOwnedPath : isTransientHarnessPath;
  const collector = repositoryCaptureCollector(REPOSITORY_CAPTURE_LIMITS, options.policy, options.baselineIntegrity);
  let files;
  try {
    const requests = [];
    for (const record of records) {
      if (record.fromPath && !excluded(record.fromPath)) requests.push({path:record.fromPath,status:'D '});
      if (!excluded(record.path)) requests.push({path:record.path,status:record.status});
    }
    files = options.listingOnly ? requests : await collector.collect(requests);
  } catch (error) {
    return { available:false,files:[],output:error.message,diagnostics:result.stderr.trim(),reason:error.message };
  }
  const output = records.map(record => `${record.status} ${record.fromPath ? `${record.fromPath} -> ` : ''}${record.path}`).join('\n');
  return { available:true,files,output,diagnostics:result.stderr.trim(),reason:null,collector,
    captureMode: options.listingOnly ? 'listing-v1' : options.policy?.metadataRoots?.length ? 'artifact-metadata-v1' : 'content-v1',
    ...(options.policy ? { capturePolicy: options.policy } : {}) };
}

function parsePorcelainStatus(stdoutBuffer) {
  const fields = splitNulFields(stdoutBuffer, 'git status');
  const records = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!/^[ MTADRCU?!]{2} /.test(field)) throw new Error(`invalid status record at field ${index + 1}`);
    const status = field.slice(0, 2);
    const file = normalizePath(field.slice(3));
    if (!file) throw new Error(`empty path at field ${index + 1}`);
    const renameOrCopy = status.includes('R') || status.includes('C');
    if (renameOrCopy && index + 1 >= fields.length) throw new Error(`missing source path for ${status.trim()} record`);
    const fromPath = renameOrCopy ? normalizePath(fields[++index]) : null;
    if (renameOrCopy && !fromPath) throw new Error(`empty source path for ${status.trim()} record`);
    records.push({ status, path: file, fromPath: fromPath || null });
  }
  return records;
}

function splitNulFields(buffer, label) {
  if (!Buffer.isBuffer(buffer)) throw new Error(`${label} output was not captured as bytes`);
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 0) throw new Error(`${label} output was not NUL terminated`);
  const fields = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    const bytes = buffer.subarray(start, index);
    const field = bytes.toString('utf8');
    if (!Buffer.from(field, 'utf8').equals(bytes)) throw new Error(`${label} contains a path that is not valid UTF-8`);
    fields.push(field);
    start = index + 1;
  }
  return fields;
}

async function committedChangesSince(baseline, currentIdentity, collector = repositoryCaptureCollector()) {
  const startingTree = await captureGit(['rev-parse', '--verify', `${baseline.head}^{tree}`]);
  if (startingTree.exitCode !== 0 || startingTree.overflow) {
    const reason = gitCaptureFailure('git rev-parse starting tree', startingTree);
    return { available: false, files: [], output: reason, reason };
  }
  if (startingTree.stdout.trim() !== baseline.tree) {
    const reason = 'The recorded starting tree does not match the starting HEAD; repository history or the baseline was rewritten.';
    return { available: false, files: [], output: reason, reason };
  }

  const ancestry = await captureGit(['merge-base', '--is-ancestor', baseline.head, currentIdentity.head]);
  if (ancestry.overflow || ancestry.exitCode > 1) {
    const reason = gitCaptureFailure('git merge-base --is-ancestor', ancestry);
    return { available: false, files: [], output: reason, reason };
  }
  if (ancestry.exitCode === 1) {
    const reason = `Starting HEAD ${baseline.head} is not an ancestor of current HEAD ${currentIdentity.head}; repository history is unrelated or rewritten.`;
    return { available: false, files: [], output: reason, reason };
  }
  if (baseline.head === currentIdentity.head) return { available: true, files: [], output: '', reason: null };

  const result = await captureGit(['diff', '--name-status', '-z', '--find-renames', baseline.head, currentIdentity.head, '--']);
  if (result.exitCode !== 0 || result.overflow) {
    const reason = gitCaptureFailure('git diff from feature start', result);
    return { available: false, files: [], output: reason, reason };
  }
  let records;
  try {
    records = parseNameStatus(result.stdoutBuffer);
  } catch (error) {
    const reason = `git diff returned malformed NUL-delimited output: ${error.message}`;
    return { available: false, files: [], output: reason, reason };
  }

  let files;
  try {
    const requests=[];
    for(const record of records){if(record.fromPath&&!isScopeOwnedPath(record.fromPath))requests.push({path:record.fromPath,status:'D '});if(!isScopeOwnedPath(record.path))requests.push({path:record.path,status:`${record.status[0]} `});}
    files=new Map((await collector.collect(requests)).map(item=>[item.path,item]));
  }catch(error){return {available:false,files:[],output:error.message,reason:error.message};}
  const baselineFiles = new Map(baseline.files.map((item) => [item.path, item]));
  for (const [file, item] of files) {
    if (baselineFiles.get(file)?.hash === item.hash) files.delete(file);
  }
  const committedFiles = [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
  return {
    available: true,
    files: committedFiles,
    output: committedFiles.map((item) => `[committed ${item.status.trim()}] ${item.path}`).join('\n'),
    reason: null
  };
}

function parseNameStatus(stdoutBuffer) {
  const fields = splitNulFields(stdoutBuffer, 'git diff');
  const records = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[ADMTUXB]|[RC][0-9]{0,3})$/.test(status)) {
      throw new Error(`invalid name-status token at field ${index}`);
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      if (index + 1 >= fields.length) throw new Error(`missing paths for ${status} record`);
      const fromPath = normalizePath(fields[index++]);
      const file = normalizePath(fields[index++]);
      if (!fromPath || !file) throw new Error(`empty path for ${status} record`);
      records.push({ status, path: file, fromPath });
    } else {
      if (index >= fields.length) throw new Error(`missing path for ${status} record`);
      const file = normalizePath(fields[index++]);
      if (!file) throw new Error(`empty path for ${status} record`);
      records.push({ status, path: file, fromPath: null });
    }
  }
  return records;
}

function gitCaptureFailure(label, result) {
  if (result.overflow) {
    return `${label} exceeded the bounded ${result.maxBytes}-byte capture limit; repository snapshot is incomplete.`;
  }
  if (result.timedOut) return `${label} timed out before a complete repository snapshot was captured.`;
  const detail = result.stderr.trim();
  return detail ? `${label} failed: ${detail}` : `${label} failed with exit code ${result.exitCode}.`;
}

function isTransientHarnessPath(value) {
  if (!value) return false;
  const normalized = normalizePath(value).replace(/\/$/, '');
  return normalized.startsWith('.harness/baselines/') || normalized === '.harness/state.lock' || normalized.startsWith('.harness/state.lock/')
    || normalized === '.harness/context' || normalized.startsWith('.harness/context/') || normalized === '.harness/logs' || normalized.startsWith('.harness/logs/')
    || /^\.harness\/(?:features|continuity|credentials-state)\.json\.[0-9]+\.[0-9]+\.tmp$/.test(normalized);
}

function isScopeOwnedPath(value) {
  return isTransientHarnessPath(value) || RUNTIME_OWNED_PATHS.some((pattern) => matchGlob(value, pattern));
}

function repositoryCapturePath(value) {
  if (typeof value !== 'string' || Buffer.from(value, 'utf8').toString('utf8') !== value) throw new Error('invalid repository path encoding');
  const relative = normalizePath(value).replace(/\/$/, '');
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\0')
    || relative.split('/').some(part => !part || part === '.' || part === '..')
    || (process.platform === 'win32' && relative.split('/').some(part => /[:<>"|?*]/.test(part) || /[. ]$/.test(part)))) throw new Error('invalid repository-relative capture path');
  return relative;
}

function capturePolicy(value) {
  if (value === undefined) return { version: 1, metadataRoots: [], metadataExtensions: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !['version', 'metadataRoots', 'metadataExtensions'].includes(key))
    || (value.version !== undefined && value.version !== 1)
    || !Array.isArray(value.metadataRoots) || !Array.isArray(value.metadataExtensions)) {
    throw new Error('scope.capture must contain metadataRoots and metadataExtensions arrays (version 1).');
  }
  const metadataRoots = [...new Set(value.metadataRoots.map((root) => {
    const canonical = repositoryCapturePath(root);
    if (root !== canonical || /[*?\[\]{}]/.test(root)) throw new Error('scope.capture metadataRoots must be exact canonical repository-relative paths.');
    if (/^(?:\.git|\.harness|\.github|\.codex|\.claude|src|scripts|tests|test|bin|skill|packages)(?:\/|$)/i.test(root)) {
      throw new Error(`scope.capture metadata root is a protected development/source path: ${root}`);
    }
    return root;
  }))].sort();
  const metadataExtensions = [...new Set(value.metadataExtensions.map((extension) => {
    if (typeof extension !== 'string' || !ARTIFACT_METADATA_EXTENSIONS.has(extension)) throw new Error(`scope.capture metadata extension is not an approved generated output type: ${extension}`);
    return extension;
  }))].sort();
  return { version: 1, metadataRoots, metadataExtensions };
}

function metadataArtifact(relative, policy) {
  return Boolean(policy?.metadataRoots?.some((root) => relative.startsWith(root + '/'))
    && ARTIFACT_METADATA_EXTENSIONS.has(path.extname(relative).toLowerCase())
    && policy.metadataExtensions.includes(path.extname(relative).toLowerCase()));
}

function repositoryCaptureIdentity(info) {
  return [info.dev,info.ino,info.mode,info.size,info.mtimeMs,info.ctimeMs].join(':');
}

function repositoryCaptureCollector(limits = REPOSITORY_CAPTURE_LIMITS, policy = null, baselineIntegrity = false) {
  const began = performance.now(), nodes = new Map(), folded = new Map(), ancestry = new Map();
  let entries = 0, manifestBytes = 0, fileBytes = 0;const fileBuffer=Buffer.alloc(1048576);
  function guard() { if (performance.now()-began > limits.elapsedMs) throw new Error('repository capture elapsed limit exceeded'); }
  function account(value) {manifestBytes += Buffer.byteLength(JSON.stringify(value)); if (manifestBytes > limits.manifestBytes) throw new Error('repository capture manifest limit exceeded');guard();}
  async function ancestors(relative) {
    const seal = [];
    for (const component of relative.split('/').slice(0,-1)) {
      const part = seal.length ? seal.at(-1).path+'/'+component : component;
      let info;try {info=await lstat(path.join(ROOT,part));}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR'){if(ancestry.has(part)&&ancestry.get(part)!==null)throw new Error('repository capture ancestor disappeared');seal.push({path:part,identity:null});ancestry.set(part,null);return {missing:true,seal};}throw error;}
      const identity=repositoryCaptureIdentity(info);if(ancestry.has(part)&&ancestry.get(part)!==identity)throw new Error('repository capture ancestor changed');ancestry.set(part,identity);seal.push({path:part,identity});
      if(info.isSymbolicLink()||info.isFile())return {missing:true,seal};if(!info.isDirectory())throw new Error('unknown repository ancestor filesystem type');guard();
    }
    return {missing:false,seal};
  }
  async function sealAncestors(seal) {for(const row of seal){let info;try{info=await lstat(path.join(ROOT,row.path));}catch(error){if((error.code==='ENOENT'||error.code==='ENOTDIR')&&row.identity===null)continue;throw error;}if(row.identity===null||repositoryCaptureIdentity(info)!==row.identity)throw new Error('repository capture ancestor changed');guard();}}
  async function sealCapture(){
    await sealAncestors([...ancestry].map(([path,identity])=>({path,identity})));
    for(const node of nodes.values()){
      if(node.obstructed)continue;
      let info;try{info=await lstat(path.join(ROOT,node.path));}catch(error){if((error.code==='ENOENT'||error.code==='ENOTDIR')&&node.kind==='deleted')continue;throw error;}
      if(node.kind==='deleted'||repositoryCaptureIdentity(info)!==node.identity)throw new Error('repository captured identity changed');
      if(node.kind==='directory'&&JSON.stringify(await names(path.join(ROOT,node.path)))!==JSON.stringify(node.names))throw new Error('repository captured membership changed');guard();
    }
  }
  async function names(target) {
    const result=[],directory=await opendir(target,{encoding:'buffer',bufferSize:32});let nameBytes=0;
    for await(const entry of directory){guard();const bytes=entry.name;if(!Buffer.isBuffer(bytes))throw new Error('directory members not captured as bytes');const name=bytes.toString('utf8');
      if(!Buffer.from(name,'utf8').equals(bytes)||!name||name.includes('/')||(process.platform === 'win32' && name.includes('\\'))||name==='.'||name==='..')throw new Error('invalid repository directory member encoding');
      if(result.length>=limits.entries)throw new Error('repository capture entry limit exceeded');nameBytes+=bytes.length;if(nameBytes>limits.manifestBytes)throw new Error('repository capture manifest limit exceeded');result.push(name);
    }
    result.sort();return result;
  }
  async function walk(relative) {
    guard();if(nodes.has(relative))return nodes.get(relative);
    if(relative.split('/').length>limits.depth)throw new Error('repository capture depth limit exceeded');
    if(++entries>limits.entries)throw new Error('repository capture entry limit exceeded');
    const key=process.platform==='win32'?relative.toLowerCase():relative;
    if(folded.has(key)&&folded.get(key)!==relative)throw new Error('conflicting repository path identity');folded.set(key,relative);
    const before=await ancestors(relative);let info;
    if(!before.missing){try{info=await lstat(path.join(ROOT,relative));}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}}
    const node={path:relative,hash:'deleted',kind:'deleted',children:[],obstructed:before.missing};
    if(info){const target=path.join(ROOT,relative),identity=repositoryCaptureIdentity(info);node.identity=identity;await sealAncestors(before.seal);
      if(info.isSymbolicLink()){const link=await readlink(target,{encoding:'buffer'});node.hash=createHash('sha256').update('120000\0').update(link).digest('hex');node.kind='symlink';const again=await readlink(target,{encoding:'buffer'});if(!link.equals(again))throw new Error('repository symbolic link changed');}
      else if(info.isFile()&&metadataArtifact(relative,policy)&&!baselineIntegrity){
        node.hash='metadata-v1:'+createHash('sha256').update(identity).digest('hex');node.kind='file';node.fingerprint='metadata-v1';
      }else if(info.isFile()){
        fileBytes+=info.size;if(fileBytes>limits.fileBytes)throw new Error('repository capture file-byte limit exceeded');
        const handle=await open(target,'r');try{if(repositoryCaptureIdentity(await handle.stat())!==identity)throw new Error('repository opened file identity changed');await sealAncestors(before.seal);
          const mode=(info.mode&0o111)===0?'100644':'100755',digest=createHash('sha256').update(`${mode}\0`),buffer=fileBuffer;let total=0;
          for(;;){guard();const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;if(total>info.size)throw new Error('repository file grew during capture');digest.update(buffer.subarray(0,bytesRead));}
          if(total!==info.size||repositoryCaptureIdentity(await handle.stat())!==identity)throw new Error('repository file changed during capture');node.hash=digest.digest('hex');node.kind='file';
          if(metadataArtifact(relative,policy)){node.contentHash=node.hash;node.hash='metadata-v1:'+createHash('sha256').update(identity).digest('hex');node.fingerprint='metadata-v1';}
        }finally{await handle.close();}
      }else if(info.isDirectory()){
        const first=await names(target),membership=[];node.kind='directory';node.names=first;await sealAncestors(before.seal);if(repositoryCaptureIdentity(await lstat(target))!==identity)throw new Error('repository directory changed before traversal');
        for(const name of first){const child=await walk(repositoryCapturePath(relative+'/'+name));node.children.push(child.path);membership.push({name,type:child.kind});if(child.kind==='deleted')throw new Error('repository directory member disappeared');}
        const last=await names(target);if(JSON.stringify(first)!==JSON.stringify(last))throw new Error('repository directory membership changed');account(membership);
        node.hash=createHash('sha256').update('040000\0harness-directory-v1\0').update(JSON.stringify(membership)).digest('hex');
      }else throw new Error('unknown repository filesystem type');
      const after=await lstat(target);if(repositoryCaptureIdentity(after)!==identity)throw new Error('repository path identity changed');
    }else if(!before.missing){try{await lstat(path.join(ROOT,relative));throw new Error('repository missing path appeared');}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}}
    await sealAncestors(before.seal);account({path:node.path,hash:node.hash,kind:node.kind});nodes.set(relative,node);return node;
  }
  async function collect(requests) {
    await sealCapture();const statuses=new Map();for(const row of requests){const relative=repositoryCapturePath(row.path);if(typeof row.status!=='string'||!/^[ MTADRCU?!B]{2}$/.test(row.status))throw new Error('invalid repository capture status');account({path:relative,status:row.status});if(statuses.has(relative)&&statuses.get(relative)!==row.status)throw new Error('conflicting repository capture statuses');statuses.set(relative,row.status);}
    const ordered=[...statuses.keys()].sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b)),roots=[],rootSet=new Set();
    for(const relative of ordered){const parts=relative.split('/');let covering=null;for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/');if(rootSet.has(parent)&&nodes.get(parent)?.kind==='directory'){covering=parent;break;}}if(covering){if(statuses.get(covering)!==statuses.get(relative))throw new Error('conflicting overlapping repository statuses');continue;}await walk(relative);roots.push(relative);rootSet.add(relative);}
    const output=new Map();function emit(relative,status){const node=nodes.get(relative),row={path:relative,status,hash:node.hash};if(node.kind==='directory')row.type='directory';if(node.fingerprint)row.fingerprint=node.fingerprint;if(node.contentHash)row.contentHash=node.contentHash;output.set(relative,row);for(const child of node.children)emit(child,status);}
    await sealCapture();for(const root of roots)emit(root,statuses.get(root));guard();return [...output.values()].sort((a,b)=>a.path.localeCompare(b.path));
  }
  return {collect,metrics:()=>({entries,manifestBytes,fileBytes,elapsedMs:Math.ceil(performance.now()-began)})};
}

async function fileHash(target) {
  const relative=repositoryCapturePath(normalizePath(path.relative(ROOT,target)));
  try{return (await repositoryCaptureCollector().collect([{path:relative,status:'B '}])).find(row=>row.path===relative).hash;}
  catch(error){throw new Error(`Unable to hash repository path ${relative}: ${error.message}`);}
}

function normalizePath(value) {
  const text = String(value);
  return process.platform === 'win32' ? text.replaceAll('\\', '/') : text;
}

function isPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function matchGlob(file, pattern) {
  const normalizedFile = normalizePath(file);
  let source = normalizePath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**/', '__DOUBLE_DIR__')
    .replaceAll('**', '__DOUBLE__')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]')
    .replaceAll('__DOUBLE_DIR__', '(?:.*/)?')
    .replaceAll('__DOUBLE__', '.*');
  return new RegExp(`^${source}$`, 's').test(normalizedFile);
}

async function runCommands(entries, config) {
  const results = [];
  const outputPolicy = contextPolicy(config);
  await mkdir(path.join(HARNESS_DIR, 'logs'), { recursive: true });
  const secrets = secretEnvironmentValues(config.security);
  for (const entry of entries) {
    const text = commandText(entry);
    const started = Date.now();
    let prepared;
    try {
      prepared = await resolveCommandCredentials(entry, config);
    } catch (error) {
      results.push({
        executionId: typeof entry === 'string' ? undefined : entry.executionId,
        executionOrder: typeof entry === 'string' ? undefined : entry.executionOrder,
        command: config.security?.redactOutput ? redact(text, secrets) : text,
        layer: typeof entry === 'string' ? 'unspecified' : entry.layer,
        criterionId: typeof entry === 'string' ? null : (entry.criterionId ?? null),
        credentials: commandCredentials(entry).map((provider) => ({ provider, slot: null })),
        pass: false,
        exitCode: 78,
        timedOut: false,
        durationMs: Date.now() - started,
        stdout: '',
        stderr: error.message,
        output: error.message,
        truncated: false,
        originalBytes: Buffer.byteLength(error.message)
      });
      break;
    }
    const result = await capture(text, Number(config.policies?.commandTimeoutMs || 600000), config.security, prepared.environment, prepared.secrets, outputPolicy);
    results.push({
      executionId: typeof entry === 'string' ? undefined : entry.executionId,
      executionOrder: typeof entry === 'string' ? undefined : entry.executionOrder,
      command: config.security?.redactOutput ? redact(text, secrets) : text,
      layer: typeof entry === 'string' ? 'unspecified' : entry.layer,
      criterionId: typeof entry === 'string' ? null : (entry.criterionId ?? null),
      credentials: prepared.metadata,
      pass: result.exitCode === 0 && result.timedOut === false,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      signal: result.signal,
      terminationConfirmed: result.terminationConfirmed,
      durationMs: Date.now() - started,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.output,
      truncated: result.truncated,
      originalBytes: result.originalBytes
      ,logs: result.logs
    });
    if (result.exitCode !== 0 || result.timedOut) break;
  }
  const continuity = await readContinuity();
  if (continuity.owner) await contextObservation(ROOT, { actor: continuity.owner.id, role: 'worker', config, outputChars: Math.min(outputPolicy.perRunChars, results.reduce((sum, item) => sum + item.output.length, 0)), startedAt: continuity.owner.claimedAt });
  results.displayBudget = outputPolicy.perRunChars;
  results.resultBudget = outputPolicy.perResultChars;
  return { pass: results.length === entries.length && results.every((item) => item.pass), results };
}

async function resolveCommandCredentials(entry, config) {
  const requested = unique(commandCredentials(entry));
  if (requested.length === 0) return { environment: {}, metadata: [], secrets: secretEnvironmentValues(config.security) };
  const providers = credentialProviders(config);
  const state = await readJson(CREDENTIAL_STATE_PATH).catch(() => ({ version: 1, cursors: {} }));
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Credential rotation state must contain an object.');
  if (!state.cursors || typeof state.cursors !== 'object' || Array.isArray(state.cursors)) state.cursors = {};
  const environment = {};
  const metadata = [];
  let changed = false;
  for (const providerName of requested) {
    const provider = providers[providerName];
    if (!validCredentialProvider(provider)) throw new Error(`Credential provider is missing or invalid: ${providerName}.`);
    const available = provider.sources
      .map((source, index) => ({ source, slot: index + 1, value: process.env[source] }))
      .filter((candidate) => typeof candidate.value === 'string' && candidate.value.length > 0);
    if (available.length === 0) throw new Error(`No environment-backed keys are available for credential provider: ${providerName}.`);
    const cursor = Number.isInteger(state.cursors[providerName]) && state.cursors[providerName] >= 0 ? state.cursors[providerName] : 0;
    const selected = provider.selection === 'round_robin' ? available[cursor % available.length] : available[0];
    environment[provider.targetEnvironment] = selected.value;
    metadata.push({ provider: providerName, slot: selected.slot, selection: provider.selection });
    if (provider.selection === 'round_robin') {
      state.cursors[providerName] = cursor + 1;
      changed = true;
    }
  }
  if (changed) await writeJson(CREDENTIAL_STATE_PATH, { version: 1, cursors: state.cursors });
  return {
    environment,
    metadata,
    secrets: secretEnvironmentValues(config.security, Object.values(environment))
  };
}

async function credentialsStatus() {
  const { config } = await load();
  const status = Object.entries(credentialProviders(config)).map(([provider, definition]) => ({
    provider,
    selection: definition.selection,
    configuredSlots: Array.isArray(definition.sources) ? definition.sources.length : 0,
    availableSlots: Array.isArray(definition.sources) ? definition.sources.filter((source) => typeof process.env[source] === 'string' && process.env[source].length > 0).length : 0
  }));
  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (status.length === 0) {
    console.log('No credential providers are configured.');
    return;
  }
  for (const provider of status) console.log(`${provider.provider}: ${provider.availableSlots}/${provider.configuredSlots} slots available (${provider.selection})`);
}

function secretEnvironmentValues(security, additional = []) {
  const sensitiveName = /(?:api.?key|credential|password|private.?key|secret|token)/i;
  const allowlistedValues = (security?.environmentAllow ?? [])
    .filter((key) => sensitiveName.test(key) && typeof process.env[key] === 'string' && process.env[key].length >= 4)
    .map((key) => process.env[key]);
  const providerValues = credentialEnvironmentNames(security)
    .filter((key) => typeof process.env[key] === 'string' && process.env[key].length > 0)
    .map((key) => process.env[key]);
  return allowlistedValues
    .concat(providerValues, additional.filter((value) => typeof value === 'string' && value.length > 0))
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((left, right) => right.length - left.length);
}

// Locate quoted values without treating escaped quotes or embedded whitespace
// as a boundary. An unfinished value extends through the end of the input.
function* quotedSecretSpans(value) {
  const prefix = /(?:(?:"(?:api[_-]?key|credential|password|private[_-]?key|secret|token)"|'(?:api[_-]?key|credential|password|private[_-]?key|secret|token)'|(?:api[_-]?key|credential|password|private[_-]?key|secret|token))(?:\s*[=:]\s*|\s+)|authorization:\s*(?:bearer|basic)\s+)(["'])/gi;
  let match;
  while ((match = prefix.exec(value))) {
    const valueStart = prefix.lastIndex, quote = match[1];
    let end = valueStart, escaped = false, closed = false;
    while (end < value.length) {
      const character = value[end++];
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) { closed = true; break; }
    }
    yield { start: match.index, valueStart, end, quote, escaped, closed };
    prefix.lastIndex = end;
  }
}

function secretValueForms(secrets) {
  return [...new Set(secrets.filter(secret => typeof secret === 'string' && secret.length)
    .flatMap(secret => [secret, JSON.stringify(secret).slice(1, -1)]))];
}

// Every match refers to the original input. Replacing a known value first can
// remove an escaped quote or a secret label and change the remaining grammar.
function redactionSpans(value, forms) {
  const spans = [];
  for (const form of forms) {
    for (let start = value.indexOf(form); start >= 0; start = value.indexOf(form, start + 1)) {
      spans.push({ start, end: start + form.length, boundaryStart: start, marker: '[REDACTED_ENV]', priority: 2 });
    }
  }
  for (const span of quotedSecretSpans(value)) spans.push({
    start: span.valueStart, end: span.end - Number(span.closed), boundaryStart: span.start, marker: '[REDACTED]', priority: 0
  });
  for (const match of value.matchAll(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_\-]{16,}\b/g)) {
    spans.push({ start: match.index, end: match.index + match[0].length, boundaryStart: match.index, marker: '[REDACTED_TOKEN]', priority: 1 });
  }
  for (const pattern of [
    /((?:api[_-]?key|credential|password|private[_-]?key|secret|token)(?:\s*[=:]\s*|\s+))([^\s,;]+)/gi,
    /(authorization:\s*(?:bearer|basic)\s+)([^\s]+)/gi
  ]) for (const match of value.matchAll(pattern)) {
    // Quoted values belong to the quote scanner, including their whitespace.
    if (/^["']/.test(match[2])) continue;
    spans.push({ start: match.index + match[1].length, end: match.index + match[0].length, boundaryStart: match.index, marker: '[REDACTED]', priority: 0 });
  }
  return spans;
}

function redact(value, secrets = []) {
  const raw = String(value), merged = [];
  for (const span of redactionSpans(raw, secretValueForms(secrets)).sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
      if (span.priority > previous.priority) { previous.marker = span.marker; previous.priority = span.priority; }
    } else merged.push({ ...span });
  }
  let output = '', cursor = 0;
  for (const span of merged) {
    output += raw.slice(cursor, span.start) + span.marker;
    cursor = span.end;
  }
  return output + raw.slice(cursor);
}

function platformCommand(commandText) {
  if (process.platform !== 'win32') return commandText;
  return commandText.replace(/^(\s*)(?:"([^"]+)"|'([^']+)'|(\S+))/, (match, leading, doubleQuoted, singleQuoted, bare) => {
    const executable = doubleQuoted ?? singleQuoted ?? bare;
    if (!executable.includes('/') && !executable.includes('\\')) return match;
    const windowsPath = executable.replaceAll('/', '\\');
    if (/^(?:\.\.?\\|[A-Za-z]:\\|\\\\)/.test(windowsPath)) {
      return `${leading}${doubleQuoted !== undefined ? `"${windowsPath}"` : singleQuoted !== undefined ? `'${windowsPath}'` : windowsPath}`;
    }
    const normalized = `.\\${windowsPath}`;
    return `${leading}${doubleQuoted !== undefined ? `"${normalized}"` : singleQuoted !== undefined ? `'${normalized}'` : normalized}`;
  });
}

function captureGit(gitArgs, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn('git', gitArgs, {
      cwd: ROOT,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let capturedBytes = 0;
    let originalBytes = 0;
    let overflow = false;
    let timedOut = false;
    let settled = false;

    const append = (chunks, chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      originalBytes += bytes.length;
      const remaining = Math.max(0, GIT_CAPTURE_MAX_BYTES - capturedBytes);
      if (remaining > 0) {
        const kept = bytes.length > remaining ? bytes.subarray(0, remaining) : bytes;
        chunks.push(kept);
        capturedBytes += kept.length;
      }
      if (bytes.length > remaining && !overflow) {
        overflow = true;
        child.kill();
      }
    };

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);
      const stdout = stdoutBuffer.toString('utf8');
      const stderr = stderrBuffer.toString('utf8');
      resolve({
        exitCode: overflow ? 75 : (timedOut ? 124 : exitCode),
        timedOut,
        overflow,
        maxBytes: GIT_CAPTURE_MAX_BYTES,
        originalBytes,
        stdoutBuffer,
        stderrBuffer,
        stdout,
        stderr,
        output: `${stdout}${stderr}`
      });
    };

    child.stdout.on('data', (chunk) => append(stdoutChunks, chunk));
    child.stderr.on('data', (chunk) => append(stderrChunks, chunk));
    child.on('error', (error) => {
      append(stderrChunks, Buffer.from(error.message));
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
  });
}

async function capture(commandText, timeoutMs, security = null, environment = {}, explicitSecrets = [], outputPolicy = contextPolicy()) {
  // Help and option validation remain usable without execution adapters.
  let windowsCommand = null;
  if (process.platform === 'win32') {
    try { ({ windowsCommand } = await import('./windows-command.mjs')); }
    catch (error) { throw new Error(`Windows command containment adapter initialization failed: ${error.message}`); }
    if (typeof windowsCommand !== 'function') throw new Error('Windows command containment adapter initialization failed: missing controller export.');
  }
  return new Promise((resolve) => {
    const credentialNames = new Set(credentialEnvironmentNames(security).map(environmentNameKey));
    const baseEnvironment = security?.environmentAllow
      ? Object.fromEntries(security.environmentAllow
        .filter((key) => process.env[key] !== undefined && !credentialNames.has(environmentNameKey(key)))
        .map((key) => [key, process.env[key]]))
      : Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !credentialNames.has(environmentNameKey(key))));
    const env = { ...baseEnvironment, ...environment };
    // POSIX commands own a process group; Windows shells start inside a job.
    const containment = process.platform === 'win32' ? windowsCommand(platformCommand(commandText), ROOT, env, timeoutMs) : null;
    const child = containment?.child ?? spawn(platformCommand(commandText), { cwd: ROOT, env, shell: true, windowsHide: true, detached: true });
    let stdout = '';
    let stderr = '';
    let originalBytes = 0;
    let truncated = false;
    let settled = false;
    const secrets = unique([...secretEnvironmentValues(security), ...explicitSecrets]);
    const logId = randomUUID();
    const logs = { stdout: `.harness/logs/${logId}.stdout.log`, stderr: `.harness/logs/${logId}.stderr.log` };
    const files = [logs.stdout, logs.stderr].map(relative => openSync(path.join(ROOT, relative), 'wx', 0o600));
    const streams = files.map(file => redactedCapture(security?.redactOutput, secrets, outputPolicy.perResultChars, value => appendFileSync(file, value)));
    const append = (stream, chunk) => {
      originalBytes += chunk.length;
      stream.append(chunk);
      if (stream.truncated) truncated = true;
    };
    let timedOut = false;
    let termination = Promise.resolve();
    let watchdog;
    const timer = containment ? null : setTimeout(() => {
      timedOut = true;
      termination = terminateCommandTree(child);
      watchdog = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(124); }, 2000);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => append(streams[0], chunk));
    child.stderr.on('data', (chunk) => append(streams[1], chunk));
    const finish = async (exitCode, extra = '', completion = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await termination;
      clearTimeout(watchdog);
      if (extra) append(streams[1], Buffer.from(`\n${extra}`));
      stdout = streams[0].finish();
      stderr = streams[1].finish();
      for (const file of files) closeSync(file);
      truncated ||= streams.some(stream => stream.truncated);
      const combined = stdout + stderr;
      truncated ||= combined.length > outputPolicy.perResultChars;
      const marker = truncated ? '\n[OUTPUT TRUNCATED; see originalBytes metadata]' : '';
      resolve({ exitCode, timedOut, signal: completion.signal ?? null, terminationConfirmed: completion.terminationConfirmed ?? null, stdout, stderr, output: combined.slice(-outputPolicy.perResultChars) + marker, truncated, originalBytes, logs });
    };
    if (containment) containment.done.then(result => { timedOut = result.timedOut; finish(result.exitCode, result.confirmed ? '' : result.error, { terminationConfirmed: result.confirmed }); });
    else {
      child.on('error', (error) => { clearTimeout(timer); finish(1, error.message); });
      child.on('close', (code, signal) => { clearTimeout(timer); finish(timedOut ? 124 : (code ?? 1), '', { signal }); });
    }
  });
}

function terminateCommandTree(child) {
  if (!child.pid) return Promise.resolve();
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  return Promise.resolve();
}

// Keep incomplete credentials in a raw overlap, redact complete spans, then
// truncate sanitized output. If a safe boundary cannot be found within the
// retained bound, omit the remainder of this stream: a later newline may be
// inside a quoted or known multiline secret whose prefix has been discarded.
function redactedCapture(enabled, secrets, maximum = 30000, sink = () => {}) {
  const decoder = new StringDecoder('utf8');
  const secretForms = secretValueForms(secrets);
  const overlap = Math.max(4096, ...secretForms.map(secret => secret.length + 1));
  let pending = '', output = '', suppressed = false, truncated = false;
  const persist = value => {
    const sanitized = enabled ? redact(value, secrets) : value;
    sink(sanitized);
    const next = output + sanitized;
    if (next.length > maximum) truncated = true;
    output = next.slice(-maximum);
  };
  const ingest = value => {
    if (suppressed) return;
    pending += value;
    if (!enabled) { persist(pending); pending = ''; return; }
    const limit = pending.length - overlap;
    if (limit <= 0) return;
    let split = 0;
    for (let index = limit; index > 0; index--) if (/\s/.test(pending[index - 1])) { split = index; break; }
    // Exact values may contain whitespace; never split a value around it.
    const spans = redactionSpans(pending, secretForms).map(span => ({ start: span.boundaryStart, end: span.end }));
    // Retain an incomplete secret label even across arbitrarily long whitespace.
    for (const pattern of [/(?:"(?:api[_-]?key|credential|password|private[_-]?key|secret|token)"|'(?:api[_-]?key|credential|password|private[_-]?key|secret|token)'|(?:api[_-]?key|credential|password|private[_-]?key|secret|token))(?:\s*[=:]\s*|\s+)$/i, /authorization:\s*(?:bearer|basic)\s*$/i]) {
      const match = pending.match(pattern);
      if (match) spans.push({ start: match.index, end: pending.length });
    }
    // Moving a cut left may intersect another, overlapping secret span.
    for (const span of spans.sort((left, right) => right.start - left.start)) if (span.start < split && span.end > split) split = span.start;
    if (split > 0) { persist(pending.slice(0, split)); pending = pending.slice(split); }
    if (pending.length > Math.max(65536, overlap * 2)) {
      persist('\n[OUTPUT OMITTED: unsafe oversized span; remainder of stream suppressed]\n');
      pending = ''; suppressed = true; truncated = true;
    }
  };
  return {
    append(chunk) {
      if (suppressed) return;
      const decoded = decoder.write(chunk);
      if (!enabled) { ingest(decoded); return; }
      // Bound retained raw text even if a caller supplies a very large chunk.
      for (let offset = 0; offset < decoded.length; offset += 16384) ingest(decoded.slice(offset, offset + 16384));
    },
    finish() { ingest(decoder.end()); persist(pending); pending = ''; return output; },
    get truncated() { return truncated; }
  };
}

function printRun(run) {
  let remaining = run.results.displayBudget ?? 16000;
  for (const result of run.results) {
    console.log(`\n$ ${result.command.slice(0, 512)}`);
    const display = result.output.trim();
    const visible = remaining > 0 ? display.slice(-Math.min(remaining, run.results.resultBudget ?? 6000)) : '';
    if (visible) console.log(visible);
    remaining -= visible.length;
    if (display.length > visible.length || result.truncated) console.log(`[output limited; redacted logs: ${result.logs?.stdout ?? 'see evidence'} ${result.logs?.stderr ?? ''}]`);
    console.log(`[exit=${result.exitCode} duration=${result.durationMs}ms${result.timedOut ? ' timeout' : ''}]`);
  }
}

function repeatedText(value, maximumItems = 20) {
  if (value === undefined || value === true) return [];
  const values = Array.isArray(value) ? value : [value];
  const texts = values.map((item) => String(item).trim()).filter(Boolean);
  if (texts.length > maximumItems) throw new Error(`Checkpoint lists must contain at most ${maximumItems} entries.`);
  for (const text of texts) boundedText('checkpoint-entry', text, 1024);
  return texts;
}

function boundedText(name, value, maximumLength) {
  const text = requireText(name, value);
  if (Buffer.byteLength(text) > maximumLength) throw new Error(`--${name} must be at most ${maximumLength} UTF-8 bytes.`);
  return text;
}

function utf8Projection(value, maximumBytes) {
  let result = '', size = 0;
  for (const character of String(value)) {
    const bytes = Buffer.byteLength(character);
    if (size + bytes > maximumBytes) break;
    result += character; size += bytes;
  }
  return result;
}

function inferredNextAction(state, config, selectedId) {
  const active = activeFeatures(state);
  const blocked = state.features.filter((item) => item.status === 'blocked');
  const candidate = nextCandidates(state, config)[0];
  if (active[0]) return `Continue ${active[0].id}: ${active[0].description}`;
  if (candidate) return `Start ${candidate.id}: node .harness/run.mjs start ${candidate.id}`;
  const current = blocked.find(feature => feature.id === selectedId);
  if (current?.blocker) return `Resolve ${current.id}: ${current.blocker}`;
  return 'Add the next bounded feature before changing project code.';
}

function latestEvidence(state) {
  return state.features.flatMap((feature) => feature.evidence ?? []).slice(-10);
}

function checkpointId(prefix, createdAt, value) {
  const stamp = createdAt.replace(/[^0-9]/g, '').slice(0, 17);
  return `${prefix}-${stamp}-${stableHash(value).slice(0, 8)}`;
}

async function buildCheckpoint(kind) {
  const { config, state } = await load();
  const continuity = await readContinuity();
  const selectedId = continuity.owner?.featureId;
  const continuitySecrets = secretEnvironmentValues(config.security);
  const sanitize = (value) => redact(String(value), continuitySecrets);
  const summary = sanitize(boundedText('summary', args.summary, 4000));
  const next = args.next ? sanitize(boundedText('next', args.next, 2000)) : utf8Projection(sanitize(inferredNextAction(state, config, selectedId)), 2000);
  const createdAt = new Date().toISOString();
  const policy = kind === 'checkpoint' ? capturePolicy(config.scope?.capture) : null;
  const git = await repositoryChanges(kind === 'checkpoint' ? { policy, scopeOnly: true } : {});
  const identity = await repositoryIdentity(git);
  const projectFiles = git.files.filter((item) => !CONTINUITY_OWNED_PATHS.some((pattern) => matchGlob(item.path, pattern)));
  const active = activeFeatures(state).map((item) => ({ id: item.id, title: utf8Projection(sanitize(item.title), 200), description: utf8Projection(sanitize(item.description), 2000) }));
  const featureBlockers = state.features
    .filter((item) => item.status === 'blocked' && item.id === selectedId)
    .map((item) => utf8Projection(sanitize(`${item.id}: ${item.blocker}`), 1024));
  const userBlockers = repeatedText(args.blocker).map(sanitize);
  const decisions = repeatedText(args.decision).map(sanitize);
  const evidence = unique([...latestEvidence(state), ...repeatedText(args.evidence)].map(sanitize));
  const seed = { kind, createdAt, summary, next, revision: state.revision, head: identity.head };
  const packet = {
    id: checkpointId(kind, createdAt, seed),
    kind,
    createdAt,
    reason: sanitize(boundedText('reason', args.reason || (args.automatic ? 'context_limit' : 'planned'), 200)),
    agent: args.agent && args.agent !== true ? sanitize(boundedText('agent', args.agent, 200)) : null,
    automatic: args.automatic === true,
    summary,
    next,
    decisions,
    blockers: unique([...featureBlockers, ...userBlockers]).slice(0, 20),
    historicalBlockedCount: state.features.filter(item => item.status === 'blocked').length,
    featureRevision: state.revision,
    activeFeatures: active,
    selectedFeatureId: selectedId ?? null,
    passingFeatureCount: state.features.filter((item) => item.status === 'passing').length,
    evidence,
    configHash: stableHash(config),
    repository: {
      available: git.available && identity.available,
      head: identity.head,
      branch: identity.branch ? sanitize(identity.branch) : identity.branch,
      clean: git.available && projectFiles.length === 0,
      worktreeHash: git.available ? stableHash(projectFiles) : null,
      captureMode: git.captureMode ?? 'content-v1',
      ...(policy ? { capturePolicy: policy } : {}),
      changedFileCount: projectFiles.length,
      changedFiles: projectFiles.slice(0, 100).map((item) => ({ path: sanitize(item.path), status: item.status, hash: item.hash, ...(item.fingerprint ? { fingerprint: item.fingerprint } : {}) }))
    }
  };
  if (Buffer.byteLength(JSON.stringify(packet)) > 24576) throw new Error('Checkpoint exceeds the 24 KiB aggregate UTF-8 budget; narrow entries or changed paths. Previous state is unchanged.');
  const projection = { summary, next, decisions, blockers: packet.blockers, evidence };
  if (Buffer.byteLength(JSON.stringify(projection)) > 12288) throw new Error('Checkpoint projection exceeds the 12 KiB aggregate UTF-8 budget. Previous state is unchanged.');
  serializeBootstrap(config, state, { ...continuity, checkpoint: packet }, selectedId);
  serializeBootstrap(config, state, { ...continuity, checkpoint: packet });
  return packet;
}

function markdownItems(items, empty = 'None recorded.') {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : empty;
}

function renderProgress(checkpoint, phase, generation) {
  const active = checkpoint.activeFeatures.map((item) => `${item.id}: ${item.title}`);
  const files = checkpoint.repository.changedFiles.map((item) => `${item.status.trim() || 'M'} ${item.path}`);
  const omitted = checkpoint.repository.changedFileCount - checkpoint.repository.changedFiles.length;
  if (omitted > 0) files.push(`... ${omitted} more changed project files (see Git status)`);
  const phaseText = phase === 'awaiting_resume'
    ? `Awaiting a fresh worker for handoff \`${checkpoint.id}\``
    : `Working generation ${generation}`;
  return `# Progress\n\nGenerated: ${new Date().toISOString()}\n\nThis is a bounded current-state snapshot. Use Git history, \`.harness/events.jsonl\`, and evidence files for older history.\n\n## Current state\n\n- Continuity: ${phaseText}\n- Feature revision: ${checkpoint.featureRevision}\n- Active features: ${active.length}\n- Passing features: ${checkpoint.passingFeatureCount}\n- Branch: ${checkpoint.repository.branch || '(detached or unavailable)'}\n- Commit: ${checkpoint.repository.head ?? '(unavailable)'}\n- Project worktree: ${checkpoint.repository.available ? checkpoint.repository.clean ? 'clean' : 'dirty (preserved for worker resume)' : 'unavailable'}\n\n## Current summary\n\n${checkpoint.summary}\n\n## Active feature\n\n${markdownItems(active, 'None.')}\n\n## Blockers and risks\n\n${markdownItems(checkpoint.blockers)}\n\n## Decisions to preserve\n\n${markdownItems(checkpoint.decisions)}\n\n## Next executable step\n\n${checkpoint.next}\n\n## Changed project files\n\n${markdownItems(files, checkpoint.repository.clean ? 'None.' : 'Unavailable.')}\n\n## Latest evidence\n\n${markdownItems(checkpoint.evidence, 'None.')}\n`;
}

function freshWorkerPrompt(handoff) {
  const command = `node .harness/run.mjs resume ${handoff.id}`;
  return `Delegate without inherited implementation history: Codex fork_turns="none"; Claude a fresh non-fork Agent. Act as one fresh bounded repository worker for parked handoff ${handoff.id}. Before any edits, run exactly: \`${command}\`. Non-Codex hosts append their own unique --worker-id to resume and EVERY mutation (claim, add, start, block, unblock, check, verify, migrate, checkpoint, handoff); use the native Claude identity delivered only to this child by the reviewed SubagentStart hook, or a fresh unique manual attestation. Never use session_id or another worker's ID. Then run node .harness/run.mjs bootstrap --validate --json for bounded active feature and checkpoint projections; read AGENTS.md, .harness/config.json and task-relevant routes in .harness/docs-map.md. Never dump .harness/features.json or baseline blobs into context. Complete only the active bounded work and return concisely to the persistent development orchestrator.`;
}

function renderWorkingHandoff(continuity, consumedHandoff = null) {
  const status = consumedHandoff ? 'CONSUMED_HANDOFF' : 'NO_PENDING_HANDOFF';
  const consumed = consumedHandoff
    ? `\n- Consumed handoff ID: \`${consumedHandoff.id}\`\n- Consumed at: ${consumedHandoff.resumedAt}`
    : '';
  const checkpoint = continuity.checkpoint?.id
    ? `\n- Latest checkpoint: \`${continuity.checkpoint.id}\``
    : '';
  return `# Worker Handoff\n\nGenerated: ${new Date().toISOString()}\n\n- Status: **${status}**\n- Continuity: working generation ${continuity.generation}${consumed}${checkpoint}\n\nNo worker handoff is pending. The persistent development orchestrator may continue in the current user chat.\n`;
}

function renderHandoff(handoff, generation) {
  const active = handoff.activeFeatures.map((item) => `${item.id}: ${item.title}`);
  const files = handoff.repository.changedFiles.map((item) => `${item.status.trim() || 'M'} ${item.path}`);
  const omitted = handoff.repository.changedFileCount - handoff.repository.changedFiles.length;
  if (omitted > 0) files.push(`... ${omitted} more changed project files (see Git status)`);
  const prompt = freshWorkerPrompt(handoff);
  const codexLink = `codex://new?path=${encodeURIComponent(ROOT)}&prompt=${encodeURIComponent(prompt)}`;
  const orchestratorAction = handoff.reason === 'needs_input'
    ? 'Wait for the required user input here, then delegate one fresh worker/subagent.'
    : 'Delegate one fresh worker/subagent now.';
  return `# Worker Handoff\n\nGenerated: ${handoff.createdAt}\n\n- Handoff ID: \`${handoff.id}\`\n- From generation: ${generation}\n- Status: **FRESH_WORKER_REQUIRED**\n- Action: \`${handoff.reason === 'needs_input' ? 'await_user' : 'delegate_worker'}\`\n- Resume command: \`node .harness/run.mjs resume ${handoff.id}\`\n\n## Orchestrator and worker boundary\n\nThe persistent development orchestrator stays in the current user chat. ${orchestratorAction} Give that worker the bootstrap prompt below. The handing-off worker yields and must not consume its own handoff.\n\nOnly when worker delegation is unavailable, use the fallback: [open a fresh Codex task](${codexLink}), start a new Claude Code session, or start a new GitHub Copilot chat/task in this same worktree.\n\n\`\`\`text\n${prompt}\n\`\`\`\n\n## Summary\n\n${handoff.summary}\n\n## Active feature\n\n${markdownItems(active, 'None.')}\n\n## Repository checkpoint\n\n- Commit: ${handoff.repository.head ?? '(unavailable)'}\n- Branch: ${handoff.repository.branch || '(detached or unavailable)'}\n- Feature revision: ${handoff.featureRevision}\n- Project worktree: ${handoff.repository.available ? handoff.repository.clean ? 'clean' : 'dirty; exact paths and hashes are recorded' : 'unavailable'}\n\nDirty or unavailable repository state is recorded as a handoff risk; it never prevents continuity from being persisted.\n\n## Changed project files\n\n${markdownItems(files, handoff.repository.clean ? 'None.' : 'Unavailable.')}\n\n## Blockers and risks\n\n${markdownItems(handoff.blockers)}\n\n## Decisions to preserve\n\n${markdownItems(handoff.decisions)}\n\n## Latest evidence\n\n${markdownItems(handoff.evidence, 'None.')}\n\n## Next action\n\n${handoff.next}\n`;
}

async function archiveProgress(handoffId) {
  if (!await exists(PROGRESS_PATH)) return;
  const current = await readFile(PROGRESS_PATH, 'utf8');
  if (!current.trim()) return;
  await mkdir(CONTINUITY_HISTORY_DIR, { recursive: true });
  const target = path.join(CONTINUITY_HISTORY_DIR, `${safeName(handoffId)}.md`);
  if (!await exists(target)) await atomicWrite(target, current);
}

async function writeCheckpoint() {
  const continuity = await readContinuity();
  const checkpoint = await buildCheckpoint('checkpoint');
  const releasing = ['worker_yield', 'needs_input'].includes(checkpoint.reason);
  const updated = { ...continuity, checkpoint, ...(releasing ? { owner: null, retiredWorkerIds: unique([...(continuity.retiredWorkerIds ?? []), assertOwner(continuity).id]) } : {}) };
  await atomicWrite(PROGRESS_PATH, renderProgress(checkpoint, 'working', continuity.generation));
  await atomicWrite(HANDOFF_PATH, renderWorkingHandoff(updated));
  await writeJson(CONTINUITY_PATH, updated);
  await appendEvent('checkpoint.written', {
    checkpointId: checkpoint.id,
    summary: checkpoint.summary,
    next: checkpoint.next,
    revision: checkpoint.featureRevision,
    generation: continuity.generation
  });
  if (args.json) console.log(JSON.stringify(checkpoint, null, 2));
  else console.log(`CHECKPOINT_WRITTEN ${checkpoint.id}`);
}

async function writeHandoff() {
  const continuity = await readContinuity();
  if (continuity.phase === 'awaiting_resume') {
    assertOwner(continuity);
    await atomicWrite(PROGRESS_PATH, renderProgress(continuity.handoff, 'awaiting_resume', continuity.generation));
    await atomicWrite(HANDOFF_PATH, renderHandoff(continuity.handoff, continuity.generation));
    if (args.json) console.log(JSON.stringify(continuity.handoff, null, 2));
    else printAwaitingResume(continuity);
    return;
  }
  const actor = assertOwner(continuity);
  const handoff = { ...await buildCheckpoint('handoff'), owner: continuity.owner };
  await archiveProgress(handoff.id);
  const updated = { ...continuity, phase: 'awaiting_resume', checkpoint: handoff, handoff };
  await writeJson(CONTINUITY_PATH, updated);
  await atomicWrite(PROGRESS_PATH, renderProgress(handoff, 'awaiting_resume', continuity.generation));
  await atomicWrite(HANDOFF_PATH, renderHandoff(handoff, continuity.generation));
  await appendEvent('handoff.ready', {
    handoffId: handoff.id,
    summary: handoff.summary,
    next: handoff.next,
    head: handoff.repository.head,
    clean: handoff.repository.clean,
    revision: handoff.featureRevision,
    generation: continuity.generation
  });
  if (args.json) console.log(JSON.stringify(handoff, null, 2));
  else {
    console.log(`HANDOFF_READY ${handoff.id}`);
    if (!handoff.repository.clean) console.log('WARN  Project worktree is not clean; its exact state was recorded and continuity remains valid.');
    printAwaitingResume(updated);
    console.log(`Worker prompt: ${freshWorkerPrompt(handoff)}`);
    console.log('YIELD_CURRENT_WORKER');
  }
}

async function currentRepositoryCheckpoint() {
  const git = await repositoryChanges();
  const identity = await repositoryIdentity(git);
  const projectFiles = git.files.filter((item) => !CONTINUITY_OWNED_PATHS.some((pattern) => matchGlob(item.path, pattern)));
  return {
    available: git.available && identity.available,
    head: identity.head,
    branch: identity.branch,
    worktreeHash: git.available ? stableHash(projectFiles) : null
  };
}

async function resumeHandoff() {
  const continuity = await readContinuity();
  const id = boundedText('handoff-id', args._[1] || args.id, 200);
  if (continuity.phase === 'working') {
    if (continuity.lastHandoff?.id === id) {
      assertOwner(continuity);
      if (continuity.checkpoint?.id === id) {
        await atomicWrite(PROGRESS_PATH, renderProgress(continuity.lastHandoff, 'working', continuity.generation));
        await atomicWrite(HANDOFF_PATH, renderWorkingHandoff(continuity, continuity.lastHandoff));
      }
      if (args.json) console.log(JSON.stringify(continuityView(continuity), null, 2));
      else console.log(`ALREADY_RESUMED ${id}; generation ${continuity.generation}`);
      return;
    }
    throw new Error(`No handoff is awaiting resume. Current continuity phase is ${continuity.phase}.`);
  }
  const handoff = continuity.handoff;
  if (handoff.id !== id) throw new Error(`Handoff ID mismatch. Pending handoff is ${handoff.id}.`);
  const actor = workerIdentity();
  if (actor.id === (handoff.owner?.id ?? continuity.owner?.id) || retired(continuity, actor.id)) throw new Error('Handing-off or retired worker cannot resume its own transfer; delegate with fork_turns="none".');
  const { config, state } = await load();
  const repository = await currentRepositoryCheckpoint();
  const drift = [];
  if (handoff.featureRevision !== state.revision) drift.push(`feature revision ${handoff.featureRevision} -> ${state.revision}`);
  if (handoff.configHash !== stableHash(config)) drift.push('configuration changed');
  if (handoff.repository.available && repository.available) {
    if (handoff.repository.head !== repository.head) drift.push(`commit ${handoff.repository.head} -> ${repository.head}`);
    if (handoff.repository.branch !== repository.branch) drift.push(`branch ${handoff.repository.branch || '(detached)'} -> ${repository.branch || '(detached)'}`);
    if (handoff.repository.worktreeHash !== repository.worktreeHash) drift.push('project worktree changed');
  } else if (handoff.repository.available !== repository.available) drift.push('repository availability changed');
  if (drift.length && args.acceptDrift !== true) {
    throw new Error(`Repository drifted after handoff: ${drift.join('; ')}. Review it, then rerun with --accept-drift if intentional.`);
  }
  const resumedAt = new Date().toISOString();
  const generation = continuity.generation + 1;
  const lastHandoff = { ...handoff, resumedAt, driftAccepted: drift.length > 0, drift };
  const updated = {
    ...continuity,
    phase: 'working',
    generation,
    resumedAt,
    checkpoint: handoff,
    handoff: null,
    lastHandoff,
    owner: { ...actor, generation, claimedAt: resumedAt, featureId: handoff.owner?.featureId ?? handoff.selectedFeatureId ?? handoff.activeFeatures?.[0]?.id ?? null },
    retiredWorkerIds: unique([...(continuity.retiredWorkerIds ?? []), handoff.owner?.id ?? continuity.owner?.id].filter(Boolean))
  };
  await writeJson(CONTINUITY_PATH, updated);
  await atomicWrite(PROGRESS_PATH, renderProgress(handoff, 'working', generation));
  await atomicWrite(HANDOFF_PATH, renderWorkingHandoff(updated, lastHandoff));
  await appendEvent('worker.resumed', { handoffId: id, generation, drift, driftAccepted: drift.length > 0 });
  if (args.json) {
    console.log(JSON.stringify({ continuity: continuityView(updated), summary: handoff.summary, next: handoff.next, drift }, null, 2));
    return;
  }
  console.log(`WORKER_RESUMED ${id}; generation ${generation}`);
  if (drift.length) console.log(`WARN  Accepted drift: ${drift.join('; ')}`);
  console.log(`Summary: ${handoff.summary}`);
  console.log(`Next: ${handoff.next}`);
  console.log('Fresh worker: now run node .harness/run.mjs doctor, status, and next before changing files.');
}

async function traceFeature() {
  const id = requireText('id', args._[1] || args.id);
  const journal = path.join(HARNESS_DIR, 'events.jsonl');
  if (!await exists(journal)) throw new Error('Event journal is missing.');
  const events = (await readFile(journal, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.featureId === id);
  if (events.length === 0) throw new Error(`No trace events for ${id}.`);
  for (const event of events) console.log(JSON.stringify(event));
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-');
}

function printHelp(specificCommand = null) {
  if (Object.hasOwn(COMMAND_USAGE, specificCommand)) {
    console.log(`Project harness runtime

Usage:
  ${COMMAND_USAGE[specificCommand]}

Use -h or --help in any argument position to show this text without reading project state.
Non-Codex workers use a unique --worker-id ID on every mutation, including claim,
resume and checkpoint. Codex uses per-worker CODEX_THREAD_ID. Never use a shared
session identity or another worker's ID. Delegate without implementation history:
Codex fork_turns="none"; Claude fresh non-fork Agent.`);
    return;
  }
  console.log(`Project harness runtime

Usage:
  node .harness/run.mjs session [--json]
  node .harness/run.mjs context [--observe] [--tool-calls N] [--output-chars N] [--transcript PATH] [--json]
  node .harness/run.mjs claim [--worker-id ID]
  node .harness/run.mjs bootstrap [ID] [--validate] [--integrity] [--json]
  node .harness/run.mjs migrate [--worker-id ID]
  node .harness/run.mjs recover --expected-owner ID --reason TEXT --confirmed-terminated [--worker-id ID]
  node .harness/run.mjs resume HANDOFF_ID [--accept-drift] [--json]
  node .harness/run.mjs doctor
  node .harness/run.mjs status
  node .harness/run.mjs next [--json]
  node .harness/run.mjs add ID --title TEXT --description TEXT --criterion TEXT --command CMD --allow GLOB [--depends ID,ID] [--level e2e]
  node .harness/run.mjs start ID
  node .harness/run.mjs block ID --reason TEXT
  node .harness/run.mjs unblock ID
  node .harness/run.mjs check [quick|full|e2e|architecture|clean]
  node .harness/run.mjs credentials [--json]
  node .harness/run.mjs verify [ID]
  node .harness/run.mjs trace ID
  node .harness/run.mjs checkpoint --summary TEXT [--next TEXT] [--reason planned|worker_yield|needs_input] [--decision TEXT] [--blocker TEXT] [--evidence PATH]
  node .harness/run.mjs handoff --summary TEXT [--next TEXT] [--reason TEXT] [--agent NAME] [--json]

Command entries may request configured credential pools with a credentials array.
Workers on other hosts append their own unique --worker-id ID to every mutation,
including claim, resume, migrate, verify, checkpoint and handoff. Codex identity is
CODEX_THREAD_ID. Recovery is explicit: recover --expected-owner ID --reason TEXT
--confirmed-terminated requires host/operator confirmation that the worker stopped;
it preserves state, retires that worker and releases ownership for a fresh claim.
The add command accepts --credential PROVIDER for acceptance commands. Keys are
selected from environment variables, rotated without persisting values, and are
never retried automatically after command execution.

Orchestrated-Worker Protocol (${ORCHESTRATED_WORKER_PROTOCOL}):
Use checkpoint for routine milestones, completed work, and requests for user
input; it keeps the persistent development orchestrator in the current chat.
Handoff is a parked transfer between workers. It records dirty work safely,
parks feature mutations, and prints the exact resume command and prompt for one
fresh bounded worker/subagent. The handing-off worker yields. Opening a fresh
chat/task is only the fallback when worker delegation is unavailable.

Only successful verify runs can transition an active feature to passing.`);
}
