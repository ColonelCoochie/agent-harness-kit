---
name: codex-harness
description: Initialize, operate, audit or upgrade the zero-dependency repository-development harness (.harness/run.mjs) for Codex, Claude Code and GitHub Copilot. Use for long-running coding goals that need an orchestrator chat with fresh bounded workers, WIP-limited features with frozen contracts, cumulative verification with evidence, scope checks, checkpoints and handoffs. Never use it as application runtime.
---

# Repository Development Harness

`.harness/` is a development control plane. Product agents, loops and schedulers keep their own state and never read or write `.harness/`.

## Set up or upgrade

```bash
node <skill-dir>/scripts/harness.mjs init <project> --name "Name" --purpose "One sentence" --agents codex,claude
node <skill-dir>/scripts/harness.mjs sync <project> [--preview] [--prune]
node <skill-dir>/scripts/harness.mjs audit <project>
```

After `init`: set the real `verification.full` command in `.harness/config.json`, make sure the repo has a HEAD commit, and run `node .harness/run.mjs doctor`. `sync` migrates v6 projects in place and keeps project-specific instruction sections.

## Operate (long-running goals)

1. The user-facing chat is the orchestrator: keep intent, decisions and compact worker results. Delegate a feature by passing `node .harness/run.mjs brief ID` unchanged to the `harness-worker` agent (never a fork), and reviews via `brief ID --role checker` to `harness-checker`. One mutating worker at a time. Do small, low-risk changes directly instead of spawning a worker.
2. Worker startup: `node .harness/run.mjs session`, `claim` (or the exact delegated `resume HANDOFF_ID`), `bootstrap --validate --json`, then only the docs the feature needs (`.harness/docs-map.md`).
3. Plan the goal as features small enough for one worker: `add ID --title --description --criterion C --command CMD --allow GLOB [--depends ID]`.
4. `start ID` → implement within scope → `check quick` while working → `verify ID`. A pass marks the feature `passing` and commits. Fix your own reversible failures; stop when the runtime blocks the feature for repeated failures or budget.
5. End the worker: `checkpoint --reason worker_yield --summary ... --next ...` (or `needs_input` with one question). Use `handoff` only for a true transfer; the orchestrator gives `resume HANDOFF_ID` to a fresh worker.
6. Optional maker/checker split for risky work: `.harness/loops/maker.md`, `checker.md`, `goal.md`.

Run `node .harness/run.mjs help` for every command. Hosts without `CODEX_THREAD_ID` pass `--worker-id ID` on mutations.

## Invariants

- WIP limit (default 1), dependencies, and frozen contracts are enforced; `passing` only comes from `verify`, and is terminal (regressions are new features).
- Scope: changes since `start` must match the feature's allow/deny globs; `config.json` changes need explicit scope.
- Credentials are environment-only and injected only into command entries that list them; output is redacted; no automatic credential or deployment retries.
- The only hook is a fail-open PreCompact progress note. Nothing intercepts ordinary tool calls.

## References

- [architecture.md](references/architecture.md): subsystems and boundaries.
- [operations.md](references/operations.md): state machine, verification, continuity, configuration.
- [audit-model.md](references/audit-model.md) and [lecture-map.md](references/lecture-map.md): scoring and design traceability.
