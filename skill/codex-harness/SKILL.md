---
name: codex-harness
description: Initialize, audit, operate, repair, or simplify reusable project harnesses for Codex, Claude Code, and GitHub Copilot with native instruction files, project-specific verification profiles, opt-in multi-key OpenAI and Anthropic credential pools, WIP-limited feature state, executable completion gates, durable evidence, bounded checkpoints, and terminal fresh-task handoffs. Use when a repository needs reliable coding-agent startup, verification, or cross-task continuity; when agents lose context or drift; when an agent claims completion without proof; or when adapting one common harness across multiple projects.
---

# Project Harness

Build a small project control plane shared by Codex, Claude Code, and GitHub Copilot. Keep reusable procedure in this skill and project facts in the target repository.

## Workflow

1. Inspect the target before writing: existing `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, agent configuration, `.harness/`, docs and decision records, manifests, scripts, tests, and git state. Identify any product, security, data-rights, external-provider, or deployment gate that must pass before implementation.
2. Initialize only when `.harness/config.json` is absent:

   ```bash
   node <skill-dir>/scripts/harness.mjs init <project-dir> --name "Project name" --purpose "One-sentence purpose"
   ```

3. Review detected commands in `.harness/config.json`. Replace guesses with the project's real quick, full, end-to-end, architecture, and cleanup commands.
4. Preserve existing agent instructions. Merge any `.harness/*.addition.md` manually only after checking for conflicts. Keep `AGENTS.md` canonical, have `CLAUDE.md` import `@AGENTS.md`, and keep Copilot guidance consistent.
5. At the start of every task, inspect the lifecycle before changing files:

   ```bash
   node <project-dir>/.harness/run.mjs session
   ```

   If it reports `awaiting_resume`, continue only from a genuinely fresh task and run the exact `resume HANDOFF_ID` command it prints. Never resume from the handing-off conversation or use context compaction as a substitute.
6. Run the structural audit and local startup checks:

   ```bash
   node <skill-dir>/scripts/harness.mjs audit <project-dir>
   node <project-dir>/.harness/run.mjs doctor
   node <project-dir>/.harness/run.mjs status
   node <project-dir>/.harness/run.mjs next
   ```

7. Add concrete features whose behavior fits one working generation. Pair every observable `--criterion` with one `--command`, and declare bounded scope with `--allow`.
8. Operate state only through `.harness/run.mjs`: `session`, `resume`, `add`, `start`, `block`, `unblock`, `check`, `verify`, `trace`, `status`, `next`, `checkpoint`, and `handoff`. Never hand-edit a feature to `passing` or hand-edit continuity phases.
9. Use `checkpoint --summary ... --next ...` at meaningful in-task milestones. It is a bounded current-state snapshot, not a transcript and not a task boundary.
10. End with a dirty-safe `handoff --summary ... --next ...`. Once it parks the repository, stop the current task; the next agent must open a fresh task and run the exact ID-bound `resume` command before mutation.
11. For Codex, review and trust the installed project-local `.codex/hooks.json` before relying on its automatic `PreCompact` guard. The hook invokes `.harness/hooks/precompact-handoff.mjs` with the Codex adapter, writes an automatic terminal handoff, and returns `continue: false`. Claude Code may optionally register `node "${CLAUDE_PROJECT_DIR}/.harness/hooks/precompact-handoff.mjs" --platform claude` for automatic `PreCompact` after review.
12. Configure provider pools under `security.credentials.providers` only when project commands need API keys. Require command entries to opt in with `credentials`; never put key values in project files.
13. Use `sync` to upgrade an existing runtime, create or migrate `.harness/continuity.json`, and fill missing legacy schema defaults without replacing project facts.
14. Before reporting completion, require a passing evidence record and a reproducible fresh-task restart path.

## Commands

Use the reusable CLI for repository-level setup:

```bash
node <skill-dir>/scripts/harness.mjs init <project>
node <skill-dir>/scripts/harness.mjs audit <project> --json
node <skill-dir>/scripts/harness.mjs sync <project>
```

Use the checked-in project runtime for day-to-day work:

```bash
node .harness/run.mjs session
node .harness/run.mjs doctor
node .harness/run.mjs status
node .harness/run.mjs next
node .harness/run.mjs add feat-001 --title "Behavior" --description "Observable outcome" --criterion "The behavior works" --command "npm test -- --runInBand" --allow "src/**"
node .harness/run.mjs start feat-001
node .harness/run.mjs check quick
node .harness/run.mjs credentials
node .harness/run.mjs verify feat-001
node .harness/run.mjs trace feat-001
node .harness/run.mjs checkpoint --summary "Current facts" --next "Run the focused test"
node .harness/run.mjs handoff --summary "Current state" --next "Run the full verification gate"
# Stop this task. In a genuinely fresh task, use the exact printed ID:
node .harness/run.mjs resume HANDOFF_ID
```

## Invariants

- Default to WIP=1. Raise it only when work is isolated with explicit ownership.
- Keep root `AGENTS.md` a concise router; move details into project docs.
- Treat `.harness/features.json` as the scope source of truth.
- Permit `active -> passing` only through successful verification.
- Freeze the feature contract at start and require cumulative full, configured fast/architecture, requested, and acceptance layers.
- Fail closed when Git-backed scope cannot be evaluated; check scope before and after commands.
- Expand untracked directories to individual files, ignore transient lock artifacts, and never parse Git diagnostics as paths.
- Exempt only runtime-owned state from feature scope; configuration, the runtime, project docs, quality, and loop prompts need explicit scope. Continuity, generated progress/handoff projections, and their archives are runtime-owned.
- Keep `passing` irreversible; represent regressions as new features.
- Record provenance hashes, layers, command, exit code, duration, separate stdout/stderr, truncation, and repository identity in write-once evidence.
- Redact both common secret formats and values of allowlisted secret-bearing environment variables before persistence.
- Expose provider credentials only to command entries that explicitly request them; rotate environment-backed pools without persisting values.
- Never retry a command automatically with another key after execution begins.
- Serialize state mutations and append correlated lifecycle events.
- Keep `.harness/continuity.json` authoritative for the `working -> awaiting_resume -> working` generation lifecycle.
- Keep checkpoints bounded and current. Use Git history, `.harness/events.jsonl`, archived progress, and evidence for older detail.
- Treat `handoff` as terminal even when the worktree is dirty. It records rather than cleans project changes and parks harness mutations until an ID-bound resume.
- Run `resume` only from a genuinely fresh chat or task. Context compaction, transcript continuation, and a same-chat resume do not satisfy the boundary.
- Treat the reviewed Codex `PreCompact` hook as defense in depth: it parks state and returns `continue: false` before automatic compaction. Claude Code may opt into the same script.
- Remember the platform limit: the runtime and hook can park state and print a bootstrap, but they cannot universally create or terminate chats or prove task freshness.
- Stop after repeated identical failures or when a decision requires the user.
- Keep initialization non-destructive and non-mutating.
- Preserve existing user files unless overwrite is explicitly requested.
- Treat post-pass configuration evolution as normal historical progression; validate the commands captured in evidence instead of retroactively invalidating terminal features.
- Separate maker and checker for autonomous or high-risk loops.

## References

- Read [architecture.md](references/architecture.md) when deciding what belongs globally versus per project.
- Read [operations.md](references/operations.md) when running feature, verification, handoff, or loop workflows.
- Read [audit-model.md](references/audit-model.md) when interpreting scores or improving a weak subsystem.
- Read [lecture-map.md](references/lecture-map.md) when tracing a rule to the 13-lecture source.

## Completion

Do not call a harness ready until:

- `audit` has no critical structural failure.
- `.harness/run.mjs doctor` passes.
- The project verification profile contains real commands.
- A fresh task can find purpose, architecture, state, active scope, continuity phase, the exact resume command when parked, and the verification path from repository files.
- Codex, Claude Code, and GitHub Copilot instruction surfaces exist, agree, and route to the same harness state.
- At least one representative feature has been run through `start -> verify -> passing`, or the user has been told that behavioral validation is still pending.
