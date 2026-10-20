#!/usr/bin/env node
// Agent Harness runtime v7: the checked-in repository-development controller.
// Zero dependencies, Node.js 20+. It owns feature state, verification, evidence,
// worker checkpoints and handoffs. It is never application runtime.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RUNTIME_VERSION = 7;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const H = path.join(ROOT, '.harness');
const STATES = ['not_started', 'active', 'blocked', 'passing'];
const LAYERS = ['quick', 'full', 'architecture', 'e2e', 'clean'];
const OWNED = [
  '.harness/features.json', '.harness/continuity.json', '.harness/events.jsonl', '.harness/progress.md',
  '.harness/handoff.md', '.harness/evidence/**', '.harness/logs/**', '.harness/credentials-state.json',
  '.harness/history/**', '.harness/baselines/**', '.harness/.lock/**', '.harness/*.tmp'
];
const DEFAULT_ENV = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CI', 'NODE_ENV'];
const DEFAULT_DENY = ['.git/**', '.env', '.env.*', '**/node_modules/**', '**/dist/**', '**/build/**'];
const HASH_LIMIT_BYTES = 32 * 1024 * 1024;
const REPEATABLE = new Set(['criterion', 'command', 'allow', 'deny', 'depends', 'layer', 'credential', 'decision', 'blocker']);

// ---------------------------------------------------------------- basics

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-h') { args.help = true; continue; }
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const eq = token.indexOf('=');
    const name = (eq > 0 ? token.slice(2, eq) : token.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    let value = eq > 0 ? token.slice(eq + 1) : true;
    if (value === true && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) value = argv[++i];
    if (REPEATABLE.has(name)) (args[name] ??= []).push(value);
    else args[name] = value;
  }
  return args;
}

const file = (...parts) => path.join(H, ...parts);
const now = () => new Date().toISOString();
const rel = target => path.relative(ROOT, target).split(path.sep).join('/');
export const normalizePath = value => String(value).replaceAll('\\', '/').replace(/^\.\//, '');
const list = value => (value === undefined || value === true ? [] : Array.isArray(value) ? value : [value]).flatMap(v => String(v).split(',')).map(v => v.trim()).filter(Boolean);
const unique = values => [...new Set(values)];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function readJson(target, fallback) {
  try { return JSON.parse(readFileSync(target, 'utf8')); }
  catch (error) { if (fallback !== undefined && error.code === 'ENOENT') return fallback; throw new Error(`Cannot read ${rel(target)}: ${error.message}`); }
}

function writeAtomic(target, content) {
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, target);
}
const writeJson = (target, value) => writeAtomic(target, `${JSON.stringify(value, null, 2)}\n`);

export function appendEvent(type, data = {}) {
  appendFileSync(file('events.jsonl'), `${JSON.stringify({ at: now(), type, ...data })}\n`);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export async function withLock(operation) {
  const dir = file('.lock');
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now() }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = JSON.parse(readFileSync(path.join(dir, 'owner.json'), 'utf8')); } catch {}
      let age = 0;
      try { age = Date.now() - statSync(dir).mtimeMs; } catch { continue; }
      const stale = owner ? !alive(owner.pid) || Date.now() - owner.at > 30 * 60000 : age > 10000;
      if (stale) { rmSync(dir, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) throw new Error(`Harness state is locked by pid ${owner?.pid ?? 'unknown'}; retry when it finishes.`);
      await sleep(150);
    }
  }
  try { return await operation(); } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function loadConfig() { return readJson(file('config.json')); }
export function loadFeatures() {
  const state = readJson(file('features.json'), { version: 1, revision: 0, features: [] });
  if (!Array.isArray(state.features)) throw new Error('.harness/features.json must contain a features array');
  return state;
}
export function loadContinuity() {
  return readJson(file('continuity.json'), { version: 1, phase: 'working', generation: 1, startedAt: now(), checkpoint: null, handoff: null, owner: null });
}
function saveFeatures(state) { state.revision = (state.revision ?? 0) + 1; writeJson(file('features.json'), state); }
function saveContinuity(continuity) { writeJson(file('continuity.json'), continuity); }

function byId(state, id) {
  if (!id || id === true) throw new Error('A feature ID is required.');
  const feature = state.features.find(item => item.id === id);
  if (!feature) throw new Error(`Unknown feature: ${id}`);
  return feature;
}
const activeFeatures = state => state.features.filter(feature => feature.status === 'active');
const requireText = (name, value) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`--${name} is required.`);
  return value.trim();
};

// ------------------------------------------------------------ worker identity

function identity(args) {
  const id = args.workerId ?? process.env.CODEX_THREAD_ID ?? process.env.HARNESS_WORKER_ID ?? null;
  if (id !== null && (typeof id !== 'string' || !/^[\w.:/-]{1,200}$/.test(id))) throw new Error('--worker-id must be 1-200 characters of [A-Za-z0-9_.:/-].');
  return id;
}

// Ownership is cooperative: it keeps one mutating worker per worktree and blocks
// mutations while a handoff is parked. It is not a security boundary.
function assertMutable(continuity, args) {
  if (continuity.phase === 'awaiting_resume') {
    throw new Error(`A handoff is pending. A fresh worker must run: node .harness/run.mjs resume ${continuity.handoff?.id}`);
  }
  const id = identity(args);
  if (continuity.owner && id && continuity.owner.id !== id) {
    throw new Error(`Working state is owned by ${continuity.owner.id}. If that worker has stopped, run: node .harness/run.mjs claim --force`);
  }
}

// ------------------------------------------------------------------- git

