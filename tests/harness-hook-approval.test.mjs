// The existing feature acceptance entrypoint covers policy, transport and recovery.
import './harness-hook-policy.test.mjs';
import './harness-native-hook-client.test.mjs';
import './harness-source-repair.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bootstrap = JSON.parse(await readFile(path.join(repo, 'skill/codex-harness/assets/native-hook-bootstrap-v3.json'), 'utf8'));
function invoke(command, cwd, input, env = {}) {
  assert.ok(command.startsWith('node -e "') && command.endsWith('"'));
  const result = spawnSync(process.execPath, ['-e', command.slice(9, -1)], { cwd, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('frozen native bootstrap dispatches exactly once with intact input and native identity', async () => {
  const root = await mkdtemp(path.join(repo, 'tests', '.harness-bootstrap-'));
  try {
    await initHarness(root);
    const nested = path.join(root, 'src', 'nested'); await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, '.harness/hooks/context-guard.mjs'), "import{readFileSync}from'node:fs';process.stdout.write(JSON.stringify({cwd:process.cwd(),raw:readFileSync(0,'utf8'),identity:process.env.CODEX_THREAD_ID}));\n");
    const hooks = JSON.parse(await readFile(path.join(root, '.codex/hooks.json'), 'utf8'));
    const command = hooks.hooks.UserPromptSubmit[0].hooks[0].command;
    assert.equal(command, bootstrap.commands['codex/context-guard.mjs']);
    assert.equal(hooks.hooks.PreToolUse.length, 1);
    const input = { cwd: nested, hook_event_name: 'UserPromptSubmit', prompt: 'original user input' };
    const output = invoke(command, nested, input, { CODEX_THREAD_ID: 'native-child-identity' });
    assert.equal(output.cwd, root); assert.equal(output.raw, JSON.stringify(input)); assert.equal(output.identity, 'native-child-identity');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('broken mutable dispatcher retains independent repair and ordinary fail-closed behavior at nearest root', async () => {
  const root = await mkdtemp(path.join(repo, 'tests', '.harness-bootstrap-repair-'));
  try {
    await initHarness(root);
    const nearest = path.join(root, 'nested'); await mkdir(path.join(nearest, '.harness'), { recursive: true });
    const home = path.join(root, 'home'); await mkdir(home);
    await writeFile(path.join(home, 'agent-harness-hook-policy.json'), JSON.stringify({ version: 1, enabled: true, authority: 'explicit-canonical-kit-location', sourceRoot: repo, projects: [nearest] }));
    const command = bootstrap.commands['codex/context-guard.mjs'];
    const denied = invoke(command, nearest, { cwd: nearest, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { cmd: 'node ordinary.mjs' } });
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    const repaired = invoke(command, nearest, { cwd: nearest, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { cmd: `node "${path.join(repo, 'bin/agent-harness.mjs')}" repair --preview`, workdir: nearest } }, { CODEX_HOME: home });
    assert.match(repaired.hookSpecificOutput.additionalContext, /already completed/);
    const prompt = invoke(command, nearest, { cwd: nearest, hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
    assert.match(prompt.hookSpecificOutput.additionalContext, /repair/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bootstrap generation no longer embeds mutable helper source', async () => {
  const source = await readFile(path.join(repo, 'skill/codex-harness/scripts/lib/core.mjs'), 'utf8');
  assert.ok(!source.includes('hookRepairCommand.toString()'));
  assert.ok(!source.includes('hookFailure.toString()'));
  assert.equal(bootstrap.version, 3);
  assert.match(bootstrap.commands['codex/context-guard.mjs'], /HARNESS_HOOK_LAUNCHER_V3/);
});
