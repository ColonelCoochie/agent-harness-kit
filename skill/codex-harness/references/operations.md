# Operations

## Repository prerequisites

Git with at least one commit. `start` records `HEAD` as the scope baseline, so an empty repository needs an initial commit first.

## Feature state machine

```text
not_started --start--> active --verify(pass)--> passing (terminal)
     ^                   |  \--verify(fail, budget/repeat)--> blocked
     |                   \--block--> blocked
     +----unblock (never started)----/   unblock (started) -> active
```

- `add` requires a title, description, at least one `--criterion`, a matching `--command` per criterion (unless `completion.requireAcceptanceCommands` is false), and scope (`--allow`, or `scope.defaultAllow`). `--deny` adds to `scope.defaultDeny`.
- `start` enforces `policies.wipLimit` and passing dependencies, freezes a contract snapshot, and records a baseline: `HEAD`, branch, and a fingerprint of every pre-existing changed path.
- Editing a started feature's title, description, scope, acceptance, dependencies or layers makes `verify` refuse it. Block it and add a successor.
- `unblock --reset-attempts` clears the attempt counter after a human decision.

## Verification

Layers run in fixed order: `quick`, `full`, `architecture`, `e2e`, `clean`. A `verify` runs:

1. every layer in `completion.alwaysRunWhenConfigured` that has commands,
2. `completion.baseLayers` (default `full`, which must be configured),
3. the feature's `requiredLayers` and any `--layer` given,
4. each acceptance command,

then the scope check. With `verification.failFast` (default true) the first failure skips later commands. Each command gets `policies.commandTimeoutMs` (default 10 minutes); timeouts kill the process tree and report exit 124.

Evidence (`.harness/evidence/<time>-<id>.json`) records layers, each command's exit code, duration, output tail (redacted, 4 KB) and log path, scope results, and the commit verified. Full output lives in `.harness/logs/` (git-ignored, newest 200 kept).

On pass: status `passing`, then a commit of the feature's attributed changes plus harness state and evidence (`completion.commitOnPass`, default true). A failing commit (for example a pre-commit hook) leaves the feature passing and says so; commit manually.

On failure: `attempts` increments; the same failure signature `policies.maxRepeatedFailures` times in a row, or reaching `policies.maxAttempts`, blocks the feature.

`check LAYER` runs one layer without touching state.

## Scope

Attributed changes = files changed in commits since the baseline `HEAD` + current working-tree changes, minus pre-existing dirt whose fingerprint is unchanged, minus harness-owned state (`features.json`, `continuity.json`, `events.jsonl`, `progress.md`, `handoff.md`, `evidence/`, `logs/`, `credentials-state.json`) and paths rewritten by `agent-harness sync` while the feature was active. Each must match an allow glob and no deny glob. A rewritten history (baseline not an ancestor of `HEAD`) fails verification; start a successor.

Globs: `*` within a segment, `**` across segments, `?` one character; a plain path also matches everything beneath it.

## Continuity

`continuity.json` has `phase` (`working` | `awaiting_resume`), `generation`, `owner`, the latest `checkpoint`, and a pending `handoff`.

- `session` is read-only routing for the orchestrator and workers.
- `claim` sets the owner (Codex `CODEX_THREAD_ID`, else `--worker-id`, else a generated ID). Another identified worker is refused until `claim --force`.
- `checkpoint --reason worker_yield|needs_input --summary --next [--decision] [--blocker]` records current facts (summary up to 4,000 bytes, next up to 2,000) and releases ownership.
- `handoff --summary --next` records a packet (commit, branch, feature revision, config hash, changed-path count), sets `awaiting_resume`, and blocks mutations. Only `resume HANDOFF_ID` from a fresh worker continues; drift requires `--accept-drift`.
- The PreCompact hook records `lastCompaction` in continuity and progress. It never blocks.

## Configuration reference (`.harness/config.json`)

| Key | Meaning |
|---|---|
| `project.name`, `project.purpose` | Shown to workers |
| `policies.wipLimit`, `maxAttempts`, `maxRepeatedFailures`, `commandTimeoutMs` | Budgets |
| `verification.{quick,full,architecture,e2e,clean}` | Command lists (string or `{command, credentials}`) |
| `verification.failFast` | Stop at first failing command (default true) |
| `completion.baseLayers`, `alwaysRunWhenConfigured`, `requireAcceptanceCommands`, `commitOnPass` | Verify composition |
| `scope.defaultAllow`, `scope.defaultDeny` | Defaults for `add` |
| `security.environmentAllow` | Variables passed to commands |
| `security.credentials.providers` | Key pools by env-var name |
| `agents.enabled`, `agents.instructions` | Which instruction surfaces exist |
| `docs.required`, `docs.router` | What workers should be able to read |

## Loops

`.harness/loops/goal.md` structures a long goal into features; `maker.md` is the implementing worker's checklist; `checker.md` is an independent read-only reviewer. Use the checker for risky or autonomous work, not for every change.
