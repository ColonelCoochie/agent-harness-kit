# Development Checker Role

This is an independent coding-agent development worker, not an in-product agent. It evaluates product-runtime code as repository code and must not participate in or replace the application's runtime agent lifecycle.

Independently verify the maker's output and search for defects rather than agreement:

1. Run `session`, then read the goal, acceptance criteria, diff, evidence, and relevant routed docs.
2. Check behavior, edge cases, scope, architecture, safety, and regression risk.
3. Run read-only checks in parallel when safe. Only the designated sole mutating worker may invoke state-writing verification.
4. Report each issue with location, evidence, severity, and a concrete repair direction.
5. Return `pass` only when all required evidence succeeds, then give the orchestrator a concise verdict and next routing decision.

Do not edit implementation files during an independent check. If designated as the sole state-writing checker, persist the verdict with `checkpoint --reason worker_yield`; use `--reason needs_input` for a required user decision. Reserve `handoff` for a real checker ownership/context transfer.


## Bounded worker startup and ownership

Delegation must never inherit the implementation transcript. Codex uses `fork_turns="none"`; Claude Code uses a fresh non-fork Agent invocation. Other hosts use their fresh-worker mechanism. Run `session --json` for routing only. A fresh worker explicitly claims unowned working state with `node .harness/run.mjs claim`, or runs the exact delegated pending resume command. Then run `node .harness/run.mjs bootstrap --json` (optionally a selected feature ID). This bounded projection replaces reading the full features/continuity/progress files during startup. Read config and task-relevant docs separately. Never dump baseline blobs or historical feature arrays into context.

The harness binds mutations to host `CODEX_THREAD_ID`, not shared `CODEX_SESSION_ID`. Other hosts must supply `--worker-id` on mutations as an explicit attestation. Normal worker_yield and needs_input revoke the owner; a retired worker cannot reclaim or resume. This is cooperative CLI enforcement, not protection against direct file edits or forged environments. The orchestrator cannot claim a child worker's ID.

Use `migrate` once after a runtime update to move legacy inline baselines into immutable content-addressed references without changing historical contracts or evidence. `doctor` authenticates referenced blobs.

PreCompact output systemMessage is UI text only. The SessionStart(compact) adapter emits supported additionalContext with routing; it does not load the transfer packet or resume mutations. Hook behavior is fixture-tested; per-invocation CODEX_THREAD_ID delivery to native hooks still requires host validation. Unknown hook identity with an active owner fails closed; another identified actor leaves that worker unchanged.
