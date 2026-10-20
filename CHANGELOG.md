# Changelog

## 0.8.0: delegation helpers

- `verify` and `check` run each identical command once (same text and credentials) and credit the result to every layer or acceptance check that lists it (`covers` in evidence). In this repo, `npm test` as both `full` and the acceptance check had doubled verify time.
- New read-only `brief [ID] [--role worker|checker]` prints a self-contained delegation prompt: contract, scope, verification, last checkpoint, docs router, startup (`claim` or the pending `resume`) and reply format.
- `init` and `sync` install fresh-context `harness-worker` and read-only `harness-checker` agents for Claude Code (`.claude/agents/`) and Codex (`.codex/agents/`). Files are refreshed only while they keep the `agent-harness-managed` line, and other agent files are never touched.
- The harness block in AGENTS.md routes delegation through `brief` and these agents, never through forks (which inherit the transcript), and adds effort scaling: do small, low-risk changes directly.

## 0.7.0 (runtime v7): lean overhaul

Keeps the long-running-goal workflow (orchestrator + fresh workers, WIP-limited features with frozen contracts, cumulative verification with evidence, scope checks, checkpoints, handoff/resume) and removes the machinery that slowed every session.

- Removed per-tool hooks (PreToolUse, PostToolUse, UserPromptSubmit, Stop). Each tool call previously spawned three Node processes twice, and a hook error denied the tool.
- Removed context budgets and forced worker rotation (exit 75), and the 6,000-character tool-result blocking. Workers checkpoint at milestones; hosts compact on their own. `sync` drops the forced 80k-token Codex auto-compaction default.
- Replaced the eval'd, compressed hook launchers, bootstrap manifests, hook-policy auto-approval, source repair authority and SHA-pinned predecessor manifests with one readable, fail-open PreCompact hook.
- Removed schema-v4 evidence plan re-hashing, content-addressed baseline blobs, `migrate`, worker retirement attestations and the Windows job-object supervisor. Evidence is a plain per-attempt record, and baselines are stored inline.
- Checkpoints and handoffs no longer hash the whole dirty worktree (the last v6 handoff here hashed 23,930 files).
- `verify` now commits the feature's scoped changes on pass (`completion.commitOnPass`), so work no longer piles up uncommitted.
- Command output is compact (a pass line, or a failure tail), with full logs in `.harness/logs/`.
- `sync` migrates v6 projects in place. Existing features, evidence, active baselines and pending handoffs keep working. User hooks and project-specific instruction sections are preserved. `--prune` removes ad-hoc `.harness/` artifacts.
- Runtime 177 KB to 56 KB; `AGENTS.md` harness text 10 KB to 2.5 KB; test suite 4m40s to about 20s.

## 0.6.0 and earlier

- Add separate actor context budgets, bounded incremental metadata-only transcript observations, proactive worker rotation with exit 75, and an interrupted-goal circuit that never requests another Stop continuation.
- Bound command feedback per result and run, retain redacted stream logs, install reviewable context hooks, and propagate compact-work instructions to every enabled agent surface.
- Preserve custom Codex compaction settings, add conservative defaults when safe, and defer unsupported TOML syntax to a review addition. Native hook dispatch and scheduler paths that bypass hooks remain host limitations.

- Avoid current dirty-file byte capture during structural doctor checks and reuse the pre-scope repository identity during verification. Authenticate referenced baseline blobs and passing evidence as before; add `doctor --integrity` for an explicit full current content digest.
- Add opt-in frozen generated-output capture policies with labelled metadata fingerprints, original baseline content digests, complete path/type/ancestor seals, and full source/JSON hashes. Exclude runtime-owned state before scope capture and preserve full transfer and deployment content checks.
- Clarify required worker ownership and verification versus optional review rounds; allow reversible local corrections within the same bounded worker while preserving attempt budgets and reconciliation of unknown external outcomes.

- Give generated Codex and Claude PreCompact hooks 600 seconds for bounded capture; upgrade exact generated 30-second settings and canonical additions while preserving custom hooks and edited additions.
- Add bounded directory capture and 1 MiB streaming hashes while preserving historical file and symlink fingerprints.
- Add read-only deterministic sync previews, managed executable inventories, reviewed raw-hash replacements and complete pre-write plan validation. Unknown enabled executables block mixed upgrades; disabled adapters and edited additions remain preserved.
- Remove ambiguous adjacent whitespace quantifiers from generic secret redaction so delayed values following long whitespace remain redacted within command deadlines.

## Audit hardening (unreleased)

