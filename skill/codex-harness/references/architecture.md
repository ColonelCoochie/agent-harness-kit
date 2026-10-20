# Architecture

## Layer boundary

`.harness/` is an outer repository-development control plane. Product-runtime agents, loops, schedulers and orchestrators are application-owned and never depend on, read or write `.harness/`. The harness builds and verifies them only as ordinary feature-scoped code.

The reusable kit (this skill and CLI) owns scaffolding, upgrades and the runtime source. Each repository owns its facts: purpose, commands, scope, features, evidence and continuity.

## Topology

```text
user <-> orchestrator chat
              |
              +-> one fresh mutating worker (claim/resume -> work -> checkpoint|handoff)
              +-> optional read-only explorers / checker
```

The orchestrator holds intent, decisions and compact results. Workers rebuild context from repository state (`session`, `bootstrap`, docs-map), so neither side needs the other's transcript.

## Five subsystems

| Subsystem | Artifacts | Behavior |
|---|---|---|
| Instructions | `AGENTS.md` (harness block), `CLAUDE.md`, Copilot adapter, `docs-map.md` | One canonical workflow, routed docs |
| Tools | `.harness/run.mjs` | Deterministic, allowlisted-environment commands with timeouts, redaction, compact output |
| Environment | `config.json` (`verification`, `security.environmentAllow`), Git | Reproducible checks; Git HEAD required for scope |
| State | `features.json`, `continuity.json`, `events.jsonl`, `progress.md`, `handoff.md` | Frozen contracts, transitions, checkpoints, transfers |
| Feedback | `verification` layers, acceptance commands, `evidence/*.json`, `logs/` | Cumulative gates and per-attempt records |

Scope and lifecycle cut across all five: WIP limit, dependencies, allow/deny globs, attempt and repeated-failure budgets, worker ownership, and the handoff mutation barrier.

## What v7 deliberately does not do

- No per-tool hooks, context budgets or forced worker rotation. Workers checkpoint at milestones; hosts compact on their own.
- No content-addressed baseline store, evidence plan re-hashing, signed hook manifests or repair authority. Evidence is a plain record; Git history is the durable trail.
- Ownership is cooperative, not a security boundary.
