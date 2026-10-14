#!/usr/bin/env node

import path from 'node:path';
import {
  auditHarness,
  formatAudit,
  initHarness,
  parseArgs,
  syncHarness
} from './lib/core.mjs';

const rawArgv = process.argv.slice(2);
const args = parseArgs(rawArgv);
const command = args._[0] ?? (args.help ? 'help' : null);
const COMMAND_OPTIONS = Object.freeze({
  init: new Set(['target', 'name', 'purpose', 'commands', 'agents', 'force', 'wipLimit', 'maxAttempts', 'maxRepeatedFailures', 'commandTimeoutMs']),
  audit: new Set(['target', 'json', 'minScore']),
  sync: new Set(['target', 'preview', 'json', 'replaceReviewed', 'expectPlan'])
});
const COMMAND_HELP = Object.freeze({
  init: `Agent Harness Kit

Usage:
  agent-harness init [project] [--name NAME] [--purpose TEXT] [--commands cmd,cmd] [--agents codex,claude,github-copilot] [--force]

Scaffold a project harness while preserving existing user-owned instruction files.`,
  audit: `Agent Harness Kit

Usage:
  agent-harness audit [project] [--json] [--min-score 75]

Inspect a project harness and report its structural score without changing it.`,
  sync: `Agent Harness Kit

Usage:
  agent-harness sync [project] [--preview] [--json] [--replace-reviewed PATH=SHA256] [--expect-plan SHA256]

Preview or apply a guarded managed update. Unknown executable copies block the entire apply.
--preview performs only reads. --replace-reviewed is repeatable and permits replacement
only of enabled .harness/run.mjs or .harness/hooks/*.mjs paths with matching raw SHA256.
--expect-plan binds apply to the deterministic reviewed plan hash. Customized instructions
and notes remain reviewable additions; project facts and historical evidence are preserved.`
});

try {
  if (helpRequested(rawArgv) || !command || command === 'help') {
    printHelp(command === 'help' ? args._[1] : command);
  } else if (command === 'init') {
    validateCommandOptions(command, args, rawArgv);
    const target = path.resolve(args._[1] || args.target || process.cwd());
    const result = await initHarness(target, args);
    console.log(`Scaffolded project harness at ${result.target}`);
    console.log(`Detected stack: ${result.profile.stack}`);
    for (const item of result.results) {
      console.log(`${item.status.toUpperCase().padEnd(9)} ${path.relative(result.target, item.path) || '.'}`);
    }
    console.log('\nNext: review .harness/config.json, then run node .harness/run.mjs session and doctor');
  } else if (command === 'audit') {
    validateCommandOptions(command, args, rawArgv);
    const target = path.resolve(args._[1] || args.target || process.cwd());
    const result = await auditHarness(target);
    console.log(args.json ? JSON.stringify(result, null, 2) : formatAudit(result));
    if (result.criticalFailures > 0 || result.overall < Number(args.minScore || 75)) process.exitCode = 1;
  } else if (command === 'sync') {
    validateCommandOptions(command, args, rawArgv);
    const target = path.resolve(args._[1] || args.target || process.cwd());
    const replacements = {};
    for (const entry of args.replaceReviewed ?? []) {
      const split = String(entry).lastIndexOf('=');
      const relative = String(entry).slice(0, split), hash = String(entry).slice(split + 1);
      if (split < 0 || Object.hasOwn(replacements, relative)) throw new Error('Each --replace-reviewed needs one unique PATH=SHA256.');
      replacements[relative] = hash;
    }
    const result = await syncHarness(target, { preview: Boolean(args.preview), replacements, expectedPlanHash: args.expectPlan });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else if (args.preview) {
      console.log(`Sync preview ${result.planHash}${result.blocked ? ' BLOCKED' : ''}`);
      for (const item of result.operations) console.log(`${item.action.toUpperCase().padEnd(9)} ${item.path}`);
      for (const item of result.blockers) console.log(`REVIEW ${item.path} ${item.beforeHash}: ${item.reason}`);
    } else {
    console.log(`${result.result.status === 'unchanged' ? 'Confirmed' : 'Updated'} ${path.relative(result.target, result.result.path)} at harness runtime v${result.version}.`);
    for (const migrated of result.migrations) console.log(`MIGRATED ${migrated}`);
    for (const repaired of result.repairs) console.log(`REPAIRED ${repaired}`);
    for (const asset of result.canonicalAssetResults) {
      if (asset.status === 'migrated') {
        console.log(`MIGRATED ${asset.path} from the verified canonical runtime-v5 predecessor.`);
      } else if (asset.status === 'preserved') {
        console.log(`REVIEW   Preserved ${asset.path}; merge canonical runtime-v6 content from ${asset.reviewPath}.`);
      }
      if (asset.reviewStatus === 'removed') console.log(`RESOLVED Removed generated addition ${asset.reviewPath}.`);
      if (asset.reviewStatus === 'preserved_modified') {
        console.log(`REVIEW   Preserved modified addition ${asset.reviewPath}; remove it manually after confirming ${asset.path}.`);
      }
    }
    }
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}

function helpRequested(argv) {
  return argv.some((token) => token === '-h' || token === '--help' || token.startsWith('--help='));
}

function validateCommandOptions(name, parsed, argv) {
  const allowed = COMMAND_OPTIONS[name];
  if (!allowed) throw new Error(`Unknown command: ${name}`);
  const unknown = Object.keys(parsed)
    .filter((key) => key !== '_' && !allowed.has(key))
    .map(optionName);
  unknown.push(...shortOptions(argv));
  const unique = [...new Set(unknown)];
  if (unique.length) throw new Error(`Unknown options for ${name}: ${unique.join(', ')}. Run agent-harness ${name} --help for usage.`);
}

function shortOptions(argv) {
  const found = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      if (!token.includes('=') && argv[index + 1] && !argv[index + 1].startsWith('--')) index += 1;
      continue;
    }
    if (token !== '-' && token !== '-h' && token.startsWith('-')) found.push(token);
  }
  return found;
}

function optionName(key) {
  if (!key) return '--';
  return `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function printHelp(specificCommand = null) {
  if (Object.hasOwn(COMMAND_HELP, specificCommand)) {
    console.log(COMMAND_HELP[specificCommand]);
    return;
  }
  console.log(`Agent Harness Kit

Usage:
  agent-harness init [project] [--name NAME] [--purpose TEXT] [--commands "cmd,cmd"] [--agents "codex,claude,github-copilot"]
  agent-harness audit [project] [--json] [--min-score 75]
  agent-harness sync [project]

Initialization preserves existing files. --agents selects one or more known coding-agent
surfaces; AGENTS.md remains the canonical boundary router even when Codex is disabled.
--force overwrites managed .harness files,
but never overwrites existing AGENTS.md, CLAUDE.md, Copilot instructions, or Codex hooks. Sync is
idempotent, refuses an active state lock, fills missing legacy defaults, upgrades only
verified canonical predecessor assets, and preserves customized copies with review additions.`);
}
