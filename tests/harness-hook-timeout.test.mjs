import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { initHarness, planSync, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const roots = [];
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surfaces = [['codex', '.codex/hooks.json'], ['claude', '.claude/settings.json']];
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const entry = settings => settings.hooks.PreCompact[0].hooks[0];
const previous = text => text.replace(/("PreCompact"\s*:[\s\S]*?"timeout"\s*:\s*)600/, (_, prefix) => prefix + '30');
const execute = promisify(execFile);
async function doctorOutput(root) {
  try {
    return (await execute(process.execPath, [path.join(root, '.harness/run.mjs'), 'doctor'], { cwd: root, windowsHide: true, env: { ...process.env, CODEX_THREAD_ID: '' } })).stdout;
  } catch (error) {
    // These unversioned fixtures also fail repository checks; inspect the independent hook warning.
    assert.equal(error.code, 1);
    assert.match(error.stdout, /Harness doctor/);
    return error.stdout;
  }
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-hook-timeout-')); roots.push(root);
  await initHarness(root, { name: 'timeout-fixture', purpose: 'Bounded timeout fixture' });
  return root;
}
async function install(root, mode) {
  if (mode === 'init') return initHarness(root, { name: 'timeout-fixture', purpose: 'Bounded timeout fixture' });
  return syncHarness(root);
}
async function runtimeBytes(root) { return readFile(path.join(root, '.harness/run.mjs')); }
async function surfaceBytes(root) { return Promise.all(surfaces.map(([, relative]) => readFile(path.join(root, relative)))); }
function assertTimeouts(settings) {
  assert.equal(entry(settings).timeout, 600);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].timeout, 30);
  if (settings.hooks.SubagentStart) assert.equal(settings.hooks.SubagentStart[0].hooks[0].timeout, 30);
}

test('hook timeout: fresh settings and review additions use bounded PreCompact headroom', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-hook-timeout-')); roots.push(root);
  for (const [, relative] of surfaces) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await save(path.join(root, relative), { hooks: {}, custom: 'retain' });
  }
  await initHarness(root, { name: 'timeout-fixture', purpose: 'Bounded timeout fixture' });
  for (const [platform, relative] of surfaces) {
    assert.deepEqual(await json(path.join(root, relative)), { hooks: {}, custom: 'retain' });
    assertTimeouts(await json(path.join(root, '.harness/' + platform + '-hooks.addition.json')));
  }
  const fresh = await fixture();
  for (const [, relative] of surfaces) assertTimeouts(await json(path.join(fresh, relative)));
  assert.deepEqual(await runtimeBytes(fresh), await readFile(path.join(repository, 'skill/codex-harness/assets/project-runtime.mjs')));
});

test('hook timeout: init and planned sync upgrade generated defaults without touching runtime or unrelated hooks', async () => {
  for (const mode of ['init', 'sync']) {
    const root = await fixture(), runtime = await runtimeBytes(root);
    for (const [, relative] of surfaces) {
      const settings = await json(path.join(root, relative)); entry(settings).timeout = 30;
      settings.custom = { retain: true };
      settings.hooks.PreCompact[0].hooks.push({ type: 'command', command: 'echo unrelated', timeout: 30 });
      await save(path.join(root, relative), settings);
    }
    const before = await surfaceBytes(root);
    if (mode === 'sync') {
      const plan = await planSync(root);
      assert.deepEqual(await surfaceBytes(root), before, 'preview must remain read-only');
      for (const [, relative] of surfaces) assert.ok(plan.operations.some(item => item.path === relative && item.action === 'write'));
      assert.ok(!plan.operations.some(item => item.path === '.harness/run.mjs' && item.action === 'write'));
      await syncHarness(root, { expectedPlanHash: plan.planHash });
    } else await install(root, mode);
    for (const [, relative] of surfaces) {
      const settings = await json(path.join(root, relative)); assertTimeouts(settings);
      assert.deepEqual(settings.custom, { retain: true });
      assert.deepEqual(settings.hooks.PreCompact[0].hooks[1], { type: 'command', command: 'echo unrelated', timeout: 30 });
    }
    const after = await surfaceBytes(root); await install(root, mode);
    assert.deepEqual(await surfaceBytes(root), after, 'repeat install must be byte-idempotent');
    assert.deepEqual(await runtimeBytes(root), runtime);
  }
});

