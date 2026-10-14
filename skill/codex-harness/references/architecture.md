# Architecture

## Layer boundary

`.harness/` is strictly an outer repository-development control plane. Product-runtime agents, loops, schedulers, and orchestrators are application-owned, keep separate state, configuration, telemetry, and operations, and never depend on, read, or write `.harness/`. The harness may build and verify them only as ordinary feature-scoped product code.

Keep invariant workflow in the reusable skill and CLI:

- scaffolding and upgrades
- state-machine rules
- evidence capture
- structural audit logic
- generic coding-agent operating procedure
- orchestrated worker continuity

Keep volatile facts in each repository:

- purpose and architecture
- build, test, lint, E2E, and cleanup commands
- protected paths and allowed scope
- features, dependencies, status, and evidence
- continuity phase, bounded progress, decisions, quality, and worker-transfer state

Do not copy project architecture into the skill. Do not encode generic state-machine logic separately in every `AGENTS.md`.

## Development orchestration topology

Runtime v6 uses the `Orchestrated-Worker Protocol`:

```text
user <-> persistent development orchestrator
                    |
                    +-> one fresh bounded mutating worker
                    +-> optional parallel read-only explorers
```

The persistent user-facing orchestrator holds user intent, decisions, concise status, and routing only. It does not accumulate repository implementation history or consume worker-transfer packets. Fresh bounded workers reconstruct the task from checked-in state and relevant docs. Only one worker may mutate at a time; read-only explorers can run concurrently.

Ordinary completion and user-input pauses return through reasoned checkpoints without changing the user chat. A true context or ownership transfer writes an ID-bound packet, parks mutations, and is resumed by a fresh worker delegated by the orchestrator. When subagents are unavailable, a fresh chat/task is the fallback transport, not the default workflow.

This development orchestrator is not a product-runtime orchestrator. Product orchestration remains wholly application-owned and independent of `.harness/`.

## Five core subsystems

| Subsystem | Project artifacts | Enforced behavior |
|---|---|---|
| Instructions | `AGENTS.md`, `CLAUDE.md`, Copilot instructions, `.harness/docs-map.md` | Native routers for the same orchestrated-worker protocol |
| Tools | `.harness/run.mjs`, command policies | Deterministic, bounded, redacted execution |
| Environment | `config.json.execution`, Git identity | Reproducible development/test setup, start, and health surfaces; never the deployed product control plane |
| State | `features.json`, `continuity.json`, `events.jsonl`, progress/transfer projections | Durable contracts, transitions, decisions, worker reconstruction, and transfer recovery |
| Feedback | verification config, `evidence/*.json` | Cumulative gates and schema-v4 historical-plan manifests with exact ordered result validation |

Scope and lifecycle are cross-cutting enforcement planes: WIP, dependencies, allow/deny paths, locks, retry budgets, worker yield/transfer boundaries, and maintenance constrain all five core subsystems. Observability crosses tools, state, and feedback.

Evidence validation is historical-plan based: a passing record carries the canonical plan it executed, and repository-local doctor/audit checks validate that snapshot rather than reinterpret the run through later mutable configuration. The manifest hash and internal cross-checks detect structural inconsistency, but do not create a cryptographic trust anchor against a writer who can rewrite all repository state together.

## Agent surfaces

- Use `AGENTS.md` for durable repository instructions and routing.
- Use `CLAUDE.md` to import `@AGENTS.md`; add only Claude Code-specific exceptions.
- Use `.github/copilot-instructions.md` as a short adapter consistent with `AGENTS.md`.
- Use `.codex/hooks.json` for reviewed automatic worker-packet persistence before compaction.
- Use this skill for reusable workflow.
- Use development connectors for live external systems needed by coding work, not local project state or product-runtime orchestration.
- Use hooks only for mechanical lifecycle enforcement that cannot be expressed safely by the checked-in runtime.
- Use automations only for scheduled coding-agent development triggers after the single-run harness is reliable; application scheduling stays in product runtime.

## Progressive disclosure

The orchestrator retains only user intent, decisions, compact worker results, and routing status. A fresh worker loads:

1. `AGENTS.md` and its agent-native adapter
2. `.harness/config.json`
3. `session --json` for routing only, then claim or delegated resume
4. `bootstrap --json` for the bounded current feature and continuity projection
5. Deliberately selected detail only; never dump historical baseline maps
6. task-relevant docs routed by `.harness/docs-map.md`

Keep deep design, reliability, security, and product detail in linked docs. A fresh worker should not need the prior transcript or a repository-wide scan to find the next executable step.


## Bounded worker startup and ownership

Delegation must never inherit the implementation transcript. Codex uses `fork_turns="none"`; Claude Code uses a fresh non-fork Agent invocation. Other hosts use their fresh-worker mechanism. Run `session --json` for routing only. A fresh worker explicitly claims unowned working state with `node .harness/run.mjs claim`, or runs the exact delegated pending resume command. Then run `node .harness/run.mjs bootstrap --json` (optionally a selected feature ID). This bounded projection replaces reading the full features/continuity/progress files during startup. Read config and task-relevant docs separately. Never dump baseline blobs or historical feature arrays into context.

The harness binds mutations to host `CODEX_THREAD_ID`, not shared `CODEX_SESSION_ID`. Other hosts must supply `--worker-id` on mutations as an explicit attestation. Normal worker_yield and needs_input revoke the owner; a retired worker cannot reclaim or resume. This is cooperative CLI enforcement, not protection against direct file edits or forged environments. The orchestrator cannot claim a child worker's ID.

Use `migrate` once after a runtime update to move legacy inline baselines into immutable content-addressed references without changing historical contracts or evidence. `doctor` authenticates referenced blobs.

PreCompact output systemMessage is UI text only. The SessionStart(compact) adapter emits supported additionalContext with routing; it does not load the transfer packet or resume mutations. Hook behavior is fixture-tested; per-invocation CODEX_THREAD_ID delivery to native hooks still requires host validation. Unknown hook identity with an active owner fails closed; another identified actor leaves that worker unchanged.
