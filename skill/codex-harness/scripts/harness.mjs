#!/usr/bin/env node
// Agent Harness Kit CLI: scaffold, upgrade and audit project harnesses.
import { auditHarness, formatAudit, HARNESS_VERSION, initHarness, parseArgs, syncHarness } from './lib/core.mjs';

const HELP = `Agent Harness Kit v${HARNESS_VERSION}

Usage:
  agent-harness init [project] [--name NAME] [--purpose TEXT] [--commands "cmd,cmd"] [--agents codex,claude,github-copilot] [--force]
  agent-harness sync [project] [--preview] [--prune] [--json]
  agent-harness audit [project] [--json] [--min-score N]

init   scaffolds .harness/ plus AGENTS.md/CLAUDE.md/Copilot adapters and a fail-open PreCompact hook.
sync   installs the current runtime, migrates v6 state, removes v6 per-tool hooks and runtime leftovers,
       and refreshes the harness block in instruction files (project-specific sections are kept).
       --prune also deletes ad-hoc files in .harness/ outside the v7 layout (archive them first).
audit  scores the harness structure and runs the project's doctor.

Day-to-day work uses the project controller: node .harness/run.mjs help`;

const argv = process.argv.slice(2);
const args = parseArgs(argv);
const [command, target] = args._;

try {
  if (!command || command === 'help' || args.help) console.log(HELP);
  else if (command === 'init') {
    const result = initHarness(target, args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Initialized ${result.root}`);
      for (const action of result.actions) console.log(`  ${action}`);
      for (const warning of result.warnings) console.log(`  WARN ${warning}`);
      if (!result.config.verification.full.length) console.log('  Set verification.full in .harness/config.json before verifying features.');
    }
  } else if (command === 'sync') {
    const result = syncHarness(target, args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.preview ? 'Preview' : 'Synced'} ${result.root}`);
      for (const action of result.actions) console.log(`  ${action}`);
      for (const removal of result.removals) console.log(`  remove ${removal}`);
      for (const item of result.legacy ?? []) console.log(`  would remove .harness/${item}`);
      for (const item of result.prune ?? []) console.log(`  would prune .harness/${item}`);
      for (const warning of result.warnings ?? []) console.log(`  WARN ${warning}`);
      if (!result.preview && !result.actions.length && !result.removals.length) console.log('  Already current.');
    }
  } else if (command === 'audit') {
    const result = auditHarness(target);
    console.log(args.json ? JSON.stringify(result, null, 2) : formatAudit(result));
    if (args.minScore !== undefined && result.score < Number(args.minScore)) process.exitCode = 1;
  } else if (['repair', 'hook-policy'].includes(command)) {
    console.log(`'${command}' was removed in v7: hooks are a single fail-open PreCompact note, so there is nothing to repair or auto-approve. Use 'sync'.`);
  } else {
    throw new Error(`Unknown command ${command}. Run agent-harness help.`);
  }
} catch (error) {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
}
