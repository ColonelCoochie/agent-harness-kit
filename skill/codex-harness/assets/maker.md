# Development Maker Role

This is a bounded coding-agent development worker, not an in-product agent. It may modify and test product-runtime code within feature scope but must not use `.harness/` as application runtime state, configuration, telemetry, or orchestration.

Implement the active feature as the sole mutating worker:

1. Run `session`, reconstruct state from the small harness files, and read only task-relevant routed docs.
2. Confirm scope, acceptance, and applicable gates; describe a bounded approach.
3. Change only files needed for the active feature.
4. Run quick checks while working and the required verification at completion.
5. Record a normal result with `checkpoint --reason worker_yield`; use `--reason needs_input` when a user decision blocks progress.
6. Return only changed files, verification, risks, uncertainty, and the next routing decision, then yield to the persistent orchestrator.

Never hand-edit passing state or weaken checks to obtain a pass; use the feature's `verify` gate. Do not use `handoff` for an ordinary result. Use `handoff` only when another fresh worker must assume implementation context or ownership.

Correct reversible local command/test errors within the current scope and ownership; a shell error alone does not require a successor. Extra review rounds and process accounting are optional unless project policy requires them. Respect attempt budgets, reconcile unknown external outcomes before an authorized retry, and never automatically retry credentials or deployment.


## Bounded worker startup and ownership

Delegation must never inherit the implementation transcript. Codex uses `fork_turns="none"`; Claude Code uses a fresh non-fork Agent invocation. Other hosts use their fresh-worker mechanism. Run `session --json` for routing only. A fresh worker explicitly claims unowned working state with `node .harness/run.mjs claim`, or runs the exact delegated pending resume command. Then run `node .harness/run.mjs bootstrap --validate --json` (optionally a selected feature ID). This bounded projection replaces reading the full features/continuity/progress files during startup. Read config and task-relevant docs separately. Never dump baseline blobs or historical feature arrays into context.

The harness binds mutations to host `CODEX_THREAD_ID`, not shared `CODEX_SESSION_ID`. Other hosts must supply `--worker-id` on mutations as an explicit attestation. Normal worker_yield and needs_input revoke the owner; a retired worker cannot reclaim or resume. This is cooperative CLI enforcement, not protection against direct file edits or forged environments. The orchestrator cannot claim a child worker's ID.

Use `migrate` once after a runtime update to move legacy inline baselines into immutable content-addressed references without changing historical contracts or evidence. `doctor` authenticates referenced blobs.

PreCompact output systemMessage is UI text only. The SessionStart(compact) adapter emits supported additionalContext with routing; it does not load the transfer packet or resume mutations. Hook behavior is fixture-tested; per-invocation CODEX_THREAD_ID delivery to native hooks still requires host validation. Unknown hook identity with an active owner fails closed; another identified actor leaves that worker unchanged.
