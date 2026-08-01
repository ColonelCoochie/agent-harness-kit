# Documentation Map

Project: Agent Harness Kit

Use this as a router, not a manual. Load only the documents relevant to the active feature.

The `.harness/` routes below describe the outer repository-development control plane only. Product-runtime agents, loops, schedulers, and orchestrators belong in application documentation and keep state, configuration, telemetry, and operations separate from `.harness/`.

| Need | Source | Status |
|---|---|---|
| Product purpose, installation, and user behavior | `README.md` | Current |
| Architecture, design basis, and boundaries | `ANALYSIS.md`, `skill/codex-harness/references/architecture.md` | Current |
| Contribution and verification contract | `CONTRIBUTING.md`, `AGENTS.md` | Current |
| Product-runtime agents or orchestration | Product architecture and operations docs outside `.harness/` | Application-owned; never depend on, read, or write `.harness/` |
| Reliability and operations | `skill/codex-harness/references/operations.md` | Current |
| Security constraints | `SECURITY.md` | Current |
| Product, legal/data-rights, provider, or deployment gates | Project ADRs or decision records | Confirm when applicable |
| Current scope and state | `.harness/features.json` | Authoritative |
| Verification commands | `.harness/config.json` | Authoritative |
| Continuity phase and pending handoff capsule | `.harness/continuity.json` | Machine-authoritative |
| Current checkpoint and fresh-task bootstrap | `.harness/progress.md`, `.harness/handoff.md` | Bounded projections |
| Older continuity history | `.harness/history/progress/`, `.harness/events.jsonl` | Append/archive record |
| Codex compaction stop guard | `.codex/hooks.json`, `.harness/hooks/precompact-handoff.mjs` | Review and trust before enabling project-local hooks |
| Objective evidence | `.harness/evidence/` | Machine-written |

## Fresh-session test

A new Codex session should be able to answer from repository contents:

1. What does this project do?
2. How is it structured?
3. What is the active work item and its scope?
4. Is continuity `working` or `awaiting_resume`, and what exact resume command applies?
5. Which recorded gates constrain implementation or delivery?
6. Which commands prove completion?
7. What should happen next?
8. Does any product-runtime agent or orchestration remain independent of `.harness/`?
