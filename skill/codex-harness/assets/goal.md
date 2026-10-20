# Development Goal Loop

Template for a long-running coding goal. The orchestrator owns this file's intent; workers execute one feature at a time. This is repository-development process, not a product-runtime loop.

## Goal

State one durable objective.

## Acceptance criteria

- [ ] Machine-verifiable condition (each becomes a feature criterion + command).

## Scope

- Allowed: explicit paths.
- Hands off: explicit paths.

## Plan

Break the goal into features small enough for one worker each. Add them with dependencies so `next` orders the work.

## Loop

1. Orchestrator runs `node .harness/run.mjs session` and delegates the next step to a fresh maker worker.
2. Maker starts or continues the feature, implements, runs `verify`, and checkpoints (`worker_yield`).
3. For risky work, a fresh checker worker reviews the diff and evidence read-only.
4. Orchestrator records decisions, then routes the next feature.

## Stop conditions

- All acceptance criteria pass.
- A feature is blocked by its attempt budget or a repeated identical failure.
- A human decision or new authority is required (`needs_input`).
