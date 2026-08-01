# Changelog

## Unreleased

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
