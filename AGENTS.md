# AGENTS.md

Maintain Agent Harness Kit as a zero-dependency Node.js 20+ project skeleton for Codex, Claude Code, and GitHub Copilot.

Before changing code, inspect `package.json`, `README.md`, the reusable skill under `skill/codex-harness/`, and the test suite. Preserve the `agent-harness` CLI and the `codex-harness` compatibility alias. Keep `AGENTS.md` as the canonical generated workflow; `CLAUDE.md` and `.github/copilot-instructions.md` must route to it without contradictory rules.

Credential values must remain environment-only. Never add live keys to fixtures, logs, configuration, evidence, examples, or Git history. Commands receive provider credentials only when their command entry explicitly requests them. Do not add automatic post-execution credential retries.

Run `npm test` and Node syntax checks for the reusable initializer and generated runtime before completion. Test initialization, migration, all instruction surfaces, missing-key behavior, round-robin selection, redaction, and evidence metadata.
