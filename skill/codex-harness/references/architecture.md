# Architecture

## Layer boundary

`.harness/` is strictly an outer repository-development control plane. Product-runtime agents, loops, schedulers, and orchestrators are application-owned, keep separate state/configuration/telemetry/operations, and never depend on, read, or write `.harness/`. The harness may build and verify them only as ordinary feature-scoped product code.

Keep invariant workflow in the reusable skill and CLI:

- scaffolding and upgrades
- state-machine rules
- evidence capture
- structural audit logic
- generic coding-agent operating procedure

Keep volatile facts in each repository:

- purpose and architecture
- build, test, lint, E2E, and cleanup commands
- protected paths and allowed scope
- features, dependencies, status, and evidence
- continuity phase, bounded progress, decisions, quality, and handoff state

Do not copy project architecture into the skill. Do not encode generic state-machine logic separately in every `AGENTS.md`.

## Five core subsystems

| Subsystem | Project artifacts | Enforced behavior |
|---|---|---|
| Instructions | `AGENTS.md`, `CLAUDE.md`, Copilot instructions, `.harness/docs-map.md` | Native startup routers backed by one discoverable project workflow |
| Tools | `.harness/run.mjs`, command policies | Deterministic, bounded, redacted execution |
| Environment | `config.json.execution`, Git identity | Reproducible development/test setup, start, and health surfaces; never the deployed product control plane |
| State | `features.json`, `continuity.json`, `events.jsonl`, progress/handoff projections | Durable contracts, transitions, decisions, and fresh-task recovery |
| Feedback | verification config, `evidence/*.json` | Cumulative gates and provenance-bound objective proof |

Scope and lifecycle are cross-cutting enforcement planes: WIP, dependencies, allow/deny paths, locks, retry budgets, terminal handoff/resume, and maintenance constrain all five core subsystems. Observability crosses tools, state, and feedback.

## Agent surfaces

- Use `AGENTS.md` for durable repository instructions and routing.
- Use `CLAUDE.md` to import `@AGENTS.md`; add only Claude Code-specific exceptions below the import.
- Use `.github/copilot-instructions.md` as a short Copilot adapter and keep it consistent with `AGENTS.md`.
- Use `.codex/hooks.json` for the reviewed automatic compaction guard; keep unrelated Codex settings out of the harness.
- Use this skill for the reusable workflow.
- Use development MCP/connectors for live external systems needed by coding work, not for local project state or product-runtime orchestration.
- Use hooks only for mechanical lifecycle enforcement that cannot be expressed safely by the checked-in runtime.
- Use automations only for scheduled coding-agent development triggers after the single-run harness is reliable; application scheduling stays in product runtime.

## Progressive disclosure

The startup path should load only:

1. `AGENTS.md`
2. the agent-native adapter (`CLAUDE.md` or Copilot instructions)
3. `.harness/config.json`
4. `.harness/features.json`
5. `.harness/continuity.json`
6. `.harness/progress.md` and the current `.harness/handoff.md`
7. task-relevant docs routed by `.harness/docs-map.md`

Keep deep design, reliability, security, and product detail in linked docs. A fresh session should not need to scan the entire repository to find the next executable step.