function git(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: ROOT, input: input === undefined ? undefined : Buffer.from(input), encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (result.error) throw new Error(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`);
  return { ok: result.status === 0, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
}

export function repository() {
  const head = git(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  if (!head.ok) return { available: false, head: null, branch: null, dirty: [] };
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true }).stdout.trim();
  return { available: true, head: head.stdout.trim(), branch: branch === 'HEAD' ? null : branch, dirty: dirtyPaths() };
}

function dirtyPaths() {
  const fields = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout.split('\0');
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (status.includes('R') || status.includes('C')) paths.push(fields[++i]);
  }
  return unique(paths.map(normalizePath));
}

function fingerprint(relative) {
  const target = path.join(ROOT, relative);
  let info;
  try { info = statSync(target); } catch { return 'deleted'; }
  if (!info.isFile()) return `other:${info.mode}`;
  if (info.size > HASH_LIMIT_BYTES) return `meta:${info.size}:${Math.round(info.mtimeMs)}`;
  return sha256(readFileSync(target));
}

export function globRegex(pattern) {
  let p = normalizePath(pattern);
  if (p.endsWith('/')) p += '**';
  if (!/[*?]/.test(p)) return new RegExp(`^${escape(p)}(?:/.*)?$`, 's');
  let source = '';
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
    } else if (p[i] === '*') source += '[^/]*';
    else if (p[i] === '?') source += '[^/]';
    else source += escape(p[i]);
  }
  return new RegExp(`^${source}$`, 's');
  function escape(text) { return text.replace(/[.+^${}()|[\]\\]/g, '\\$&'); }
}
export const matches = (relative, patterns) => patterns.some(pattern => globRegex(pattern).test(normalizePath(relative)));

function captureBaseline() {
  const repo = repository();
  if (!repo.available) throw new Error('Feature scope needs Git with an initial commit. Create one, then start the feature.');
  const dirty = {};
  for (const relative of repo.dirty) if (!matches(relative, OWNED)) dirty[relative] = fingerprint(relative);
  return { version: 2, head: repo.head, branch: repo.branch, capturedAt: now(), dirty };
}

function featureBaseline(feature) {
  if (feature.baseline) return feature.baseline;
  // Runtime v6 stored content-addressed baseline blobs; read them once for compatibility.
  const ref = feature.scopeBaselineRef?.path;
  if (!ref) return null;
  const blob = readJson(path.join(ROOT, ref), null);
  if (!blob) return null;
  const dirty = {};
  for (const entry of blob.files ?? []) if (entry?.path) dirty[normalizePath(entry.path)] = entry.hash ?? 'unknown';
  return { version: 1, head: blob.head ?? null, branch: blob.branch ?? null, dirty };
}

// Paths changed since the feature started, excluding pre-existing dirt that is unchanged.
export function changedSince(baseline) {
  const repo = repository();
  if (!repo.available) return { error: 'Git repository or HEAD is unavailable.', changed: [], repo };
  const changed = new Set();
  if (baseline.head && baseline.head !== repo.head) {
    if (!git(['merge-base', '--is-ancestor', baseline.head, repo.head], { allowFailure: true }).ok) {
      return { error: `Start commit ${baseline.head.slice(0, 12)} is not an ancestor of HEAD; history was rewritten. Start a successor feature.`, changed: [], repo };
    }
    for (const item of git(['diff', '--name-only', '-z', '--no-renames', baseline.head, repo.head]).stdout.split('\0')) if (item) changed.add(normalizePath(item));
  }
  for (const relative of repo.dirty) {
    const before = baseline.dirty?.[relative];
    if (before === undefined || before !== fingerprint(relative)) changed.add(relative);
  }
  for (const relative of Object.keys(baseline.dirty ?? {})) {
    if (!repo.dirty.includes(relative) && !changed.has(relative) && baseline.head === repo.head) changed.add(relative);
  }
  return { error: null, changed: [...changed].filter(relative => !matches(relative, OWNED)).sort(), repo };
}

function scopeReport(feature) {
  const baseline = featureBaseline(feature);
  if (!baseline) return { changed: [], violations: ['No scope baseline recorded; block this feature and start a successor.'] };
  const { error, changed } = changedSince(baseline);
  if (error) return { changed: [], violations: [error] };
  const allow = feature.scope?.allow ?? [];
  const deny = feature.scope?.deny ?? [];
  // Paths rewritten by `agent-harness sync` while the feature was active are not the feature's work.
  const synced = feature.syncedPaths ?? [];
  const attributed = changed.filter(relative => !matches(relative, synced));
  const violations = attributed.filter(relative => matches(relative, deny) || !matches(relative, allow)).map(relative => `out of scope: ${relative}`);
  return { changed: attributed, violations };
}

// ------------------------------------------------------------- commands

const commandText = entry => typeof entry === 'string' ? entry : entry?.command;
const commandCredentials = entry => typeof entry === 'string' ? [] : list(entry?.credentials);

export function platformCommand(text) {
  if (process.platform !== 'win32') return text;
  // cmd.exe cannot run ./relative/tool.exe; normalize the executable token only.
  return text.replace(/^(\s*)(?:"([^"]+)"|(\S+))/, (match, lead, quoted, bare) => {
    const exe = quoted ?? bare;
    if (!exe.includes('/') && !exe.includes('\\')) return match;
    let win = exe.replaceAll('/', '\\');
    if (!/^(?:\.\.?\\|[A-Za-z]:\\|\\\\)/.test(win)) win = `.\\${win}`;
    return `${lead}${quoted !== undefined ? `"${win}"` : win}`;
  });
}

function providers(config) { return config.security?.credentials?.providers ?? {}; }

function secretValues(config) {
  const names = new Set();
  for (const provider of Object.values(providers(config))) {
    for (const name of provider.sources ?? []) names.add(name);
    if (provider.targetEnvironment) names.add(provider.targetEnvironment);
  }
  for (const name of Object.keys(process.env)) if (/key|secret|token|password|credential/i.test(name)) names.add(name);
  return unique([...names].map(name => process.env[name]).filter(value => typeof value === 'string' && value.length >= 6)).sort((a, b) => b.length - a.length);
}

export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join('[REDACTED]');
  return out
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .replace(/\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED]')
    .replace(/(authorization:\s*(?:bearer|basic)\s+)\S+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|password|private[_-]?key|secret|access[_-]?token)\s*[=:]\s*)["']?[^\s"',;]+/gi, '$1[REDACTED]');
}

function selectCredentials(names, config) {
  const env = {}, used = [];
  if (!names.length) return { env, used };
  const statePath = path.join(ROOT, config.security?.credentials?.stateFile ?? '.harness/credentials-state.json');
  const state = readJson(statePath, { version: 1, cursors: {} });
  state.cursors ??= {};
  for (const name of names) {
    const provider = providers(config)[name];
    if (!provider) throw new Error(`Unknown credential provider: ${name}`);
    const sources = provider.sources ?? [];
    const available = sources.map((source, index) => ({ source, index })).filter(({ source }) => process.env[source]);
    if (!available.length) throw new Error(`No ${name} credential is set (expected one of ${sources.join(', ')}).`);
    let pick = available[0];
    if ((provider.selection ?? 'round_robin') === 'round_robin') {
      const cursor = Number(state.cursors[name] ?? 0);
      pick = available.find(item => item.index >= cursor) ?? available[0];
      state.cursors[name] = (pick.index + 1) % sources.length;
    }
    env[provider.targetEnvironment] = process.env[pick.source];
    used.push({ provider: name, slot: pick.index + 1, selection: provider.selection ?? 'round_robin' });
  }
  writeJson(statePath, state);
  return { env, used };
}

function commandEnvironment(config, extra) {
  const blocked = new Set();
  for (const provider of Object.values(providers(config))) {
    for (const name of provider.sources ?? []) blocked.add(name.toUpperCase());
    if (provider.targetEnvironment) blocked.add(provider.targetEnvironment.toUpperCase());
  }
  const allow = config.security?.environmentAllow ?? DEFAULT_ENV;
  const env = {};
  for (const name of allow) if (process.env[name] !== undefined && !blocked.has(name.toUpperCase())) env[name] = process.env[name];
  return { ...env, ...extra, AGENT_HARNESS: '1' };
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
}

function runShell(text, env, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const chunks = [];
    let bytes = 0, kept = 0, timedOut = false;
    const child = spawn(platformCommand(text), { cwd: ROOT, env, shell: true, windowsHide: true, detached: process.platform !== 'win32' });
    const collect = chunk => {
      bytes += chunk.length; chunks.push(chunk); kept += chunk.length;
      while (kept > 4 * 1024 * 1024 && chunks.length > 1) kept -= chunks.shift().length;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const finish = (exitCode, signal, error) => {
      clearTimeout(timer);
      let output = Buffer.concat(chunks).toString('utf8');
      if (bytes > kept) output = `[... ${bytes - kept} earlier bytes omitted ...]\n${output}`;
      if (error) output += `\n${error.message}`;
      resolve({ exitCode: timedOut ? 124 : exitCode ?? 1, signal, timedOut, output, bytes, durationMs: Date.now() - started });
    };
    child.on('error', error => finish(127, null, error));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

function pruneLogs(keep = 200) {
  const dir = file('logs');
  if (!existsSync(dir)) return;
  const names = readdirSync(dir).filter(name => name.endsWith('.log')).sort();
  for (const name of names.slice(0, Math.max(0, names.length - keep))) rmSync(path.join(dir, name), { force: true });
}

const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'command';
const stamp = () => now().replace(/[:.]/g, '-');

async function runEntries(entries, config, { failFast = true } = {}) {
  const timeoutMs = config.policies?.commandTimeoutMs ?? 600000;
  const secrets = secretValues(config);
  const results = [];
  mkdirSync(file('logs'), { recursive: true });
  for (const { layer, entry, id } of entries) {
    const text = commandText(entry);
    const result = { layer, id, command: text, exitCode: null, pass: false, durationMs: 0 };
    let credentials;
    try { credentials = selectCredentials(commandCredentials(entry), config); }
    catch (error) {
      Object.assign(result, { exitCode: -1, error: error.message });
      results.push(result); report(result); if (failFast) break; continue;
    }
    const run = await runShell(text, commandEnvironment(config, credentials.env), timeoutMs);
    const output = redact(run.output, [...secrets, ...Object.values(credentials.env)]);
    const log = file('logs', `${stamp()}-${slug(id ?? layer)}.log`);
    writeFileSync(log, `$ ${text}\n${output}\n[exit ${run.exitCode}${run.timedOut ? ', timed out' : ''} in ${run.durationMs}ms]\n`);
    Object.assign(result, {
      exitCode: run.exitCode, pass: run.exitCode === 0, timedOut: run.timedOut, durationMs: run.durationMs,
      outputBytes: run.bytes, outputTail: output.slice(-4000), log: rel(log), credentials: credentials.used
    });
    results.push(result);
    report(result);
    if (!result.pass && failFast) break;
  }
  pruneLogs();
  return results;
}

function report(result) {
  const label = `${result.layer}${result.id ? `/${result.id}` : ''}`;
  const seconds = (result.durationMs / 1000).toFixed(1);
  if (result.pass) { console.log(`PASS ${label}: ${result.command} (${seconds}s)`); return; }
  console.log(`FAIL ${label}: ${result.command} (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}, ${seconds}s)${result.log ? ` log: ${result.log}` : ''}`);
  if (result.error) console.log(`  ${result.error}`);
  if (result.outputTail) {
    const tail = result.outputTail.trimEnd().split('\n').slice(-30).join('\n').slice(-3000);
    console.log(tail.replace(/^/gm, '  | '));
  }
}

function configuredLayers(config) {
  return LAYERS.filter(layer => (config.verification?.[layer] ?? []).length > 0);
}

function verificationLayers(config, feature, extra = []) {
  const always = (config.completion?.alwaysRunWhenConfigured ?? []).filter(layer => (config.verification?.[layer] ?? []).length);
  const wanted = new Set([...always, ...(config.completion?.baseLayers ?? ['full']), ...(feature.requiredLayers ?? []), ...extra]);
  for (const layer of wanted) if (!LAYERS.includes(layer)) throw new Error(`Unknown verification layer: ${layer}`);
  return LAYERS.filter(layer => wanted.has(layer));
}

// ---------------------------------------------------------- projections

function nextCandidates(state) {
  const passing = new Set(state.features.filter(f => f.status === 'passing').map(f => f.id));
  return state.features.filter(f => f.status === 'not_started' && (f.dependencies ?? []).every(dep => passing.has(dep)));
}

function nextAction(state, continuity) {
  if (continuity.phase === 'awaiting_resume') return `Delegate a fresh worker to run: node .harness/run.mjs resume ${continuity.handoff?.id}`;
  const active = activeFeatures(state)[0];
  if (active) return `Continue ${active.id}: implement within scope, then run node .harness/run.mjs verify ${active.id}`;
  const candidate = nextCandidates(state)[0];
  if (candidate) return `Start ${candidate.id}: node .harness/run.mjs start ${candidate.id}`;
  const blocked = state.features.find(f => f.status === 'blocked');
  if (blocked) return `Resolve blocker on ${blocked.id} or add a successor feature.`;
  return state.features.length ? 'All features pass. Add the next feature with node .harness/run.mjs add.' : 'No features yet. Add one with node .harness/run.mjs add.';
}

function counts(state) {
  return Object.fromEntries(STATES.map(status => [status, state.features.filter(f => f.status === status).length]));
}

function featureView(feature) {
  if (!feature) return null;
  return {
    id: feature.id, title: feature.title, status: feature.status, description: feature.description,
    dependencies: feature.dependencies ?? [], requiredLayers: feature.requiredLayers ?? [], scope: feature.scope,
    acceptance: feature.acceptance ?? [], attempts: feature.attempts ?? 0, blocker: feature.blocker ?? null,
    lastVerification: feature.lastVerification ?? null
  };
}

function checkpointView(checkpoint) {
  if (!checkpoint) return null;
  return { id: checkpoint.id, reason: checkpoint.reason ?? checkpoint.kind, at: checkpoint.createdAt ?? checkpoint.at, summary: checkpoint.summary, next: checkpoint.next, decisions: checkpoint.decisions ?? [], blockers: checkpoint.blockers ?? [] };
}

export function sessionView() {
  const state = loadFeatures(), continuity = loadContinuity();
  return {
    runtime: RUNTIME_VERSION, phase: continuity.phase, generation: continuity.generation, owner: continuity.owner ?? null,
    pendingResume: continuity.phase === 'awaiting_resume' ? `node .harness/run.mjs resume ${continuity.handoff?.id}` : null,
    active: activeFeatures(state).map(f => ({ id: f.id, title: f.title })), counts: counts(state),
    checkpoint: checkpointView(continuity.checkpoint), next: nextAction(state, continuity)
  };
}

function renderProgress(state, continuity) {
  const repo = repository();
  const cp = checkpointView(continuity.checkpoint);
  const items = values => values?.length ? values.map(v => `- ${v}`).join('\n') : 'None recorded.';
  const active = activeFeatures(state);
  const c = counts(state);
  writeAtomic(file('progress.md'), `# Progress

Generated: ${now()} by \`.harness/run.mjs\`. Current-state snapshot only; Git history, \`.harness/events.jsonl\` and \`.harness/evidence/\` hold the past.

- Continuity: ${continuity.phase}, generation ${continuity.generation}${continuity.owner ? `, owner ${continuity.owner.id}` : ''}
- Features: ${c.passing} passing, ${c.active} active, ${c.not_started} not started, ${c.blocked} blocked
- Active: ${active.length ? active.map(f => `${f.id} (${f.title})`).join(', ') : 'none'}
- Repository: ${repo.available ? `${repo.branch ?? 'detached'} @ ${repo.head.slice(0, 12)}, ${repo.dirty.length} changed paths` : 'unavailable'}${continuity.lastCompaction ? `\n- Last host compaction: ${continuity.lastCompaction.at}` : ''}

## Summary

${cp?.summary ?? 'No checkpoint recorded yet.'}

## Next step

${cp?.next ?? nextAction(state, continuity)}

## Decisions to preserve

${items(cp?.decisions)}

## Blockers and risks

${items(cp?.blockers)}
`);
}

