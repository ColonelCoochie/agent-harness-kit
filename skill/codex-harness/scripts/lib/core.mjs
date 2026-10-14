import { access, copyFile, lstat, mkdir, readFile, readdir, readlink, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(SCRIPT_DIR, '..', '..');
export const ASSET_DIR = path.join(SKILL_DIR, 'assets');
export const HARNESS_VERSION = 6;
const EVIDENCE_SCHEMA_VERSION = 4;
const VERIFICATION_PLAN_SCHEMA_VERSION = 1;
export const STATE_SCHEMA_VERSION = 1;
export const STATES = ['not_started', 'active', 'blocked', 'passing'];
const STATE_LOCK_OWNER_PREFIX = 'owner-';
const STATE_LOCK_OWNER_SUFFIX = '.json';
const LEGACY_STATE_LOCK_OWNER = 'owner.json';
const STATE_LOCK_ORPHAN_AGE_MS = 300000;
const STATE_LOCK_MAX_ACQUIRE_ATTEMPTS = 8;
const DEVELOPMENT_HARNESS_BOUNDARY = '## Development-Harness Boundary';
const ORCHESTRATED_WORKER_PROTOCOL = 'ORCHESTRATED_WORKER_CONTINUITY_V1';
const MANAGED_EXECUTABLES = Object.freeze([
  ['project-runtime.mjs', '.harness/run.mjs', 'always'],
  ['precompact-handoff.mjs', '.harness/hooks/precompact-handoff.mjs', 'shared'],
  ['sessionstart-routing.mjs', '.harness/hooks/sessionstart-routing.mjs', 'shared'],
  ['claude-worker-identity.mjs', '.harness/hooks/claude-worker-identity.mjs', 'claude']
]);
const MANAGED_INVENTORY_PATH = '.harness/managed-files.json';
const DEFAULT_ENVIRONMENT_ALLOW = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CI', 'NODE_ENV'
];
const DEFAULT_DENY = ['.git/**', '.env', '.env.*', '**/node_modules/**', '**/dist/**', '**/build/**'];
const DEFAULT_CREDENTIAL_PROVIDERS = {
  openai: {
    targetEnvironment: 'OPENAI_API_KEY',
    sources: ['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'OPENAI_API_KEY_4'],
    selection: 'round_robin'
  },
  anthropic: {
    targetEnvironment: 'ANTHROPIC_API_KEY',
    sources: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_2', 'ANTHROPIC_API_KEY_3', 'ANTHROPIC_API_KEY_4'],
    selection: 'round_robin'
  }
};
const AGENT_SURFACES = [
  {
    id: 'codex',
    path: 'AGENTS.md',
    template: 'AGENTS.md.template',
    addition: 'AGENTS.addition.md.template',
    routed: (content) => content.includes('.harness/config.json')
      && content.includes('.harness/features.json')
      && content.includes('.harness/continuity.json')
      && content.includes('.harness/run.mjs resume')
      && content.includes(ORCHESTRATED_WORKER_PROTOCOL)
      && content.includes(DEVELOPMENT_HARNESS_BOUNDARY)
  },
  {
    id: 'claude',
    path: 'CLAUDE.md',
    template: 'CLAUDE.md.template',
    addition: 'CLAUDE.addition.md.template',
    routed: (content) => content.includes(DEVELOPMENT_HARNESS_BOUNDARY)
      && content.includes(ORCHESTRATED_WORKER_PROTOCOL)
      && (content.includes('@AGENTS.md') || (content.includes('.harness/config.json') && content.includes('.harness/features.json')))
  },
  {
    id: 'github-copilot',
    path: '.github/copilot-instructions.md',
    template: 'copilot-instructions.md.template',
    addition: 'copilot-instructions.addition.md.template',
    routed: (content) => content.includes(DEVELOPMENT_HARNESS_BOUNDARY)
      && content.includes(ORCHESTRATED_WORKER_PROTOCOL)
      && (content.includes('AGENTS.md') || (content.includes('.harness/config.json') && content.includes('.harness/features.json')))
  }
];
const CODEX_HOOK_SURFACE = {
  path: '.codex/hooks.json',
  template: 'codex-hooks.json.template',
  addition: 'codex-hooks.addition.json.template',
  routed: (content) => content.includes('HARNESS_HOOK_LAUNCHER_V1') && content.includes('.harness/hooks/precompact-handoff.mjs') && content.includes('PreCompact') && content.includes('.harness/hooks/sessionstart-routing.mjs') && content.includes('SessionStart')
};
const CLAUDE_HOOK_SURFACE = {
  path: '.claude/settings.json', template: 'claude-hooks.json.template', addition: 'claude-hooks.addition.json.template',
  routed: content => content.includes('HARNESS_HOOK_LAUNCHER_V1') && content.includes('.harness/hooks/claude-worker-identity.mjs') && content.includes('SubagentStart') && content.includes('PreCompact') && content.includes('SessionStart')
};
const CANONICAL_V5_ASSET_MIGRATIONS = Object.freeze([
  Object.freeze({
    asset: 'docs-map.md.template',
    predecessor: 'migrations/runtime-v5/docs-map.md.template',
    predecessorSha256: 'e74b50e8b6664a96547f0478437f41e198c4db9c74cf523cae978270ea093a87',
    destination: 'docs-map.md',
    review: 'docs-map.v6.addition.md'
  }),
  Object.freeze({
    asset: 'goal.md',
    predecessor: 'migrations/runtime-v5/goal.md',
    predecessorSha256: 'c444ec6cde487d8d864c7de3e218809add1ba634fa33820e4bc57f031547d01b',
    destination: 'loops/goal.md',
    review: 'loops/goal.v6.addition.md'
  }),
  Object.freeze({
    asset: 'maker.md',
    predecessor: 'migrations/runtime-v5/maker.md',
    predecessorSha256: 'b9055260a12c21d9684b61b8c885fd6e80ffbbf29657952ee08dd22dab2da239',
    destination: 'loops/maker.md',
    review: 'loops/maker.v6.addition.md'
  }),
  Object.freeze({
    asset: 'checker.md',
    predecessor: 'migrations/runtime-v5/checker.md',
    predecessorSha256: '001f8b740e0e6282a7b3b346255a1e5e54ddd163228886e3ff18e642f8efca7d',
    destination: 'loops/checker.md',
    review: 'loops/checker.v6.addition.md'
  })
]);

export function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const option = token.slice(2), equal = option.indexOf('=');
    const split = equal < 0 ? [option] : [option.slice(0, equal), option.slice(equal + 1)];
    const key = split[0].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (split.length === 2) {
      parsed[key] = key === 'replaceReviewed' ? [...(parsed[key] ?? []), split[1]] : split[1];
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[key] = key === 'replaceReviewed' ? [...(parsed[key] ?? []), argv[index + 1]] : argv[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

export async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readText(target) {
  return readFile(target, 'utf8');
}

export async function readJson(target) {
  return JSON.parse(await readText(target));
}

export async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
}

export async function writeJson(target, value) {
  await atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function withStateLock(harnessDir, lockCommand, operation) {
  const lockDir = path.join(harnessDir, 'state.lock');
  const lock = await acquireStateLock(lockDir, lockCommand);
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
      command: String(lockCommand || 'sync'),
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

async function copyAsset(name, target, { force = false, replacements = {} } = {}) {
  if (!force && await exists(target)) return { path: target, status: 'preserved' };
  const content = await renderAsset(name, replacements);
  if (await exists(target) && await readText(target) === content) return { path: target, status: 'unchanged' };
  await atomicWrite(target, content);
  return { path: target, status: 'written' };
}

function applyAssetReplacements(content, replacements = {}) {
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}

async function renderAsset(name, replacements = {}) {
  return applyAssetReplacements(await readText(path.join(ASSET_DIR, name)), replacements);
}

function matchesExactOrCrLfNormalized(actual, expected) {
  return actual === expected || actual.replaceAll('\r\n', '\n') === expected.replaceAll('\r\n', '\n');
}


function canonicalAssetReview(relativeTarget, canonicalContent) {
  return `# Canonical runtime v6 addition for \`${relativeTarget}\`

<!-- agent-harness-managed: canonical-runtime-v6-asset-review -->

\`agent-harness sync\` preserved \`${relativeTarget}\` because its content is neither the current canonical runtime-v6 asset nor an exact known runtime-v5 predecessor (allowing only CRLF-to-LF normalization).

Review and merge the canonical content between the markers into \`${relativeTarget}\`. Do not delete customized project guidance. After the target matches the canonical runtime-v6 content, rerun \`sync\`; it removes this generated addition automatically. If you intentionally keep the customization, keep this addition as the explicit pending review.

<!-- BEGIN CANONICAL RUNTIME V6 CONTENT -->
${canonicalContent}<!-- END CANONICAL RUNTIME V6 CONTENT -->
`;
}


function runCommand(packageManager, script) {
  if (packageManager === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`;
  if (packageManager === 'yarn') return `yarn ${script}`;
  return `${packageManager} run ${script}`;
}

export function normalizeCommandForPlatform(command, platform = process.platform) {
  const text = String(command);
  if (platform !== 'win32') return text;
  return text.replace(/^(\s*)(?:"([^"]+)"|'([^']+)'|(\S+))/, (match, leading, doubleQuoted, singleQuoted, bare) => {
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

function initialContinuity(startedAt = new Date().toISOString()) {
  return {
    version: 1,
    phase: 'working',
    generation: 1,
    startedAt,
    resumedAt: null,
    checkpoint: null,
    handoff: null,
    lastHandoff: null
  };
}

function migrateContinuity(value, startedAt) {
  const baseline = initialContinuity(startedAt);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return baseline;
  if (value.version !== undefined && value.version !== 1) throw new Error(`Unsupported continuity schema version: ${value.version}.`);
  if (value.phase !== undefined && !['working', 'awaiting_resume'].includes(value.phase)) throw new Error(`Unsupported continuity phase: ${value.phase}.`);
  if (value.phase === 'awaiting_resume' && !value.handoff?.id) {
    throw new Error('Refusing to clear an awaiting-resume barrier whose handoff capsule is missing. Repair continuity.json explicitly.');
  }
  const phase = value.phase ?? 'working';
  const handoff = phase === 'awaiting_resume' && value.handoff?.id ? value.handoff : null;
  return {
    ...baseline,
    ...value,
    version: 1,
    phase: handoff ? 'awaiting_resume' : 'working',
    generation: Number.isInteger(value.generation) && value.generation > 0 ? value.generation : 1,
    handoff
  };
}

function featureContract(feature) {
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

function featureContractHash(feature) {
  if (feature.contract?.version === 2) {
    return stableHash({
      contract: featureContract(feature),
      scopeBaselineHash: feature.contract.scopeBaselineHash
    });
  }
  return stableHash(featureContract(feature));
}

function credentialProviders(security = {}) {
  return security.credentials?.providers ?? {};
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
  const providers = credentialProviders(security);
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

function commandText(entry) {
  return typeof entry === 'string' ? entry : entry?.command;
}

function commandCredentials(entry) {
  if (!entry || typeof entry === 'string' || entry.credentials === undefined) return [];
  return Array.isArray(entry.credentials) ? entry.credentials : [entry.credentials];
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

function validateEvidenceRecord(feature, record) {
  const errors = [];
  const warnings = [];
  const evidenceSchema = Number(record?.schemaVersion ?? 1);
  if (!Number.isInteger(evidenceSchema) || evidenceSchema < 1 || evidenceSchema > EVIDENCE_SCHEMA_VERSION) {
    errors.push(`${feature.id}: unsupported evidence schema version ${String(record?.schemaVersion ?? 1)}`);
    return { errors, warnings };
  }
  if (record.featureId !== feature.id) errors.push(`${feature.id}: evidence belongs to ${record.featureId}`);
  if (record.pass !== true) errors.push(`${feature.id}: latest evidence did not pass`);
  if (!Array.isArray(record.commands) || record.commands.length === 0 || record.commands.some((item) => item.exitCode !== 0)) {
    errors.push(`${feature.id}: evidence lacks successful commands`);
  }
  if (!Array.isArray(record.scopeViolations) || record.scopeViolations.length !== 0) {
    errors.push(`${feature.id}: passing evidence has nonempty or invalid scope violations`);
  }
  if (evidenceSchema >= 2) {
    if (!record.contractHash || record.contractHash !== featureContractHash(feature)) errors.push(`${feature.id}: contract and evidence do not match`);
    if (!record.configHash) errors.push(`${feature.id}: evidence lacks config provenance`);
    if (Number(record.harnessVersion ?? 1) >= 2 && !record.verificationHash) errors.push(`${feature.id}: evidence lacks verification-plan provenance`);
  }
  if (evidenceSchema < EVIDENCE_SCHEMA_VERSION) {
    warnings.push(`${feature.id}: legacy evidence schema v${evidenceSchema} predates embedded verification-plan manifests; the historical pass remains usable but is not independently plan-verified`);
    return { errors, warnings };
  }

  const plan = record.verificationPlan;
  if (!isRecord(plan)) {
    errors.push(`${feature.id}: evidence lacks an embedded verification plan`);
    return { errors, warnings };
  }
  if (plan.schemaVersion !== VERIFICATION_PLAN_SCHEMA_VERSION) {
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

async function ensureAgentSurfaces(target, harnessDir, results, replacements = {}, enabledAgents = AGENT_SURFACES.map((surface) => surface.id)) {
  const selected = new Set(['codex', ...enabledAgents]);
  for (const surface of AGENT_SURFACES.filter((candidate) => selected.has(candidate.id))) {
    const destination = path.join(target, surface.path);
    if (!await exists(destination)) {
      results.push(await copyAsset(surface.template, destination, { replacements }));
      continue;
    }
    const content = await readText(destination);
    if (!surface.routed(content)) {
      results.push(await copyAsset(surface.addition, path.join(harnessDir, path.basename(surface.addition, '.template'))));
    }
    results.push({ path: destination, status: 'preserved' });
  }
}

function parseEnabledAgents(value) {
  if (value === undefined || value === true) return AGENT_SURFACES.map((surface) => surface.id);
  const enabled = unique((Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean));
  if (enabled.length === 0) throw new Error('--agents must name at least one coding-agent surface.');
  const known = new Set(AGENT_SURFACES.map((surface) => surface.id));
  const unknown = enabled.filter((agent) => !known.has(agent));
  if (unknown.length > 0) throw new Error(`Unknown coding-agent surface(s): ${unknown.join(', ')}.`);
  return enabled;
}

async function ensureCodexHookSurface(target, harnessDir, results) {
  return ensureHookSurface(target, harnessDir, results, CODEX_HOOK_SURFACE);
}

async function ensureHookSurface(target, harnessDir, results, surface) {
  const destination = path.join(target, surface.path);
  const platform = surface === CLAUDE_HOOK_SURFACE ? 'claude' : 'codex';
  const replacements = {};
  for (const [key, name] of [['PRECOMPACT', 'precompact-handoff.mjs'], ['SESSIONSTART', 'sessionstart-routing.mjs'], ['IDENTITY', 'claude-worker-identity.mjs']]) {
    replacements[key + '_COMMAND'] = JSON.stringify(hookLauncher(name, platform));
    replacements[key + '_WINDOWS_COMMAND'] = JSON.stringify(hookLauncher(name, platform));
  }
  if (!await exists(destination)) {
    results.push(await copyAsset(surface.template, destination, { replacements }));
    await clearKnownHookAddition(harnessDir, surface, replacements);
    return;
  }
  const content = await readText(destination);
  const upgraded = upgradeKnownHookCommands(content, platform, await renderAsset(surface.template, replacements));
  if (upgraded && surface.routed(upgraded)) {
    await atomicWrite(destination, upgraded);
    await clearKnownHookAddition(harnessDir, surface, replacements);
    results.push({ path: destination, status: 'written' });
    return;
  }
  if (!surface.routed(content)) {
    const addition = path.join(harnessDir, path.basename(surface.addition, '.template'));
    const expected = await renderAsset(surface.addition, replacements);
    const known = await exists(addition) && isKnownHookAddition(await readText(addition), expected);
    results.push(await copyAsset(surface.addition, addition, { replacements, force: known }));
  }
  else await clearKnownHookAddition(harnessDir, surface, replacements);
  results.push({ path: destination, status: 'preserved' });
}

function isKnownHookAddition(content, expected) {
  // Only the entire canonical addition or its one known timeout predecessor
  // is managed. Formatting edits beyond CRLF and manual notes stay untouched.
  const previous = expected.replace(/("PreCompact"\s*:[\s\S]*?"timeout"\s*:\s*)600/, (_, prefix) => prefix + '30');
  return matchesExactOrCrLfNormalized(content, expected) || matchesExactOrCrLfNormalized(content, previous);
}

async function clearKnownHookAddition(harnessDir, surface, replacements) {
  const addition = path.join(harnessDir, path.basename(surface.addition, '.template'));
  if (!await exists(addition)) return;
  try {
    const original = await readText(addition);
    const expected = await renderAsset(surface.addition, replacements);
    if (isKnownHookAddition(original, expected)) await unlink(addition);
  } catch { /* Customized notes or malformed user additions remain reviewable. */ }
}

function hookLauncher(name, platform) {
  // The code contains only shell-neutral ASCII literals, never a project path,
  // variable interpolation or Git-root assumption. Forward the original JSON
  // input intact to the installed adapter closest to its cwd.
  const failure = platform === 'claude' && name === 'precompact-handoff.mjs' ? "{decision:'block',reason:e.message}" : "{continue:false,stopReason:e.message}";
  const script = `const marker='HARNESS_HOOK_LAUNCHER_V1';const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process');try{const raw=fs.readFileSync(0,'utf8'),input=JSON.parse(raw||'{}');let root=p.resolve(input.cwd||process.cwd());while(!fs.existsSync(p.join(root,'.harness/run.mjs'))){const parent=p.dirname(root);if(parent===root)throw new Error('No nearest harness installation');root=parent;}const result=cp.spawnSync(process.execPath,[p.join(root,'.harness/hooks/${name}'),'--platform','${platform}'],{cwd:root,input:raw,encoding:'utf8',windowsHide:true});if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr||'Hook adapter failed');process.stdout.write(result.stdout||'{}');}catch(e){process.stdout.write(JSON.stringify(${failure}));}`;
  return `node -e "${script}"`;
}

function isKnownLegacyHookCommand(command, name, platform) {
  if (typeof command !== 'string') return false;
  const escapedName = name.replaceAll('.', '\\.');
  const oldAbsolute = new RegExp(`^node (?:"[^"\\r\\n]+/\\.harness/hooks/${escapedName}"|'[^'\\r\\n]+/\\.harness/hooks/${escapedName}')(?: --platform ${platform})?$`).test(command);
  const oldGit = command === `node "$(git rev-parse --show-toplevel)/.harness/hooks/${name}"${name === 'precompact-handoff.mjs' ? ' --platform ' + platform : ''}`;
  return oldAbsolute || oldGit;
}

function upgradeKnownHookCommands(content, platform, canonical) {
  let settings;
  try { settings = JSON.parse(content); } catch { return null; }
  let changed = false;
  const precompactDefault = JSON.parse(canonical).hooks.PreCompact[0];
  for (const [event, name] of [['PreCompact', 'precompact-handoff.mjs'], ['SessionStart', 'sessionstart-routing.mjs'], ['SubagentStart', 'claude-worker-identity.mjs']]) {
    for (const group of Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : []) for (const hook of Array.isArray(group.hooks) ? group.hooks : []) {
      if (hook.type !== 'command' || typeof hook.command !== 'string') continue;
      // Exact generated invocations only: wrappers, arguments and customized
      // Windows overrides are preserved even when the main command migrates.
      const launcher = hookLauncher(name, platform);
      if (isKnownLegacyHookCommand(hook.command, name, platform)) {
        hook.command = launcher;
        if (isKnownLegacyHookCommand(hook.commandWindows, name, platform)) hook.commandWindows = launcher;
        changed = true;
      }
      // Upgrade the exact generated entry and matcher, never a user timeout,
      // command wrapper, added hook option or customized matching policy.
      if (event === 'PreCompact' && hook.timeout === 30
          && stableHash({ ...group, hooks: [] }) === stableHash({ ...precompactDefault, hooks: [] })
          && stableHash({ ...hook, timeout: 600 }) === stableHash(precompactDefault.hooks[0])) {
        hook.timeout = 600;
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(settings, null, 2) + '\n' : null;
}

export async function detectProject(root) {
  const rootNames = new Set((await readdir(root, { withFileTypes: true })).map((item) => item.name));
  let stack = 'generic';
  let packageManager = null;
  let packageJson = null;

  if (rootNames.has('package.json')) {
    packageJson = await readJson(path.join(root, 'package.json'));
    packageManager = rootNames.has('pnpm-lock.yaml') ? 'pnpm'
      : rootNames.has('yarn.lock') ? 'yarn'
        : rootNames.has('bun.lock') || rootNames.has('bun.lockb') ? 'bun'
          : 'npm';
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    stack = dependencies.typescript ? 'typescript' : 'node';
  } else if (rootNames.has('pyproject.toml') || rootNames.has('requirements.txt')) {
    stack = 'python';
  } else if (rootNames.has('go.mod')) {
    stack = 'go';
  } else if (rootNames.has('Cargo.toml')) {
    stack = 'rust';
  } else if (rootNames.has('pom.xml')) {
    stack = 'java-maven';
  } else if (rootNames.has('build.gradle') || rootNames.has('build.gradle.kts')) {
    stack = 'java-gradle';
  } else if ([...rootNames].some((name) => name.endsWith('.sln') || name.endsWith('.csproj'))) {
    stack = 'dotnet';
  }

  return { rootNames, stack, packageManager, packageJson };
}

export function detectVerification(profile) {
  const empty = { quick: [], full: [], e2e: [], architecture: [], clean: [] };
  if (profile.packageJson) {
    const scripts = profile.packageJson.scripts ?? {};
    const command = (name) => scripts[name] ? runCommand(profile.packageManager, name) : null;
    empty.quick = unique([command('check'), command('typecheck'), command('type-check'), command('lint')]);
    empty.full = unique([command('test'), command('build')]);
    empty.e2e = unique([command('test:e2e'), command('e2e')]);
    empty.architecture = unique([command('check:architecture'), command('architecture')]);
    empty.clean = unique([command('check:clean'), command('clean:check')]);
    return empty;
  }

  if (profile.stack === 'python') {
    empty.quick = ['python -m compileall -q .'];
    empty.full = ['python -m pytest'];
  } else if (profile.stack === 'go') {
    empty.full = ['go test ./...'];
  } else if (profile.stack === 'rust') {
    empty.full = ['cargo test'];
  } else if (profile.stack === 'java-maven') {
    empty.full = ['mvn test'];
  } else if (profile.stack === 'java-gradle') {
    empty.full = ['./gradlew test'];
  } else if (profile.stack === 'dotnet') {
    empty.full = ['dotnet test'];
  }
  return empty;
}

function detectDocs(root, rootNames) {
  const candidates = ['README.md', 'docs/ARCHITECTURE.md', 'docs/PRODUCT.md', 'docs/RELIABILITY.md', 'docs/SECURITY.md'];
  return candidates.filter((candidate) => {
    if (!candidate.includes('/')) return rootNames.has(candidate);
    return existsSync(path.join(root, candidate));
  });
}

export async function initHarness(root, options = {}) {
  const target = path.resolve(root);
  await mkdir(target, { recursive: true });
  const profile = await detectProject(target);
  const verification = detectVerification(profile);
  const harnessDir = path.join(target, '.harness');
  const projectName = String(options.name || profile.packageJson?.name || path.basename(target));
  const projectPurpose = String(options.purpose || `TODO: describe ${projectName}'s user-facing product purpose; do not describe the development harness here.`);
  const enabledAgents = parseEnabledAgents(options.agents);
  const commandsOverride = options.commands
    ? String(options.commands).split(',').map((item) => normalizeCommandForPlatform(item.trim())).filter(Boolean)
    : null;
  if (commandsOverride) verification.full = commandsOverride;

  const config = {
    version: STATE_SCHEMA_VERSION,
    project: {
      name: projectName,
      purpose: projectPurpose,
      stack: profile.stack
    },
    policies: {
      wipLimit: Number(options.wipLimit || 1),
      maxAttempts: Number(options.maxAttempts || 3),
      maxRepeatedFailures: Number(options.maxRepeatedFailures || 2),
      commandTimeoutMs: Number(options.commandTimeoutMs || 600000),
      passingIsTerminal: true,
      requireEvidence: true
    },
    verification,
    completion: {
      baseLayers: ['full'],
      alwaysRunWhenConfigured: ['quick', 'architecture'],
      requireAcceptanceCommands: true
    },
    execution: {
      harnessRuntime: { command: 'node', minimumMajorVersion: 20 },
      packageManager: profile.packageManager,
      setup: [],
      start: profile.packageJson?.scripts?.start ? [runCommand(profile.packageManager, 'start')] : [],
      health: [],
      shutdown: []
    },
    scope: {
      enforcement: 'required',
      defaultAllow: ['**/*'],
      defaultDeny: DEFAULT_DENY
    },
    continuity: {
      mode: 'orchestrated_worker',
      dirtyWorktree: 'record',
      blockMutationsAfterHandoff: true
    },
    security: {
      environmentAllow: DEFAULT_ENVIRONMENT_ALLOW,
      redactOutput: true,
      credentials: {
        stateFile: '.harness/credentials-state.json',
        providers: DEFAULT_CREDENTIAL_PROVIDERS
      }
    },
    agents: {
      enabled: enabledAgents,
      instructions: Object.fromEntries(AGENT_SURFACES.filter((surface) => enabledAgents.includes(surface.id)).map((surface) => [surface.id, surface.path]))
    },
    docs: {
      required: detectDocs(target, profile.rootNames),
      router: '.harness/docs-map.md'
    }
  };

  const features = {
    version: STATE_SCHEMA_VERSION,
    revision: 0,
    features: []
  };

  await mkdir(path.join(harnessDir, 'evidence'), { recursive: true });
  await mkdir(path.join(harnessDir, 'loops'), { recursive: true });
  await mkdir(path.join(harnessDir, 'hooks'), { recursive: true });
  const results = [];

  const configPath = path.join(harnessDir, 'config.json');
  if (options.force || !await exists(configPath)) {
    await writeJson(configPath, config);
    results.push({ path: configPath, status: 'written' });
  } else results.push({ path: configPath, status: 'preserved' });

  const featuresPath = path.join(harnessDir, 'features.json');
  if (options.force || !await exists(featuresPath)) {
    await writeJson(featuresPath, features);
    results.push({ path: featuresPath, status: 'written' });
  } else results.push({ path: featuresPath, status: 'preserved' });

  const continuityPath = path.join(harnessDir, 'continuity.json');
  if (options.force || !await exists(continuityPath)) {
    await writeJson(continuityPath, initialContinuity());
    results.push({ path: continuityPath, status: 'written' });
  } else results.push({ path: continuityPath, status: 'preserved' });

  results.push(await copyAsset('project-runtime.mjs', path.join(harnessDir, 'run.mjs'), { force: Boolean(options.force) }));
  results.push(await copyAsset('progress.md', path.join(harnessDir, 'progress.md'), { force: Boolean(options.force) }));
  results.push(await copyAsset('handoff.md', path.join(harnessDir, 'handoff.md'), { force: Boolean(options.force) }));
  results.push(await copyAsset('quality.md', path.join(harnessDir, 'quality.md'), { force: Boolean(options.force) }));
  results.push(await copyAsset('docs-map.md.template', path.join(harnessDir, 'docs-map.md'), {
    force: Boolean(options.force), replacements: { PROJECT_NAME: projectName }
  }));
  results.push(await copyAsset('goal.md', path.join(harnessDir, 'loops', 'goal.md'), { force: Boolean(options.force) }));
  results.push(await copyAsset('maker.md', path.join(harnessDir, 'loops', 'maker.md'), { force: Boolean(options.force) }));
  results.push(await copyAsset('checker.md', path.join(harnessDir, 'loops', 'checker.md'), { force: Boolean(options.force) }));
  for (const [asset, relative, surface] of enabledExecutables(enabledAgents).filter(([, relative]) => relative !== '.harness/run.mjs')) {
    results.push(await copyAsset(asset, path.join(target, relative), { force: Boolean(options.force) }));
  }

  await ensureAgentSurfaces(target, harnessDir, results, { PROJECT_PURPOSE: projectPurpose }, enabledAgents);
  if (enabledAgents.includes('codex')) await ensureCodexHookSurface(target, harnessDir, results);
  if (enabledAgents.includes('claude')) await ensureHookSurface(target, harnessDir, results, CLAUDE_HOOK_SURFACE);

  await atomicWrite(path.join(harnessDir, 'evidence', '.gitkeep'), '');
  if (!await exists(path.join(harnessDir, 'credentials-state.json'))) {
    await writeJson(path.join(harnessDir, 'credentials-state.json'), { version: 1, cursors: {} });
  }
  if (!await exists(path.join(harnessDir, 'events.jsonl'))) {
    await atomicWrite(path.join(harnessDir, 'events.jsonl'), '');
  }
  // Record only files proved to equal our source, never adopt an unknown copy.
  const inventoryPath = path.join(target, MANAGED_INVENTORY_PATH);
  const inventory = await exists(inventoryPath) ? await readJson(inventoryPath) : { version: 1, files: {} };
  validateManagedInventory(inventory);
  for (const [asset, relative] of enabledExecutables(enabledAgents)) {
    const actual = await readFile(path.join(target, relative));
    if (actual.equals(await readFile(path.join(ASSET_DIR, asset)))) inventory.files[relative] = rawHash(actual);
  }
  await writeJson(inventoryPath, inventory);
  return { target, profile, verification, results };
}

function rawHash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function enabledExecutables(enabled) {
  return MANAGED_EXECUTABLES.filter(([, , surface]) => surface === 'always'
    || (surface === 'shared' && (enabled.includes('codex') || enabled.includes('claude')))
    || (surface === 'claude' && enabled.includes('claude')));
}

function validateManagedInventory(value) {
  if (value?.version !== 1 || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)
    || Object.entries(value.files).some(([relative, hash]) => !MANAGED_EXECUTABLES.some(([, allowed]) => allowed === relative) || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Invalid managed executable inventory; repair it explicitly before sync.');
  }
}

async function syncInput(absolute) {
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) return { kind: 'symlink', hash: rawHash(await readlink(absolute, { encoding: 'buffer' })) };
    if (info.isDirectory()) return { kind: 'directory', hash: rawHash(`${info.dev}:${info.ino}:${info.mode}`) };
    if (!info.isFile()) return { kind: 'unsupported', hash: null };
    const bytes = await readFile(absolute);
    return { kind: 'file', hash: rawHash(bytes), bytes };
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing', hash: null };
    throw error;
  }
}

// Planning performs only reads. The public projection contains hashes and
// actions; executable/config bytes stay internal to this exact plan object.
export async function planSync(root, options = {}) {
  const target = path.resolve(root), inputs = new Map(), sources = new Map(), operations = [], blockers = [];
  const migrations = [], repairs = [], canonicalAssetResults = [];
  const read = async relative => {
    if (inputs.has(relative)) return inputs.get(relative);
    const parts = relative.split('/');
    for (let index = 0; index < parts.length - 1; index++) {
      const parent = parts.slice(0, index + 1).join('/');
      if (!inputs.has(parent)) inputs.set(parent, await syncInput(path.join(target, parent)));
      if (!['directory', 'missing'].includes(inputs.get(parent).kind)) throw new Error(`Sync refuses non-directory ancestor ${parent}.`);
    }
    const value = await syncInput(path.join(target, relative)); inputs.set(relative, value);
    if (!['file', 'missing'].includes(value.kind)) throw new Error(`Sync refuses ${value.kind} target ${relative}.`);
    return value;
  };
  const asset = async (name, replacements = {}) => {
    if (!sources.has(name)) sources.set(name, await syncInput(path.join(ASSET_DIR, name)));
    const value = sources.get(name);
    if (value.kind !== 'file') throw new Error(`Missing reusable source asset ${name}.`);
    return applyAssetReplacements(value.bytes.toString('utf8'), replacements);
  };
  const operation = async (relative, action, content, status = action) => {
    const before = await read(relative), bytes = content === undefined ? null : Buffer.from(content);
    const afterHash = action === 'remove' ? null : action === 'write' && bytes ? rawHash(bytes) : before.hash;
    const actualAction = action === 'write' && before.hash === afterHash ? 'preserve' : action;
    const item = { path: relative, action: actualAction, beforeHash: before.hash, afterHash, status: actualAction === 'preserve' && status === 'written' ? 'unchanged' : status };
    Object.defineProperty(item, 'bytes', { value: bytes }); operations.push(item); return item;
  };
  const ensure = async (relative, content) => operation(relative, (await read(relative)).kind === 'missing' ? 'write' : 'preserve', content, (await read(relative)).kind === 'missing' ? 'written' : 'preserved');
  const jsonBytes = value => JSON.stringify(value, null, 2) + '\n';
  const configInput = await read('.harness/config.json'), stateInput = await read('.harness/features.json'), continuityInput = await read('.harness/continuity.json');
  if (configInput.kind !== 'file' || stateInput.kind !== 'file') throw new Error(`No harness found at ${target}. Run init first.`);
  const originalConfig = JSON.parse(configInput.bytes), originalState = JSON.parse(stateInput.bytes);
  const originalContinuity = continuityInput.kind === 'file' ? JSON.parse(continuityInput.bytes) : null;
  for (const [name, value] of [['config', originalConfig], ['features', originalState], ['continuity', originalContinuity]]) {
    if (value?.version !== undefined && value.version !== STATE_SCHEMA_VERSION) throw new Error(`Unsupported ${name} schema version: ${value.version}. Sync left project files unchanged.`);
  }
  // Only package-manager detection is needed for migration; bind every input.
  const packageInput = await read('package.json');
  const lockInputs = await Promise.all(['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].map(read));
  const profile = { packageManager: packageInput.kind === 'file' ? lockInputs[0].kind === 'file' ? 'pnpm' : lockInputs[1].kind === 'file' ? 'yarn' : lockInputs.slice(2).some(value => value.kind === 'file') ? 'bun' : 'npm' : null };
  const config = migrateConfig(originalConfig, profile), state = migrateState(originalState, config);
  // A deterministic fallback makes a legacy missing-state preview reviewable.
  const continuity = migrateContinuity(originalContinuity, originalState.features?.find(item => typeof item.createdAt === 'string')?.createdAt ?? '1970-01-01T00:00:00.000Z');
  for (const [relative, before, after] of [['.harness/config.json', originalConfig, config], ['.harness/features.json', originalState, state], ['.harness/continuity.json', originalContinuity, continuity]]) {
    if (stableHash(before) !== stableHash(after)) { await operation(relative, 'write', jsonBytes(after), 'migrated'); migrations.push(relative); }
  }
  const enabled = Array.isArray(config.agents?.enabled) ? config.agents.enabled : AGENT_SURFACES.map(surface => surface.id);
  const inventoryInput = await read(MANAGED_INVENTORY_PATH);
  const inventory = inventoryInput.kind === 'file' ? JSON.parse(inventoryInput.bytes) : { version: 1, files: {} }; validateManagedInventory(inventory);
  const predecessor = JSON.parse(await asset('migrations/runtime-v6/executable-identities.json'));
  const replacements = options.replacements ?? {};
  if (!replacements || typeof replacements !== 'object' || Array.isArray(replacements)) throw new Error('Reviewed replacements must be a path-to-SHA256 object.');
  const executables = enabledExecutables(enabled), allowed = new Set(executables.map(([, relative]) => relative));
  for (const [relative, expected] of Object.entries(replacements)) {
    if (!allowed.has(relative) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Reviewed replacement is not an enabled runtime/hook path with a raw SHA256: ${relative}.`);
    if ((await read(relative)).hash !== expected) throw new Error(`Stale reviewed replacement hash for ${relative}; sync left project files unchanged.`);
  }
  for (const [name, relative] of executables) {
    const before = await read(relative), content = await asset(name), afterHash = rawHash(Buffer.from(content));
    const recognized = before.kind === 'missing' || before.hash === afterHash || inventory.files[relative] === before.hash || predecessor.files?.[name]?.includes(before.hash);
    const reviewed = Object.hasOwn(replacements, relative);
    if (!recognized && !reviewed) {
      blockers.push({ path: relative, beforeHash: before.hash, afterHash, reason: 'Customized or unknown executable; explicit reviewed replacement with its raw SHA256 is required.' });
      await operation(relative, 'blocked', undefined, 'preserved_customized');
    } else {
      const item = await operation(relative, 'write', content, 'written'); inventory.files[relative] = afterHash;
      if (item.action === 'write' && relative !== '.harness/run.mjs') repairs.push(relative);
    }
  }
  for (const [name, relative] of [['progress.md', '.harness/progress.md'], ['handoff.md', '.harness/handoff.md'], ['quality.md', '.harness/quality.md']]) {
    if ((await ensure(relative, await asset(name))).action === 'write') repairs.push(relative);
  }
  for (const migration of CANONICAL_V5_ASSET_MIGRATIONS) {
    const relative = '.harness/' + migration.destination, reviewPath = '.harness/' + migration.review;
    const replacements = migration.asset === 'docs-map.md.template' ? { PROJECT_NAME: config.project?.name ?? path.basename(target) } : {};
    const canonical = await asset(migration.asset, replacements), expectedReview = canonicalAssetReview(relative, canonical);
    const before = await read(relative), current = before.bytes?.toString('utf8');
    let status;
    if (before.kind === 'missing') { await operation(relative, 'write', canonical, 'written'); status = 'written'; }
    else if (matchesExactOrCrLfNormalized(current, canonical)) { await operation(relative, 'preserve', undefined, 'unchanged'); status = 'unchanged'; }
    else {
      const predecessorBytes = await asset(migration.predecessor);
      if (rawHash(Buffer.from(predecessorBytes)) !== migration.predecessorSha256) throw new Error(`Canonical runtime-v5 predecessor identity mismatch for ${migration.asset}.`);
      if (matchesExactOrCrLfNormalized(current, applyAssetReplacements(predecessorBytes, replacements))) { await operation(relative, 'write', canonical, 'migrated'); status = 'migrated'; }
      else { await operation(relative, 'preserve', undefined, 'preserved'); status = 'preserved'; }
    }
    const reviewInput = await read(reviewPath); let reviewStatus;
    if (status === 'preserved') { const item = await ensure(reviewPath, expectedReview); reviewStatus = item.action === 'write' ? 'written' : reviewInput.bytes.toString('utf8') === expectedReview ? 'unchanged' : 'preserved-customized'; }
    else if (reviewInput.kind === 'missing') reviewStatus = 'absent';
    else if (reviewInput.bytes.toString('utf8') === expectedReview) { await operation(reviewPath, 'remove'); reviewStatus = 'removed'; }
    else { await operation(reviewPath, 'preserve'); reviewStatus = 'preserved_modified'; }
    canonicalAssetResults.push({ path: relative, status, reviewPath, reviewStatus });
    if (['written', 'migrated'].includes(status)) repairs.push(relative); if (reviewStatus === 'written') repairs.push(reviewPath);
  }
  for (const [relative, content] of [['.harness/events.jsonl', ''], ['.harness/evidence/.gitkeep', ''], ['.harness/credentials-state.json', jsonBytes({ version: 1, cursors: {} })]]) {
    if ((await ensure(relative, content)).action === 'write') repairs.push(relative);
  }
  for (const surface of AGENT_SURFACES.filter(surface => surface.id === 'codex' || enabled.includes(surface.id))) {
    const before = await read(surface.path);
    if (before.kind === 'missing') { await operation(surface.path, 'write', await asset(surface.template, { PROJECT_PURPOSE: config.project?.purpose ?? '' }), 'written'); repairs.push(surface.path); }
    else if (!surface.routed(before.bytes.toString('utf8'))) {
      const relative = '.harness/' + path.basename(surface.addition, '.template'); if ((await ensure(relative, await asset(surface.addition))).action === 'write') repairs.push(relative);
    }
  }
  for (const [surface, platform] of [[CODEX_HOOK_SURFACE, 'codex'], [CLAUDE_HOOK_SURFACE, 'claude']].filter(([, platform]) => enabled.includes(platform))) {
    const replacements = {};
    for (const [key, name] of [['PRECOMPACT', 'precompact-handoff.mjs'], ['SESSIONSTART', 'sessionstart-routing.mjs'], ['IDENTITY', 'claude-worker-identity.mjs']]) {
      replacements[key + '_COMMAND'] = replacements[key + '_WINDOWS_COMMAND'] = JSON.stringify(hookLauncher(name, platform));
    }
    const canonical = await asset(surface.template, replacements);
    const before = await read(surface.path), current = before.bytes?.toString('utf8'), upgraded = current && upgradeKnownHookCommands(current, platform, canonical);
    const routed = before.kind === 'missing' || surface.routed(upgraded || current);
    if (before.kind === 'missing' || (upgraded && surface.routed(upgraded))) { await operation(surface.path, 'write', upgraded || canonical, 'written'); repairs.push(surface.path); }
    const addition = '.harness/' + path.basename(surface.addition, '.template'), expected = await asset(surface.addition, replacements);
    if (!routed) {
      const input = await read(addition);
      const known = input.kind === 'file' && isKnownHookAddition(input.bytes.toString('utf8'), expected);
      const item = known ? await operation(addition, 'write', expected, 'written') : await ensure(addition, expected);
      if (item.action === 'write') repairs.push(addition);
    }
    else {
      const input = await read(addition);
      if (input.kind === 'file') {
        const known = isKnownHookAddition(input.bytes.toString('utf8'), expected);
        await operation(addition, known ? 'remove' : 'preserve');
      }
    }
  }
  await operation(MANAGED_INVENTORY_PATH, 'write', jsonBytes(inventory), 'written');
  operations.sort((left, right) => left.path.localeCompare(right.path));
  const readSet = [...inputs].map(([path, value]) => ({ path, kind: value.kind, hash: value.hash })).sort((a, b) => a.path.localeCompare(b.path));
  const sourceSet = [...sources].map(([path, value]) => ({ path, kind: value.kind, hash: value.hash })).sort((a, b) => a.path.localeCompare(b.path));
  const resultOperation = operations.find(item => item.path === '.harness/run.mjs');
  const plan = { target, version: HARNESS_VERSION, blocked: blockers.length > 0, blockers, operations, readSet, sourceSet, migrations, repairs, canonicalAssetResults,
    result: { path: path.join(target, '.harness/run.mjs'), status: resultOperation.action === 'write' ? 'written' : resultOperation.action === 'blocked' ? 'preserved' : 'unchanged' } };
  plan.planHash = stableHash(plan);
  return plan;
}

async function validateSyncPlan(plan) {
  for (const [rows, root] of [[plan.readSet, plan.target], [plan.sourceSet, ASSET_DIR]]) {
    for (const row of rows) {
      const current = await syncInput(path.join(root, row.path));
      if (current.kind !== row.kind || current.hash !== row.hash) throw new Error(`Stale sync plan input ${row.path}; sync left project files unchanged.`);
    }
  }
}

export async function syncHarness(root, options = {}) {
  const plan = await planSync(root, options);
  if (options.preview) return plan;
  if (options.expectedPlanHash !== undefined && options.expectedPlanHash !== plan.planHash) throw new Error('Stale expected sync plan hash; sync left project files unchanged.');
  if (plan.blocked) throw new Error(`Sync blocked by customized executable(s): ${plan.blockers.map(item => item.path).join(', ')}. Run sync --preview --json and review narrow --replace-reviewed PATH=SHA256 replacements.`);
  return withStateLock(path.join(plan.target, '.harness'), 'sync', async () => {
    await validateSyncPlan(plan);
    for (const item of plan.operations) {
      const destination = path.join(plan.target, item.path);
      if (item.action === 'write') await atomicWrite(destination, item.bytes);
      else if (item.action === 'remove') await unlink(destination);
    }
    return plan;
  });
}

function normalizeRelative(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

function migrateConfig(config, profile) {
  const selectedAgents = Array.isArray(config.agents?.enabled) ? config.agents.enabled : AGENT_SURFACES.map(surface => surface.id);
  const defaultInstructions = Object.fromEntries(AGENT_SURFACES.filter(surface => selectedAgents.includes(surface.id)).map(surface => [surface.id, surface.path]));
  const { requireCleanHandoff: _legacyCleanHandoff, ...existingPolicies } = config.policies ?? {};
  const { mode: existingContinuityMode, ...existingContinuity } = config.continuity ?? {};
  const continuityMode = existingContinuityMode === undefined || existingContinuityMode === 'fresh_task'
    ? 'orchestrated_worker'
    : existingContinuityMode;
  const verification = {
    quick: [],
    full: [],
    e2e: [],
    architecture: [],
    clean: [],
    ...(config.verification ?? {})
  };
  return {
    ...config,
    version: STATE_SCHEMA_VERSION,
    policies: {
      wipLimit: 1,
      maxAttempts: 3,
      maxRepeatedFailures: 2,
      commandTimeoutMs: 600000,
      passingIsTerminal: true,
      requireEvidence: true,
      ...existingPolicies
    },
    verification,
    completion: {
      baseLayers: ['full'],
      alwaysRunWhenConfigured: ['quick', 'architecture'],
      requireAcceptanceCommands: true,
      ...(config.completion ?? {})
    },
    execution: {
      harnessRuntime: { command: 'node', minimumMajorVersion: 20 },
      packageManager: profile.packageManager,
      setup: [],
      start: [],
      health: [],
      shutdown: [],
      ...(config.execution ?? {}),
      harnessRuntime: {
        command: 'node',
        minimumMajorVersion: 20,
        ...(config.execution?.harnessRuntime ?? {})
      }
    },
    scope: {
      enforcement: 'required',
      defaultAllow: ['**/*'],
      defaultDeny: DEFAULT_DENY,
      ...(config.scope ?? {})
    },
    continuity: {
      mode: continuityMode,
      dirtyWorktree: 'record',
      blockMutationsAfterHandoff: true,
      ...existingContinuity
    },
    security: {
      environmentAllow: DEFAULT_ENVIRONMENT_ALLOW,
      redactOutput: true,
      ...(config.security ?? {}),
      credentials: {
        stateFile: '.harness/credentials-state.json',
        ...(config.security?.credentials ?? {}),
        providers: Object.fromEntries(Object.entries({
          ...DEFAULT_CREDENTIAL_PROVIDERS,
          ...(config.security?.credentials?.providers ?? {})
        }).map(([name, provider]) => [name, {
          ...(DEFAULT_CREDENTIAL_PROVIDERS[name] ?? {}),
          ...provider
        }]))
      }
    },
    agents: {
      enabled: selectedAgents,
      instructions: defaultInstructions,
      ...(config.agents ?? {}),
      instructions: {
        ...defaultInstructions,
        ...(config.agents?.instructions ?? {})
      }
    },
    docs: {
      required: [],
      router: '.harness/docs-map.md',
      ...(config.docs ?? {})
    }
  };
}

function migrateState(state, config) {
  const statusMap = {
    'not-started': 'not_started',
    'in-progress': 'active',
    done: 'passing'
  };
  const features = Array.isArray(state.features) ? state.features.map((feature) => ({
    ...feature,
    status: statusMap[feature.status] ?? feature.status,
    dependencies: Array.isArray(feature.dependencies) ? feature.dependencies : [],
    requiredLayers: Array.isArray(feature.requiredLayers)
      ? feature.requiredLayers
      : unique(['full', feature.verificationLevel]),
    scope: {
      ...(feature.scope ?? {}),
      allow: Array.isArray(feature.scope?.allow) && feature.scope.allow.length
        ? feature.scope.allow
        : config.scope.defaultAllow,
      deny: Array.isArray(feature.scope?.deny) ? feature.scope.deny : config.scope.defaultDeny
    },
    acceptance: Array.isArray(feature.acceptance) ? feature.acceptance : [],
    evidence: Array.isArray(feature.evidence) ? feature.evidence : [],
    blocker: feature.blocker ?? null,
    attempts: Number.isInteger(feature.attempts) ? feature.attempts : (Array.isArray(feature.evidence) ? feature.evidence.length : 0),
    repeatedFailures: Number.isInteger(feature.repeatedFailures) ? feature.repeatedFailures : 0,
    lastFailureFingerprint: feature.lastFailureFingerprint ?? null
  })) : [];
  return {
    ...state,
    version: STATE_SCHEMA_VERSION,
    revision: Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0,
    features
  };
}

function check(pass, message, severity = 'error') {
  return { pass: Boolean(pass), message, severity };
}

function validFeature(feature) {
  return feature
    && typeof feature.id === 'string'
    && typeof feature.title === 'string'
    && typeof feature.description === 'string'
    && STATES.includes(feature.status)
    && Array.isArray(feature.dependencies)
    && Array.isArray(feature.scope?.allow)
    && feature.scope.allow.length > 0
    && Array.isArray(feature.scope?.deny)
    && Array.isArray(feature.acceptance)
    && feature.acceptance.length > 0
    && feature.acceptance.every((item) =>
      typeof item.id === 'string'
      && typeof item.description === 'string'
      && typeof item.command === 'string'
      && item.command.trim().length > 0
      && (item.credentials === undefined || (Array.isArray(item.credentials) && item.credentials.every((provider) => typeof provider === 'string' && provider.trim())))
    );
}

async function lineCount(file) {
  return (await readText(file)).split(/\r?\n/).length;
}

function isPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function auditHarness(root) {
  const target = path.resolve(root);
  const harnessDir = path.join(target, '.harness');
  const configPath = path.join(harnessDir, 'config.json');
  const featuresPath = path.join(harnessDir, 'features.json');
  const continuityPath = path.join(harnessDir, 'continuity.json');
  const config = await exists(configPath).then((yes) => yes ? readJson(configPath).catch(() => null) : null);
  const features = await exists(featuresPath).then((yes) => yes ? readJson(featuresPath).catch(() => null) : null);
  const continuity = await exists(continuityPath).then((yes) => yes ? readJson(continuityPath).catch(() => null) : null);
  const enabledAgents = Array.isArray(config?.agents?.enabled) ? config.agents.enabled : AGENT_SURFACES.map((surface) => surface.id);
  const featureItems = Array.isArray(features?.features) ? features.features : [];
  const active = featureItems.filter((item) => item.status === 'active');
  const evidenceNames = await exists(path.join(harnessDir, 'evidence'))
    ? (await readdir(path.join(harnessDir, 'evidence'))).filter((name) => name.endsWith('.json'))
    : [];
  const verificationCommands = config
    ? Object.values(config.verification ?? {}).flat().filter((item) => typeof commandText(item) === 'string' && commandText(item).trim())
    : [];
  const configuredProviders = credentialProviders(config?.security);
  const requestedProviders = unique([
    ...Object.values(config?.verification ?? {}).flat().flatMap(commandCredentials),
    ...featureItems.flatMap((feature) => (Array.isArray(feature.acceptance) ? feature.acceptance : []).flatMap(commandCredentials))
  ]);
  const unknownRequestedProviders = requestedProviders.filter((provider) => !Object.hasOwn(configuredProviders, provider));
  const duplicateCredentialTargets = Object.values(configuredProviders)
    .map((provider) => provider?.targetEnvironment)
    .filter(Boolean)
    .filter((targetEnvironment, index, values) => values.indexOf(targetEnvironment) !== index);
  const credentialAllowlistOverlaps = credentialEnvironmentAllowOverlaps(config?.security);
  const evidenceIntegrity = [];
  const evidenceWarnings = [];
  for (const feature of featureItems.filter((item) => item.status === 'passing')) {
    const reference = feature.evidence?.at(-1);
    if (!reference) {
      evidenceIntegrity.push(`${feature.id}: passing without evidence reference`);
      continue;
    }
    const evidencePath = path.resolve(target, reference);
    if (!isPathInside(path.join(harnessDir, 'evidence'), evidencePath)) {
      evidenceIntegrity.push(`${feature.id}: evidence path escapes .harness/evidence`);
      continue;
    }
    const record = await exists(evidencePath).then((yes) => yes ? readJson(evidencePath).catch(() => null) : null);
    if (!record) {
      evidenceIntegrity.push(`${feature.id}: evidence is missing or invalid JSON`);
      continue;
    }
    const validation = validateEvidenceRecord(feature, record);
    evidenceIntegrity.push(...validation.errors);
    evidenceWarnings.push(...validation.warnings);
  }
  const instructionChecks = [];
  const instructionLineChecks = [];
  const instructionRouteChecks = [];
  const unresolvedInstructionAdditions = [];
  for (const agent of enabledAgents) {
    const surface = AGENT_SURFACES.find((candidate) => candidate.id === agent);
    const relative = config?.agents?.instructions?.[agent] ?? surface?.path;
    if (!surface || !relative) {
      instructionChecks.push(check(false, `Unknown agent surface is configured: ${agent}`));
      continue;
    }
    const instructionPath = path.join(target, relative);
    const present = await exists(instructionPath);
    const content = present ? await readText(instructionPath) : '';
    instructionChecks.push(check(present, `${agent} instructions exist at ${relative}`));
    instructionLineChecks.push(check(present && await lineCount(instructionPath) <= 200, `${agent} root guidance is at most 200 lines`));
    instructionRouteChecks.push(check(present && surface.routed(content), `${agent} instructions route to canonical harness guidance`));
    const additionPath = path.join(harnessDir, path.basename(surface.addition, '.template'));
    if (await exists(additionPath)) unresolvedInstructionAdditions.push(normalizeRelative(target, additionPath));
  }
  const runtimeText = await exists(path.join(harnessDir, 'run.mjs')).then((yes) => yes ? readText(path.join(harnessDir, 'run.mjs')) : '');
  const codexHookPath = path.join(target, CODEX_HOOK_SURFACE.path);
  const codexHookText = await exists(codexHookPath).then((yes) => yes ? readText(codexHookPath) : '');
  const codexHookAddition = path.join(harnessDir, path.basename(CODEX_HOOK_SURFACE.addition, '.template'));
  const unresolvedCanonicalAssetAdditions = [];
  for (const migration of CANONICAL_V5_ASSET_MIGRATIONS) {
    const reviewPath = path.join(harnessDir, migration.review);
    if (await exists(reviewPath)) unresolvedCanonicalAssetAdditions.push(normalizeRelative(target, reviewPath));
  }
  const missingDocs = [];
  for (const required of config?.docs?.required ?? []) if (!await exists(path.join(target, required))) missingDocs.push(required);

  const groups = {
    instructions: [
      ...instructionChecks,
      check(
        await exists(path.join(target, 'AGENTS.md'))
          && (await readText(path.join(target, 'AGENTS.md'))).includes(DEVELOPMENT_HARNESS_BOUNDARY),
        'Canonical AGENTS.md declares the Development-Harness Boundary'
      ),
      check(await exists(path.join(harnessDir, 'docs-map.md')), 'Documentation router exists'),
      ...instructionLineChecks,
      ...instructionRouteChecks,
      check(unresolvedInstructionAdditions.length === 0, unresolvedInstructionAdditions.length ? `Unresolved instruction additions: ${unresolvedInstructionAdditions.join(', ')}` : 'No unresolved instruction merge additions remain'),
      check(Boolean(config?.project?.purpose) && !String(config?.project?.purpose).includes('TODO:'), 'Project purpose is concrete'),
      check(Array.isArray(config?.docs?.required) && config.docs.required.length > 0, 'Required project docs are declared'),
      check(missingDocs.length === 0, missingDocs.length ? `Declared docs are missing: ${missingDocs.join(', ')}` : 'Declared project docs exist', 'warning')
    ],
    tools: [
      check(await exists(path.join(harnessDir, 'run.mjs')), 'Local deterministic runtime exists'),
      check(runtimeText.includes(`const HARNESS_RUNTIME_VERSION = ${HARNESS_VERSION};`), `Local runtime is v${HARNESS_VERSION}`),
      check(Array.isArray(config?.security?.environmentAllow), 'Command environment allowlist is declared'),
      check(
        credentialAllowlistOverlaps.length === 0,
        credentialAllowlistOverlaps.length
          ? `Remove credential provider source and target environment names from security.environmentAllow and request providers explicitly per command: ${credentialAllowlistOverlaps.join(', ')}`
          : 'Credential provider environments are excluded from the ordinary command allowlist'
      ),
      check(Object.values(credentialProviders(config?.security)).every(validCredentialProvider), 'Credential providers are explicit environment-backed pools'),
      check(unknownRequestedProviders.length === 0, unknownRequestedProviders.length ? `Commands request unknown credential providers: ${unknownRequestedProviders.join(', ')}` : 'Every requested credential provider is configured'),
      check(duplicateCredentialTargets.length === 0, duplicateCredentialTargets.length ? `Credential target environments are duplicated: ${unique(duplicateCredentialTargets).join(', ')}` : 'Credential target environments are unique'),
      check(config?.security?.credentials?.stateFile === '.harness/credentials-state.json', 'Credential rotation state is repository-local and non-secret'),
      check(await exists(path.join(harnessDir, 'credentials-state.json')), 'Credential rotation state exists'),
      check(Number(config?.policies?.commandTimeoutMs) > 0, 'Command timeout is explicit'),
      check(['required', 'disabled'].includes(config?.scope?.enforcement), 'Scope enforcement mode is explicit'),
      check(await exists(path.join(harnessDir, 'events.jsonl')), 'Lifecycle event journal exists')
    ],
    environment: [
      check(Boolean(config?.execution), 'Execution profile exists'),
      check(Array.isArray(config?.agents?.enabled) && config.agents.enabled.length > 0, 'Coding-agent instruction surfaces are declared'),
      check(config?.execution?.harnessRuntime?.command === 'node', 'Harness runtime is declared'),
      check(Number(config?.execution?.harnessRuntime?.minimumMajorVersion) >= 20, 'Minimum harness runtime version is declared'),
      check(Boolean(config?.project?.stack), 'Project stack is declared'),
      check(Array.isArray(config?.execution?.setup) && Array.isArray(config?.execution?.start) && Array.isArray(config?.execution?.health), 'Setup/start/health surfaces are declared')
    ],
    state: [
      check(Boolean(config), 'config.json is valid JSON'),
      check(Boolean(features), 'features.json is valid JSON'),
      check(Boolean(continuity), 'continuity.json is valid JSON'),
      check(featureItems.every(validFeature), 'Every feature has the required typed fields'),
      check(config?.version === STATE_SCHEMA_VERSION && features?.version === STATE_SCHEMA_VERSION, 'Harness state schema versions are supported'),
      check(continuity?.version === 1 && ['working', 'awaiting_resume'].includes(continuity?.phase), 'Continuity state schema and phase are supported'),
      check(Number.isInteger(continuity?.generation) && continuity.generation > 0, 'Continuity generation is monotonic'),
      check(continuity?.phase !== 'awaiting_resume' || Boolean(continuity?.handoff?.id), 'Awaiting-resume state has a handoff capsule'),
      check(continuity?.phase !== 'awaiting_resume' || continuity?.handoff?.featureRevision === features?.revision, 'Pending handoff matches the current feature revision'),
      check(Number(features?.revision ?? 0) === 0 || continuity?.checkpoint?.featureRevision === features?.revision, 'Progress checkpoint matches the current feature revision', 'warning'),
      check(Number.isInteger(features?.revision) && features.revision >= 0, 'Feature revision is monotonic state'),
      check(active.length <= Number(config?.policies?.wipLimit ?? 1), 'Active work respects the WIP limit'),
      check(evidenceIntegrity.length === 0, evidenceIntegrity.length ? evidenceIntegrity.join('; ') : 'Passing evidence chains are valid'),
      check(evidenceWarnings.length === 0, evidenceWarnings.length ? evidenceWarnings.join('; ') : 'Evidence uses current provenance schemas', 'warning'),
      check(await exists(path.join(harnessDir, 'progress.md')), 'Progress state exists')
    ],
    feedback: [
      check(verificationCommands.length > 0, 'At least one project verification command is configured'),
      check((config?.verification?.full?.length ?? 0) > 0, 'Full completion gate is configured'),
      check(Array.isArray(config?.completion?.baseLayers) && config.completion.baseLayers.includes('full'), 'Completion requires the full layer'),
      check(config?.completion?.requireAcceptanceCommands === true, 'Behavior-specific acceptance commands are required'),
      check(Boolean(config?.policies?.requireEvidence), 'Evidence is required by policy'),
      check(evidenceNames.length > 0, 'At least one evidence record exists', 'warning')
    ],
    scope: [
      check(Number(config?.policies?.wipLimit) >= 1, 'WIP limit is explicit'),
      check(config?.scope?.enforcement === 'required', 'Scope enforcement fails closed'),
      check(Array.isArray(config?.scope?.defaultAllow), 'Default allowed scope is declared'),
      check(Array.isArray(config?.scope?.defaultDeny), 'Default denied scope is declared'),
      check(featureItems.every((feature) => Array.isArray(feature.dependencies)), 'Feature dependencies are explicit'),
      check(featureItems.every((feature) => Array.isArray(feature.acceptance)), 'Feature acceptance criteria are explicit')
    ],
    lifecycle: [
      check(await exists(path.join(harnessDir, 'handoff.md')), 'Handoff state exists'),
      check(await exists(path.join(harnessDir, 'hooks', 'precompact-handoff.mjs')), 'Pre-compaction handoff adapter exists'),
      check(CODEX_HOOK_SURFACE.routed(codexHookText), 'Codex automatic compaction routes through the worker-handoff guard', 'warning'),
      check(!await exists(codexHookAddition), 'No unresolved Codex hook merge addition remains', 'warning'),
      check(!enabledAgents.includes('claude') || (await exists(path.join(harnessDir, 'hooks', 'claude-worker-identity.mjs')) && CLAUDE_HOOK_SURFACE.routed(await exists(path.join(target, '.claude', 'settings.json')) ? await readText(path.join(target, '.claude', 'settings.json')) : '') && !await exists(path.join(harnessDir, 'claude-hooks.addition.json'))), 'Claude identity and compaction hooks are merged; unique explicit worker-id remains the manual fallback', 'warning'),
      check(config?.continuity?.mode === 'orchestrated_worker', 'Continuity keeps the development orchestrator active while fresh workers consume handoffs'),
      check(config?.continuity?.dirtyWorktree === 'record', 'Dirty worktrees are recorded instead of blocking handoff'),
      check(config?.continuity?.blockMutationsAfterHandoff === true, 'Feature mutations stop after handoff'),
      check(await exists(path.join(harnessDir, 'quality.md')), 'Quality ledger exists'),
      check(await exists(path.join(harnessDir, 'loops', 'goal.md')), 'Goal loop template exists'),
      check(await exists(path.join(harnessDir, 'loops', 'checker.md')), 'Independent checker template exists'),
      check(
        unresolvedCanonicalAssetAdditions.length === 0,
        unresolvedCanonicalAssetAdditions.length
          ? `Review and merge canonical runtime-v6 asset additions: ${unresolvedCanonicalAssetAdditions.join(', ')}`
          : 'No canonical runtime-v6 asset additions remain unresolved',
        'warning'
      )
    ]
  };

  const subsystems = {};
  for (const [name, checks] of Object.entries(groups)) {
    const passed = checks.filter((item) => item.pass).length;
    subsystems[name] = { score: Math.round((passed / checks.length) * 100), passed, total: checks.length, checks };
  }
  const overall = Math.round(Object.values(subsystems).reduce((sum, item) => sum + item.score, 0) / Object.keys(subsystems).length);
  const ranked = Object.entries(subsystems).sort((a, b) => a[1].score - b[1].score);
  const bottleneck = ranked.every(([, item]) => item.score === 100) ? null : (ranked[0]?.[0] ?? null);
  const criticalFailures = Object.values(subsystems).flatMap((item) => item.checks).filter((item) => !item.pass && item.severity === 'error').length;
  return { version: HARNESS_VERSION, target, overall, bottleneck, criticalFailures, subsystems };
}

export function formatAudit(result) {
  const lines = [
    `Harness audit: ${result.target}`,
    `Overall: ${result.overall}/100`,
    `Candidate bottleneck: ${result.bottleneck ?? 'none'}`,
    `Critical structural failures: ${result.criticalFailures}`,
    ''
  ];
  for (const [name, subsystem] of Object.entries(result.subsystems)) {
    lines.push(`${name}: ${subsystem.score}/100 (${subsystem.passed}/${subsystem.total})`);
    for (const item of subsystem.checks) {
      lines.push(`  ${item.pass ? 'PASS' : item.severity === 'warning' ? 'WARN' : 'FAIL'} ${item.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
