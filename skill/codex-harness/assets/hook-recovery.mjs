import repairFs from 'node:fs';
import repairOs from 'node:os';

// Self-contained functions embedded in the frozen native bootstrap. Recovery
// never imports an installed helper, dispatcher, runtime, or source record.
export function repairRealPath(value, p, fs = repairFs) {
  const absolute = p.resolve(value);
  for (let cursor = absolute;; cursor = p.dirname(cursor)) {
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Repair refuses symbolic links');
    if (p.dirname(cursor) === cursor) break;
  }
  if (fs.realpathSync(absolute) !== absolute) throw new Error('Repair requires a canonical path');
  return absolute;
}

export function nearestHarnessRoot(cwd, p, fs = repairFs) {
  let root = repairRealPath(cwd, p, fs);
  for (;;) {
    const directory = p.join(root, '.harness');
    try {
      const info = fs.lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid nearest harness directory');
      repairRealPath(directory, p, fs);
      return root;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = p.dirname(root);
    if (parent === root) throw new Error('No nearest harness installation');
    root = parent;
  }
}

export function repairArguments(words, root, p) {
  words = [...words];
  if (words[0] && !words[0].startsWith('--')) {
    const project = words.shift();
    if (!p.isAbsolute(project) || p.resolve(project) !== root) throw new Error('Repair target must be the nearest enrolled project');
  }
  const flags = new Set(), replacements = {};
  let preview = false, expectedPlanHash, json = false, workerId;
  while (words.length) {
    const flag = words.shift();
    if (flag !== '--replace-reviewed' && flags.has(flag)) throw new Error('Duplicate repair option');
    flags.add(flag);
    if (flag === '--preview') preview = true;
    else if (flag === '--json') json = true;
    else if (flag === '--worker-id') {
      workerId = words.shift();
      if (!/^[a-zA-Z0-9_./:-]{1,200}$/.test(workerId ?? '') || workerId.startsWith('--')) throw new Error('Repair requires a valid worker identity');
    } else if (flag === '--expect-plan') {
      expectedPlanHash = words.shift();
      if (!/^[a-f0-9]{64}$/.test(expectedPlanHash ?? '')) throw new Error('Repair requires a SHA256 plan');
    } else if (flag === '--replace-reviewed') {
      const replacement = words.shift() ?? '';
      if (!/^\.harness\/(?:(?:run|context-budget|windows-command|repair|hooks\/[a-z-]+)\.mjs|windows-command-supervisor\.ps1|hooks\/native-hook-bootstrap-v[123]\.json)=[a-f0-9]{64}$/.test(replacement)) throw new Error('Repair replacement must name a managed executable or bootstrap manifest and raw SHA256');
      const split = replacement.lastIndexOf('='), relative = replacement.slice(0, split);
      if (Object.hasOwn(replacements, relative)) throw new Error('Duplicate repair replacement');
      replacements[relative] = replacement.slice(split + 1);
    } else throw new Error('Unknown repair option');
  }
  if (preview === Boolean(expectedPlanHash)) throw new Error('Repair requires either --preview or --expect-plan SHA256');
  return { target: root, preview, expectedPlanHash, replacements, json, workerId };
}

export function sourceRepairAuthority(root, cli, p, fs = repairFs, environment = process.env, userHome = repairOs.homedir()) {
  if (typeof cli !== 'string' || !p.isAbsolute(cli) || !p.isAbsolute(root)) throw new Error('Repair authority requires absolute paths');
  const home = environment.CODEX_HOME || p.join(userHome, '.codex');
  if (!p.isAbsolute(home)) throw new Error('CODEX_HOME must be an absolute path');
  const policyPath = p.join(p.resolve(home), 'agent-harness-hook-policy.json');
  repairRealPath(policyPath, p, fs);
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  if (policy.version !== 1 || policy.enabled !== true || policy.authority !== 'explicit-canonical-kit-location'
    || typeof policy.sourceRoot !== 'string' || !p.isAbsolute(policy.sourceRoot)
    || !Array.isArray(policy.projects) || !policy.projects.every(project => typeof project === 'string' && p.isAbsolute(project))) throw new Error('Missing or invalid enabled source repair policy');
  const sourceRoot = repairRealPath(policy.sourceRoot, p, fs), projectRoot = repairRealPath(root, p, fs);
  if (!policy.projects.includes(projectRoot)) throw new Error('Nearest harness project is not enrolled for source repair');
  if (nearestHarnessRoot(projectRoot, p, fs) !== projectRoot) throw new Error('Repair project is not the nearest harness');
  const expectedCli = p.join(sourceRoot, 'bin', 'agent-harness.mjs');
  if (p.resolve(cli) !== expectedCli || repairRealPath(cli, p, fs) !== expectedCli || !fs.lstatSync(cli).isFile()) throw new Error('Repair CLI differs from the approved source authority');
  return { sourceRoot, projectRoot, policyPath };
}

export function hookRepairCommand(input, root, p, fs = repairFs, environment = process.env, userHome = repairOs.homedir()) {
  try {
    if (input.tool_name !== 'Bash' && !/(?:^|__|\.)(?:exec_command|shell_command|run_shell_command)$/.test(String(input.tool_name ?? ''))) return false;
    const value = input.tool_input;
    const command = typeof value === 'string' ? value : value?.cmd ?? value?.command;
    if (typeof command !== 'string' || /[;&|$\r\n<>]/.test(command) || command.includes(String.fromCharCode(96))) return false;
    const words = []; let word = '', quote = 0;
    for (const character of command.trim()) {
      const code = character.charCodeAt(0);
      if (quote) { if (code === quote) quote = 0; else word += character; }
      else if (code === 34 || code === 39) quote = code;
      else if (/\s/.test(character)) { if (word) { words.push(word); word = ''; } }
      else word += character;
    }
    if (quote) return false;
    if (word) words.push(word);
    const cwd = p.resolve(value?.workdir ?? value?.cwd ?? input.cwd ?? root);
    if (nearestHarnessRoot(cwd, p, fs) !== root || !/^node(?:\.exe)?$/.test(words.shift() ?? '')) return false;
    const cli = words.shift();
    if (words.shift() !== 'repair') return false;
    if (cwd !== root && (!words[0] || words[0].startsWith('--'))) return false;
    const args = repairArguments(words, root, p);
    if (environment.CODEX_THREAD_ID && args.workerId && environment.CODEX_THREAD_ID !== args.workerId) return false;
    sourceRepairAuthority(root, cli, p, fs, environment, userHome);
    return true;
  } catch { return false; }
}

export function hookFailure(input, message, repair = false) {
  const event = input?.hook_event_name ?? '';
  const reason = 'Harness context guard failed: ' + String(message).slice(0, 600) + '. Use the absolute approved source bin/agent-harness.mjs repair command with --preview, then --expect-plan SHA256 and narrowly reviewed replacements. Source policy and runtime ownership checks still apply.';
  if (event === 'UserPromptSubmit') return input.content_item_kinds?.includes('goal.internal_context') ? { decision: 'block', reason } : { hookSpecificOutput: { hookEventName: event, additionalContext: reason } };
  if (event === 'PostToolUse' && repair) return { hookSpecificOutput: { hookEventName: event, additionalContext: reason + ' The repair command already completed; use its result and do not replay side effects.' } };
  if (event === 'PreToolUse') return { hookSpecificOutput: { hookEventName: event, ...(repair ? { additionalContext: reason } : { permissionDecision: 'deny', permissionDecisionReason: reason }) } };
  return { continue: false, stopReason: reason };
}

