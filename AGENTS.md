# AGENTS.md

Maintain Agent Harness Kit as a zero-dependency Node.js 20+ project skeleton for Codex, Claude Code, and GitHub Copilot.

Before changing code, inspect `package.json`, `README.md`, the reusable skill under `skill/codex-harness/`, and the test suite. Preserve the `agent-harness` CLI and the `codex-harness` compatibility alias. Keep `AGENTS.md` as the canonical generated workflow; `CLAUDE.md` and `.github/copilot-instructions.md` must route to it without contradictory rules.

Credential values must remain environment-only. Never add live keys to fixtures, logs, configuration, evidence, examples, or Git history. Commands receive provider credentials only when their command entry explicitly requests them. Do not add automatic post-execution credential retries.

Run `npm test` and Node syntax checks for the reusable initializer and generated runtime before completion. Test initialization, migration, all instruction surfaces, missing-key behavior, round-robin selection, redaction, and evidence metadata.

## Development-Harness Boundary

`.harness/` governs repository-development work, verification, evidence, and fresh-task continuity only. It is not application runtime and must never be imported by, deployed with, or used to orchestrate a product built with this kit.

Before changing project files, run `node .harness/run.mjs session` and inspect `.harness/continuity.json`. If it reports `awaiting_resume`, run the exact printed `node .harness/run.mjs resume <handoff-id>` command only from a genuinely fresh task. Then read `.harness/config.json`, `.harness/features.json`, `.harness/progress.md`, `.harness/handoff.md`, and the task-relevant routes in `.harness/docs-map.md`; run `doctor`, `status`, and `next`.

Use one active feature by default and mutate feature state only through `.harness/run.mjs`. Successful `verify` evidence is the only route to `passing`. Use bounded checkpoints while work continues and a dirty-safe terminal `handoff` at the end; after `STOP_CURRENT_CHAT`, do not edit or resume in the same task.
