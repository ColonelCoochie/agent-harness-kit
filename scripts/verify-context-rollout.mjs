import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CONTEXT_DEFAULTS } from '../skill/codex-harness/assets/context-budget.mjs';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const targets = [sourceRoot,
  'C:\\Users\\Jason\\Coding\\CoochieTerminal',
  'C:\\Users\\Jason\\Documents\\Claude\\Projects\\Stock Compendium',
  'C:\\Users\\Jason\\Documents\\ChatGPT\\CoochieCalendar',
  'C:\\Users\\Jason\\Documents\\ChatGPT\\ReverseEngineer',
  'C:\\Users\\Jason\\Documents\\ChatGPT\\RobloxDeployer',
  'C:\\Users\\Jason\\Documents\\StrategyTester',
  'C:\\Users\\Jason\\Documents\\CoochieScreener',
  'C:\\Users\\Jason\\Documents\\Codex\\2026-07-20\\my-goal-is-to-build-an\\work\\final-forward-test',
  'C:\\Users\\Jason\\Documents\\Codex\\2026-07-20\\my-goal-is-to-build-an\\work\\forward-test-sample',
  'C:\\Users\\Jason\\Documents\\CoochieScreener\\.local\\agent-harness-kit'];
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const environmentFor = (root) => ({ ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: root.replaceAll('\\', '/') });
export const json = async (root, file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
export const runtimeFiles = {
  '.harness/run.mjs': 'project-runtime.mjs',
  '.harness/context-budget.mjs': 'context-budget.mjs',
  '.harness/hooks/context-guard.mjs': 'context-guard.mjs',
  '.harness/hooks/precompact-handoff.mjs': 'precompact-handoff.mjs',
  '.harness/hooks/sessionstart-routing.mjs': 'sessionstart-routing.mjs',
  '.harness/hooks/claude-worker-identity.mjs': 'claude-worker-identity.mjs'
};
export function run(root, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: environmentFor(root), encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `${root}: ${args.join(' ')}: ${(result.stderr || result.stdout || result.error?.message || '').slice(-1500)}`);
  return result.stdout;
}
export function featureDigest(features, excluded = []) {
  return sha(JSON.stringify(features.features.filter((f) => !excluded.includes(f.id)).map((f) => {
    const copy = { ...f }; delete copy.scopeBaseline; delete copy.scopeBaselineRef; return copy;
  })));
}
export async function evidenceHashes(root) {
  const result = {};
  for (const entry of await readdir(path.join(root, '.harness/evidence'))) {
    if (entry.endsWith('.json')) result[`.harness/evidence/${entry}`] = sha(await readFile(path.join(root, '.harness/evidence', entry)));
  }
  return result;
}
export async function verifyInstallation(root, record = {}) {
  const config = await json(root, '.harness/config.json');
  assert.equal(config.continuity.mode, 'orchestrated_worker');
  assert.deepEqual(config.context, CONTEXT_DEFAULTS, `${root}: context defaults`);
  const hashes = {};
  for (const [file, asset] of Object.entries(runtimeFiles)) {
    if (asset === 'claude-worker-identity.mjs' && !config.agents.enabled.includes('claude')) continue;
    const bytes = await readFile(path.join(root, file));
    hashes[file] = sha(bytes);
    assert.equal(hashes[file], sha(await readFile(path.join(sourceRoot, 'skill/codex-harness/assets', asset))), `${root}: ${file}`);
    run(root, ['--check', file]);
  }
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  const contextBlock = (await readFile(path.join(sourceRoot, 'skill/codex-harness/assets/context-instructions.md'), 'utf8')).trim().replace(/\r\n/g, '\n');
  const managedBlock = (text) => text.match(/<!-- agent-harness-context-v1 -->[\s\S]*?<!-- \/agent-harness-context-v1 -->/)?.[0].replace(/\r\n/g, '\n');
  assert.match(agents, /ORCHESTRATED_WORKER_CONTINUITY_V1/);
  assert.match(agents, /<!-- agent-harness-context-v1 -->/);
  assert.match(agents, /context --observe --json/);
  assert.match(agents, /fork_turns="none"/);
  assert.match(agents, /bootstrap --json/, `${root}: bounded worker startup must be merged`);
  assert.match(agents, /claim/, `${root}: worker ownership startup`);
  assert(!/\b(?:Read|reads|inspect)[^\r\n]*`\.harness\/(?:features\.json|continuity\.json|progress\.md|handoff\.md)`/.test(agents), `${root}: remove obsolete full-state startup directive`);
  assert.equal(managedBlock(agents), contextBlock, `${root}: complete managed instruction block`);
  for (const [agent, file] of Object.entries(config.agents.instructions)) {
    if (agent === 'codex' || !config.agents.enabled.includes(agent)) continue;
    const text = await readFile(path.join(root, file), 'utf8');
    assert.match(text, /AGENTS\.md/, `${root}: instruction route ${file}`);
    assert.match(text, /agent-harness-context-v1|Proactive context management/, `${root}: context route ${file}`);
    assert.equal(managedBlock(text), contextBlock, `${root}: managed block ${file}`);
  }
  const hooks = await json(root, '.codex/hooks.json');
  const commands = (event) => (hooks.hooks[event] || []).flatMap((entry) => entry.hooks || []);
  const canonicalHooks = await json(sourceRoot, '.codex/hooks.json');
  for (const event of ['PreCompact', 'SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']) {
    for (const expected of canonicalHooks.hooks[event]) assert.equal(hooks.hooks[event]?.filter((entry) => JSON.stringify(entry) === JSON.stringify(expected)).length, 1, `${root}: exactly one canonical Codex ${event} route`);
  }
  if (record.canonicalV2 === true) {
    const {canonicalCodexHooks}=await import('../skill/codex-harness/scripts/lib/hook-policy.mjs');
    assert.deepEqual(hooks,await canonicalCodexHooks(sourceRoot),`${root}: exact canonical V2 definitions`);
  } else {
    assert.equal(commands('PreCompact').filter((h) => h.command?.includes('precompact-handoff.mjs')).length, 1, `${root}: duplicate/missing PreCompact`);
    assert(commands('SessionStart').some((h) => h.command?.includes('sessionstart-routing.mjs')));
    for (const event of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']) assert(commands(event).some((h) => h.command?.includes('context-guard.mjs')), `${root}: ${event}`);
  }
  if (config.agents.enabled.includes('claude')) {
    const claude = await json(root, '.claude/settings.json');
    const canonicalClaude = await json(sourceRoot, '.claude/settings.json');
    for (const event of ['SubagentStart', 'PreCompact', 'SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']) {
      for (const expected of canonicalClaude.hooks[event]) assert.equal(claude.hooks[event]?.filter((entry) => JSON.stringify(entry) === JSON.stringify(expected)).length, 1, `${root}: exactly one canonical Claude ${event} route`);
    }
  }
  const toml = await readFile(path.join(root, '.codex/config.toml'), 'utf8');
  // These reviewed installations use simple TOML assignments; check their table scope.
  let table = ''; const settings = {};
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim(); if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { table = line.replace(/^\[+|\]+$/g, ''); continue; }
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (match) settings[table ? `${table}.${match[1]}` : match[1]] = match[2];
  }
  assert.equal(settings.model_auto_compact_token_limit, '80000');
  assert.equal(settings.model_auto_compact_token_limit_scope, '"total"');
  assert.equal(settings['features.hooks'], 'true', `${root}: hooks enabled in host configuration`);
  if (record.preservedFeatures) assert.equal(featureDigest(await json(root, '.harness/features.json'), record.excludedFeatures || []), record.preservedFeatures, `${root}: preserved features`);
  for (const [file, hash] of Object.entries(record.preservedEvidence || {})) assert.equal(sha(await readFile(path.join(root, file))), hash, `${root}: historical evidence ${file}`);
  for (const [file, hash] of Object.entries(record.reusableSourceHashes || {})) assert.equal(sha(await readFile(path.join(root, file))), hash, `${root}: reusable source ${file}`);
  const doctorResult = spawnSync(process.execPath, ['.harness/run.mjs', 'doctor'], { cwd: root, env: environmentFor(root), encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  const doctor = doctorResult.stdout || '';
  const failures = doctor.split(/\r?\n/).filter((line) => line.startsWith('FAIL'));
  if (record.preexistingDoctorFailures?.length) {
    assert.deepEqual(failures, record.preexistingDoctorFailures, `${root}: only the authenticated preexisting historical doctor failure may remain`);
    assert.equal(doctorResult.status, 1);
  } else { assert.equal(doctorResult.status, 0, doctorResult.stderr || doctor); assert.match(doctor, /Structural state is healthy/); }
  // Verification commands intentionally receive no worker authority. A fresh
  // explicit identity attests only this read-only inspection when the host ID
  // is absent; it never claims ownership or observes/persists context state.
  const contextArgs = ['.harness/run.mjs', 'context', '--json'];
  if (!process.env.CODEX_THREAD_ID) contextArgs.push('--worker-id', `rollout-inspector:${process.pid}`);
  const context = JSON.parse(run(root, contextArgs));
  const session = JSON.parse(run(root, ['.harness/run.mjs', 'session', '--json']));
  assert.equal(session.phase, 'working');
  if (record.continuation) {
    assert.equal(root,targets[4],'Continuation exception is exclusive to ReverseEngineer');
    const bootstrap=JSON.parse(run(root,['.harness/run.mjs','bootstrap','--json']));
    const continuity=await json(root,'.harness/continuity.json');
    assertContinuation(root,record.continuation,{session,bootstrap,continuity});
  } else if (root !== sourceRoot) assert.equal(session.owner, null, `${root}: owner must yield`);
  return { runtimeHashes: hashes, startupInstructionsHash: sha(agents), boundedStartup: 'pass', contextDefaults: config.context, doctor: failures.length ? 'unchanged historical failure' : 'pass', doctorFailures: failures, contextPressure: context.pressure,
    hookRoutes: 'pass', instructionRoutes: 'pass', hostDefaults: '80000/total', preservedState: 'pass',
    historicalWarnings: doctor.split(/\r?\n/).filter((line) => line.startsWith('WARN') && line.includes('legacy evidence')).length };
}
export function assertContinuation(root,anchor,{session,bootstrap,continuity}) {
  assert.equal(root,targets[4]);assert.equal(anchor.root,root);assert(Number.isSafeInteger(anchor.generation));
  assert.equal(session.phase,'working');assert.equal(session.handoffId,null);assert.equal(continuity.phase,'working');assert.equal(continuity.handoff,null);
  assert(Number.isSafeInteger(session.generation)&&session.generation>=anchor.generation);assert.equal(continuity.generation,session.generation);
  assert.deepEqual(session.owner,continuity.owner);assert.equal(bootstrap.continuity.phase,'working');assert.equal(bootstrap.continuity.generation,session.generation);
  assert.deepEqual(bootstrap.continuity.owner,session.owner);assert(Number.isSafeInteger(bootstrap.revision)&&bootstrap.revision>=anchor.featureRevision);
  return {root,generation:session.generation,phase:session.phase,owner:session.owner,featureRevision:bootstrap.revision};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await json(sourceRoot, '.harness/context-rollout-report.json');
  assert.equal(report.version, 1);
  assert.equal(sha(await readFile(path.join(sourceRoot, report.sourceEvidence))), report.sourceEvidenceHash, 'source implementation evidence hash');
  assert.equal((await json(sourceRoot, report.sourceEvidence)).pass, true, 'source implementation gate');
  assert.deepEqual(report.instructionConvergencePending, [], 'startup instruction convergence complete');
  assert.deepEqual(report.targets.map((target) => target.root), targets);
  for (const record of report.targets) {
    assert.equal(record.status, 'verified', `${record.root}: rollout incomplete`);
    assert.equal(record.idempotent, true, `${record.root}: reviewed installation idempotence`);
    assert(!record.remaining && !record.error, `${record.root}: unresolved rollout work`);
    const live = await verifyInstallation(record.root, record);
    assert.deepEqual(record.verification, live, `${record.root}: recorded installation evidence matches live checks`);
    for (const gate of record.finalGates || []) {
      const bytes = await readFile(path.join(record.root, gate.evidence));
      assert.equal(sha(bytes), gate.sha256, `${record.root}: final gate evidence hash`);
      const evidence = JSON.parse(bytes);
      assert.equal(evidence.featureId, gate.featureId);
      assert.equal(evidence.pass, true, `${record.root}: final configured gate`);
    }
    if (record.obsoleteTestArchive) {
      const archive = await json(record.root, record.obsoleteTestArchive.manifest);
      assert.equal(sha(await readFile(path.join(record.root, record.obsoleteTestArchive.manifest))), record.obsoleteTestArchive.sha256);
      assert.equal(archive.records.length, 5);
      for (const entry of archive.records) {
        assert(entry.path.startsWith('tests/') && entry.archive.startsWith('.harness/obsolete-test-archive/') && entry.archive.endsWith('.bak'));
        assert.equal(sha(await readFile(path.join(record.root, entry.archive))), entry.sha256, `${record.root}: archived obsolete test`);
        await assert.rejects(readFile(path.join(record.root, entry.path)), { code: 'ENOENT' });
        await assert.rejects(readFile(path.join(sourceRoot, entry.path)), { code: 'ENOENT' });
      }
    }
  }
  assert.deepEqual(report.totals, { installed: targets.length, verified: targets.length, boundedStartup: targets.length, healthyDoctor: targets.length - 1, unchangedHistoricalDoctorFailure: 1 });
  console.log(`PASS context rollout: ${targets.length} installed harnesses; runtime, defaults, routes, doctor and historical state authenticated.`);
}