- Redact before output truncation, preserve chunk and lexical secret boundaries, and terminate ordinary command descendants on timeout with a bounded pipe wait.
- Preserve structured credential command entries and customized sync additions; reject future project schemas before writes.
- Generate portable nearest-harness hook launchers and reviewable Claude native identity/compaction settings without replacing unrelated user settings. Native dispatch remains unvalidated beyond fixtures.
- Bound UTF-8 checkpoint projections without changing frozen feature text, validate both selected/default startup projections, and provide explicit audited recovery of host-confirmed terminated owners.

## Unreleased

- Embed canonical historical verification-plan manifests in schema-v4 evidence, bind ordered commands to stable result IDs, and validate exact layer, acceptance, scope, pass, contract, and captured-config relationships in both `doctor` and reusable `audit`.
- Preserve pre-v4 passing evidence with an explicit legacy non-plan-verified warning, reject unknown future schemas, and keep post-pass configuration evolution valid by checking the captured plan rather than current mutable configuration.
- Document that repository-local evidence hashing provides structural consistency rather than cryptographic tamper-proofing without an external trust anchor.
- Upgrade exact, explicitly identified runtime-v5 goal, maker, checker, and rendered docs-map assets during `sync`, with CRLF-to-LF as the only accepted normalization.
- Preserve customized or unknown support assets and emit auditable `.v6.addition.md` siblings containing canonical runtime-v6 content; clear exact generated additions after resolution while retaining modified additions for manual cleanup.

## 0.6.0

- Release runtime v6 with `continuity.mode: "orchestrated_worker"` and the stable `Orchestrated-Worker Protocol` migration marker.
- Keep the user-facing development orchestrator chat open for intent, decisions, concise status, and routing while fresh bounded workers reconstruct repository context on demand.
- Add `worker_yield` and `needs_input` checkpoint reasons so normal completion and user-input pauses return to the same chat without a global handoff or resume.
- Reserve ID-bound `handoff`/`resume` for true worker context or ownership transfer; park mutations until the orchestrator delegates the exact resume command to a fresh worker.
- Permit parallel read-only explorers while retaining one mutating worker per worktree.
- Change reviewed `PreCompact` behavior to persist a worker packet and allow the persistent chat to compact on success, while remaining fail-closed on persistence failure.
- Keep a fresh user chat/task as the fallback only when the host cannot delegate subagents, and keep all product-runtime orchestration independent of `.harness/`.

## 0.5.0

- Normalize relative executable paths used by Windows verification commands so local virtual-environment Python commands run through `cmd.exe`, while preserving POSIX command text.
- Define and enforce the canonical `Development-Harness Boundary`: `.harness/` governs repository development only and never supplies product-runtime agent state or orchestration.
- Fail audit and runtime doctor when canonical instructions lack that boundary; `sync` emits non-destructive merge additions for stale user files.
- Make coding-agent surfaces selectable with `--agents`; `sync` repairs only enabled adapters and does not recreate a deliberately absent Claude adapter.
- Label goal, maker, and checker templates as development roles and add a documentation route for application-owned agent runtime.
- Add regressions proving boundary generation, stale-route repair, adapter inheritance, selective surfaces, and byte-for-byte preservation of seeded product-agent runtime.

## 0.4.0

- Add `.harness/continuity.json` as the machine-readable lifecycle state for working and awaiting-resume generations.
- Add read-only `session` inspection and bounded `checkpoint` snapshots for durable in-task continuity.
- Make `handoff` a dirty-worktree-safe terminal boundary that records the repository checkpoint, parks harness mutations, and prints an exact fresh-task bootstrap.
- Add handoff-ID-bound `resume` with repository-drift detection and an explicit, review-only `--accept-drift` escape hatch.
- Redact configured provider values and common token forms from continuity capsules and generated projections.
- Strengthen Codex, Claude Code, and GitHub Copilot instructions around fresh-task startup, terminal handoff, and the rule that context compaction is not a handoff substitute.
- Install a reviewable Codex `PreCompact` hook that writes an automatic dirty-safe handoff and returns `continue: false`; expose the same script as an optional Claude Code hook adapter.
- Document the platform boundary: the runtime can persist and park repository state, but it cannot universally create a new chat, terminate the current one, or prove that a resume command came from a fresh task.

## 0.3.0

- Scaffold compatible instruction surfaces for Codex, Claude Code, and GitHub Copilot.
- Add opt-in, environment-backed credential pools with `first_available` and persistent `round_robin` selection.
- Add built-in OpenAI and Anthropic provider definitions without storing key values.
- Record only provider names and selected slot numbers in command evidence.
- Preserve existing agent instruction files and emit explicit merge additions when routing is missing.
- Keep the `codex-harness` executable as a compatibility alias for `agent-harness`.

## 0.2.0

- Harden Git scope parsing, evidence provenance, secret redaction, lock recovery, and schema migration.