function renderHandoff(continuity) {
  const handoff = continuity.handoff;
  if (!handoff) {
    writeAtomic(file('handoff.md'), `# Worker Handoff\n\nNo handoff is pending (generation ${continuity.generation}). A fresh worker starts with \`node .harness/run.mjs session\` and \`claim\`.\n`);
    return;
  }
  writeAtomic(file('handoff.md'), `# Worker Handoff

- Handoff ID: \`${handoff.id}\`
- Created: ${handoff.createdAt}
- Resume command (run by a fresh worker, not the orchestrator): \`node .harness/run.mjs resume ${handoff.id}\`
- Commit: ${handoff.repository?.head ?? 'unavailable'} on ${handoff.repository?.branch ?? 'detached'}; ${handoff.repository?.dirtyCount ?? 0} changed paths preserved

## Summary

${handoff.summary}

## Next action

${handoff.next}

## Active features

${handoff.activeFeatures?.length ? handoff.activeFeatures.map(f => `- ${f.id}: ${f.title}`).join('\n') : 'None.'}

## Decisions to preserve

${handoff.decisions?.length ? handoff.decisions.map(v => `- ${v}`).join('\n') : 'None recorded.'}

## Blockers and risks

${handoff.blockers?.length ? handoff.blockers.map(v => `- ${v}`).join('\n') : 'None recorded.'}
`);
}

