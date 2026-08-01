#!/usr/bin/env node

import path from 'node:path';
import {
  auditHarness,
  formatAudit,
  initHarness,
  parseArgs,
  syncHarness
} from './lib/core.mjs';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? (args.help ? 'help' : null);

try {
  if (!command || command === 'help') {
    printHelp();
  } else if (command === 'init') {
    const target = path.resolve(args._[1] || args.target || process.cwd());
    const result = await initHarness(target, args);
    console.log(`Scaffolded project harness at ${result.target}`);
    console.log(`Detected stack: ${result.profile.stack}`);
    for (const item of result.results) {
      console.log(`${item.status.toUpperCase().padEnd(9)} ${path.relative(result.target, item.path) || '.'}`);
    }
    console.log('\nNext: review .harness/config.json, then run node .harness/run.mjs session and doctor');
  } else if (command === 'audit') {
    const target = path.resolve(args._[1] || args.target || process.cwd());
    const result = await auditHarness(target);
    console.log(args.json ? JSON.stringify(result, null, 2) : formatAudit(result));
    if (result.criticalFailures > 0 || result.overall < Number(args.minScore || 75)) process.exitCode = 1;
  } else if (command === 'sync') {
    const target = path.resolve(args._[1] || args.target || process.cwd());
    const result = await syncHarness(target);
    console.log(`${result.result.status === 'unchanged' ? 'Confirmed' : 'Updated'} ${path.relative(result.target, result.result.path)} at harness runtime v${result.version}.`);
    for (const migrated of result.migrations) console.log(`MIGRATED ${migrated}`);
    for (const repaired of result.repairs) console.log(`REPAIRED ${repaired}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`Agent Harness Kit

Usage:
  agent-harness init [project] [--name NAME] [--purpose TEXT] [--commands "cmd,cmd"] [--agents "codex,claude,github-copilot"]
  agent-harness audit [project] [--json] [--min-score 75]
  agent-harness sync [project]

Initialization preserves existing files. --agents selects one or more known coding-agent
surfaces; AGENTS.md remains the canonical boundary router even when Codex is disabled.
--force overwrites managed .harness files,
but never overwrites existing AGENTS.md, CLAUDE.md, Copilot instructions, or Codex hooks. Sync is
idempotent, refuses an active state lock, and fills missing legacy defaults without
replacing project facts.`);
}