test('hook timeout: legacy commands upgrade while customized Windows wrappers remain intact', async () => {
  const frozen = JSON.parse(await readFile(path.join(repository, 'skill/codex-harness/assets/native-hook-bootstrap-v1.json'), 'utf8'));
  for (const mode of ['init', 'sync']) for (const legacy of ['absolute', 'frozen-v1']) for (const wrappedWindows of [false, true]) {
    const root = await fixture();
    for (const [platform, relative] of surfaces) {
      const settings = await json(path.join(root, relative)), hook = entry(settings); hook.timeout = 30;
      hook.command = legacy === 'frozen-v1' ? frozen.commands[platform + '/precompact-handoff.mjs'] : 'node "' + root.replaceAll('\\', '/') + '/.harness/hooks/precompact-handoff.mjs" --platform ' + platform;
      if (platform === 'codex') hook.commandWindows = wrappedWindows ? 'custom-wrapper ' + hook.command : hook.command;
      await save(path.join(root, relative), settings);
    }
    await install(root, mode);
    for (const [platform, relative] of surfaces) {
      const hook = entry(await json(path.join(root, relative)));
      assert.equal(hook.command, JSON.parse(await readFile(path.join(repository, 'skill/codex-harness/assets/native-hook-bootstrap-v3.json'), 'utf8')).commands[platform + '/precompact-handoff.mjs']);
      assert.equal(hook.timeout, wrappedWindows && platform === 'codex' ? 30 : 600);
      if (wrappedWindows && platform === 'codex') assert.match(hook.commandWindows, /^custom-wrapper node /);
    }
  }
});

test('hook timeout: custom timeouts and wrappers and options are byte-preserved', async () => {
  const variants = [
    settings => { entry(settings).timeout = 450; },
    settings => { entry(settings).timeout = '30'; },
    settings => { delete entry(settings).timeout; },
    settings => { entry(settings).command = 'custom-wrapper ' + entry(settings).command; },
    settings => { entry(settings).commandWindows = 'custom-wrapper ' + entry(settings).command; },
    settings => { entry(settings).command = 'node "/project/.harness/hooks/precompact-handoff.mjs-copy"'; },
    settings => { settings.hooks.PreCompact[0].matcher = 'custom'; },
    settings => { entry(settings).async = true; }
  ];
  for (const mode of ['init', 'sync']) for (const customize of variants) {
    const root = await fixture();
    for (const [, relative] of surfaces) {
      const settings = await json(path.join(root, relative)); entry(settings).timeout = 30; customize(settings);
      await save(path.join(root, relative), settings);
    }
    const before = await surfaceBytes(root); await install(root, mode);
    assert.deepEqual(await surfaceBytes(root), before);
  }
});

test('hook timeout: old additions refresh and resolve while modified additions survive repeated install', async () => {
  for (const mode of ['init', 'sync']) for (const modification of ['canonical', 'notes', 'formatting']) {
    const root = await fixture(), settingsBytes = await surfaceBytes(root), originals = [];
    for (const [, relative] of surfaces) await save(path.join(root, relative), { hooks: {}, custom: 'retain' });
    await install(root, mode);
    for (const [platform] of surfaces) {
      const file = path.join(root, '.harness/' + platform + '-hooks.addition.json');
      let content = previous(await readFile(file, 'utf8'));
      if (modification === 'notes') content += '\nManual merge notes: retain this file.\n';
      if (modification === 'formatting') content = JSON.stringify(JSON.parse(content)) + '\n';
      if (modification === 'canonical') content = content.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
      await writeFile(file, content); originals.push(content);
    }
    await install(root, mode);
    for (const [index, [platform]] of surfaces.entries()) {
      const file = path.join(root, '.harness/' + platform + '-hooks.addition.json');
      if (modification === 'canonical') assertTimeouts(await json(file));
      else assert.equal(await readFile(file, 'utf8'), originals[index]);
    }
    const after = await Promise.all(surfaces.map(([platform]) => readFile(path.join(root, '.harness/' + platform + '-hooks.addition.json'))));
    await install(root, mode);
    assert.deepEqual(await Promise.all(surfaces.map(([platform]) => readFile(path.join(root, '.harness/' + platform + '-hooks.addition.json')))), after);
    for (const [index, [, relative]] of surfaces.entries()) await writeFile(path.join(root, relative), settingsBytes[index]);
    await install(root, mode);
    for (const [index, [platform]] of surfaces.entries()) {
      const file = path.join(root, '.harness/' + platform + '-hooks.addition.json');
      if (modification === 'canonical') await assert.rejects(readFile(file), /ENOENT/);
      else assert.equal(await readFile(file, 'utf8'), originals[index]);
    }
  }
});

