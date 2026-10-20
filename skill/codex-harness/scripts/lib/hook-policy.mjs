import { mkdir, readFile, readdir, realpath, lstat, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { connectNativeHookClient } from './native-hook-client.mjs';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const POLICY_NAME = 'agent-harness-hook-policy.json';
const INSTALLED = [
  ['project-runtime.mjs', '.harness/run.mjs'], ['context-budget.mjs', '.harness/context-budget.mjs'],
  ['windows-command.mjs', '.harness/windows-command.mjs'], ['windows-command-supervisor.ps1', '.harness/windows-command-supervisor.ps1'],
  ['repair.mjs', '.harness/repair.mjs'], ['hook-recovery.mjs', '.harness/hooks/hook-recovery.mjs'],
  ['native-hook-dispatch.mjs', '.harness/hooks/native-hook-dispatch.mjs'],
  ...[1, 2, 3].map(version => [`native-hook-bootstrap-v${version}.json`, `.harness/hooks/native-hook-bootstrap-v${version}.json`]),
  ['context-guard.mjs', '.harness/hooks/context-guard.mjs'],
  ['native-hook-identity.mjs', '.harness/hooks/native-hook-identity.mjs'],
  ['precompact-handoff.mjs', '.harness/hooks/precompact-handoff.mjs'],
  ['sessionstart-routing.mjs', '.harness/hooks/sessionstart-routing.mjs']
];
const EVENT_NAMES = { PreCompact: 'pre_compact', SessionStart: 'session_start', PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', UserPromptSubmit: 'user_prompt_submit', Stop: 'stop' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (a, b) => stable(a) === stable(b);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
function homePath(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  requireThat(path.isAbsolute(home), 'CODEX_HOME must be an absolute path.');
  return path.resolve(home);
}
async function absoluteRoot(root) {
  requireThat(typeof root === 'string' && path.isAbsolute(root), 'Hook policy roots must be explicitly supplied absolute paths.');
  requireThat(!(await lstat(root)).isSymbolicLink(), 'Hook policy roots cannot be symbolic links.');
  return realpath(root);
}
async function atomicJson(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = destination + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, destination);
}
export async function readHookPolicy({ home } = {}) {
  try {
    const policy = JSON.parse(await readFile(path.join(homePath(home), POLICY_NAME), 'utf8'));
    if (policy.version === 1 && policy.enabled === false) return null;
    requireThat(policy.version === 1 && policy.enabled === true && policy.authority === 'explicit-canonical-kit-location' && path.isAbsolute(policy.sourceRoot) && Array.isArray(policy.projects) && policy.projects.every(root => typeof root === 'string' && path.isAbsolute(root)), 'Invalid hook approval policy; review it explicitly.');
    return policy;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// This command is an explicit operator attestation of source authority, rather
// than an inference from matching hashes or project inventory discovery.
export async function enableHookPolicy({ sourceRoot, projects = [], home, runningSource = KIT_ROOT } = {}) {
  const canonical = await absoluteRoot(sourceRoot);
  requireThat(canonical === await absoluteRoot(runningSource), 'Authorize the kit location running this command; a different source needs its own reviewed invocation.');
  const enrolled = await Promise.all(projects.map(absoluteRoot));
  const prior = await readHookPolicy({ home });
  requireThat(!prior || prior.sourceRoot === canonical, 'Existing policy has another source authority; disable it before changing authority.');
  const policy = { version: 1, enabled: true, authority: 'explicit-canonical-kit-location', sourceRoot: canonical, projects: [...new Set([...(prior?.projects ?? []), ...enrolled])].sort() };
  await atomicJson(path.join(homePath(home), POLICY_NAME), policy);
  return policy;
}
export async function disableHookPolicy({ home } = {}) {
  await atomicJson(path.join(homePath(home), POLICY_NAME), { version: 1, enabled: false });
}

async function sourceSnapshot(sourceRoot) {
  const entries = {};
  async function visit(relative) {
    const destination = path.join(sourceRoot, relative), information = await lstat(destination);
    requireThat(!information.isSymbolicLink(), 'Canonical source verification refuses symbolic links.');
    if (information.isDirectory()) for (const child of (await readdir(destination)).sort()) await visit(path.join(relative, child));
    else if (information.isFile()) entries[relative.replaceAll('\\', '/')] = sha(await readFile(destination));
    else throw new Error('Unsupported canonical source file.');
  }
  for (const relative of ['package.json', 'bin', 'skill/codex-harness', 'tests']) await visit(relative);
  return entries;
}
async function verifySourceTests(sourceRoot) {
  // Keep only a bounded diagnostic tail. Provider credentials are not passed.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].includes(key)));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', 'tests/harness.test.mjs'], { cwd: sourceRoot, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = ''; const capture = bytes => { tail = (tail + bytes.toString()).slice(-2000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const timer = setTimeout(() => { child.kill(); reject(new Error('Canonical source verification timed out; trust unchanged.')); }, 600000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Canonical source verification failed; trust unchanged. ' + tail)); });
  });
}
export async function canonicalCodexHooks(sourceRoot = KIT_ROOT) {
  const assets = path.join(sourceRoot, 'skill/codex-harness/assets');
  const bootstrap = JSON.parse(await readFile(path.join(assets, 'native-hook-bootstrap-v3.json'), 'utf8'));
  let template = await readFile(path.join(assets, 'codex-hooks.json.template'), 'utf8');
  for (const [prefix, name] of [['PRECOMPACT', 'precompact-handoff.mjs'], ['SESSIONSTART', 'sessionstart-routing.mjs'], ['CONTEXT', 'context-guard.mjs']]) {
    const command = bootstrap.commands['codex/' + name]; requireThat(typeof command === 'string', 'Missing canonical bootstrap command.');
    for (const suffix of ['COMMAND', 'WINDOWS_COMMAND']) template = template.replaceAll('{{' + prefix + '_' + suffix + '}}', JSON.stringify(command));
  }
  return JSON.parse(template);
}
async function installedSnapshot(root, sourceRoot) {
  const snapshot = {};
  for (const [asset, relative] of INSTALLED) {
    const bytes = await readFile(path.join(root, relative));
    requireThat(await realpath(path.join(root, relative)) === path.join(root, relative), 'Installed executable cannot traverse a symbolic link.');
    requireThat(sha(bytes) === sha(await readFile(path.join(sourceRoot, 'skill/codex-harness/assets', asset))), 'Installed executable differs from verified canonical source: ' + relative);
    snapshot[relative] = sha(bytes);
  }
  const hookPath = path.join(root, '.codex/hooks.json');
  requireThat(await realpath(hookPath) === hookPath, 'Installed hook source cannot traverse a symbolic link.');
  snapshot['.codex/hooks.json'] = sha(await readFile(hookPath));
  return snapshot;
}

export function reviewNativeDefinitions(discovery, root, installed, canonical, platform = process.platform) {
  const discovered = discovery?.data?.filter(item => path.resolve(item.cwd) === root);
  requireThat(discovered?.length === 1 && !discovered[0].errors?.length && Array.isArray(discovered[0].hooks), 'Native hook discovery is incomplete.');
  const sourcePath = path.join(root, '.codex/hooks.json'), definitions = [];
  for (const [event, groups] of Object.entries(canonical.hooks)) {
    requireThat(EVENT_NAMES[event], 'Unreviewed canonical native event.');
    for (const expected of groups) {
      const matches = (installed.hooks?.[event] ?? []).map((group, index) => ({ group, index })).filter(item => same(item.group, expected));
      requireThat(matches.length === 1, 'Customized or duplicated canonical hook requires review: ' + event);
      const { index } = matches[0];
      for (const [hookIndex, hook] of expected.hooks.entries()) {
        requireThat(Object.keys(expected).every(key => ['matcher', 'hooks'].includes(key)) && Object.keys(hook).every(key => ['type', 'command', 'commandWindows', 'timeout', 'async', 'statusMessage', 'additionalContextLimit'].includes(key)), 'Unreviewed canonical native option.');
        const key = `${sourcePath}:${EVENT_NAMES[event]}:${index}:${hookIndex}`;
        const candidates = discovered[0].hooks.filter(item => item.key === key);
        requireThat(candidates.length === 1, 'Native hook identity is missing or duplicated; disabled project hooks require independent project-trust review: ' + event);
        const native = candidates[0];
        requireThat(native.enabled !== false, 'Project hook is disabled; project trust or hook enablement requires independent user review.');
        const expectedFields = { key, eventName: event[0].toLowerCase() + event.slice(1), handlerType: 'command', command: platform === 'win32' ? hook.commandWindows ?? hook.command : hook.command, matcher: expected.matcher ?? null, timeoutSec: hook.timeout ?? 600, async: hook.async ?? false, statusMessage: hook.statusMessage ?? null, additionalContextLimit: hook.additionalContextLimit ?? null, sourcePath, source: 'project', pluginId: null, enabled: true, isManaged: false };
        requireThat(hook.type === 'command' && Object.entries(expectedFields).every(([field, value]) => same(native[field], value)), 'Native definition differs from canonical source: ' + event);
        requireThat(/^sha256:[0-9a-f]{64}$/.test(native.currentHash), 'Missing native definition hash.');
        requireThat(Number.isSafeInteger(native.displayOrder) && native.displayOrder >= 0 && discovered[0].hooks.filter(item => item.displayOrder === native.displayOrder).length === 1, 'Invalid or duplicated native discovery order.');
        requireThat(['trusted', 'untrusted', 'modified'].includes(native.trustStatus), 'Unexpected project hook trust status.');
        definitions.push(native);
      }
    }
  }
  return definitions;
}

// Invoked only by an authorized controller init/sync operation. Hook adapters
// never import this module or call an approval API.
export async function approveCanonicalHooks(root, { home, rpc, executable, verifySource = verifySourceTests, runningSource = KIT_ROOT, enroll = false, nativeHookInvocation = false } = {}) {
  requireThat(!nativeHookInvocation, 'Native hooks cannot approve themselves.');
  let policy = await readHookPolicy({ home });
  if (!policy) return { status: 'disabled', approved: 0 };
  root = await absoluteRoot(root);
  requireThat(policy.sourceRoot === await absoluteRoot(runningSource), 'Invoking kit location does not own policy source authority.');
  if (!policy.projects.includes(root)) {
    requireThat(enroll, 'Project has not been explicitly enrolled.');
    policy = await enableHookPolicy({ sourceRoot: policy.sourceRoot, projects: [root], home, runningSource });
  }
  if (typeof rpc !== 'function') {
    const client = await connectNativeHookClient({ home, cwd: root, executable });
    try { return await approveCanonicalHooks(root, { home, rpc: client.rpc, verifySource, runningSource, nativeHookInvocation }); }
    finally { await client.close(); }
  }
  const beforeSource = await sourceSnapshot(policy.sourceRoot);
  await verifySource(policy.sourceRoot);
  requireThat(same(beforeSource, await sourceSnapshot(policy.sourceRoot)), 'Canonical source changed during verification; trust unchanged.');
  const beforeInstalled = await installedSnapshot(root, policy.sourceRoot);
  const canonical = await canonicalCodexHooks(policy.sourceRoot), installed = JSON.parse(await readFile(path.join(root, '.codex/hooks.json'), 'utf8'));
  const discovered = await rpc('hooks/list', { cwds: [root] });
  const definitions = reviewNativeDefinitions(discovered, root, installed, canonical);
  const config = await rpc('config/read', { includeLayers: true });
  const baseLayers = config => config.layers?.filter(layer => layer.name?.type === 'user' && !layer.name.profile && typeof layer.name.file === 'string' && path.resolve(layer.name.file) === path.join(homePath(home), 'config.toml'));
  const userLayers = baseLayers(config);
  requireThat(userLayers?.length === 1 && typeof userLayers[0].version === 'string' && userLayers[0].config && typeof userLayers[0].config === 'object', 'Complete base user config and version are required; trust unchanged.');
  const layer = userLayers[0], state = layer.config.hooks?.state ?? {};
  requireThat(state && typeof state === 'object' && !Array.isArray(state), 'Invalid base user hook trust map.');
  const nextState = structuredClone(state);
  for (const definition of definitions) nextState[definition.key] = { ...(nextState[definition.key] ?? {}), trusted_hash: definition.currentHash };
  const nextConfig = structuredClone(layer.config);
  nextConfig.hooks ??= {};
  nextConfig.hooks.state = nextState;
  const inputsIntact = async () => same(policy, await readHookPolicy({ home })) && same(beforeSource, await sourceSnapshot(policy.sourceRoot)) && same(beforeInstalled, await installedSnapshot(root, policy.sourceRoot));
  requireThat(same(policy, await readHookPolicy({ home })) && same(beforeSource, await sourceSnapshot(policy.sourceRoot)) && same(beforeInstalled, await installedSnapshot(root, policy.sourceRoot)), 'Approval inputs drifted; trust unchanged.');
  let writeError;
  if (!same(state, nextState)) {
    try {
      await rpc('config/batchWrite', { filePath: layer.name.file, expectedVersion: layer.version, reloadUserConfig: true, edits: [{ keyPath: 'hooks.state', mergeStrategy: 'replace', value: nextState }] });
    } catch (error) { writeError = error; }
  }
  // A lost response may follow a committed write. Confirm the complete base
  // config, fresh native hashes, and authority binding before classifying it.
  // This operation never retries the write, including on a version conflict.
  let confirmed, afterLayer, intact;
  try {
    const afterConfig = await rpc('config/read', { includeLayers: true });
    const after = await rpc('hooks/list', { cwds: [root] });
    confirmed = reviewNativeDefinitions(after, root, installed, canonical);
    const layers = baseLayers(afterConfig);
    requireThat(layers?.length === 1 && typeof layers[0].version === 'string', 'Base user config readback is incomplete.');
    afterLayer = layers[0];
    intact = await inputsIntact();
    requireThat(intact && confirmed.every(definition => definitions.some(prior => prior.key === definition.key && prior.currentHash === definition.currentHash && prior.displayOrder === definition.displayOrder)), 'Approval authority or native definitions changed.');
  } catch (error) {
    const failure = new Error('Native approval outcome is indeterminate; readback did not verify unchanged authority, config and definitions. No write retry was made.', { cause: error });
    failure.code = 'HOOK_APPROVAL_INDETERMINATE';
    throw failure;
  }
  if (same(afterLayer.config, nextConfig) && confirmed.every(definition => definition.trustStatus === 'trusted')) {
    return { status: 'trusted', approved: confirmed.length, recoveredWrite: Boolean(writeError), sourceDigest: sha(stable(beforeSource)), project: root };
  }
  // An unchanged snapshot is not a barrier: a timed-out/disconnected request
  // may still commit later. Only an authoritative version rejection proves
  // this request cannot write; other failures remain indeterminate.
  if (writeError?.configWriteErrorCode === 'configVersionConflict' && afterLayer.version === layer.version && same(afterLayer.config, layer.config) && confirmed.every(definition => definitions.some(prior => prior.key === definition.key && prior.trustStatus === definition.trustStatus))) {
    const failure = new Error('Native approval write was verified not committed; no write retry was made.', { cause: writeError });
    failure.code = 'HOOK_APPROVAL_NOT_COMMITTED';
    throw failure;
  }
  const failure = new Error('Native trust confirmation failed; outcome is indeterminate. Project trust may require independent user review. No write retry was made.', { cause: writeError });
  failure.code = 'HOOK_APPROVAL_INDETERMINATE';
  throw failure;
}
