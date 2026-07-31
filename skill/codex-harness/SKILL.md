---
name: codex-harness
description: Initialize, audit, operate, repair, or simplify reusable project harnesses for Codex, Claude Code, and GitHub Copilot with native instruction files, project-specific verification profiles, opt-in multi-key OpenAI and Anthropic credential pools, WIP-limited feature state, executable completion gates, durable evidence, clean handoffs, and maker/checker loop templates. Use when a repository needs reliable coding-agent startup and verification, when agents lose context or drift across sessions, when an agent claims completion without proof, when setting up feature tracking or long-running goals, or when adapting one common harness across multiple projects.
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
5. Run the structural audit and local doctor:

   ```bash
   node <skill-dir>/scripts/harness.mjs audit <project-dir>
   node <project-dir>/.harness/run.mjs doctor
   ```

6. Add concrete features whose behavior fits one session. Pair every observable `--criterion` with one `--command`, and declare bounded scope with `--allow`.
7. Run `node <project-dir>/.harness/run.mjs next` to find dependency-ready work.
8. Operate state only through `.harness/run.mjs`: `add`, `start`, `block`, `unblock`, `verify`, `trace`, `status`, `next`, and `handoff`. Never hand-edit a feature to `passing`.
9. Configure provider pools under `security.credentials.providers` only when project commands need API keys. Require command entries to opt in with `credentials`; never put key values in project files.
10. Use `sync` to upgrade an existing runtime and fill missing legacy schema defaults without replacing project facts.
11. Before reporting completion, require a passing evidence record and a clean restart path.

## Commands

Use the reusable CLI for repository-level setup:

```bash
node <skill-dir>/scripts/harness.mjs init <project>
node <skill-dir>/scripts/harness.mjs audit <project> --json
node <skill-dir>/scripts/harness.mjs sync <project>
```

Use the checked-in project runtime for day-to-day work:

```bash
node .harness/run.mjs doctor
node .harness/run.mjs status
node .harness/run.mjs next
node .harness/run.mjs add feat-001 --title "Behavior" --description "Observable outcome" --criterion "The behavior works" --command "npm test -- --runInBand" --allow "src/**"
node .harness/run.mjs start feat-001
node .harness/run.mjs check quick
node .harness/run.mjs credentials
node .harness/run.mjs verify feat-001
node .harness/run.mjs trace feat-001
node .harness/run.mjs handoff --summary "Current state and next action"
```

## Invariants

- Default to WIP=1. Raise it only when work is isolated with explicit ownership.
- Keep root `AGENTS.md` a concise router; move details into project docs.
- Treat `.harness/features.json` as the scope source of truth.
- Permit `active -> passing` only through successful verification.
- Freeze the feature contract at start and require cumulative full, configured fast/architecture, requested, and acceptance layers.
- Fail closed when Git-backed scope cannot be evaluated; check scope before and after commands.
- Expand untracked directories to individual files, ignore transient lock artifacts, and never parse Git diagnostics as paths.
- Exempt only runtime-owned state from feature scope; configuration, the runtime, docs, progress, quality, and loop prompts need explicit scope.
- Keep `passing` irreversible; represent regressions as new features.
- Record provenance hashes, layers, command, exit code, duration, separate stdout/stderr, truncation, and repository identity in write-once evidence.
- Redact both common secret formats and values of allowlisted secret-bearing environment variables before persistence.
- Expose provider credentials only to command entries that explicitly request them; rotate environment-backed pools without persisting values.
- Never retry a command automatically with another key after execution begins.
- Serialize state mutations and append correlated lifecycle events.
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
- A fresh session can find purpose, architecture, state, active scope, and the verification path from repository files.
- Codex, Claude Code, and GitHub Copilot instruction surfaces exist, agree, and route to the same harness state.
- At least one representative feature has been run through `start -> verify -> passing`, or the user has been told that behavioral validation is still pending.
