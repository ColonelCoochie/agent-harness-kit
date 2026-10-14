# AGENTS.md

Maintain Agent Harness Kit as a zero-dependency Node.js 20+ project skeleton for Codex, Claude Code, and GitHub Copilot.

## Orchestrated-Worker Protocol

Protocol marker: `ORCHESTRATED_WORKER_CONTINUITY_V1`.

The persistent development orchestrator keeps the user-facing chat open. It owns user intent, decisions, concise status, and routing, but delegates repository implementation to fresh bounded workers so implementation context does not accumulate in the orchestrator. Allow only one mutating worker at a time; independent read-only explorers may run in parallel.

Before changing files, a worker runs `node .harness/run.mjs session`, claims or resumes ownership, runs `node .harness/run.mjs bootstrap --json`, reads `.harness/config.json`, and task-relevant routes in `.harness/docs-map.md`, then runs `doctor`, `status`, and `next`. If continuity is `awaiting_resume`, the orchestrator delegates the exact printed `node .harness/run.mjs resume <handoff-id>` command to a fresh worker; the orchestrator must not consume the implementation packet or run the resume itself. A fresh user chat/task is a fallback only when the host cannot delegate subagents.

At normal completion, a worker verifies or records the blocker, writes a bounded `checkpoint --reason worker_yield`, returns a concise result, and yields. When user input is required, use `checkpoint --reason needs_input`, return one concise question, and yield. Neither boundary requires `handoff`, `resume`, or a new user chat.

Use `handoff --summary ... --next ...` only for a true context or ownership transfer. It writes an ID-bound worker packet and parks harness mutations. The handing-off worker yields, and the orchestrator gives the exact resume command to a fresh worker. A successful reviewed Codex `PreCompact` hook persists the worker packet so the persistent chat may compact and continue routing; hook failure remains fail-closed.

## Development-Harness Boundary

`.harness/` is the outer repository-development control plane for coding-agent work, verification, and orchestrated worker continuity. It is not application runtime and must not be imported by, deployed with, or used as an orchestration dependency of the product.

Any in-product agent, loop, scheduler, or orchestrator is product-owned runtime. It keeps separate state, configuration, telemetry, and operations and never depends on, reads, or writes `.harness/`. The development harness may build and test that product code only as ordinary feature-scoped code.

Work on one active feature by default. Use `.harness/run.mjs` for state changes, keep scope explicit, and allow a feature to become `passing` only through successful `verify` evidence. Keep the development orchestrator distinct from any product-runtime orchestrator: product runtime remains wholly application-owned and independent of `.harness/`.

## Repository invariants

Before changing implementation code, inspect `package.json`, `README.md`, the reusable skill under `skill/codex-harness/`, and the test suite. Preserve the `agent-harness` CLI and the `codex-harness` compatibility alias. Keep `AGENTS.md` as the canonical workflow; `CLAUDE.md` and `.github/copilot-instructions.md` must route to it without contradictory rules.

Credential values remain environment-only. Never add live keys to fixtures, logs, configuration, evidence, examples, or Git history. Commands receive provider credentials only when their command entry explicitly requests them. Do not add automatic post-execution credential retries.

When changing the generated runtime, edit the reusable source under `skill/codex-harness/assets/`, test it, and use `node bin/agent-harness.mjs sync .` to refresh the checked-in `.harness/` copy. Do not hand-maintain divergent source and generated runtimes.

## Verification

Use the active feature's `node .harness/run.mjs verify <feature-id>` gate before completion. The configured ladder runs source syntax checks, the full Node test suite, the structural self-audit, and each feature's acceptance command. For focused manual checks, preserve coverage of initialization, migration, all instruction surfaces, missing-key behavior, round-robin selection, redaction, evidence metadata, and the generated runtime.


## Bounded worker startup and ownership

Delegation must never inherit the implementation transcript. Codex uses `fork_turns="none"`; Claude Code uses a fresh non-fork Agent invocation. Other hosts use their fresh-worker mechanism. Run `session --json` for routing only. A fresh worker explicitly claims unowned working state with `node .harness/run.mjs claim`, or runs the exact delegated pending resume command. Then run `node .harness/run.mjs bootstrap --json` (optionally a selected feature ID). This bounded projection replaces reading the full features/continuity/progress files during startup. Read config and task-relevant docs separately. Never dump baseline blobs or historical feature arrays into context.

The harness binds mutations to host `CODEX_THREAD_ID`, not shared `CODEX_SESSION_ID`. Other hosts must supply `--worker-id` on mutations as an explicit attestation. Normal worker_yield and needs_input revoke the owner; a retired worker cannot reclaim or resume. This is cooperative CLI enforcement, not protection against direct file edits or forged environments. The orchestrator cannot claim a child worker's ID.

Use `migrate` once after a runtime update to move legacy inline baselines into immutable content-addressed references without changing historical contracts or evidence. `doctor` authenticates referenced blobs.

PreCompact output systemMessage is UI text only. The SessionStart(compact) adapter emits supported additionalContext with routing; it does not load the transfer packet or resume mutations. Hook behavior is fixture-tested; per-invocation CODEX_THREAD_ID delivery to native hooks still requires host validation. Unknown hook identity with an active owner fails closed; another identified actor leaves that worker unchanged.

For Claude Code, review `.claude/settings.json` or merge the generated `.harness/claude-hooks.addition.json` into existing settings. The read-only SubagentStart hook delivers `claude-agent:<agent_id>` only to that child. The child appends its own `--worker-id` to claim/resume and every mutation, including verify, checkpoint and handoff; it uses a fresh non-fork Agent invocation. Without native identity delivery, each non-Codex child chooses a fresh unique manual worker ID. Automatic hooks cannot infer a manual ID. Shared `session_id` never authorizes worker ownership. Native Claude/Codex hook dispatch still requires a live host smoke test.

Only after the host or operator confirms an abandoned worker has stopped, a distinct actor may run `node .harness/run.mjs recover --expected-owner OLD_ID --reason "Host confirmed termination" --confirmed-terminated` (append its own `--worker-id` on a non-Codex host). Recovery preserves packets and feature state, retires OLD_ID, logs the attestation, and releases ownership for a fresh claim. Never recover a live worker or clear a pending handoff; delegate the exact pending resume instead.

Authoritative stored state remains `.harness/features.json` and `.harness/continuity.json`; access their bounded projections during startup.
