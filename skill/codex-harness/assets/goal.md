# Development Goal Loop

This template coordinates coding-agent repository-development work only. It is not a product-runtime loop, scheduler, or orchestrator and must not own application runtime state or operations.

The persistent user-facing development orchestrator keeps only user intent, decisions, concise status, and routing. Fresh bounded workers reconstruct implementation state from the repository. Permit one mutating worker at a time; read-only explorers may run in parallel.

## Goal

State one durable objective.

## Acceptance criteria

- [ ] Add machine-verifiable conditions.

## Scope

### Allowed

- Add explicit paths.

### Hands off

- Add explicit paths.

## Verification

1. Run the feature acceptance commands.
2. Run the configured full verification level.
3. Run E2E and architecture checks when the behavior crosses boundaries.

## Stop conditions

- All acceptance criteria pass.
- Maximum attempts from `.harness/config.json` is reached.
- The same failure repeats without new evidence.
- A human decision or new authority is required.

## Worker boundaries

Each worker starts with `node .harness/run.mjs session`, reconstructs the bounded task from repository state and routed docs, and returns only the result, evidence, risk, and next routing decision.

After normal completion, verify or block as appropriate, persist `checkpoint --reason worker_yield --summary ... --next ...`, and yield to the same orchestrator chat. When a human decision is required, use `checkpoint --reason needs_input`, return one concise question, and yield.

Use dirty-safe `handoff --summary ... --next ...` only for a true worker context or ownership transfer. The handing-off worker yields; the orchestrator sends the exact ID-bound resume command to a fresh worker without loading the packet. A new user chat/task is only the no-subagent fallback. A reviewed `PreCompact` hook persists a worker packet on success so the orchestrator can compact and continue; failure remains fail-closed.


## Bounded worker startup and ownership

Delegation must never inherit the implementation transcript. Codex uses `fork_turns="none"`; Claude Code uses a fresh non-fork Agent invocation. Other hosts use their fresh-worker mechanism. Run `session --json` for routing only. A fresh worker explicitly claims unowned working state with `node .harness/run.mjs claim`, or runs the exact delegated pending resume command. Then run `node .harness/run.mjs bootstrap --json` (optionally a selected feature ID). This bounded projection replaces reading the full features/continuity/progress files during startup. Read config and task-relevant docs separately. Never dump baseline blobs or historical feature arrays into context.

The harness binds mutations to host `CODEX_THREAD_ID`, not shared `CODEX_SESSION_ID`. Other hosts must supply `--worker-id` on mutations as an explicit attestation. Normal worker_yield and needs_input revoke the owner; a retired worker cannot reclaim or resume. This is cooperative CLI enforcement, not protection against direct file edits or forged environments. The orchestrator cannot claim a child worker's ID.

Use `migrate` once after a runtime update to move legacy inline baselines into immutable content-addressed references without changing historical contracts or evidence. `doctor` authenticates referenced blobs.

PreCompact output systemMessage is UI text only. The SessionStart(compact) adapter emits supported additionalContext with routing; it does not load the transfer packet or resume mutations. Hook behavior is fixture-tested; per-invocation CODEX_THREAD_ID delivery to native hooks still requires host validation. Unknown hook identity with an active owner fails closed; another identified actor leaves that worker unchanged.
