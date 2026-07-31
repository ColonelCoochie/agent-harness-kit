# Architecture

## Layer boundary

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
- progress, decisions, quality, and handoff state

Do not copy project architecture into the skill. Do not encode generic state-machine logic separately in every `AGENTS.md`.

## Five core subsystems

| Subsystem | Project artifacts | Enforced behavior |
|---|---|---|
| Instructions | `AGENTS.md`, `CLAUDE.md`, Copilot instructions, `.harness/docs-map.md` | Native startup routers backed by one discoverable project workflow |
| Tools | `.harness/run.mjs`, command policies | Deterministic, bounded, redacted execution |
| Environment | `config.json.execution`, Git identity | Reproducible runtime, setup, start, and health surfaces |
| State | `features.json`, `events.jsonl`, handoff | Durable contracts, transitions, decisions, and recovery |
| Feedback | verification config, `evidence/*.json` | Cumulative gates and provenance-bound objective proof |

Scope and lifecycle are cross-cutting enforcement planes: WIP, dependencies, allow/deny paths, locks, retry budgets, clean handoff, and maintenance constrain all five core subsystems. Observability crosses tools, state, and feedback.

## Agent surfaces

- Use `AGENTS.md` for durable repository instructions and routing.
- Use `CLAUDE.md` to import `@AGENTS.md`; add only Claude Code-specific exceptions below the import.
- Use `.github/copilot-instructions.md` as a short Copilot adapter and keep it consistent with `AGENTS.md`.
- Use `.codex/config.toml` only for trusted repository Codex settings; do not generate it unless a project actually needs a setting.
- Use this skill for the reusable workflow.
- Use MCP/connectors for live external systems, not for local project state.
- Use hooks only for mechanical lifecycle enforcement that cannot be expressed safely by the checked-in runtime.
- Use automations for scheduled triggers after the single-run harness is reliable.

## Progressive disclosure

The startup path should load only:

1. `AGENTS.md`
2. the agent-native adapter (`CLAUDE.md` or Copilot instructions)
3. `.harness/config.json`
4. `.harness/features.json`
5. `.harness/progress.md`
6. task-relevant docs routed by `.harness/docs-map.md`

Keep deep design, reliability, security, and product detail in linked docs. A fresh session should not need to scan the entire repository to find the next executable step.