function bounded(name, value, max) {
  const text = requireText(name, value);
  if (Buffer.byteLength(text) > max) throw new Error(`--${name} exceeds ${max} bytes; keep it to current facts.`);
  return text;
}
const boundedList = (values, max = 1024) => list(values).slice(0, 20).map(v => v.slice(0, max));

// ------------------------------------------------------------ commands

const handlers = {
  async session(args) {
    const view = sessionView();
    if (args.json) return void console.log(JSON.stringify(view, null, 2));
    console.log(`Runtime v${view.runtime} | ${view.phase} | generation ${view.generation} | owner ${view.owner?.id ?? 'none'}`);
    console.log(`Features: ${view.counts.passing} passing, ${view.counts.active} active, ${view.counts.not_started} not started, ${view.counts.blocked} blocked`);
    if (view.active.length) console.log(`Active: ${view.active.map(f => `${f.id} (${f.title})`).join(', ')}`);
    if (view.checkpoint) console.log(`Last checkpoint (${view.checkpoint.reason}): ${view.checkpoint.summary}`);
    console.log(`Next: ${view.next}`);
  },

  async claim(args) {
    await withLock(async () => {
      const continuity = loadContinuity();
      if (continuity.phase === 'awaiting_resume') throw new Error(`A handoff is pending; run node .harness/run.mjs resume ${continuity.handoff?.id} instead of claim.`);
      let id = identity(args);
      if (continuity.owner && continuity.owner.id !== id && !args.force) {
        throw new Error(`Already owned by ${continuity.owner.id} since ${continuity.owner.claimedAt}. Use --force only after that worker has stopped.`);
      }
      const generated = !id;
      id ??= `worker-${randomBytes(4).toString('hex')}`;
      const previous = continuity.owner?.id ?? null;
      continuity.owner = { id, claimedAt: now() };
      saveContinuity(continuity);
      appendEvent('worker.claimed', { worker: id, replaced: previous && previous !== id ? previous : undefined });
      console.log(`Claimed working state as ${id}.${generated ? ` Pass --worker-id ${id} on later mutations if your host does not set CODEX_THREAD_ID.` : ''}`);
    });
  },

  async recover(args) {
    // Compatibility with v6 instructions: release a confirmed-stopped owner.
    await withLock(async () => {
      const continuity = loadContinuity();
      if (args.expectedOwner && continuity.owner?.id !== args.expectedOwner) throw new Error(`Current owner is ${continuity.owner?.id ?? 'none'}, not ${args.expectedOwner}.`);
      appendEvent('worker.recovered', { worker: continuity.owner?.id, reason: args.reason });
      continuity.owner = null;
      saveContinuity(continuity);
      console.log('Ownership released; a fresh worker may claim.');
    });
  },

  async bootstrap(args) {
    const config = loadConfig(), state = loadFeatures(), continuity = loadContinuity();
    const selectedId = args._[1];
    const selected = selectedId ? byId(state, selectedId) : activeFeatures(state)[0] ?? nextCandidates(state)[0] ?? null;
    const view = {
      runtime: RUNTIME_VERSION,
      project: config.project,
      session: sessionView(),
      feature: featureView(selected),
      verification: Object.fromEntries(LAYERS.map(layer => [layer, (config.verification?.[layer] ?? []).map(commandText)])),
      policies: config.policies,
      upcoming: nextCandidates(state).slice(0, 5).map(f => ({ id: f.id, title: f.title })),
      blocked: state.features.filter(f => f.status === 'blocked').slice(0, 10).map(f => ({ id: f.id, title: f.title, blocker: typeof f.blocker === 'string' ? f.blocker : f.blocker?.reason ?? null })),
      docs: { map: '.harness/docs-map.md', required: config.docs?.required ?? [] }
    };
    if (args.validate) view.doctor = collectDoctor(config, state, continuity);
    console.log(JSON.stringify(view, null, 2));
    if (view.doctor?.errors.length) process.exitCode = 1;
  },

  async status(args) {
    const state = loadFeatures(), continuity = loadContinuity();
    if (args.json) return void console.log(JSON.stringify({ revision: state.revision, phase: continuity.phase, counts: counts(state), features: state.features.map(f => ({ id: f.id, title: f.title, status: f.status, attempts: f.attempts ?? 0, blocker: f.blocker ?? null })) }, null, 2));
    const c = counts(state);
    console.log(`Revision ${state.revision} | ${continuity.phase} | ${c.passing} passing, ${c.active} active, ${c.not_started} not started, ${c.blocked} blocked`);
    for (const f of state.features) {
      if (f.status === 'passing' && !args.all) continue;
      const blocker = f.blocker ? ` | blocker: ${typeof f.blocker === 'string' ? f.blocker : f.blocker.reason}` : '';
      console.log(`${f.status.padEnd(11)} ${f.id} - ${f.title} (attempts ${f.attempts ?? 0})${blocker}`);
    }
    if (c.passing && !args.all) console.log(`(${c.passing} passing features hidden; use --all)`);
  },

  async next(args) {
    const state = loadFeatures(), continuity = loadContinuity();
    const action = nextAction(state, continuity);
    if (args.json) return void console.log(JSON.stringify({ next: action, candidates: nextCandidates(state).map(f => f.id) }, null, 2));
    console.log(action);
  },

  async add(args) {
    await withLock(async () => {
      const config = loadConfig(), state = loadFeatures(), continuity = loadContinuity();
      assertMutable(continuity, args);
      const id = args._[1];
      if (!/^[A-Za-z0-9][\w.-]{0,79}$/.test(id ?? '')) throw new Error('Feature ID must be 1-80 characters of [A-Za-z0-9_.-].');
      if (state.features.some(f => f.id === id)) throw new Error(`Feature ${id} already exists; regressions become new features.`);
      const criteria = list(args.criterion).length ? args.criterion.map(String) : [];
      const commands = (args.command ?? []).map(String);
      if (!criteria.length) throw new Error('At least one --criterion is required.');
      if ((config.completion?.requireAcceptanceCommands ?? true) && commands.length !== criteria.length) throw new Error('Pair every --criterion with a --command (same order).');
      const dependencies = list(args.depends);
      for (const dep of dependencies) byId(state, dep);
      const credentials = list(args.credential);
      const feature = {
        id, title: requireText('title', args.title), description: requireText('description', args.description), dependencies,
        status: 'not_started', requiredLayers: list(args.layer),
        scope: { allow: list(args.allow).length ? list(args.allow) : config.scope?.defaultAllow ?? [], deny: unique([...(config.scope?.defaultDeny ?? DEFAULT_DENY), ...list(args.deny)]) },
        acceptance: criteria.map((description, index) => ({ id: `ac-${index + 1}`, description, command: commands[index] ?? null, ...(credentials.length ? { credentials } : {}) })),
        evidence: [], blocker: null, attempts: 0, repeatedFailures: 0, lastFailureFingerprint: null, createdAt: now(), updatedAt: now()
      };
      if (!feature.scope.allow.length) throw new Error('Declare scope with --allow (or set scope.defaultAllow).');
      state.features.push(feature);
      saveFeatures(state);
      appendEvent('feature.added', { feature: id });
      console.log(`Added ${id}. Start it with: node .harness/run.mjs start ${id}`);
    });
  },

  async start(args) {
    await withLock(async () => {
      const config = loadConfig(), state = loadFeatures(), continuity = loadContinuity();
      assertMutable(continuity, args);
      const feature = byId(state, args._[1]);
      if (feature.status !== 'not_started') throw new Error(`${feature.id} is ${feature.status}; only not_started features can start.`);
      const wip = config.policies?.wipLimit ?? 1;
      if (activeFeatures(state).length >= wip) throw new Error(`WIP limit ${wip} reached (${activeFeatures(state).map(f => f.id).join(', ')}).`);
      const pending = (feature.dependencies ?? []).filter(dep => byId(state, dep).status !== 'passing');
      if (pending.length) throw new Error(`Dependencies not passing: ${pending.join(', ')}`);
      const snapshot = contractSnapshot(feature);
      feature.contract = { hash: sha256(stable(snapshot)), snapshot, frozenAt: now() };
      feature.baseline = captureBaseline();
      delete feature.scopeBaselineRef;
      feature.status = 'active';
      feature.updatedAt = now();
      saveFeatures(state);
      appendEvent('feature.started', { feature: feature.id, head: feature.baseline.head, preexistingDirty: Object.keys(feature.baseline.dirty).length });
      renderProgress(state, continuity);
      console.log(`Started ${feature.id} at ${feature.baseline.head.slice(0, 12)} (${Object.keys(feature.baseline.dirty).length} pre-existing changed paths recorded).`);
    });
  },

  async block(args) {
    await withLock(async () => {
      const state = loadFeatures(), continuity = loadContinuity();
      assertMutable(continuity, args);
      const feature = byId(state, args._[1]);
      if (feature.status === 'passing') throw new Error('Passing is terminal; add a successor feature instead.');
      feature.status = 'blocked';
      feature.blocker = { reason: requireText('reason', args.reason), at: now(), wasStarted: Boolean(feature.contract) };
      feature.updatedAt = now();
      saveFeatures(state);
      appendEvent('feature.blocked', { feature: feature.id, reason: feature.blocker.reason });
      console.log(`Blocked ${feature.id}.`);
    });
  },

  async unblock(args) {
    await withLock(async () => {
      const config = loadConfig(), state = loadFeatures(), continuity = loadContinuity();
      assertMutable(continuity, args);
      const feature = byId(state, args._[1]);
      if (feature.status !== 'blocked') throw new Error(`${feature.id} is not blocked.`);
      const resume = Boolean(feature.contract && (featureBaseline(feature)));
      if (resume && activeFeatures(state).length >= (config.policies?.wipLimit ?? 1)) throw new Error('WIP limit reached; finish or block the active feature first.');
      feature.status = resume ? 'active' : 'not_started';
      feature.blocker = null;
      feature.repeatedFailures = 0;
      feature.lastFailureFingerprint = null;
      if (args.resetAttempts) feature.attempts = 0;
      feature.updatedAt = now();
      saveFeatures(state);
      appendEvent('feature.unblocked', { feature: feature.id, status: feature.status, resetAttempts: Boolean(args.resetAttempts) });
      console.log(`${feature.id} is ${feature.status}.`);
    });
  },

  async check(args) {
    const config = loadConfig();
    const layer = args._[1] ?? 'quick';
    if (!LAYERS.includes(layer)) throw new Error(`Unknown layer ${layer}; use one of ${LAYERS.join(', ')}.`);
    const entries = (config.verification?.[layer] ?? []).map(entry => ({ layer, entry }));
    if (!entries.length) return void console.log(`No ${layer} commands configured.`);
    const results = await runEntries(entries, config, { failFast: false });
    if (results.some(result => !result.pass)) process.exitCode = 1;
  },

  async verify(args) {
    const config = loadConfig();
    const prepared = await withLock(async () => {
      const state = loadFeatures(), continuity = loadContinuity();
      assertMutable(continuity, args);
      const feature = byId(state, args._[1]);
      if (feature.status !== 'active') throw new Error(`${feature.id} is ${feature.status}; only active features can be verified.`);
      if (feature.contract?.snapshot && stable(contractSnapshot(feature)) !== stable(feature.contract.snapshot)) {
        throw new Error(`${feature.id} changed after start (frozen contract differs). Block it and add a successor feature.`);
      }
      return { feature: structuredClone(feature) };
    });
    const { feature } = prepared;
    const started = Date.now();
    const layers = verificationLayers(config, feature, list(args.layer));
    const entries = [
      ...layers.flatMap(layer => (config.verification?.[layer] ?? []).map(entry => ({ layer, entry }))),
      ...(feature.acceptance ?? []).filter(item => item.command).map(item => ({ layer: 'acceptance', id: item.id, entry: item.credentials ? { command: item.command, credentials: item.credentials } : item.command }))
    ];
    if (!entries.length) throw new Error('Nothing to verify: configure verification.full or acceptance commands.');
    const missing = (config.completion?.baseLayers ?? ['full']).filter(layer => !(config.verification?.[layer] ?? []).length);
    const results = await runEntries(entries, config, { failFast: config.verification?.failFast ?? true });
    const scope = scopeReport(feature);
    for (const violation of scope.violations) console.log(`SCOPE ${violation}`);
    const failures = [
      ...missing.map(layer => `required layer ${layer} has no configured commands`),
      ...results.filter(r => !r.pass).map(r => `${r.layer}${r.id ? `/${r.id}` : ''} exit ${r.exitCode}`),
      ...(results.length < entries.length ? [`${entries.length - results.length} later commands skipped after failure`] : []),
      ...scope.violations
    ];
    const pass = failures.length === 0;

    return withLock(async () => {
      const state = loadFeatures(), continuity = loadContinuity();
      const current = byId(state, feature.id);
      if (current.status !== 'active' || current.contract?.hash !== feature.contract?.hash) throw new Error(`${feature.id} changed while verification ran; rerun verify.`);
      const repo = repository();
      const evidencePath = file('evidence', `${stamp()}-${feature.id}.json`);
      const evidence = {
        schema: 7, feature: feature.id, contractHash: feature.contract?.hash ?? null, pass, failures, layers,
        startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
        repository: { head: repo.head, branch: repo.branch }, results, scope
      };
      writeJson(evidencePath, evidence);
      current.evidence = [...(current.evidence ?? []), rel(evidencePath)];
      current.lastVerification = { at: now(), pass, evidence: rel(evidencePath) };
      current.attempts = (current.attempts ?? 0) + 1;
      current.updatedAt = now();
      if (pass) {
        current.status = 'passing';
        current.repeatedFailures = 0;
        current.lastFailureFingerprint = null;
      } else {
        const print = sha256(stable(failures.map(f => f.replace(/\d+(\.\d+)?s\b/g, ''))));
        current.repeatedFailures = current.lastFailureFingerprint === print ? (current.repeatedFailures ?? 0) + 1 : 1;
        current.lastFailureFingerprint = print;
        const maxAttempts = Math.min(config.policies?.maxAttempts ?? 5, current.verificationBudget?.maxAttempts ?? Infinity);
        const maxRepeated = config.policies?.maxRepeatedFailures ?? 2;
        let reason = null;
        if (current.attempts >= maxAttempts) reason = `Attempt budget exhausted (${current.attempts}/${maxAttempts}).`;
        else if (current.repeatedFailures >= maxRepeated) reason = `Same failure repeated ${current.repeatedFailures} times without new evidence.`;
        if (reason) {
          current.status = 'blocked';
          current.blocker = { reason, at: now(), wasStarted: true };
          appendEvent('feature.blocked', { feature: feature.id, reason });
        }
      }
      saveFeatures(state);
      appendEvent('feature.verified', { feature: feature.id, pass, evidence: rel(evidencePath), attempts: current.attempts });
      renderProgress(state, continuity);
      if (pass) {
        console.log(`VERIFIED ${feature.id}: passing (evidence ${rel(evidencePath)}).`);
        if (config.completion?.commitOnPass !== false) commitFeature(current, scope.changed, rel(evidencePath));
      } else {
        console.log(`NOT VERIFIED ${feature.id}: ${failures.length} failure(s); attempt ${current.attempts}.${current.status === 'blocked' ? ` Blocked: ${current.blocker.reason}` : ''}`);
        process.exitCode = 1;
      }
    });
  },

  async trace(args) {
    const state = loadFeatures();
    const feature = byId(state, args._[1]);
    const events = existsSync(file('events.jsonl')) ? readFileSync(file('events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(e => e && (e.feature === feature.id || e.featureId === feature.id)) : [];
    console.log(JSON.stringify({ feature: featureView(feature), events: events.slice(-50), evidence: feature.evidence ?? [] }, null, 2));
  },

  async checkpoint(args) {
    await withLock(async () => {
      const state = loadFeatures(), continuity = loadContinuity();
      assertMutable(continuity, args);
      const reason = args.reason ?? 'worker_yield';
      if (!['worker_yield', 'needs_input'].includes(reason)) throw new Error('--reason must be worker_yield or needs_input (use handoff for a transfer).');
      const repo = repository();
      continuity.checkpoint = {
        id: `checkpoint-${stamp()}`, kind: 'checkpoint', reason, createdAt: now(),
        summary: bounded('summary', args.summary, 4000), next: bounded('next', args.next, 2000),
        decisions: boundedList(args.decision), blockers: boundedList(args.blocker),
        activeFeatures: activeFeatures(state).map(f => f.id), repository: { head: repo.head, branch: repo.branch, dirtyCount: repo.dirty.length }
      };
      const worker = continuity.owner?.id ?? identity(args);
      continuity.owner = null;
      saveContinuity(continuity);
      appendEvent('checkpoint.written', { reason, worker, checkpoint: continuity.checkpoint.id });
      renderProgress(state, continuity);
      renderHandoff(continuity);
      console.log(`Checkpoint ${continuity.checkpoint.id} (${reason}) written; ownership released. Return a concise result to the orchestrator and stop.`);
    });
  },

  async handoff(args) {
    await withLock(async () => {
      const config = loadConfig(), state = loadFeatures(), continuity = loadContinuity();
      assertMutable(continuity, args);
      const repo = repository();
      const handoff = {
        id: `handoff-${stamp()}-${randomBytes(3).toString('hex')}`, kind: 'handoff', reason: args.reason ?? 'context_transfer', createdAt: now(),
        summary: bounded('summary', args.summary, 4000), next: bounded('next', args.next, 2000),
        decisions: boundedList(args.decision), blockers: boundedList(args.blocker), automatic: Boolean(args.automatic),
        featureRevision: state.revision, configHash: sha256(stable(config)),
        activeFeatures: activeFeatures(state).map(f => ({ id: f.id, title: f.title })),
        repository: { head: repo.head, branch: repo.branch, dirtyCount: repo.dirty.length, dirtySample: repo.dirty.slice(0, 50) },
        fromWorker: continuity.owner?.id ?? identity(args)
      };
      continuity.phase = 'awaiting_resume';
      continuity.handoff = handoff;
      continuity.checkpoint = { ...handoff, reason: 'handoff' };
      continuity.owner = null;
      saveContinuity(continuity);
      appendEvent('handoff.ready', { handoff: handoff.id, reason: handoff.reason });
      renderProgress(state, continuity);
      renderHandoff(continuity);
      console.log(`Handoff ${handoff.id} parked. Stop now. The orchestrator delegates a fresh worker to run:\nnode .harness/run.mjs resume ${handoff.id}`);
    });
  },

  async resume(args) {
    await withLock(async () => {
      const config = loadConfig(), state = loadFeatures(), continuity = loadContinuity();
      const id = args._[1];
      if (continuity.phase !== 'awaiting_resume') throw new Error(`No handoff is pending (phase ${continuity.phase}). Use claim.`);
      if (continuity.handoff?.id !== id) throw new Error(`Pending handoff is ${continuity.handoff?.id}, not ${id}.`);
      const handoff = continuity.handoff;
      const repo = repository();
      const drift = [];
      const before = handoff.repository ?? {};
      if (before.head && repo.head !== before.head) drift.push(`commit ${before.head.slice(0, 12)} -> ${repo.head?.slice(0, 12)}`);
      if ((before.branch ?? null) !== (repo.branch ?? null)) drift.push(`branch ${before.branch} -> ${repo.branch}`);
      if (handoff.featureRevision !== undefined && handoff.featureRevision !== state.revision) drift.push(`feature revision ${handoff.featureRevision} -> ${state.revision}`);
      if (handoff.configHash && handoff.configHash.length === 64 && handoff.configHash !== sha256(stable(config)) && !handoff.legacy) drift.push('config.json changed');
      if (drift.length && !args.acceptDrift) throw new Error(`State drifted since the handoff: ${drift.join('; ')}. Review it, then rerun with --accept-drift.`);
      const worker = identity(args) ?? `worker-${randomBytes(4).toString('hex')}`;
      continuity.phase = 'working';
      continuity.generation = (continuity.generation ?? 0) + 1;
      continuity.resumedAt = now();
      continuity.lastHandoff = handoff;
      continuity.handoff = null;
      continuity.owner = { id: worker, claimedAt: now() };
      saveContinuity(continuity);
      appendEvent('worker.resumed', { handoff: id, worker, drift });
      renderProgress(state, continuity);
      renderHandoff(continuity);
      console.log(`Resumed ${id} as ${worker} (generation ${continuity.generation}).${drift.length ? ` Accepted drift: ${drift.join('; ')}.` : ''}`);
      console.log(`Summary: ${handoff.summary}\nNext: ${handoff.next}\nRun node .harness/run.mjs bootstrap --validate --json for the active contract.`);
    });
  },

  async doctor(args) {
    const result = collectDoctor(loadConfig(), loadFeatures(), loadContinuity());
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const message of result.errors) console.log(`ERROR ${message}`);
      for (const message of result.warnings) console.log(`WARN  ${message}`);
      console.log(result.errors.length ? `Doctor found ${result.errors.length} error(s).` : 'Doctor passed.');
    }
    if (result.errors.length) process.exitCode = 1;
  },

  async credentials(args) {
    const config = loadConfig();
    const view = Object.entries(providers(config)).map(([name, p]) => ({ provider: name, selection: p.selection ?? 'round_robin', configured: (p.sources ?? []).length, available: (p.sources ?? []).filter(s => process.env[s]).length }));
    if (args.json) return void console.log(JSON.stringify(view, null, 2));
    for (const p of view) console.log(`${p.provider}: ${p.available}/${p.configured} slots available (${p.selection})`);
    if (!view.length) console.log('No credential providers configured.');
  },

  async context() {
    console.log('Runtime v7 has no context budgets or forced rotation. Checkpoint at milestones, hand off only for a real transfer, and let the host compact.');
  },

  async migrate() {
    console.log('Runtime v7 reads v6 state directly; no migration is needed.');
  },

  async help(args) { printHelp(args._[1]); }
};

