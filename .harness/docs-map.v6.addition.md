# Canonical runtime v6 addition for `.harness/docs-map.md`

<!-- agent-harness-managed: canonical-runtime-v6-asset-review -->

`agent-harness sync` preserved `.harness/docs-map.md` because its content is neither the current canonical runtime-v6 asset nor an exact known runtime-v5 predecessor (allowing only CRLF-to-LF normalization).

Review and merge the canonical content between the markers into `.harness/docs-map.md`. Do not delete customized project guidance. After the target matches the canonical runtime-v6 content, rerun `sync`; it removes this generated addition automatically. If you intentionally keep the customization, keep this addition as the explicit pending review.

<!-- BEGIN CANONICAL RUNTIME V6 CONTENT -->
# Documentation Map

Project: agent-harness-kit

Use this as a router, not a manual. A fresh bounded worker loads only the documents relevant to its task. The persistent development orchestrator keeps only user intent, decisions, concise status, and routing.

The `.harness/` routes below describe the outer repository-development control plane only. Product-runtime agents, loops, schedulers, and orchestrators belong in application documentation and keep state, configuration, telemetry, and operations separate from `.harness/`.

| Need | Source | Status |
|---|---|---|
| Product purpose and user behavior | `README.md` or project product docs | Confirm for this project |
| Architecture and boundaries | `docs/ARCHITECTURE.md` or equivalent | Confirm for this project |
| Product-runtime agents or orchestration | Product architecture and operations docs outside `.harness/` | Application-owned; never depend on, read, or write `.harness/` |
| Reliability and operations | `docs/RELIABILITY.md` or equivalent | Add when material |
| Security constraints | `docs/SECURITY.md` or equivalent | Add when material |
| Product, legal/data-rights, provider, or deployment gates | Project ADRs or decision records | Confirm when applicable |
| Current scope and state | `.harness/features.json` | Authoritative |
| Verification commands | `.harness/config.json` | Authoritative |
| Continuity phase and pending worker transfer | `.harness/continuity.json` | Machine-authoritative |
| Current checkpoint and worker packet | `.harness/progress.md`, `.harness/handoff.md` | Bounded projections |
| Older continuity history | `.harness/history/progress/`, `.harness/events.jsonl` | Append/archive record |
| Codex compaction persistence | `.codex/hooks.json`, `.harness/hooks/precompact-handoff.mjs` | Review and trust before enabling project-local hooks |
| Objective evidence | `.harness/evidence/` | Machine-written |

## Orchestrated-worker reconstruction test

A fresh worker should be able to answer from repository contents:

1. What does this project do and how is it structured?
2. What is the active work item and its scope?
3. Is continuity `working` or `awaiting_resume`, and what exact resume command applies to a pending transfer?
4. Which recorded gates constrain implementation or delivery?
5. Which commands prove completion, and what should happen next?
6. Does every product-runtime agent or orchestrator remain independent of `.harness/`?

## Compact orchestrator routing test

Without loading implementation history, the persistent orchestrator should be able to answer:

1. What user intent and decisions must be preserved?
2. Is one mutating worker active, while any parallel explorers remain read-only?
3. Should it delegate ordinary work, ask the user a checkpointed `needs_input` question, or send an exact pending resume command to a fresh worker?
4. Can the user continue in this chat, using a new chat/task only as the no-subagent fallback?
<!-- END CANONICAL RUNTIME V6 CONTENT -->
