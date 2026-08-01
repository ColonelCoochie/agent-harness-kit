#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const HARNESS_RUNTIME_VERSION = 5;
const STATE_SCHEMA_VERSION = 1;
const CONTINUITY_SCHEMA_VERSION = 1;
const STATES = new Set(['not_started', 'active', 'blocked', 'passing']);
const CONTINUITY_PHASES = new Set(['working', 'awaiting_resume']);
const RUNTIME_OWNED_PATHS = [
  '.harness/features.json',
  '.harness/events.jsonl',
  '.harness/evidence/**',
  '.harness/credentials-state.json',
  '.harness/continuity.json',
  '.harness/progress.md',
  '.harness/handoff.md',
  '.harness/history/progress/**',
  '.harness/state.lock/**'
];
const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? (args.help ? 'help' : null);
const AGENT_INSTRUCTIONS = {
  codex: 'AGENTS.md',
  claude: 'CLAUDE.md',
  'github-copilot': '.github/copilot-instructions.md'
};
const DEVELOPMENT_HARNESS_BOUNDARY = '## Development-Harness Boundary';

try {
  if (!command || command === 'help') printHelp();
  else if (command === 'session') await continuityStatus();
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
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
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
  const acquire = async (allowRecovery) => {
    const token = randomUUID();
    try {
      await mkdir(lockDir);
      try {
        await writeJson(path.join(lockDir, 'owner.json'), {
          pid: process.pid,
          token,
          command: process.argv.slice(2),
          acquiredAt: new Date().toISOString()
        });
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      return token;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await stat(lockDir).then((item) => Date.now() - item.mtimeMs).catch(() => 0);
      const owner = await readJson(path.join(lockDir, 'owner.json')).catch(() => null);
      const ownerIsKnown = Number.isInteger(owner?.pid) && owner.pid > 0;
      const ownerIsGone = ownerIsKnown && !isProcessAlive(owner.pid);
      const ownerIsUnknownAndStale = !ownerIsKnown && age > 300000;
      if (allowRecovery && (ownerIsGone || ownerIsUnknownAndStale)) {
        await rm(lockDir, { recursive: true, force: true });
        return acquire(false);
      }
      const ownerText = ownerIsKnown ? ` pid=${owner.pid}` : '';
      throw new Error(`Harness state is locked by another operation (${Math.round(age / 1000)}s old${ownerText}).`);
    }
  };
  const token = await acquire(true);
  try {
    return await operation();
  } finally {
    await releaseStateLock(lockDir, token);
  }
}

async function releaseStateLock(lockDir, token) {
  const ownerPath = path.join(lockDir, 'owner.json');
  const owner = await readJson(ownerPath).catch(() => null);
  if (owner?.token !== token) return;
  await rm(ownerPath, { force: true });
  try {
    await rmdir(lockDir);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
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

function continuityView(continuity) {
  return {
    phase: continuity.phase,
    generation: continuity.generation,
    handoffId: continuity.handoff?.id ?? null,
    resumeCommand: resumeCommand(continuity),
    checkpoint: continuity.checkpoint ?? null,
    lastHandoff: continuity.lastHandoff ?? null
  };
}

function printAwaitingResume(continuity) {
  console.log(`FRESH_TASK_REQUIRED ${continuity.handoff.id}`);
  console.log(`Start a new chat/task in this same worktree, then run: ${resumeCommand(continuity)}`);
  console.log('Do not continue implementation, resume this transcript, or use context compaction as a substitute.');
}

async function continuityStatus() {
  const continuity = await readContinuity();
  if (args.json) {
    console.log(JSON.stringify(continuityView(continuity), null, 2));
    return;
  }
  console.log(`Continuity: ${continuity.phase}; generation ${continuity.generation}`);
  if (continuity.phase === 'awaiting_resume') printAwaitingResume(continuity);
  else if (continuity.checkpoint) console.log(`Latest checkpoint: ${continuity.checkpoint.id} (${continuity.checkpoint.createdAt})`);
  else console.log('No runtime checkpoint has been written yet.');
}

async function whileWorking(operation) {
  const continuity = await readContinuity();
  if (continuity.phase !== 'working') {
    throw new Error(`Repository is parked at handoff ${continuity.handoff.id}. End this chat and resume from a fresh task with: ${resumeCommand(continuity)}`);
  }
  return operation();
}

function list(value) {
  if (value === undefined || value === true) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
}

function repeatedValues(value) {
  if (value === undefined || value === true) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item).trim()).filter(Boolean);
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

function validCommandEntry(entry) {
  return typeof commandText(entry) === 'string'
    && commandText(entry).trim().length > 0
    && (typeof entry === 'string' || entry.credentials === undefined || Array.isArray(entry.credentials))
    && commandCredentials(entry).every((provider) => typeof provider === 'string' && provider.trim().length > 0);
}

function instructionRoutes(agent, content) {
  if (!content.includes(DEVELOPMENT_HARNESS_BOUNDARY)) return false;
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
    requiredLayers: feature.requiredLayers ?? ['full']
  };
}

function verificationPlanShape(config, feature, layers, entries) {
  return {
    layers,
    commands: entries.map((entry) => ({
      command: entry.command,
      layer: entry.layer,
      criterionId: entry.criterionId,
      credentials: commandCredentials(entry)
    })),
    scope: {
      enforcement: config.scope?.enforcement,
      allow: feature.scope?.allow ?? [],
      deny: feature.scope?.deny ?? []
    },
    execution: {
      commandTimeoutMs: config.policies?.commandTimeoutMs
    },
    evidence: {
      redactOutput: config.security?.redactOutput,
      environmentAllow: config.security?.environmentAllow ?? []
    }
  };
}

async function validatePassingEvidence(feature, config) {
  const errors = [];
  const warnings = [];
  const reference = feature.evidence?.at(-1);
  if (!reference) return { errors: [`${feature.id}: passing without evidence`], warnings };
  const target = path.resolve(ROOT, reference);
  if (!isPathInside(EVIDENCE_DIR, target)) {
    return { errors: [`${feature.id}: evidence path escapes .harness/evidence`], warnings };
  }
  const record = await readJson(target).catch(() => null);
  if (!record) return { errors: [`${feature.id}: evidence is missing or invalid`], warnings };
  if (record.featureId !== feature.id) errors.push(`${feature.id}: evidence belongs to ${record.featureId}`);
  if (record.pass !== true) errors.push(`${feature.id}: latest evidence did not pass`);
  if (!Array.isArray(record.commands) || record.commands.length === 0 || record.commands.some((item) => item.exitCode !== 0)) {
    errors.push(`${feature.id}: evidence lacks successful commands`);
  }
  const evidenceSchema = Number(record.schemaVersion ?? 1);
  if (evidenceSchema >= 2) {
    if (!record.contractHash || record.contractHash !== stableHash(contractShape(feature))) errors.push(`${feature.id}: contract and evidence do not match`);
    if (!record.configHash) errors.push(`${feature.id}: evidence lacks config provenance`);
    if (Number(record.harnessVersion ?? 1) >= 2 && !record.verificationHash) errors.push(`${feature.id}: evidence lacks verification-plan provenance`);
  } else {
    warnings.push(`${feature.id}: legacy evidence predates frozen-contract and config provenance`);
  }
  return { errors, warnings };
}

async function doctor() {
  const { config, state } = await load();
  const continuity = await readContinuity();
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const featureIds = new Set(state.features.map((item) => item.id));

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
  if (config.continuity?.mode !== 'fresh_task') errors.push('continuity.mode must be fresh_task.');
  if (config.continuity?.dirtyWorktree !== 'record') errors.push('continuity.dirtyWorktree must be record so unfinished work can always be handed off.');
  if (config.continuity?.blockMutationsAfterHandoff !== true) errors.push('continuity.blockMutationsAfterHandoff must be true.');
  if (!Array.isArray(config.security?.environmentAllow)) errors.push('security.environmentAllow must be an array.');
  const providers = credentialProviders(config);
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
  if (config.scope?.enforcement === 'required' && !(await repositoryChanges()).available) errors.push('Git-backed scope enforcement is required but repository state is unavailable.');
  if (activeFeatures(state).length > Number(config.policies?.wipLimit ?? 1)) errors.push('Active features exceed the WIP limit.');
  if (continuity.phase === 'awaiting_resume' && continuity.handoff?.featureRevision !== state.revision) {
    errors.push(`Pending handoff ${continuity.handoff?.id ?? '(missing)'} captured feature revision ${continuity.handoff?.featureRevision ?? '(missing)'}, but current state is revision ${state.revision}.`);
  } else if (continuity.phase === 'working' && continuity.checkpoint && continuity.checkpoint.featureRevision !== state.revision) {
    warnings.push(`Progress checkpoint ${continuity.checkpoint.id} is older than feature revision ${state.revision}; write a checkpoint before ending the session.`);
  }
  if (!await exists(PROGRESS_PATH)) errors.push('Progress snapshot is missing.');
  if (!await exists(HANDOFF_PATH)) errors.push('Handoff projection is missing.');

  for (const feature of state.features) {
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
    if (!hooksText.includes('.harness/hooks/precompact-handoff.mjs') || !hooksText.includes('PreCompact')) {
      warnings.push('Codex automatic compaction guard is not merged; review .harness/codex-hooks.addition.json or rerun sync.');
    }
  }

  console.log(`Harness doctor: ${ROOT} (runtime v${HARNESS_RUNTIME_VERSION}, schema v${STATE_SCHEMA_VERSION})`);
  console.log(`Features: ${state.features.length}; active: ${activeFeatures(state).length}; passing: ${state.features.filter((item) => item.status === 'passing').length}`);
  console.log(`Continuity: ${continuity.phase}; generation: ${continuity.generation}`);
  for (const warning of warnings) console.log(`WARN  ${warning}`);
  for (const error of errors) console.log(`FAIL  ${error}`);
  if (errors.length === 0) console.log('PASS  Structural state is healthy.');
  if (continuity.phase === 'awaiting_resume') printAwaitingResume(continuity);
  if (errors.length > 0) process.exitCode = 1;
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
  for (const feature of state.features) {
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
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (continuity.phase === 'awaiting_resume') {
    printAwaitingResume(continuity);
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
  if (blocked.length) console.log(`No startable feature. Review blocked work: ${blocked.map((item) => item.id).join(', ')}`);
  else console.log('No startable feature. Add the next bounded behavior.');
}

async function addFeature() {
  const { config, state } = await load();
  const id = requireText('id', args._[1] || args.id);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error('Feature ID may contain letters, numbers, dots, underscores, and hyphens.');
  if (state.features.some((item) => item.id === id)) throw new Error(`Feature already exists: ${id}`);
  const title = requireText('title', args.title);
  const description = requireText('description', args.description);
  const criteria = repeatedValues(args.criterion);
  const acceptanceCommands = repeatedValues(args.acceptCommand || args.command);
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
  const allowed = repeatedValues(args.allow);
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
  const denied = repeatedValues(args.deny);
  state.features.push({
    id,
    title,
    description,
    dependencies,
    status: 'not_started',
    requiredLayers,
    scope: {
      allow: args.allowAll === true ? ['**/*'] : allowed,
      deny: denied.length ? denied : config.scope.defaultDeny
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
  const [scopeBaseline, startHead] = await Promise.all([repositoryChanges(), repositoryHead()]);
  feature.scopeBaseline = { ...scopeBaseline, head: startHead };
  if (config.scope?.enforcement === 'required' && (!feature.scopeBaseline.available || !feature.scopeBaseline.head)) {
    throw new Error('Git-backed scope enforcement is required, but repository state is unavailable or has no starting commit. Initialize Git and retry.');
  }
  feature.contract = {
    hash: stableHash(contractShape(feature)),
    snapshot: contractShape(feature),
    frozenAt: new Date().toISOString()
  };
  feature.status = 'active';
  feature.updatedAt = new Date().toISOString();
  state.revision = Number(state.revision ?? 0) + 1;
  await writeJson(FEATURES_PATH, state);
  await appendEvent('feature.started', { featureId: feature.id, contractHash: feature.contract.hash, revision: state.revision });
  console.log(`Started ${feature.id}: ${feature.title}`);
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
  await appendEvent('feature.unblocked', { featureId: feature.id, revision: state.revision });
  console.log(`Unblocked ${feature.id}.`);
}

async function checkLevel() {
  const { config } = await load();
  const level = String(args._[1] || args.level || 'quick');
  const commands = config.verification?.[level];
  if (!Array.isArray(commands) || commands.length === 0) throw new Error(`No commands configured for verification.${level}.`);
  const result = await runCommands(commands.map((command) => ({ command, layer: level })), config);
  printRun(result);
  if (!result.pass) process.exitCode = 1;
}

async function verifyFeature() {
  const { config, state } = await load();
  const requested = args._[1] || args.id;
  const feature = requested ? byId(state, requested) : activeFeatures(state)[0];
  if (!feature) throw new Error('No active feature. Provide a feature ID.');
  if (feature.status !== 'active') throw new Error(`${feature.id} is ${feature.status}; only active features can verify.`);
  if (Number(feature.attempts ?? 0) >= Number(config.policies?.maxAttempts ?? 3)) {
    throw new Error(`${feature.id} exhausted its verification budget; block, inspect the trace, and revise the plan.`);
  }
  const currentContractHash = stableHash(contractShape(feature));
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

  const startedAt = new Date().toISOString();
  const before = await repositoryIdentity();
  const preScope = await evaluateScope(feature, config);
  let run = preScope.violations.length
    ? {
        pass: false,
        results: [{
          command: '[scope] changed files must satisfy feature allow/deny rules',
          layer: 'scope',
          exitCode: 1,
          timedOut: false,
          durationMs: 0,
          output: `Out-of-scope changes:\n${preScope.violations.map((item) => `- ${item}`).join('\n')}`
        }]
      }
    : await runCommands(entries, config);
  const postScope = await evaluateScope(feature, config);
  if (postScope.violations.length) {
    run = {
      pass: false,
      results: [...run.results, {
        command: '[scope] post-verification scope check',
        layer: 'scope',
        exitCode: 1,
        timedOut: false,
        durationMs: 0,
        output: `Out-of-scope changes:\n${postScope.violations.map((item) => `- ${item}`).join('\n')}`
      }]
    };
  }
  const after = await repositoryIdentity();
  const slug = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const relativeEvidence = `.harness/evidence/${slug}-${safeName(feature.id)}.json`;
  const evidence = {
    harnessVersion: HARNESS_RUNTIME_VERSION,
    featureId: feature.id,
    schemaVersion: 3,
    requiredLayers: layers,
    executedLayers: unique(run.results.map((item) => item.layer)),
    contractHash: currentContractHash,
    configHash: stableHash(config),
    verificationHash: stableHash(verificationPlanShape(config, feature, layers, entries)),
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
    if (feature.attempts >= Number(config.policies?.maxAttempts ?? 3) || feature.repeatedFailures >= Number(config.policies?.maxRepeatedFailures ?? 2)) {
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
  const current = await repositoryChanges();
  if (!current.available) {
    const violations = config.scope?.enforcement === 'required' ? ['[scope-unavailable] Git repository state could not be read'] : [];
    return { changed: [], violations, output: current.output };
  }
  const history = await committedChangesSince(feature.scopeBaseline?.head);
  const baseline = new Map((feature.scopeBaseline?.files ?? []).map((item) => [item.path, item.hash]));
  const currentByPath = new Map(current.files.map((item) => [item.path, item]));
  const historyPaths = new Set(history.files.map((item) => item.path));
  const changedByPath = new Map();
  for (const item of history.files) {
    const unchangedDirtyBaselineWasCommitted = baseline.has(item.path)
      && !currentByPath.has(item.path)
      && baseline.get(item.path) === item.hash;
    if (!unchangedDirtyBaselineWasCommitted) changedByPath.set(item.path, item);
  }
  for (const item of current.files) {
    if (baseline.get(item.path) !== item.hash) changedByPath.set(item.path, item);
    else if (!historyPaths.has(item.path)) changedByPath.delete(item.path);
  }
  const changed = [...changedByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  const scopedChanges = changed.filter((item) => !RUNTIME_OWNED_PATHS.some((pattern) => matchGlob(item.path, pattern)));
  const allow = feature.scope?.allow ?? ['**/*'];
  const deny = feature.scope?.deny ?? [];
  const violations = (history.available || config.scope?.enforcement !== 'required'
    ? []
    : [`[scope-history-unavailable] ${history.output || 'Committed repository history could not be compared with the feature start.'}`])
    .concat(scopedChanges
    .map((item) => item.path)
    .filter((file) => deny.some((pattern) => matchGlob(file, pattern)) || !allow.some((pattern) => matchGlob(file, pattern))));
  return {
    changed: scopedChanges,
    violations,
    output: [history.output, current.output].filter(Boolean).join('\n')
  };
}

async function repositoryHead() {
  const result = await capture('git rev-parse HEAD', 30000);
  const head = result.exitCode === 0 ? result.stdout.trim() : '';
  return /^[0-9a-f]{40,64}$/i.test(head) ? head : null;
}

async function committedChangesSince(startHead) {
  if (!startHead) return { available: true, files: [], output: '' };
  if (!/^[0-9a-f]{40,64}$/i.test(startHead)) {
    return { available: false, files: [], output: 'The recorded start HEAD is invalid.' };
  }
  const ancestor = await capture(`git merge-base --is-ancestor ${startHead} HEAD`, 30000);
  if (ancestor.exitCode !== 0) {
    return { available: false, files: [], output: 'The current HEAD is not descended from the feature start HEAD.' };
  }
  const result = await capture(`git diff --name-status -z --find-renames ${startHead} HEAD`, 30000);
  if (result.exitCode !== 0) return { available: false, files: [], output: result.output.trim() };
  const records = parseNameStatus(result.stdout);
  const files = [];
  for (const record of records) {
    if (record.fromPath) {
      files.push({
        path: record.fromPath,
        status: 'D ',
        hash: await fileHash(path.join(ROOT, record.fromPath))
      });
    }
    files.push({
      path: record.path,
      status: record.status,
      hash: await fileHash(path.join(ROOT, record.path))
    });
  }
  const uniqueFiles = new Map(files.map((item) => [item.path, item]));
  return {
    available: true,
    files: [...uniqueFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
    output: records.map((record) => `${record.status.trim()} ${record.fromPath ? `${record.fromPath} -> ` : ''}${record.path}`).join('\n')
  };
}

function parseNameStatus(stdout) {
  const fields = String(stdout).split('\0');
  const records = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) continue;
    if (/^R\d*$/.test(status)) {
      const fromPath = normalizePath(fields[index++] ?? '');
      const file = normalizePath(fields[index++] ?? '');
      if (fromPath && file) records.push({ status: 'R ', path: file, fromPath });
      continue;
    }
    if (/^C\d*$/.test(status)) {
      index += 1;
      const file = normalizePath(fields[index++] ?? '');
      if (file) records.push({ status: 'C ', path: file, fromPath: null });
      continue;
    }
    const file = normalizePath(fields[index++] ?? '');
    if (file) records.push({ status: `${status.slice(0, 1)} `, path: file, fromPath: null });
  }
  return records;
}

async function repositoryIdentity() {
  const [head, branch, status] = await Promise.all([
    capture('git rev-parse HEAD', 30000),
    capture('git branch --show-current', 30000),
    repositoryChanges()
  ]);
  return {
    available: status.available && head.exitCode === 0,
    head: head.exitCode === 0 ? head.output.trim() : null,
    branch: branch.exitCode === 0 ? branch.output.trim() : null,
    statusHash: stableHash(status.files ?? []),
    status: status.output.trim()
  };
}

async function repositoryChanges() {
  const result = await capture('git status --porcelain=v1 -z --untracked-files=all', 30000);
  if (result.exitCode !== 0) return { available: false, files: [], output: result.output };
  const records = parsePorcelainStatus(result.stdout)
    .filter((record) => !isTransientHarnessPath(record.path) && !isTransientHarnessPath(record.fromPath));
  const fileRecords = new Map();
  for (const record of records) {
    if (record.fromPath) {
      fileRecords.set(record.fromPath, {
        path: record.fromPath,
        status: 'D ',
        hash: await fileHash(path.join(ROOT, record.fromPath))
      });
    }
    fileRecords.set(record.path, {
      path: record.path,
      status: record.status,
      hash: await fileHash(path.join(ROOT, record.path))
    });
  }
  const files = [...fileRecords.values()].sort((a, b) => a.path.localeCompare(b.path));
  const output = records.map((record) => `${record.status} ${record.fromPath ? `${record.fromPath} -> ` : ''}${record.path}`).join('\n');
  return { available: true, files, output, diagnostics: result.stderr.trim() };
}

function parsePorcelainStatus(stdout) {
  const fields = String(stdout).split('\0');
  const records = [];
  for (let index = 0; index < fields.length; index += 1) {
    let field = fields[index];
    if (!field) continue;
    if (!/^[ MTADRCU?!]{2} /.test(field)) {
      const lines = field.split(/\r?\n/);
      field = lines.findLast((line) => /^[ MTADRCU?!]{2} /.test(line)) ?? '';
    }
    if (!field) continue;
    const status = field.slice(0, 2);
    const file = normalizePath(field.slice(3));
    if (!file) continue;
    const renameOrCopy = status.includes('R') || status.includes('C');
    const fromPath = renameOrCopy ? normalizePath(fields[++index] ?? '') : null;
    records.push({ status, path: file, fromPath: fromPath || null });
  }
  return records;
}

function isTransientHarnessPath(value) {
  if (!value) return false;
  const normalized = normalizePath(value).replace(/\/$/, '');
  return normalized === '.harness/state.lock' || normalized.startsWith('.harness/state.lock/');
}

async function fileHash(target) {
  try {
    const bytes = await readFile(target);
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    return 'deleted';
  }
}

function normalizePath(value) {
  return String(value).replaceAll('\\', '/');
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
  return new RegExp(`^${source}$`).test(normalizedFile);
}

async function runCommands(entries, config) {
  if (!Array.isArray(config.security?.environmentAllow)) {
    throw new Error('security.environmentAllow must be an array before configured commands can run.');
  }
  const results = [];
  const secrets = secretEnvironmentValues(config.security);
  for (const entry of entries) {
    const text = commandText(entry);
    const started = Date.now();
    let prepared;
    try {
      prepared = await resolveCommandCredentials(entry, config);
    } catch (error) {
      results.push({
        command: config.security?.redactOutput ? redact(text, secrets) : text,
        layer: typeof entry === 'string' ? 'unspecified' : entry.layer,
        criterionId: typeof entry === 'string' ? undefined : entry.criterionId,
        credentials: commandCredentials(entry).map((provider) => ({ provider, slot: null })),
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
    const result = await capture(text, Number(config.policies?.commandTimeoutMs || 600000), config.security, prepared.environment, prepared.secrets);
    results.push({
      command: config.security?.redactOutput ? redact(text, secrets) : text,
      layer: typeof entry === 'string' ? 'unspecified' : entry.layer,
      criterionId: typeof entry === 'string' ? undefined : entry.criterionId,
      credentials: prepared.metadata,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: Date.now() - started,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.output,
      truncated: result.truncated,
      originalBytes: result.originalBytes
    });
    if (result.exitCode !== 0) break;
  }
  return { pass: results.length === entries.length && results.every((item) => item.exitCode === 0), results };
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
  const providerEnvironment = Object.values(security?.credentials?.providers ?? {}).flatMap((provider) => [provider?.targetEnvironment, ...(provider?.sources ?? [])]);
  const allowlistedValues = (security?.environmentAllow ?? [])
    .filter((key) => sensitiveName.test(key) && typeof process.env[key] === 'string' && process.env[key].length >= 4)
    .map((key) => process.env[key]);
  const providerValues = unique(providerEnvironment)
    .filter((key) => typeof process.env[key] === 'string' && process.env[key].length > 0)
    .map((key) => process.env[key]);
  return allowlistedValues
    .concat(providerValues, additional.filter((value) => typeof value === 'string' && value.length > 0))
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((left, right) => right.length - left.length);
}

function redact(value, secrets = []) {
  let output = String(value);
  for (const secret of secrets) output = output.replaceAll(secret, '[REDACTED_ENV]');
  return output
    .replace(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_\-]{16,}\b/g, '[REDACTED_TOKEN]')
    .replace(/((?:api[_-]?key|credential|password|private[_-]?key|secret|token)\s*(?:[=:]|\s)\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, '$1[REDACTED]');
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

function capture(commandText, timeoutMs, security = null, environment = {}, explicitSecrets = []) {
  return new Promise((resolve) => {
    const baseEnvironment = security?.environmentAllow
      ? Object.fromEntries(security.environmentAllow.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]))
      : process.env;
    const env = { ...baseEnvironment, ...environment };
    const child = spawn(platformCommand(commandText), { cwd: ROOT, env, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let originalBytes = 0;
    let truncated = false;
    let settled = false;
    const secrets = unique([...secretEnvironmentValues(security), ...explicitSecrets]);
    const append = (current, chunk) => {
      const value = chunk.toString();
      originalBytes += Buffer.byteLength(value);
      const next = current + value;
      if (next.length > 30000) truncated = true;
      return next.slice(-30000);
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const finish = (exitCode, extra = '') => {
      if (settled) return;
      settled = true;
      if (extra) stderr = append(stderr, Buffer.from(`\n${extra}`));
      if (security?.redactOutput) {
        stdout = redact(stdout, secrets);
        stderr = redact(stderr, secrets);
      }
      const marker = truncated ? '\n[OUTPUT TRUNCATED; see originalBytes metadata]' : '';
      resolve({ exitCode, timedOut, stdout, stderr, output: `${stdout}${stderr}${marker}`, truncated, originalBytes });
    };
    child.on('error', (error) => { clearTimeout(timer); finish(1, error.message); });
    child.on('close', (code) => { clearTimeout(timer); finish(timedOut ? 124 : (code ?? 1)); });
  });
}

function printRun(run) {
  for (const result of run.results) {
    console.log(`\n$ ${result.command}`);
    if (result.output.trim()) console.log(result.output.trim());
    console.log(`[exit=${result.exitCode} duration=${result.durationMs}ms${result.timedOut ? ' timeout' : ''}]`);
  }
}

function repeatedText(value, maximumItems = 20) {
  if (value === undefined || value === true) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item).trim()).filter(Boolean).slice(0, maximumItems);
}

function boundedText(name, value, maximumLength) {
  const text = requireText(name, value);
  if (text.length > maximumLength) throw new Error(`--${name} must be at most ${maximumLength} characters.`);
  return text;
}

function inferredNextAction(state, config) {
  const active = activeFeatures(state);
  const blocked = state.features.filter((item) => item.status === 'blocked');
  const candidate = nextCandidates(state, config)[0];
  if (active[0]) return `Continue ${active[0].id}: ${active[0].description}`;
  if (candidate) return `Start ${candidate.id}: node .harness/run.mjs start ${candidate.id}`;
  if (blocked[0]?.blocker) return `Resolve ${blocked[0].id}: ${blocked[0].blocker}`;
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
  const continuitySecrets = secretEnvironmentValues(config.security);
  const sanitize = (value) => redact(String(value), continuitySecrets);
  const summary = sanitize(boundedText('summary', args.summary, 4000));
  const next = sanitize(args.next ? boundedText('next', args.next, 2000) : inferredNextAction(state, config));
  const createdAt = new Date().toISOString();
  const git = await repositoryChanges();
  const identity = await repositoryIdentity();
  const projectFiles = git.files.filter((item) => !matchGlob(item.path, '.harness/**'));
  const active = activeFeatures(state).map((item) => ({ id: item.id, title: sanitize(item.title), description: sanitize(item.description) }));
  const featureBlockers = state.features
    .filter((item) => item.status === 'blocked')
    .map((item) => sanitize(`${item.id}: ${item.blocker}`));
  const userBlockers = repeatedText(args.blocker).map(sanitize);
  const decisions = repeatedText(args.decision).map(sanitize);
  const evidence = unique([...latestEvidence(state), ...repeatedText(args.evidence)].map(sanitize));
  const seed = { kind, createdAt, summary, next, revision: state.revision, head: identity.head };
  return {
    id: checkpointId(kind, createdAt, seed),
    kind,
    createdAt,
    reason: sanitize(args.reason || (args.automatic ? 'context_limit' : 'planned')),
    agent: args.agent && args.agent !== true ? sanitize(args.agent) : null,
    automatic: args.automatic === true,
    summary,
    next,
    decisions,
    blockers: unique([...featureBlockers, ...userBlockers]),
    featureRevision: state.revision,
    activeFeatures: active,
    passingFeatureCount: state.features.filter((item) => item.status === 'passing').length,
    evidence,
    configHash: stableHash(config),
    repository: {
      available: git.available && identity.available,
      head: identity.head,
      branch: identity.branch ? sanitize(identity.branch) : identity.branch,
      clean: git.available && projectFiles.length === 0,
      worktreeHash: git.available ? stableHash(projectFiles) : null,
      changedFileCount: projectFiles.length,
      changedFiles: projectFiles.slice(0, 100).map((item) => ({ path: sanitize(item.path), status: item.status, hash: item.hash }))
    }
  };
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
    ? `Awaiting a fresh task for handoff \`${checkpoint.id}\``
    : `Working generation ${generation}`;
  return `# Progress\n\nGenerated: ${new Date().toISOString()}\n\nThis is a bounded current-state snapshot. Use Git history, \`.harness/events.jsonl\`, and evidence files for older history.\n\n## Current state\n\n- Continuity: ${phaseText}\n- Feature revision: ${checkpoint.featureRevision}\n- Active features: ${active.length}\n- Passing features: ${checkpoint.passingFeatureCount}\n- Branch: ${checkpoint.repository.branch || '(detached or unavailable)'}\n- Commit: ${checkpoint.repository.head ?? '(unavailable)'}\n- Project worktree: ${checkpoint.repository.available ? checkpoint.repository.clean ? 'clean' : 'dirty (preserved for resume)' : 'unavailable'}\n\n## Current summary\n\n${checkpoint.summary}\n\n## Active feature\n\n${markdownItems(active, 'None.')}\n\n## Blockers and risks\n\n${markdownItems(checkpoint.blockers)}\n\n## Decisions to preserve\n\n${markdownItems(checkpoint.decisions)}\n\n## Next executable step\n\n${checkpoint.next}\n\n## Changed project files\n\n${markdownItems(files, checkpoint.repository.clean ? 'None.' : 'Unavailable.')}\n\n## Latest evidence\n\n${markdownItems(checkpoint.evidence, 'None.')}\n`;
}

function freshTaskPrompt(handoff) {
  return `Resume harness handoff ${handoff.id} in this fresh task. Run \`node .harness/run.mjs resume ${handoff.id}\` before changing files, then follow the printed next action.`;
}

function renderHandoff(handoff, generation) {
  const active = handoff.activeFeatures.map((item) => `${item.id}: ${item.title}`);
  const files = handoff.repository.changedFiles.map((item) => `${item.status.trim() || 'M'} ${item.path}`);
  const omitted = handoff.repository.changedFileCount - handoff.repository.changedFiles.length;
  if (omitted > 0) files.push(`... ${omitted} more changed project files (see Git status)`);
  const prompt = freshTaskPrompt(handoff);
  const codexLink = `codex://new?path=${encodeURIComponent(ROOT)}&prompt=${encodeURIComponent(prompt)}`;
  return `# Fresh-task Handoff\n\nGenerated: ${handoff.createdAt}\n\n- Handoff ID: \`${handoff.id}\`\n- From generation: ${generation}\n- Status: **FRESH TASK REQUIRED**\n- Resume command: \`node .harness/run.mjs resume ${handoff.id}\`\n\n## Terminal boundary\n\nStop the current conversation after this handoff. Do not invoke \`resume\` here, resume this transcript, or use context compaction as a substitute. Start a genuinely new chat/task in the same worktree.\n\n[Open a fresh Codex task](${codexLink})\n\nFor Claude Code, start a new session in this repository. For GitHub Copilot, start a new chat or coding-agent task. Use this bootstrap prompt:\n\n\`\`\`text\n${prompt}\n\`\`\`\n\n## Summary\n\n${handoff.summary}\n\n## Active feature\n\n${markdownItems(active, 'None.')}\n\n## Repository checkpoint\n\n- Commit: ${handoff.repository.head ?? '(unavailable)'}\n- Branch: ${handoff.repository.branch || '(detached or unavailable)'}\n- Feature revision: ${handoff.featureRevision}\n- Project worktree: ${handoff.repository.available ? handoff.repository.clean ? 'clean' : 'dirty; exact paths and hashes are recorded' : 'unavailable'}\n\nDirty or unavailable repository state is recorded as a handoff risk; it never prevents continuity from being persisted.\n\n## Changed project files\n\n${markdownItems(files, handoff.repository.clean ? 'None.' : 'Unavailable.')}\n\n## Blockers and risks\n\n${markdownItems(handoff.blockers)}\n\n## Decisions to preserve\n\n${markdownItems(handoff.decisions)}\n\n## Latest evidence\n\n${markdownItems(handoff.evidence, 'None.')}\n\n## Next action\n\n${handoff.next}\n`;
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
  await atomicWrite(PROGRESS_PATH, renderProgress(checkpoint, 'working', continuity.generation));
  await writeJson(CONTINUITY_PATH, { ...continuity, checkpoint });
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
    await atomicWrite(PROGRESS_PATH, renderProgress(continuity.handoff, 'awaiting_resume', continuity.generation));
    await atomicWrite(HANDOFF_PATH, renderHandoff(continuity.handoff, continuity.generation));
    if (args.json) console.log(JSON.stringify(continuity.handoff, null, 2));
    else printAwaitingResume(continuity);
    return;
  }
  const handoff = await buildCheckpoint('handoff');
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
    console.log(`Bootstrap prompt: ${freshTaskPrompt(handoff)}`);
    console.log('STOP_CURRENT_CHAT');
  }
}

async function currentRepositoryCheckpoint() {
  const git = await repositoryChanges();
  const identity = await repositoryIdentity();
  const projectFiles = git.files.filter((item) => !matchGlob(item.path, '.harness/**'));
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
      if (args.json) console.log(JSON.stringify(continuityView(continuity), null, 2));
      else console.log(`ALREADY_RESUMED ${id}; generation ${continuity.generation}`);
      return;
    }
    throw new Error(`No handoff is awaiting resume. Current continuity phase is ${continuity.phase}.`);
  }
  const handoff = continuity.handoff;
  if (handoff.id !== id) throw new Error(`Handoff ID mismatch. Pending handoff is ${handoff.id}.`);
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
    lastHandoff
  };
  await atomicWrite(PROGRESS_PATH, renderProgress(handoff, 'working', generation));
  await writeJson(CONTINUITY_PATH, updated);
  await appendEvent('session.resumed', { handoffId: id, generation, drift, driftAccepted: drift.length > 0 });
  if (args.json) {
    console.log(JSON.stringify({ continuity: continuityView(updated), summary: handoff.summary, next: handoff.next, drift }, null, 2));
    return;
  }
  console.log(`SESSION_RESUMED ${id}; generation ${generation}`);
  if (drift.length) console.log(`WARN  Accepted drift: ${drift.join('; ')}`);
  console.log(`Summary: ${handoff.summary}`);
  console.log(`Next: ${handoff.next}`);
  console.log('Now run node .harness/run.mjs doctor, status, and next before changing files.');
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

function printHelp() {
  console.log(`Project harness runtime

Usage:
  node .harness/run.mjs session [--json]
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
  node .harness/run.mjs checkpoint --summary TEXT [--next TEXT] [--decision TEXT] [--blocker TEXT] [--evidence PATH]
  node .harness/run.mjs handoff --summary TEXT [--next TEXT] [--reason TEXT] [--agent NAME] [--json]

Command entries may request configured credential pools with a credentials array.
The add command accepts --credential PROVIDER for acceptance commands. Keys are
selected from environment variables, rotated without persisting values, and are
never retried automatically after command execution.

Handoff is terminal for the current conversation. It records dirty work safely,
parks feature mutations, and prints the exact resume command for a fresh task.
Context compaction is not a substitute for handoff and resume.

Only successful verify runs can transition an active feature to passing.`);
}
