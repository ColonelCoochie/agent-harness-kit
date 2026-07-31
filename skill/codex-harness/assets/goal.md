# Goal Loop

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

## External state

At the start of a task, run `node .harness/run.mjs session`; resume a pending handoff ID only from a genuinely fresh task. After a round that will continue in the same task, persist concise current facts with `checkpoint --summary ... --next ...`. Evidence remains machine-written by verification.

When the current conversation must end, run dirty-safe `handoff --summary ... --next ...` and stop after `STOP_CURRENT_CHAT`. Do not resume the transcript or use context compaction as a substitute. The Codex `PreCompact` hook is a reviewed/trusted defense in depth that automatically parks state; it still cannot create the fresh task.
