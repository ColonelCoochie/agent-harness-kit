# AGENTS.md

Maintain Agent Harness Kit: a lean, zero-dependency Node.js 20+ development harness for long-running coding goals with Codex, Claude Code, and GitHub Copilot.

<!-- agent-harness-v7 -->
## Development harness

`.harness/` is the repository-development control plane (features, verification, evidence, worker continuity). It is never application runtime: product code must not import, read, or write it. Facts live in `.harness/config.json` (commands, scope, policies) and `.harness/docs-map.md` (where to read more).

### Long-running goals: orchestrator and workers

- The user-facing chat is the **orchestrator**. It keeps intent, decisions and compact worker results, and routes work. It does not do large implementation itself.
- Implementation runs in **fresh workers** (Codex `fork_turns="none"`, Claude Code a fresh non-fork Agent) with a self-contained prompt. One mutating worker at a time; read-only explorers may run in parallel.
- Worker startup: `node .harness/run.mjs session`, then `claim` (or the exact `resume HANDOFF_ID` the orchestrator gave you), then `bootstrap --validate --json`. Read only the docs the active feature needs.
- Hosts without `CODEX_THREAD_ID` pass the same `--worker-id ID` on `claim`/`resume` and later mutations.

### Feature loop

1. `add ID --title --description --criterion "observable behavior" --command "check" --allow "glob"` (pair each criterion with a command).
2. `start ID` freezes the contract and records the Git baseline. WIP limit and dependencies are enforced.
3. Implement within scope. Use `check quick` while working; fix your own reversible test failures without handing off.
4. `verify ID` runs the configured layers plus acceptance commands and checks scope. A pass marks the feature `passing` and commits its changes. Never hand-edit feature state.
5. Repeated identical failures or an exhausted attempt budget block the feature: stop and report instead of retrying blindly.

### Worker boundaries

- Normal end: `checkpoint --reason worker_yield --summary "what is true now" --next "next step"`, return a short result, stop.
- Need a user decision: `checkpoint --reason needs_input ...`, return one question, stop.
- True context or ownership transfer only: `handoff --summary ... --next ...`. Stop; the orchestrator delegates `resume HANDOFF_ID` to a fresh worker and never runs it itself.
- After host compaction, rebuild state with `session` and `bootstrap`, not from memory.

### Harness rules

- Keep tool output small: read the lines you need; verification prints only failures, and full logs are in `.harness/logs/`.
- Credentials stay in environment variables and reach a command only when its config entry lists `credentials`. Never retry an executed command with another key, and never auto-retry deployments.
- Regressions become new features; `passing` is terminal.
<!-- /agent-harness-v7 -->

## Repository invariants

Before changing implementation code, inspect `package.json`, `README.md`, the reusable skill under `skill/codex-harness/`, and the test suite. Preserve the `agent-harness` CLI and the `codex-harness` compatibility alias. Keep `AGENTS.md` as the canonical workflow; `CLAUDE.md` and `.github/copilot-instructions.md` must route to it without contradictory rules.

Credential values remain environment-only. Never add live keys to fixtures, logs, configuration, evidence, examples, or Git history. Commands receive provider credentials only when their command entry explicitly requests them. Do not add automatic post-execution credential retries.

When changing the generated runtime, edit the reusable source under `skill/codex-harness/assets/`, test it, and use `node bin/agent-harness.mjs sync .` to refresh the checked-in `.harness/` copy. Do not hand-maintain divergent source and generated runtimes.

## Verification

Use the active feature's `node .harness/run.mjs verify <feature-id>`. It runs the quick syntax checks, the Node test suite (`npm test`, about 20 seconds) and the structural self-audit, then the feature's acceptance commands. Tests must keep covering init, sync migration from v6, instruction surfaces, scope, verify/commit, continuity, credentials, redaction, timeouts and the PreCompact hook.
