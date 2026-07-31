import { access, copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(SCRIPT_DIR, '..', '..');
export const ASSET_DIR = path.join(SKILL_DIR, 'assets');
export const HARNESS_VERSION = 4;
export const STATE_SCHEMA_VERSION = 1;
export const STATES = ['not_started', 'active', 'blocked', 'passing'];
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
  },
  {
    id: 'claude',
    path: 'CLAUDE.md',
    template: 'CLAUDE.md.template',
    addition: 'CLAUDE.addition.md.template',
    routed: (content) => content.includes('@AGENTS.md') || (content.includes('.harness/config.json') && content.includes('.harness/features.json'))
  },
  {
    id: 'github-copilot',
    path: '.github/copilot-instructions.md',
    template: 'copilot-instructions.md.template',
    addition: 'copilot-instructions.addition.md.template',
    routed: (content) => content.includes('AGENTS.md') || (content.includes('.harness/config.json') && content.includes('.harness/features.json'))
  }
];
const CODEX_HOOK_SURFACE = {
  path: '.codex/hooks.json',
  template: 'codex-hooks.json.template',
  addition: 'codex-hooks.addition.json.template',
  routed: (content) => content.includes('.harness/hooks/precompact-handoff.mjs') && content.includes('PreCompact')
};

export function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const split = token.slice(2).split('=', 2);
    const key = split[0].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (split.length === 2) {
      parsed[key] = split[1];
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[key] = argv[index + 1];
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

async function copyAsset(name, target, { force = false, replacements = {} } = {}) {
  if (!force && await exists(target)) return { path: target, status: 'preserved' };
  let content = await readText(path.join(ASSET_DIR, name));
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  if (await exists(target) && await readText(target) === content) return { path: target, status: 'unchanged' };
  await atomicWrite(target, content);
  return { path: target, status: 'written' };
}

function runCommand(packageManager, script) {
  if (packageManager === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`;
  if (packageManager === 'yarn') return `yarn ${script}`;
  return `${packageManager} run ${script}`;
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

function initialContinuity() {
  return {
    version: 1,
    phase: 'working',
    generation: 1,
    startedAt: new Date().toISOString(),
    resumedAt: null,
    checkpoint: null,
    handoff: null,
    lastHandoff: null
  };
}

function migrateContinuity(value) {
  const baseline = initialContinuity();
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

function commandText(entry) {
  return typeof entry === 'string' ? entry : entry?.command;
}

function commandCredentials(entry) {
  if (!entry || typeof entry === 'string' || entry.credentials === undefined) return [];
  return Array.isArray(entry.credentials) ? entry.credentials : [entry.credentials];
}

async function ensureAgentSurfaces(target, harnessDir, results, replacements = {}) {
  for (const surface of AGENT_SURFACES) {
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

async function ensureCodexHookSurface(target, harnessDir, results) {
  const destination = path.join(target, CODEX_HOOK_SURFACE.path);
  if (!await exists(destination)) {
    results.push(await copyAsset(CODEX_HOOK_SURFACE.template, destination));
    return;
  }
  const content = await readText(destination);
  if (!CODEX_HOOK_SURFACE.routed(content)) {
    results.push(await copyAsset(
      CODEX_HOOK_SURFACE.addition,
      path.join(harnessDir, path.basename(CODEX_HOOK_SURFACE.addition, '.template'))
    ));
  }
  results.push({ path: destination, status: 'preserved' });
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
  const projectPurpose = String(options.purpose || `Project harness for ${projectName}. Replace this sentence with the project's user-facing purpose.`);
  const commandsOverride = options.commands
    ? String(options.commands).split(',').map((item) => item.trim()).filter(Boolean)
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
      mode: 'fresh_task',
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
      enabled: AGENT_SURFACES.map((surface) => surface.id),
      instructions: Object.fromEntries(AGENT_SURFACES.map((surface) => [surface.id, surface.path]))
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
  results.push(await copyAsset('precompact-handoff.mjs', path.join(harnessDir, 'hooks', 'precompact-handoff.mjs'), { force: Boolean(options.force) }));

  await ensureAgentSurfaces(target, harnessDir, results, { PROJECT_PURPOSE: projectPurpose });
  await ensureCodexHookSurface(target, harnessDir, results);

  await atomicWrite(path.join(harnessDir, 'evidence', '.gitkeep'), '');
  if (!await exists(path.join(harnessDir, 'credentials-state.json'))) {
    await writeJson(path.join(harnessDir, 'credentials-state.json'), { version: 1, cursors: {} });
  }
  if (!await exists(path.join(harnessDir, 'events.jsonl'))) {
    await atomicWrite(path.join(harnessDir, 'events.jsonl'), '');
  }
  return { target, profile, verification, results };
}

export async function syncHarness(root) {
  const target = path.resolve(root);
  const harnessDir = path.join(target, '.harness');
  const configPath = path.join(harnessDir, 'config.json');
  const featuresPath = path.join(harnessDir, 'features.json');
  const continuityPath = path.join(harnessDir, 'continuity.json');
  if (!await exists(configPath) || !await exists(featuresPath)) {
    throw new Error(`No harness found at ${target}. Run init first.`);
  }
  if (await exists(path.join(harnessDir, 'state.lock'))) {
    throw new Error(`Harness state is locked at ${target}. Wait for the active operation before syncing.`);
  }
  const profile = await detectProject(target);
  const originalConfig = await readJson(configPath);
  const originalState = await readJson(featuresPath);
  const originalContinuity = await exists(continuityPath) ? await readJson(continuityPath) : null;
  const config = migrateConfig(originalConfig, profile);
  const state = migrateState(originalState, config);
  const continuity = migrateContinuity(originalContinuity);
  const migrations = [];
  if (stableHash(config) !== stableHash(originalConfig)) {
    await writeJson(configPath, config);
    migrations.push('.harness/config.json');
  }
  if (stableHash(state) !== stableHash(originalState)) {
    await writeJson(featuresPath, state);
    migrations.push('.harness/features.json');
  }
  if (stableHash(continuity) !== stableHash(originalContinuity)) {
    await writeJson(continuityPath, continuity);
    migrations.push('.harness/continuity.json');
  }
  const repairs = [];
  await mkdir(path.join(harnessDir, 'evidence'), { recursive: true });
  await mkdir(path.join(harnessDir, 'loops'), { recursive: true });
  await mkdir(path.join(harnessDir, 'hooks'), { recursive: true });
  const supportAssets = [
    ['progress.md', path.join(harnessDir, 'progress.md'), {}],
    ['handoff.md', path.join(harnessDir, 'handoff.md'), {}],
    ['quality.md', path.join(harnessDir, 'quality.md'), {}],
    ['docs-map.md.template', path.join(harnessDir, 'docs-map.md'), { replacements: { PROJECT_NAME: config.project?.name ?? path.basename(target) } }],
    ['goal.md', path.join(harnessDir, 'loops', 'goal.md'), {}],
    ['maker.md', path.join(harnessDir, 'loops', 'maker.md'), {}],
    ['checker.md', path.join(harnessDir, 'loops', 'checker.md'), {}],
    ['precompact-handoff.mjs', path.join(harnessDir, 'hooks', 'precompact-handoff.mjs'), {}]
  ];
  for (const [asset, destination, options] of supportAssets) {
    const repaired = await copyAsset(asset, destination, options);
    if (repaired.status === 'written') repairs.push(normalizeRelative(target, destination));
  }
  const eventsPath = path.join(harnessDir, 'events.jsonl');
  if (!await exists(eventsPath)) {
    await atomicWrite(eventsPath, '');
    repairs.push('.harness/events.jsonl');
  }
  const keepPath = path.join(harnessDir, 'evidence', '.gitkeep');
  if (!await exists(keepPath)) {
    await atomicWrite(keepPath, '');
    repairs.push('.harness/evidence/.gitkeep');
  }
  const credentialStatePath = path.join(harnessDir, 'credentials-state.json');
  if (!await exists(credentialStatePath)) {
    await writeJson(credentialStatePath, { version: 1, cursors: {} });
    repairs.push('.harness/credentials-state.json');
  }
  const instructionResults = [];
  await ensureAgentSurfaces(target, harnessDir, instructionResults, { PROJECT_PURPOSE: config.project?.purpose ?? '' });
  await ensureCodexHookSurface(target, harnessDir, instructionResults);
  for (const instruction of instructionResults) {
    if (instruction.status === 'written') repairs.push(normalizeRelative(target, instruction.path));
  }
  const result = await copyAsset('project-runtime.mjs', path.join(harnessDir, 'run.mjs'), { force: true });
  return { target, version: HARNESS_VERSION, result, migrations, repairs };
}

function normalizeRelative(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

function migrateConfig(config, profile) {
  const { requireCleanHandoff: _legacyCleanHandoff, ...existingPolicies } = config.policies ?? {};
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
      mode: 'fresh_task',
      dirtyWorktree: 'record',
      blockMutationsAfterHandoff: true,
      ...(config.continuity ?? {})
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
      enabled: AGENT_SURFACES.map((surface) => surface.id),
      instructions: Object.fromEntries(AGENT_SURFACES.map((surface) => [surface.id, surface.path])),
      ...(config.agents ?? {}),
      instructions: {
        ...Object.fromEntries(AGENT_SURFACES.map((surface) => [surface.id, surface.path])),
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
    if (!record) evidenceIntegrity.push(`${feature.id}: evidence is missing or invalid JSON`);
    else if (record.featureId !== feature.id) evidenceIntegrity.push(`${feature.id}: evidence belongs to ${record.featureId}`);
    else if (record.pass !== true) evidenceIntegrity.push(`${feature.id}: latest evidence did not pass`);
    else if (!Array.isArray(record.commands) || record.commands.length === 0 || record.commands.some((item) => item.exitCode !== 0)) {
      evidenceIntegrity.push(`${feature.id}: evidence lacks successful commands`);
    }
    else if (Number(record.schemaVersion ?? 1) >= 2 && record.contractHash !== stableHash(featureContract(feature))) evidenceIntegrity.push(`${feature.id}: contract and evidence do not match`);
    else if (Number(record.schemaVersion ?? 1) >= 2 && !record.configHash) evidenceIntegrity.push(`${feature.id}: evidence lacks config provenance`);
    else if (Number(record.schemaVersion ?? 1) < 2) evidenceWarnings.push(`${feature.id}: legacy evidence predates frozen-contract and config provenance`);
    else if (Number(record.harnessVersion ?? 1) >= 2 && !record.verificationHash) evidenceIntegrity.push(`${feature.id}: evidence lacks verification-plan provenance`);
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
  const missingDocs = [];
  for (const required of config?.docs?.required ?? []) if (!await exists(path.join(target, required))) missingDocs.push(required);

  const groups = {
    instructions: [
      ...instructionChecks,
      check(await exists(path.join(harnessDir, 'docs-map.md')), 'Documentation router exists'),
      ...instructionLineChecks,
      ...instructionRouteChecks,
      check(unresolvedInstructionAdditions.length === 0, unresolvedInstructionAdditions.length ? `Unresolved instruction additions: ${unresolvedInstructionAdditions.join(', ')}` : 'No unresolved instruction merge additions remain'),
      check(Boolean(config?.project?.purpose) && !String(config?.project?.purpose).includes('Replace this sentence'), 'Project purpose is concrete'),
      check(Array.isArray(config?.docs?.required) && config.docs.required.length > 0, 'Required project docs are declared'),
      check(missingDocs.length === 0, missingDocs.length ? `Declared docs are missing: ${missingDocs.join(', ')}` : 'Declared project docs exist', 'warning')
    ],
    tools: [
      check(await exists(path.join(harnessDir, 'run.mjs')), 'Local deterministic runtime exists'),
      check(runtimeText.includes(`const HARNESS_RUNTIME_VERSION = ${HARNESS_VERSION};`), `Local runtime is v${HARNESS_VERSION}`),
      check(Array.isArray(config?.security?.environmentAllow), 'Command environment allowlist is declared'),
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
      check(CODEX_HOOK_SURFACE.routed(codexHookText), 'Codex automatic compaction routes through the fresh-task handoff guard', 'warning'),
      check(!await exists(codexHookAddition), 'No unresolved Codex hook merge addition remains', 'warning'),
      check(config?.continuity?.mode === 'fresh_task', 'Continuity requires a fresh task after handoff'),
      check(config?.continuity?.dirtyWorktree === 'record', 'Dirty worktrees are recorded instead of blocking handoff'),
      check(config?.continuity?.blockMutationsAfterHandoff === true, 'Feature mutations stop after handoff'),
      check(await exists(path.join(harnessDir, 'quality.md')), 'Quality ledger exists'),
      check(await exists(path.join(harnessDir, 'loops', 'goal.md')), 'Goal loop template exists'),
      check(await exists(path.join(harnessDir, 'loops', 'checker.md')), 'Independent checker template exists')
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
