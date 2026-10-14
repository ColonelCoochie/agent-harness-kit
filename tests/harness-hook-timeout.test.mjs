import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initHarness, planSync, syncHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const roots = [];
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surfaces = [['codex', '.codex/hooks.json'], ['claude', '.claude/settings.json']];
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const entry = settings => settings.hooks.PreCompact[0].hooks[0];
const previous = text => text.replace(/("PreCompact"\s*:[\s\S]*?"timeout"\s*:\s*)600/, (_, prefix) => prefix + '30');
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
  for (const mode of ['init', 'sync']) for (const wrappedWindows of [false, true]) {
    const root = await fixture();
    for (const [platform, relative] of surfaces) {
      const settings = await json(path.join(root, relative)), hook = entry(settings); hook.timeout = 30;
      hook.command = 'node "' + root.replaceAll('\\', '/') + '/.harness/hooks/precompact-handoff.mjs" --platform ' + platform;
      if (platform === 'codex') hook.commandWindows = wrappedWindows ? 'custom-wrapper ' + hook.command : hook.command;
      await save(path.join(root, relative), settings);
    }
    await install(root, mode);
    for (const [platform, relative] of surfaces) {
      const hook = entry(await json(path.join(root, relative)));
      assert.match(hook.command, /HARNESS_HOOK_LAUNCHER_V1/);
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

test.after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 3 });
});