function contractSnapshot(feature) {
  return { id: feature.id, title: feature.title, description: feature.description, dependencies: feature.dependencies ?? [], scope: feature.scope, acceptance: feature.acceptance ?? [], requiredLayers: feature.requiredLayers ?? [] };
}

function commitFeature(feature, changed, evidence) {
  try {
    const repo = repository();
    if (!repo.available) return void console.log('COMMIT skipped: no Git HEAD.');
    const harnessFiles = ['.harness/features.json', '.harness/continuity.json', '.harness/events.jsonl', '.harness/progress.md', ...(feature.evidence ?? []), evidence];
    const paths = unique([...changed, ...harnessFiles]).filter(p => repo.dirty.includes(p) || existsSync(path.join(ROOT, p)));
    git(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: paths.map(p => `:(literal)${p}`).join('\0') });
    if (git(['diff', '--cached', '--quiet'], { allowFailure: true }).ok) return void console.log('COMMIT skipped: nothing staged.');
    const message = `${feature.id}: ${feature.title}\n\nVerified by .harness/run.mjs verify.\nEvidence: ${evidence}\n`;
    const result = git(['commit', '-q', '-F', '-'], { input: message, allowFailure: true });
    if (!result.ok) return void console.log(`COMMIT failed (feature still passing; commit manually): ${result.stderr.trim().split('\n').slice(-3).join(' ')}`);
    console.log(`COMMITTED ${git(['rev-parse', '--short', 'HEAD']).stdout.trim()} ${feature.id}: ${feature.title}`);
  } catch (error) {
    console.log(`COMMIT failed (feature still passing; commit manually): ${error.message}`);
  }
}

