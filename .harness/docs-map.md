# Documentation Map

Project: Agent Harness Kit

Use this file as a router. The persistent development orchestrator keeps only compact routing state; fresh bounded workers load the sources relevant to the active feature. `.harness/` governs repository development only, while product-runtime agents, schedulers, loops, and orchestration remain application-owned.

| Need | Source | Role |
|---|---|---|
| Product purpose, behavior, and operator workflow | `README.md` | Current user documentation |
| Contribution constraints and required checks | `CONTRIBUTING.md` | Current contributor policy |
| Security and credential handling | `SECURITY.md` | Current security policy |
| Harness architecture and subsystem boundaries | `skill/codex-harness/references/architecture.md` | Current reusable design |
| Feature lifecycle, verification, checkpoints, and handoffs | `skill/codex-harness/references/operations.md` | Current operating procedure |
| Structural score interpretation | `skill/codex-harness/references/audit-model.md` | Current audit guidance |
| Executable behavior and regression coverage | `tests/harness.test.mjs` | Source of test truth |
| Design derivation and historical rationale | `ANALYSIS.md`, `REVIEW-2026-07-20.md` | Design history, not current instructions |
| Release history and compatibility changes | `CHANGELOG.md` | Version history |
| Current feature scope and state | `.harness/features.json` | Machine-authoritative |
| Verification profile and project facts | `.harness/config.json` | Machine-authoritative |
| Worker continuity phase and pending transfer | `.harness/continuity.json` | Machine-authoritative |
| Current checkpoint and fresh-worker bootstrap | `.harness/progress.md`, `.harness/handoff.md` | Bounded projections |
| Objective completion records | `.harness/evidence/` | Write-once evidence |
| Codex compaction packet hook | `.codex/hooks.json`, `.harness/hooks/precompact-handoff.mjs` | Review and trust locally |
| Claude worker identity and compaction routing | `.claude/settings.json`, `.harness/hooks/claude-worker-identity.mjs`, `CLAUDE.md` | Review/trust locally; native host dispatch remains unvalidated |

## Worker reconstruction and orchestrator routing

A fresh worker should be able to identify the project purpose, active feature and scope, continuity phase, exact resume command when parked, applicable gates, verification commands, next action, and the boundary between repository development and product runtime from these routed files. The orchestrator should need only the compact `session --json` action and concise worker returns, not implementation history.
