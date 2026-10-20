// Agent Harness Kit library: init, sync (including v6 -> v7 migration), audit.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(SCRIPT_DIR, '..', '..');
export const ASSET_DIR = path.join(SKILL_DIR, 'assets');
export const HARNESS_VERSION = 7;
export { parseArgs } from '../../assets/project-runtime.mjs';

const BLOCK_START = '<!-- agent-harness-v7 -->';
const BLOCK_END = '<!-- /agent-harness-v7 -->';
const HOOK_MARKER = 'AGENT_HARNESS_HOOK_V7';
// Readable launcher: find the nearest .harness from the hook's cwd and run its
// PreCompact adapter. Missing harness or any error is a no-op ('{}').
export const PRECOMPACT_COMMAND = `node -e "/*${HOOK_MARKER}*/const p=require('path'),f=require('fs');let d=process.cwd();for(;;){const h=p.join(d,'.harness','hooks','precompact.mjs');if(f.existsSync(h)){import(require('url').pathToFileURL(h).href).catch(()=>process.stdout.write('{}'));break}const u=p.dirname(d);if(u===d){process.stdout.write('{}');break}d=u}"`;
const LEGACY_HOOK = /HARNESS_HOOK_LAUNCHER|context-guard|native-hook-dispatch|precompact-handoff|sessionstart-routing|claude-worker-identity|\.harness[\\/]+hooks|agent-harness/;
const DEFAULT_ENV = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CI', 'NODE_ENV'];
const DEFAULT_DENY = ['.git/**', '.env', '.env.*', '**/node_modules/**', '**/dist/**', '**/build/**'];
const DEFAULT_PROVIDERS = {
  openai: { targetEnvironment: 'OPENAI_API_KEY', sources: ['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'OPENAI_API_KEY_4'], selection: 'round_robin' },
  anthropic: { targetEnvironment: 'ANTHROPIC_API_KEY', sources: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_2', 'ANTHROPIC_API_KEY_3', 'ANTHROPIC_API_KEY_4'], selection: 'round_robin' }
};
const SURFACES = {
  codex: { path: 'AGENTS.md', template: 'AGENTS.md.template' },
  claude: { path: 'CLAUDE.md', template: 'CLAUDE.md.template' },
  'github-copilot': { path: '.github/copilot-instructions.md', template: 'copilot-instructions.md.template' }
};
const MANAGED = [
  ['project-runtime.mjs', 'run.mjs'],
  ['precompact.mjs', 'hooks/precompact.mjs']
];
const LOOPS = [['goal.md', 'loops/goal.md'], ['maker.md', 'loops/maker.md'], ['checker.md', 'loops/checker.md']];
// Runtime-v6 machinery removed by v7 sync.
const LEGACY_FILES = [
  'context-budget.mjs', 'windows-command.mjs', 'windows-command-supervisor.ps1', 'repair.mjs', 'managed-files.json',
  'codex-context-config.addition.toml', 'codex-hooks.addition.json', 'claude-hooks.addition.json',
  'AGENTS.addition.md', 'CLAUDE.addition.md', 'copilot-instructions.addition.md', 'docs-map.v6.addition.md',
  'loops/goal.v6.addition.md', 'loops/maker.v6.addition.md', 'loops/checker.v6.addition.md',
  'hooks/context-guard.mjs', 'hooks/hook-recovery.mjs', 'hooks/native-hook-dispatch.mjs', 'hooks/native-hook-identity.mjs',
  'hooks/precompact-handoff.mjs', 'hooks/sessionstart-routing.mjs', 'hooks/claude-worker-identity.mjs',
  'hooks/native-hook-bootstrap-v1.json', 'hooks/native-hook-bootstrap-v2.json', 'hooks/native-hook-bootstrap-v3.json'
];
const LEGACY_DIRS = ['context', 'history/progress', 'tmp', 'state.lock'];
// What a v7 .harness keeps when sync --prune removes ad-hoc artifacts.
const KEEP = new Set(['config.json', 'features.json', 'continuity.json', 'events.jsonl', 'progress.md', 'handoff.md', 'docs-map.md', 'quality.md',
  'credentials-state.json', 'run.mjs', 'hooks', 'loops', 'evidence', 'baselines', 'logs', '.gitignore', '.lock']);
const LEGACY_SECTIONS = ['Orchestrated-Worker Protocol', 'Development-Harness Boundary', 'Bounded worker startup and ownership',
  'Proactive context management', 'Orchestrated worker continuity', 'Development harness', 'Claude Code harness workers'];

const read = target => readFileSync(target, 'utf8');
const readJson = target => JSON.parse(read(target));
const asset = name => read(path.join(ASSET_DIR, name));
function write(target, content) { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, content); }
const writeJson = (target, value) => write(target, `${JSON.stringify(value, null, 2)}\n`);
const unique = values => [...new Set(values)];
const render = (text, values) => text.replace(/{{([A-Z_]+)}}/g, (match, key) => values[key] ?? match);

export function detectProject(root) {
  const names = new Set(readdirSync(root));
  let stack = 'generic', packageManager = null, packageJson = null;
  if (names.has('package.json')) {
    packageJson = readJson(path.join(root, 'package.json'));
    packageManager = names.has('pnpm-lock.yaml') ? 'pnpm' : names.has('yarn.lock') ? 'yarn' : names.has('bun.lock') || names.has('bun.lockb') ? 'bun' : 'npm';
    stack = { ...packageJson.dependencies, ...packageJson.devDependencies }.typescript ? 'typescript' : 'node';
  } else if (names.has('pyproject.toml') || names.has('requirements.txt')) stack = 'python';
  else if (names.has('go.mod')) stack = 'go';
  else if (names.has('Cargo.toml')) stack = 'rust';
  else if (names.has('pom.xml')) stack = 'java-maven';
  else if (names.has('build.gradle') || names.has('build.gradle.kts')) stack = 'java-gradle';
  else if ([...names].some(name => name.endsWith('.sln') || name.endsWith('.csproj'))) stack = 'dotnet';
  return { names, stack, packageManager, packageJson };
}

export function detectVerification(profile) {
  const v = { quick: [], full: [], e2e: [], architecture: [], clean: [] };
  if (profile.packageJson) {
    const scripts = profile.packageJson.scripts ?? {};
    const run = name => scripts[name] ? (profile.packageManager === 'npm' ? (name === 'test' ? 'npm test' : `npm run ${name}`) : `${profile.packageManager} run ${name}`) : null;
    v.quick = unique([run('check'), run('typecheck'), run('type-check'), run('lint')].filter(Boolean));
    v.full = unique([run('test'), run('build')].filter(Boolean));
    v.e2e = unique([run('test:e2e'), run('e2e')].filter(Boolean));
    v.architecture = unique([run('check:architecture'), run('architecture')].filter(Boolean));
    return v;
  }
  const full = { python: 'python -m pytest', go: 'go test ./...', rust: 'cargo test', 'java-maven': 'mvn test', 'java-gradle': './gradlew test', dotnet: 'dotnet test' }[profile.stack];
  if (full) v.full = [full];
  if (profile.stack === 'python') v.quick = ['python -m compileall -q .'];
  return v;
}

function parseAgents(value) {
  const agents = value === undefined || value === true ? Object.keys(SURFACES) : String(value).split(',').map(s => s.trim()).filter(Boolean);
  for (const agent of agents) if (!SURFACES[agent]) throw new Error(`Unknown agent ${agent}; use ${Object.keys(SURFACES).join(', ')}`);
  return agents;
}

function baseConfig(root, options, profile) {
  const name = String(options.name || profile.packageJson?.name || path.basename(root));
  const agents = parseAgents(options.agents);
  const verification = detectVerification(profile);
  if (options.commands) verification.full = String(options.commands).split(',').map(s => s.trim()).filter(Boolean);
  const docs = ['README.md', 'docs/ARCHITECTURE.md'].filter(doc => existsSync(path.join(root, doc)));
  return {
    version: 1, harnessVersion: HARNESS_VERSION,
    project: { name, purpose: String(options.purpose || `TODO: describe what ${name} does for its users.`), stack: profile.stack },
    policies: { wipLimit: Number(options.wipLimit || 1), maxAttempts: Number(options.maxAttempts || 5), maxRepeatedFailures: Number(options.maxRepeatedFailures || 2), commandTimeoutMs: Number(options.commandTimeoutMs || 600000) },
    verification,
    completion: { baseLayers: ['full'], alwaysRunWhenConfigured: ['quick'], requireAcceptanceCommands: true, commitOnPass: true },
    scope: { defaultAllow: ['**/*'], defaultDeny: DEFAULT_DENY },
    continuity: { mode: 'orchestrated_worker' },
    security: { environmentAllow: DEFAULT_ENV, redactOutput: true, credentials: { stateFile: '.harness/credentials-state.json', providers: DEFAULT_PROVIDERS } },
    agents: { enabled: agents, instructions: Object.fromEntries(agents.map(agent => [agent, SURFACES[agent].path])) },
    docs: { required: docs, router: '.harness/docs-map.md' }
  };
}

function git(root, args) { return spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); }

// ------------------------------------------------------------------ init

export function initHarness(rootArg, options = {}) {
  const root = path.resolve(rootArg ?? '.');
  mkdirSync(root, { recursive: true });
  const h = path.join(root, '.harness');
  if (existsSync(path.join(h, 'config.json')) && !options.force) throw new Error(`${root} already has .harness/config.json; use sync to upgrade.`);
  const profile = detectProject(root);
  const config = baseConfig(root, options, profile);
  const actions = [];
  const created = (relative, content) => { write(path.join(root, relative), content); actions.push(`create ${relative}`); };
  created('.harness/config.json', `${JSON.stringify(config, null, 2)}\n`);
  created('.harness/features.json', `${JSON.stringify({ version: 1, revision: 0, features: [] }, null, 2)}\n`);
  created('.harness/continuity.json', `${JSON.stringify({ version: 1, phase: 'working', generation: 1, startedAt: new Date().toISOString(), checkpoint: null, handoff: null, owner: null }, null, 2)}\n`);
  created('.harness/events.jsonl', '');
  created('.harness/progress.md', '# Progress\n\nNo checkpoint recorded yet. Start with `node .harness/run.mjs session`.\n');
  created('.harness/handoff.md', '# Worker Handoff\n\nNo handoff is pending.\n');
  created('.harness/docs-map.md', render(asset('docs-map.md.template'), { PROJECT_NAME: config.project.name }));
  created('.harness/quality.md', asset('quality.md'));
  mkdirSync(path.join(h, 'evidence'), { recursive: true });
  applyManaged(root, actions, { force: true });
  const sync = syncSurfaces(root, config, actions);
  return { root, config, actions, warnings: sync.warnings };
}

// ------------------------------------------------------------------ sync

function applyManaged(root, actions, { force = false } = {}) {
  const h = path.join(root, '.harness');
  for (const [source, relative] of MANAGED) {
    const target = path.join(h, relative);
    const content = asset(source);
    const present = existsSync(target);
    if (present && read(target) === content) continue;
    write(target, content);
    actions.push(`${present ? 'update' : 'create'} .harness/${relative}`);
  }
  for (const [source, relative] of LOOPS) {
    const target = path.join(h, relative);
    const content = asset(source);
    if (existsSync(target)) {
      const current = read(target);
      if (current === content) continue;
      // Replace only the canonical v6 loop text; keep customized loops.
      if (!force && !/ORCHESTRATED_WORKER_CONTINUITY_V1|## Bounded worker startup and ownership|Run `session`, reconstruct state/.test(current)) continue;
    }
    write(target, content);
    actions.push(`write .harness/${relative}`);
  }
  const ignore = path.join(h, '.gitignore');
  const wanted = ['logs/', '.lock/', '*.tmp'];
  const lines = existsSync(ignore) ? read(ignore).split(/\r?\n/).filter(Boolean) : [];
  const missing = wanted.filter(line => !lines.includes(line));
  if (missing.length) { write(ignore, `${[...lines, ...missing].join('\n')}\n`); actions.push('update .harness/.gitignore'); }
}

export function stripLegacySections(text) {
  let out = text.replace(/<!-- agent-harness-context-v1 -->[\s\S]*?<!-- \/agent-harness-context-v1 -->\n?/g, '');
  out = out.replace(new RegExp(`${escape(BLOCK_START)}[\\s\\S]*?${escape(BLOCK_END)}\\n?`, 'g'), '');
  const lines = out.split('\n');
  const kept = [];
  let skipping = null;
  for (const line of lines) {
    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (skipping && heading[1].length <= skipping) skipping = null;
      if (!skipping && LEGACY_SECTIONS.includes(heading[2])) { skipping = heading[1].length; continue; }
    }
    if (skipping) continue;
    if (/^Protocol marker: `ORCHESTRATED_WORKER_CONTINUITY_V1`\.?$/.test(line)) continue;
    if (/^Inherit and enforce the canonical `## Development-Harness Boundary`/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
}

function insertBlock(text, block) {
  // Place the harness block after the H1 and its intro paragraph.
  const lines = text.split('\n');
  let index = 0;
  if (/^# /.test(lines[0] ?? '')) {
    index = 1;
    while (index < lines.length && lines[index].trim() === '') index++;
    while (index < lines.length && lines[index].trim() !== '' && !/^#/.test(lines[index])) index++;
  } else if (/^@AGENTS\.md/.test(lines[0] ?? '')) index = 1;
  const before = lines.slice(0, index).join('\n').trimEnd();
  const after = lines.slice(index).join('\n').trim();
  return `${before ? `${before}\n\n` : ''}${block.trim()}\n${after ? `\n${after}\n` : ''}`;
}

function blockOf(text) {
  const start = text.indexOf(BLOCK_START), end = text.indexOf(BLOCK_END);
  return start < 0 || end < 0 ? '' : text.slice(start, end + BLOCK_END.length);
}

function syncInstruction(root, agent, config, actions) {
  const surface = SURFACES[agent];
  const target = path.join(root, surface.path);
  const block = agent === 'codex' ? asset('agents-block.md') : blockOf(asset(surface.template));
  if (!existsSync(target)) {
    write(target, render(asset(surface.template), { PROJECT_NAME: config.project.name, PROJECT_PURPOSE: config.project.purpose, HARNESS_BLOCK: block.trim() }));
    actions.push(`create ${surface.path}`);
    return;
  }
  const current = read(target).replace(/\r\n/g, '\n');
  let next = insertBlock(stripLegacySections(current), block);
  if (agent === 'claude' && !/^@AGENTS\.md/m.test(next)) next = `@AGENTS.md\n\n${next}`;
  if (next !== current) { write(target, next); actions.push(`update ${surface.path}`); }
}

function precompactGroup() {
  return { hooks: [{ type: 'command', command: PRECOMPACT_COMMAND, timeout: 30 }] };
}

export function cleanHooks(hooks = {}, enable) {
  const out = {};
  let removed = 0;
  for (const [event, groups] of Object.entries(hooks)) {
    const keptGroups = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      const commands = (group.hooks ?? []).filter(h => !(typeof h.command === 'string' && (LEGACY_HOOK.test(h.command) || h.command.includes(HOOK_MARKER))));
      removed += (group.hooks ?? []).length - commands.length;
      if (commands.length) keptGroups.push({ ...group, hooks: commands });
    }
    if (keptGroups.length) out[event] = keptGroups;
  }
  if (enable) out.PreCompact = [...(out.PreCompact ?? []), precompactGroup()];
  return { hooks: out, removed };
}

function syncHookFile(root, relative, enable, actions, warnings) {
  const target = path.join(root, relative);
  if (!existsSync(target) && !enable) return;
  let settings = {};
  if (existsSync(target)) {
    try { settings = readJson(target); } catch (error) { warnings.push(`${relative} is not valid JSON; left unchanged (${error.message})`); return; }
  }
  const { hooks, removed } = cleanHooks(settings.hooks, enable);
  const next = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  if (relative === '.codex/hooks.json' && next.description?.startsWith('Agent Harness')) next.description = 'Agent Harness v7: fail-open PreCompact progress note.';
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (existsSync(target) && read(target) === text) return;
  write(target, text);
  actions.push(`update ${relative}${removed ? ` (removed ${removed} legacy hook commands)` : ''}`);
}

function syncCodexConfig(root, enable, actions) {
  const target = path.join(root, '.codex', 'config.toml');
  if (!existsSync(target)) {
    if (!enable) return;
    write(target, '[features]\nhooks = true\n');
    actions.push('create .codex/config.toml');
    return;
  }
  const current = read(target);
  // v6 forced auto-compaction at 80k total tokens; remove only its generated defaults.
  let next = current
    .replace(/^# Agent Harness proactive context defaults; custom values are preserved\.\r?\n/m, '')
    .replace(/^model_auto_compact_token_limit = 80000\r?\n/m, '')
    .replace(/^model_auto_compact_token_limit_scope = "total"\r?\n/m, '');
  if (enable && !/^\s*hooks\s*=\s*true/m.test(next)) next = `${next.trimEnd()}\n\n[features]\nhooks = true\n`;
  if (next !== current) { write(target, next); actions.push('update .codex/config.toml'); }
}

function syncSurfaces(root, config, actions) {
  const warnings = [];
  const enabled = config.agents?.enabled ?? Object.keys(SURFACES);
  for (const agent of enabled) if (SURFACES[agent]) syncInstruction(root, agent, config, actions);
  syncHookFile(root, '.codex/hooks.json', enabled.includes('codex'), actions, warnings);
  syncHookFile(root, '.claude/settings.json', enabled.includes('claude'), actions, warnings);
  syncCodexConfig(root, enabled.includes('codex'), actions);
  return { warnings };
}

function migrateConfig(config) {
  const next = structuredClone(config);
  next.harnessVersion = HARNESS_VERSION;
  delete next.context;
  if (next.scope) { delete next.scope.capture; delete next.scope.enforcement; }
  next.continuity = { mode: 'orchestrated_worker' };
  next.completion = { baseLayers: ['full'], alwaysRunWhenConfigured: ['quick'], requireAcceptanceCommands: true, ...next.completion };
  next.completion.commitOnPass ??= true;
  if (next.policies) { delete next.policies.passingIsTerminal; delete next.policies.requireEvidence; }
  return next;
}

function migrateContinuity(continuity) {
  const next = structuredClone(continuity);
  delete next.retiredWorkerIds;
  delete next.lastRecovery;
  if (next.handoff) next.handoff.legacy = true;
  return next;
}

function referencedBaselines(h) {
  try {
    return new Set(readJson(path.join(h, 'features.json')).features.filter(f => f.status !== 'passing' && f.scopeBaselineRef?.path).map(f => path.basename(f.scopeBaselineRef.path)));
  } catch { return new Set(); }
}

// Record what sync rewrote on active features so their scope check does not
// attribute harness maintenance to the feature's own work.
function exemptSyncedPaths(h, actions, removals) {
  const featuresPath = path.join(h, 'features.json');
  if (!existsSync(featuresPath)) return;
  const touched = [...actions.map(a => a.split(' ')[1]), ...removals].filter(Boolean).map(p => p.endsWith('/') ? `${p}**` : p);
  if (!touched.length) return;
  const state = readJson(featuresPath);
  let changed = false;
  for (const feature of state.features ?? []) {
    if (feature.status !== 'active') continue;
    feature.syncedPaths = unique([...(feature.syncedPaths ?? []), ...touched]);
    changed = true;
  }
  if (changed) writeJson(featuresPath, state);
}

export function syncHarness(rootArg, options = {}) {
  const root = path.resolve(rootArg ?? '.');
  const h = path.join(root, '.harness');
  if (!existsSync(path.join(h, 'config.json'))) throw new Error(`${root} has no .harness/config.json; run init first.`);
  const actions = [], removals = [];
  const config = readJson(path.join(h, 'config.json'));
  const migrated = migrateConfig(config);
  const plan = { root, actions, removals, preview: Boolean(options.preview) };
  if (options.preview) {
    plan.note = 'Preview only; run without --preview to apply.';
    plan.legacy = LEGACY_FILES.filter(f => existsSync(path.join(h, f)));
    if (options.prune) plan.prune = readdirSync(h).filter(name => !KEEP.has(name));
    return plan;
  }
  if (JSON.stringify(migrated) !== JSON.stringify(config)) { writeJson(path.join(h, 'config.json'), migrated); actions.push('migrate .harness/config.json'); }
  const continuityPath = path.join(h, 'continuity.json');
  if (existsSync(continuityPath)) {
    const continuity = readJson(continuityPath);
    const next = migrateContinuity(continuity);
    if (JSON.stringify(next) !== JSON.stringify(continuity)) { writeJson(continuityPath, next); actions.push('migrate .harness/continuity.json'); }
  }
  applyManaged(root, actions);
  for (const relative of LEGACY_FILES) {
    const target = path.join(h, relative);
    if (existsSync(target)) { rmSync(target, { force: true }); removals.push(`.harness/${relative}`); }
  }
  for (const relative of LEGACY_DIRS) {
    const target = path.join(h, relative);
    if (existsSync(target)) { rmSync(target, { recursive: true, force: true }); removals.push(`.harness/${relative}/`); }
  }
  const logs = path.join(h, 'logs');
  if (existsSync(logs)) for (const name of readdirSync(logs)) if (/^tool-/.test(name)) rmSync(path.join(logs, name), { force: true });
  const baselines = path.join(h, 'baselines');
  if (existsSync(baselines)) {
    const keep = referencedBaselines(h);
    for (const name of readdirSync(baselines)) if (!keep.has(name)) rmSync(path.join(baselines, name), { force: true });
    if (!readdirSync(baselines).length) rmSync(baselines, { recursive: true, force: true });
  }
  if (options.prune) {
    if (existsSync(logs)) for (const name of readdirSync(logs)) rmSync(path.join(logs, name), { recursive: true, force: true });
    for (const name of readdirSync(h)) {
      if (KEEP.has(name)) continue;
      rmSync(path.join(h, name), { recursive: true, force: true });
      removals.push(`.harness/${name}`);
    }
  }
  const { warnings } = syncSurfaces(root, migrated, actions);
  exemptSyncedPaths(h, actions, removals);
  return { ...plan, warnings };
}

// ----------------------------------------------------------------- audit

export function auditHarness(rootArg) {
  const root = path.resolve(rootArg ?? '.');
  const h = path.join(root, '.harness');
  const checks = [];
  const check = (area, pass, message, weight = 1) => checks.push({ area, pass: Boolean(pass), message, weight });
  const has = relative => existsSync(path.join(root, relative));
  let config = null;
  try { config = readJson(path.join(h, 'config.json')); } catch {}
  check('instructions', has('AGENTS.md'), 'AGENTS.md exists', 3);
  const agents = has('AGENTS.md') ? read(path.join(root, 'AGENTS.md')) : '';
  check('instructions', agents.includes(BLOCK_START), 'AGENTS.md carries the v7 harness block', 2);
  check('instructions', Buffer.byteLength(agents) <= 16384, 'AGENTS.md stays under 16 KiB');
  check('instructions', !/ORCHESTRATED_WORKER_CONTINUITY_V1/.test(agents), 'AGENTS.md has no v6 protocol boilerplate');
  for (const agent of config?.agents?.enabled ?? []) {
    const surface = SURFACES[agent];
    if (surface && agent !== 'codex') check('instructions', has(surface.path) && /AGENTS\.md/.test(read(path.join(root, surface.path))), `${surface.path} routes to AGENTS.md`);
  }
  check('tools', config !== null, '.harness/config.json parses', 3);
  const runtime = has('.harness/run.mjs') ? read(path.join(h, 'run.mjs')) : '';
  check('tools', runtime === asset('project-runtime.mjs'), '.harness/run.mjs matches the v7 runtime', 2);
  for (const hooks of ['.codex/hooks.json', '.claude/settings.json']) {
    if (has(hooks)) check('tools', !/HARNESS_HOOK_LAUNCHER|context-guard|native-hook-dispatch/.test(read(path.join(root, hooks))), `${hooks} has no v6 per-tool hooks`, 2);
  }
  check('feedback', (config?.verification?.full ?? []).length > 0, 'verification.full is configured', 3);
  const head = git(root, ['rev-parse', '--verify', 'HEAD']);
  check('environment', head.status === 0, 'Git repository has a HEAD commit');
  check('environment', !LEGACY_FILES.some(f => existsSync(path.join(h, f))), 'no v6 runtime leftovers in .harness/');
  let doctor = null;
  if (runtime) {
    const result = spawnSync(process.execPath, [path.join(h, 'run.mjs'), 'doctor', '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
    try { doctor = JSON.parse(result.stdout); } catch {}
  }
  check('state', doctor && doctor.errors.length === 0, doctor ? `doctor: ${doctor.errors.length} errors${doctor.errors.length ? ` (${doctor.errors.slice(0, 3).join('; ')})` : ''}` : 'doctor did not run', 3);
  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const score = Math.round(100 * checks.filter(c => c.pass).reduce((sum, c) => sum + c.weight, 0) / total);
  return { root, score, checks, warnings: doctor?.warnings ?? [] };
}

export function formatAudit(result) {
  const lines = [`Harness audit: ${result.root}`, `Score: ${result.score}/100`];
  for (const c of result.checks) lines.push(`${c.pass ? 'PASS' : 'FAIL'} [${c.area}] ${c.message}`);
  for (const w of result.warnings) lines.push(`WARN ${w}`);
  return lines.join('\n');
}

export function harnessFootprint(rootArg) {
  const h = path.join(path.resolve(rootArg ?? '.'), '.harness');
  let bytes = 0, files = 0;
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) walk(p); else { files++; bytes += statSync(p).size; } } };
  if (existsSync(h)) walk(h);
  return { files, bytes };
}