export function collectDoctor(config, state, continuity) {
  const errors = [], warnings = [];
  const ids = new Set();
  for (const feature of state.features) {
    if (ids.has(feature.id)) errors.push(`duplicate feature id ${feature.id}`);
    ids.add(feature.id);
    if (!STATES.includes(feature.status)) errors.push(`${feature.id}: unknown status ${feature.status}`);
    if (feature.status === 'passing' && !(feature.evidence ?? []).length) errors.push(`${feature.id}: passing without evidence`);
    if (feature.status === 'active' && !featureBaseline(feature)) errors.push(`${feature.id}: active without a scope baseline`);
  }
  for (const feature of state.features) for (const dep of feature.dependencies ?? []) if (!ids.has(dep)) errors.push(`${feature.id}: unknown dependency ${dep}`);
  const missingEvidence = state.features.filter(f => f.status === 'passing' && (f.evidence ?? []).length && !(f.evidence ?? []).some(e => existsSync(path.join(ROOT, e))));
  if (missingEvidence.length) warnings.push(`${missingEvidence.length} passing feature(s) have no evidence file on disk (archived or deleted): ${missingEvidence.slice(0, 5).map(f => f.id).join(', ')}${missingEvidence.length > 5 ? ', ...' : ''}`);
  const cycle = findCycle(state.features);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')}`);
  const wip = config.policies?.wipLimit ?? 1;
  if (activeFeatures(state).length > wip) errors.push(`${activeFeatures(state).length} active features exceed WIP limit ${wip}`);
  if (!(config.verification?.full ?? []).length) errors.push('verification.full is not configured');
  if (!['working', 'awaiting_resume'].includes(continuity.phase)) errors.push(`unknown continuity phase ${continuity.phase}`);
  if (continuity.phase === 'awaiting_resume' && !continuity.handoff?.id) errors.push('awaiting_resume without a handoff packet');
  for (const relative of Object.values(config.agents?.instructions ?? { codex: 'AGENTS.md' })) {
    const target = path.join(ROOT, relative);
    if (!existsSync(target)) errors.push(`missing instruction file ${relative}`);
    else if (!/\.harness\/run\.mjs|AGENTS\.md/.test(readFileSync(target, 'utf8'))) warnings.push(`${relative} does not route to AGENTS.md or .harness/run.mjs`);
  }
  for (const hooks of ['.codex/hooks.json', '.claude/settings.json']) {
    const target = path.join(ROOT, hooks);
    if (existsSync(target) && /HARNESS_HOOK_LAUNCHER|context-guard|native-hook-dispatch/.test(readFileSync(target, 'utf8'))) warnings.push(`${hooks} still has v6 per-tool hooks; run agent-harness sync`);
  }
  const allow = config.security?.environmentAllow ?? [];
  for (const provider of Object.values(providers(config))) for (const name of [...(provider.sources ?? []), provider.targetEnvironment]) if (allow.includes(name)) errors.push(`environmentAllow exposes credential variable ${name}`);
  if (!repository().available) warnings.push('Git HEAD unavailable; features cannot start until the first commit exists');
  return { errors, warnings };
}