test('hook routing preserves repair additions for inactive lifecycle matchers and malformed groups', async () => {
  const changes = [
    ['PreCompact', group => { group.matcher = 'never-matches'; }],
    ['SessionStart', group => { group.matcher = '^startup$'; }],
    ['PreCompact', group => { group.matcher = []; }],
    ['PreCompact', group => { group.enabled = false; }],
    ['PreCompact', group => { group.hooks = [null]; }],
  ];
  for (const [platform, relative] of surfaces) for (const [event, change] of changes) {
    const root = await fixture(), file = path.join(root, relative);
    const settings = await json(file); change(settings.hooks[event][0]); await save(file, settings);
    const before = await readFile(file), addition = path.join(root, '.harness/' + platform + '-hooks.addition.json');
    await syncHarness(root, { approveNativeHooks: false });
    const expected = await readFile(addition);
    await rm(addition);
    const stdout = await doctorOutput(root);
    assert.match(stdout, platform === 'codex' ? /Codex automatic compaction guard is not merged/ : /Claude native identity\/compaction hooks are absent or unmerged/);
    await syncHarness(root, { approveNativeHooks: false });
    assert.deepEqual(await readFile(addition), expected);
    assert.deepEqual(await readFile(file), before, 'customized lifecycle groups remain reviewable');
  }
});

test('hook routing uses the platform command before clearing repair additions', async () => {
  for (const [platform, relative] of surfaces) {
    const root = await fixture(), file = path.join(root, relative), settings = await json(file);
    settings.hooks.PreCompact[0].hooks[0].commandWindows = 'node custom-wrapper.mjs';
    await save(file, settings); const before = await readFile(file);
    const addition = path.join(root, '.harness/' + platform + '-hooks.addition.json');
    await syncHarness(root, { approveNativeHooks: false });
    if (process.platform === 'win32') {
      const expected = await readFile(addition);
      await syncHarness(root, { approveNativeHooks: false });
      assert.deepEqual(await readFile(addition), expected);
    } else await assert.rejects(readFile(addition), /ENOENT/);
    const stdout = await doctorOutput(root);
    const warning = platform === 'codex' ? /Codex automatic compaction guard is not merged/ : /Claude native identity\/compaction hooks are absent or unmerged/;
    if (process.platform === 'win32') assert.match(stdout, warning);
    else assert.doesNotMatch(stdout, warning);
    assert.deepEqual(await readFile(file), before);
  }
});

test('embedded canonical context commands require a matching lifecycle group', async () => {
  for (const [platform, relative] of surfaces) {
    const root = await fixture(), file = path.join(root, relative), settings = await json(file);
    const original = settings.hooks.PreToolUse[0];
    original.matcher = 'never-matches';
    await save(file, settings);
    await syncHarness(root, { approveNativeHooks: false });
    const groups = (await json(file)).hooks.PreToolUse;
    assert.deepEqual(groups[0], original, platform + ' customized group stays intact');
    assert.equal(groups.length, 2);
    assert.equal(groups[1].matcher, '.*');
    const before = await readFile(file);
    await syncHarness(root, { approveNativeHooks: false });
    assert.deepEqual(await readFile(file), before, 'canonical matching group is recognized on repeat sync');
  }
});

test.after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 3 });
});
