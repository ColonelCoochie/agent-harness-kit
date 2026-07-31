# Source repository analysis

Source: [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering), cloned and analyzed on 2026-07-20.

## Coverage method

The repository contains 2,363 non-git files and 1,737 unique SHA-256 contents; 626 file instances are exact duplicates. The large surface is mainly 15 localized documentation trees and repeated starter/solution application snapshots. The analysis used three lanes:

1. Read the canonical English text and examples for all 13 lectures: 66 files, about 310 KB.
2. Inspect every unique harness artifact under the projects, templates, scripts, tools, and `skills/harness-creator` implementation.
3. Hash and diff repeated translations and project snapshots so duplicates counted toward coverage without being mistaken for new design principles.

The six project exercises contain 489 files but only 186 unique contents. The upstream `harness-creator` contains 26 files and 25 unique contents.

## What the repository establishes

The course's central claim is consistent across lectures and projects: model capability is only one variable. Reliable agent execution comes from a repository-visible system that expresses intent, constrains execution, preserves state, and supplies objective feedback.

The stable core is a five-subsystem model, with scope and lifecycle acting across every subsystem:

| Subsystem | Failure without it | Required response |
|---|---|---|
| Instructions | Codex guesses startup, architecture, or conventions | Short `AGENTS.md` router plus topic docs |
| Tools | Commands are unavailable, unsafe, or inconsistent | Deterministic runtime, timeouts, environment policy, redaction |
| Environment | Sessions cannot reproduce setup or runtime assumptions | Declared runtime, setup, start, health, and repository identity |
| State | New sessions reconstruct or contradict prior work | Frozen feature contracts, journal, progress, decisions, and handoff |
| Feedback | Local confidence becomes "done" | Cumulative executable checks and provenance-bound evidence |

Scope and lifecycle supply WIP limits, dependencies, allow/deny boundaries, locks, retries, clean handoffs, and periodic simplification across that core.

Lecture 13 adds an autonomy layer above this system: scheduling, worktree isolation, reusable skills, connectors, subagents, and external state. Its crucial boundary is that loops do not repair an unreliable single run; they multiply it. The harness must work before scheduling or fleet orchestration is added.

## Upstream implementation audit

The repository's `skills/harness-creator` is a useful compact baseline. It correctly uses progressive disclosure, supports common stacks, preserves existing files unless forced, and provides structural scoring.

The following gaps matter for a Codex harness intended to span real projects:

- The lecture state machine (`not_started`, `active`, `blocked`, `passing`) differs from the shipped template (`not-started`, `in-progress`, `blocked`, `done`).
- State transitions are documented but not owned by the harness; an agent can directly edit a feature to done.
- Evidence is an unstructured string rather than a provenance-bound record of commands, exits, duration, and output.
- The generated `init.sh` is Unix-specific and runs dependency installation, mixing environment mutation with initialization.
- Structural scoring relies substantially on phrases and file presence, so it cannot establish dependency validity, WIP integrity, cycles, or pass/evidence consistency.
- Existing `AGENTS.md` is skipped, but no safe merge artifact is produced.
- Loop templates exist in the lecture but are not integrated into the generated project harness.

## Resulting design

Codex Harness Kit keeps the upstream strengths and tightens the enforcement boundary:

- A reusable Codex skill and CLI own scaffolding, audit, and runtime upgrades.
- Every project receives a zero-dependency Node runtime so control is identical across Windows, macOS, and Linux.
- Initialization detects but does not execute commands or install dependencies.
- A typed feature graph enforces WIP, dependencies, blockers, terminal pass state, and cycle checks.
- Only successful cumulative verification can create `passing` state.
- Required layers include the full project gate, configured fast/architecture gates, requested layers, and every behavior-specific acceptance command.
- Every attempt writes write-once, bounded, redacted evidence bound to the frozen feature contract and verification configuration.
- Git-backed scope fails closed and is checked before and after verification commands.
- State mutations are serialized; repeated failures consume a bounded budget and the append-only journal explains every transition.
- Existing root instructions are preserved and a merge snippet is emitted; leaving it unresolved is a hard failure.
- Project differences live in `.harness/config.json`; the shared skill is not forked for normal customization.
- Goal, maker, and checker templates make generator/evaluator separation available without forcing multi-agent complexity on ordinary work.
- Production feedback now makes Git scope NUL-delimited and file-exact, narrows runtime-owned exemptions, filters transient locks and diagnostics, and preserves exact verification-plan provenance.
- A read-only `next` command, safe legacy-default migration, dead-owner lock recovery, and decision-gate routing improve fresh-session restartability without adding an orchestrator.

## Lecture-to-code traceability

| Lecture | Implementation |
|---|---|
| 1 | `doctor` and `audit` diagnose harness structure before model changes are considered. |
| 2 | Audit follows instructions, tools, environment, state, and feedback, while separately scoring cross-cutting scope and lifecycle. |
| 3 | Docs map, config, feature state, revision, event journal, progress, and evidence make the repository the record. |
| 4 | Generated `AGENTS.md` is a short router; oversized or unresolved guidance fails validation. |
| 5 | Trace, progress, checkpointed handoff, evidence, and next actions survive resets. |
| 6 | `init` only scaffolds and detects; it does not install or implement. |
| 7 | Runtime defaults to WIP=1 and requires explicit scope plus executable completion evidence. |
| 8 | Runtime owns transitions and freezes the behavior contract when work starts. |
| 9 | Successful acceptance commands and provenance-bound evidence are the only completion gate. |
| 10 | Quick, full, E2E, architecture, clean, and acceptance checks compose cumulatively. |
| 11 | Evidence captures separate redacted streams, truncation, repository identity, and correlated trace events. |
| 12 | Doctor verifies the evidence chain and guidance route; handoff enforces a clean project checkpoint. |
| 13 | Locks, retry budgets, trace state, and goal/maker/checker templates prepare safe later automation. |

## Recommended rollout

Start with one representative repository and one session-sized feature. Tune the project profile until a fresh Codex session can reach useful work quickly and the feature passes only with credible evidence. Repeat the same task before and after the harness, then track rebuild time, verified completion rate, repeated failures, and clean-handoff rate. Roll out to more repositories only after the first profile proves its commands and scope boundaries.

Add automation last. A daily checker or long-running goal should call the checked-in runtime and consume the same project state rather than introduce a second source of truth.

The second-stage review is recorded in [REVIEW-2026-07-20.md](REVIEW-2026-07-20.md).