function findCycle(features) {
  const graph = new Map(features.map(f => [f.id, f.dependencies ?? []]));
  const state = new Map();
  const stack = [];
  const visit = id => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1); stack.push(id);
    for (const dep of graph.get(id) ?? []) { const cycle = visit(dep); if (cycle) return cycle; }
    stack.pop(); state.set(id, 2);
    return null;
  };
  for (const id of graph.keys()) { const cycle = visit(id); if (cycle) return cycle; }
  return null;
}

export async function recordCompaction(trigger) {
  // Called by the PreCompact hook. Bounded, best effort, never parks work.
  await withLock(async () => {
    const state = loadFeatures(), continuity = loadContinuity();
    continuity.lastCompaction = { at: now(), trigger: trigger ?? 'unknown', owner: continuity.owner?.id ?? null, active: activeFeatures(state).map(f => f.id) };
    saveContinuity(continuity);
    appendEvent('host.compaction', { trigger });
    renderProgress(state, continuity);
  });
}

const HELP = `Agent Harness runtime v${RUNTIME_VERSION}

Worker startup:   session [--json] | claim [--worker-id ID] [--force] | resume HANDOFF_ID [--accept-drift]
                  bootstrap [FEATURE] [--validate] [--json]
Features:         add ID --title T --description D --criterion C --command CMD [--allow GLOB] [--deny GLOB]
                      [--depends ID] [--layer quick|full|architecture|e2e|clean] [--credential PROVIDER]
                  start ID | block ID --reason R | unblock ID [--reset-attempts] | verify ID [--layer L]
Inspection:       status [--all] [--json] | next | trace ID | doctor [--json] | check LAYER | credentials
Worker boundary:  checkpoint --reason worker_yield|needs_input --summary S --next N [--decision D] [--blocker B]
                  handoff --summary S --next N   (true context/ownership transfer only)

Mutations accept --worker-id ID on hosts without CODEX_THREAD_ID. verify commits the feature's changes on pass
unless config.completion.commitOnPass is false.`;

function printHelp() { console.log(HELP); }

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] ?? 'help';
  if (args.help) return printHelp(command);
  const handler = handlers[command];
  if (!handler) throw new Error(`Unknown command: ${command}. Run node .harness/run.mjs help`);
  if (!existsSync(file('config.json'))) throw new Error('No .harness/config.json; initialize with agent-harness init.');
  await handler(args);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`ERROR ${error.message}`); process.exitCode = 1; });
}
